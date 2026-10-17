// routes/orders.js - Order management routes
import { Router } from 'express';
import Order from '../db/models/Order.js';
import Quote from '../db/models/Quote.js';
import stripe from '../services/stripe.js';
import email from '../services/email.js';
import ups from '../services/ups.js';
import config from '../config/index.js';
import { priceOrder } from '../services/orderPrice.js';
import { quoteFromGeometry, clampQuantity, roundMoney } from '../../src/utils/quoteMath.js';
import { measureExportedPart } from '../services/measurePart.js';
import { checkoutLines, idempotentReplay } from '../services/multiLineCheckout.js';
import { pickModelFile } from '../services/orderLines.js';
import { verifyModelLink } from '../services/modelLink.js';
import { requireAuth, requireGuestOrAuth } from '../auth/session.js';
import {
  canReadOrder,
  createOrderLookupLimiter,
  publicOrderView,
} from '../auth/orderAccess.js';

const orderLookupLimiter = createOrderLookupLimiter();

function copyCount(order) {
  const n = Number(order?.['model-data']?.quantity);
  if (!Number.isInteger(n) || n < 1 || n > 999) return 1;
  return n;
}

const router = Router();

/**
 * POST /api/orders/create
 * Create a new order and get payment intent
 */
router.post('/create', requireGuestOrAuth, async (req, res) => {
  try {
    if (Array.isArray(req.body?.lines)) {
      return await createLinesOrder(req, res);
    }
    const {
      modelData,
      quote,
      shipping,
    } = req.body;
    
    // Validate required fields
    if (!modelData || !modelData.script || !modelData.process || !modelData.material) {
      return res.status(400).json({ error: 'Model data is required' });
    }

    if (!modelData.modelFile?.data && !modelData.modelFile?.['data']) {
      return res.status(400).json({ error: 'Model file is required' });
    }
    
    if (!quote || typeof quote.subtotal !== 'number') {
      return res.status(400).json({ error: 'Quote data is required' });
    }
    
    if (!shipping || !shipping.address || !shipping.method) {
      return res.status(400).json({ error: 'Shipping info is required' });
    }

    // Get state from address (handle both formats)
    const shippingState = shipping.address.state || shipping.address['state'];
    const shippingCountry = shipping.address.country || shipping.address['country'] || 'US';

    const qty = clampQuantity(modelData.quantity, { missing: 1 });
    if (modelData.quantity != null && modelData.quantity !== '' && qty == null) {
      return res.status(400).json({ error: 'Quantity must be an integer from 1 to 999' });
    }

    // Measure the exported part and price it here. Client volume and money
    // fields are not used. The PaymentIntent uses this result.
    const measured = await measureExportedPart(modelData);
    if (!measured.ok) {
      console.error('[Orders] Create rejected:', measured.detail || measured.error);
      return res.status(400).json({ error: measured.error });
    }

    let preview;
    try {
      preview = quoteFromGeometry({
        volume: measured.geometry.volume,
        boundingBox: measured.geometry.boundingBox,
        process: modelData.process,
        material: modelData.material,
        infill: modelData.infill || 20,
        quantity: qty,
      });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const dimensions = ups.calculatePackageDimensions(
      measured.geometry.boundingBox,
      1,
      qty,
    );
    const weight = ups.calculatePackageWeight(preview.materialGrams);
    const rates = await ups.getShippingRates(shipping.address, { dimensions, weight });
    const selectedRate = (rates || []).find((rate) => rate.code === shipping.method);
    if (!selectedRate || !Number.isFinite(selectedRate.price)) {
      return res.status(400).json({ error: 'Could not price the selected shipping method' });
    }

    const priced = priceOrder({
      volume: measured.geometry.volume,
      boundingBox: measured.geometry.boundingBox,
      process: modelData.process,
      material: modelData.material,
      infill: modelData.infill || 20,
      quantity: qty,
      shippingCost: selectedRate.price,
      state: shippingState,
      country: shippingCountry,
      clientQuote: quote,
    });
    if (!priced.ok) {
      return res.status(400).json({ error: priced.error });
    }

    const { tax, taxRate, total } = priced;
    const onePartBox = priced.quote.boundingBox;

    // Map address to kebab-case (handle both incoming formats)
    const mappedAddress = {
      name: shipping.address.name,
      'address-1': shipping.address.street || shipping.address['address-1'],
      'address-2': shipping.address.street2 || shipping.address['address-2'] || '',
      city: shipping.address.city,
      state: shippingState,
      zip: shipping.address.zip,
      country: shippingCountry,
      phone: shipping.address.phone || '',
    };
    
    // Create order document with kebab-case fields
    const orderData = {
      'model-data': {
        script: modelData.script,
        process: modelData.process,
        material: modelData.material,
        infill: modelData.infill || 20,
        'volume-mm3': priced.quote.volume,
        'surface-area-mm2': priced.quote.surfaceArea,
        quantity: priced.quantity,
        'bounding-box': {
          'width-mm': onePartBox.width,
          'height-mm': onePartBox.height,
          'depth-mm': onePartBox.depth,
        },
        'model-file': {
          'content-type': modelData.modelFile.contentType || modelData.modelFile['content-type'],
          'filename': modelData.modelFile.filename || modelData.modelFile['filename'],
          'data': modelData.modelFile.data
        }
      },
      quote: {
        'material-cost': priced.quote.costs.material,
        'machine-cost': priced.quote.costs.machine,
        subtotal: priced.quote.subtotal,
        'shipping-cost': priced.shipping,
        tax,
        'tax-rate': taxRate,
        total,
      },
      shipping: {
        address: mappedAddress,
        method: shipping.method,
        carrier: 'UPS',
        service: shipping.service,
        'estimated-delivery': shipping.estimatedDelivery || shipping['estimated-delivery'],
      },
      timeline: [{
        status: 'pending',
        timestamp: new Date(),
        note: 'Order created',
        actor: 'system',
      }],
    };

    console.log("[Orders] received order data: ", orderData)
    
    // Set user reference
    if (req.isAuthenticated()) {
      orderData['user-id'] = req.user._id;
    } else if (req.session.guestEmail) {
      orderData['guest-email'] = req.session.guestEmail;
      orderData['guest-session-id'] = req.session.guestId;
    } else {
      return res.status(400).json({ error: 'User or guest session required' });
    }
    
    // Add request metadata
    orderData.metadata = {
      'ip-address': req.ip,
      'user-agent': req.get('user-agent'),
    };
    
    const order = new Order(orderData);
    await order.save();
    
    console.log(`[Orders] Created order ${order['order-number']}`);
    
    // Create Stripe payment intent
    const customerEmail = req.user?.email || req.session.guestEmail;
    const { clientSecret, paymentIntentId } = await stripe.createPaymentIntent(order, {
      customerEmail,
    });
    
    // Store payment intent ID
    order.payment = { 'stripe-payment-intent-id': paymentIntentId };
    await order.save();
    
    return res.status(201).json({
      success: true,
      priceUpdated: priced.priceUpdated,
      order: {
        id: order._id,
        orderNumber: order['order-number'],
        total: order.quote.total,
        tax: order.quote.tax,
        subtotal: order.quote.subtotal,
        shipping: order.quote['shipping-cost'],
        material: order.quote['material-cost'],
        machine: order.quote['machine-cost'],
        quantity: copyCount(order),
      },
      clientSecret,
      publishableKey: stripe.getPublishableKey(),
    });
    
  } catch (error) {
    console.error('[Orders] Create error:', error);
    return res.status(500).json({ 
      error: 'Failed to create order',
      details: error.message,
    });
  }
});

/**
 * POST /api/orders/:orderId/confirm
 * Confirm order after successful payment
 */
router.post('/:orderId/confirm', requireGuestOrAuth, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { paymentIntentId } = req.body;
    
    const order = await Order.findById(orderId);
    
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    // Verify ownership
    if (req.isAuthenticated()) {
      if (order['user-id']?.toString() !== req.user._id.toString()) {
        return res.status(403).json({ error: 'Not authorized' });
      }
    } else if (order['guest-session-id'] !== req.session.guestId) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    // Verify payment intent matches
    if (order.payment?.['stripe-payment-intent-id'] !== paymentIntentId) {
      return res.status(400).json({ error: 'Payment intent mismatch' });
    }
    
    // Verify payment succeeded with Stripe
    const paymentIntent = await stripe.getPaymentIntent(paymentIntentId);
    
    if (paymentIntent.status !== 'succeeded') {
      return res.status(400).json({ 
        error: 'Payment not completed',
        status: paymentIntent.status,
      });
    }
    
    // Update order status
    const paymentDetails = await stripe.handlePaymentSuccess(paymentIntent);
    
    // Map payment details to kebab-case
    order.payment = {
      ...order.payment,
      'stripe-payment-intent-id': paymentDetails.paymentIntentId,
      'stripe-customer-id': paymentDetails.customerId,
      method: paymentDetails.method,
      'card-last4': paymentDetails.last4,
      'card-brand': paymentDetails.brand,
      'paid-at': new Date(),
    };
    order.addTimelineEvent('paid', 'Payment received');
    await order.save();
    
    console.log(`[Orders] Order ${order['order-number']} confirmed and paid`);
    
    // Send confirmation emails (async, don't wait)
    const userEmail = req.user?.email || order['guest-email'];
    email.sendOrderConfirmation(order, userEmail).catch(console.error);
    email.sendAdminOrderNotification(order, userEmail).catch(console.error);
    
    return res.json({
      success: true,
      order: {
        orderNumber: order['order-number'],
        status: order.status,
        total: order.quote.total,
        quantity: copyCount(order),
      },
    });
    
  } catch (error) {
    console.error('[Orders] Confirm error:', error);
    return res.status(500).json({ 
      error: 'Failed to confirm order',
      details: error.message,
    });
  }
});

/**
 * GET /api/orders/model?order=&line=&exp=&sig=
 * Signed 3MF download. Wrong signature and expired links are both 404.
 */
router.get('/model', async (req, res) => {
  try {
    const orderNumber = req.query.order;
    const line = req.query.line || '';
    const { exp, sig } = req.query;
    if (!verifyModelLink({
      orderNumber,
      lineId: line,
      exp,
      sig,
      secret: config.session.secret || '',
    })) {
      return res.status(404).json({ error: 'Not found' });
    }

    const order = await Order.findByOrderNumber(String(orderNumber));
    if (!order) return res.status(404).json({ error: 'Not found' });

    const file = pickModelFile(order, line);
    const data = file?.data ?? file?.['data'];
    if (!data) return res.status(404).json({ error: 'Not found' });

    const cleaned = String(data).replace(/^data:[^,]*,/, '').replace(/\s/g, '');
    const buffer = Buffer.from(cleaned, 'base64');
    const filename = String(file.filename || file['filename'] || `${orderNumber}.3mf`).replace(/["\r\n]/g, '');
    res.setHeader('Content-Type', file['content-type'] || file.contentType || 'model/3mf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(buffer);
  } catch (error) {
    console.error('[Orders] Model download error:', error);
    return res.status(404).json({ error: 'Not found' });
  }
});

/**
 * GET /api/orders
 * Get user's orders
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const orders = await Order.findUserOrders(req.user._id);
    
    return res.json({
      success: true,
      orders,
    });
  } catch (error) {
    console.error('[Orders] List error:', error);
    return res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

/**
 * GET /api/orders/:orderNumber
 * Get single order by order number
 */
router.get('/:orderNumber', orderLookupLimiter, async (req, res) => {
  try {
    const { orderNumber } = req.params;
    
    const order = await Order.findByOrderNumber(orderNumber);
    
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const access = canReadOrder(req, order);
    if (!access.ok) {
      const status = req.isAuthenticated?.() ? access.status : 404;
      return res.status(status).json({
        error: status === 404 ? 'Order not found' : access.error,
      });
    }
    
    return res.json({
      success: true,
      order: publicOrderView(order),
    });
  } catch (error) {
    console.error('[Orders] Get error:', error);
    return res.status(500).json({ error: 'Failed to fetch order' });
  }
});

/**
 * GET /api/orders/lookup/:orderNumber
 * Guest order lookup by order number and email
 */
router.get('/lookup/:orderNumber', orderLookupLimiter, async (req, res) => {
  try {
    const { orderNumber } = req.params;
    const guestEmail = typeof req.query.email === 'string' ? req.query.email : '';

    if (!guestEmail.trim()) {
      return res.status(400).json({ error: 'Email is required for order lookup' });
    }
    
    const order = await Order.findByOrderNumber(orderNumber);
    
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const access = canReadOrder(req, order);
    if (!access.ok) {
      const status = req.isAuthenticated?.() ? access.status : 404;
      return res.status(status).json({
        error: status === 404 ? 'Order not found' : access.error,
      });
    }
    
    return res.json({
      success: true,
      order: publicOrderView(order),
    });
  } catch (error) {
    console.error('[Orders] Lookup error:', error);
    return res.status(500).json({ error: 'Failed to lookup order' });
  }
});

async function createLinesOrder(req, res) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Sign in to check out a cart' });
  }

  const idempotencyKey = String(req.get('Idempotency-Key') || '').trim();
  if (idempotencyKey.length > 200) {
    return res.status(400).json({ error: 'Idempotency-Key is too long' });
  }
  if (idempotencyKey) {
    const existing = await Order.findOne({
      'user-id': req.user._id,
      'metadata.idempotency-key': idempotencyKey,
    });
    if (existing) return sendReplay(res, existing);
  }

  // 20 lines per order keeps N inline 3MFs inside the 10mb JSON body.
  // Expand in future.
  const { lines, shipping, quote } = req.body;
  const clientShipping = shipping?.price
    ?? shipping?.cost
    ?? shipping?.['shipping-cost']
    ?? quote?.shipping
    ?? quote?.['shipping-cost'];

  const result = await checkoutLines({
    lines,
    shipping,
    userId: req.user._id,
    clientShipping,
    loadQuote: (quoteId) => Quote.findOne({ quoteId }),
  });
  if (!result.ok) {
    return res.status(result.status || 400).json({ error: result.error });
  }

  if (result.quotesToSave.length > 0) {
    await Quote.insertMany(result.quotesToSave);
  }

  const shippingState = result.state;
  const shippingCountry = result.country;
  const mappedAddress = {
    name: shipping.address.name,
    'address-1': shipping.address.street || shipping.address['address-1'],
    'address-2': shipping.address.street2 || shipping.address['address-2'] || '',
    city: shipping.address.city,
    state: shippingState,
    zip: shipping.address.zip,
    country: shippingCountry,
    phone: shipping.address.phone || '',
  };

  const orderData = {
    lines: result.orderLines.map((line) => ({
      lineId: line.lineId,
      partName: line.partName,
      assemblyName: line.assemblyName,
      partId: line.partId,
      source: line.source,
      surfId: line.surfId,
      scriptHash: line.scriptHash,
      quoteId: line.quoteId,
      process: line.process,
      material: line.material,
      infill: line.infill,
      quantity: line.quantity,
      'volume-mm3': line['volume-mm3'],
      'bounding-box': line['bounding-box'],
      'unit-subtotal': line['unit-subtotal'],
      'material-cost': line['material-cost'],
      'machine-cost': line['machine-cost'],
      'model-file': line['model-file'],
    })),
    quote: {
      'material-cost': result.priced.material,
      'machine-cost': result.priced.machine,
      subtotal: result.priced.subtotal,
      'shipping-cost': result.priced.shipping,
      tax: result.priced.tax,
      'tax-rate': result.priced.taxRate,
      total: result.priced.total,
    },
    shipping: {
      address: mappedAddress,
      method: shipping.method,
      carrier: 'UPS',
      service: shipping.service || result.selectedRate.name,
      'estimated-delivery': shipping.estimatedDelivery || shipping['estimated-delivery'] || result.selectedRate.estimatedDelivery,
      'package-count': result.boxes.length,
    },
    timeline: [{
      status: 'pending',
      timestamp: new Date(),
      note: 'Order created',
      actor: 'system',
    }],
    'user-id': req.user._id,
    metadata: {
      'ip-address': req.ip,
      'user-agent': req.get('user-agent'),
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    },
  };

  let order;
  try {
    order = new Order(orderData);
    await order.save();
  } catch (err) {
    if (err?.code === 11000 && idempotencyKey) {
      const existing = await Order.findOne({
        'user-id': req.user._id,
        'metadata.idempotency-key': idempotencyKey,
      });
      if (existing) return sendReplay(res, existing);
    }
    throw err;
  }

  console.log(`[Orders] Created order ${order['order-number']} (${order.lines.length} lines, ${result.boxes.length} boxes)`);

  const { clientSecret, paymentIntentId } = await stripe.createPaymentIntent(order, {
    customerEmail: req.user?.email,
  });
  order.payment = { 'stripe-payment-intent-id': paymentIntentId };
  await order.save();

  return res.status(201).json({
    success: true,
    priceUpdated: result.priced.priceUpdated,
    order: {
      id: order._id,
      orderNumber: order['order-number'],
      total: order.quote.total,
      tax: order.quote.tax,
      subtotal: order.quote.subtotal,
      shipping: order.quote['shipping-cost'],
      material: order.quote['material-cost'],
      machine: order.quote['machine-cost'],
      lineCount: order.lines.length,
      boxCount: result.boxes.length,
      lines: result.orderLines.map(publicLine),
    },
    skipped: result.skipped,
    clientSecret,
    publishableKey: stripe.getPublishableKey(),
  });
}

function publicLine(line) {
  const qty = line.quantity;
  const unit = line['unit-subtotal'];
  return {
    lineId: line.lineId,
    partName: line.partName,
    quantity: qty,
    quotedUnitPrice: unit,
    subtotal: roundMoney(unit * qty),
    quoteId: line.quoteId,
    quotedAt: line.quotedAt,
    scriptHash: line.scriptHash,
    requoted: line.requoted === true,
    process: line.process,
    material: line.material,
    infill: line.infill,
  };
}

async function sendReplay(res, existing) {
  const decision = idempotentReplay(existing);
  const summary = {
    id: existing._id,
    orderNumber: existing['order-number'],
    total: existing.quote?.total,
    tax: existing.quote?.tax,
    subtotal: existing.quote?.subtotal,
    shipping: existing.quote?.['shipping-cost'],
    material: existing.quote?.['material-cost'],
    machine: existing.quote?.['machine-cost'],
    lineCount: existing.lines?.length || 1,
    status: existing.status,
  };
  if (decision.kind === 'paid') {
    return res.status(200).json({
      success: true,
      alreadyPaid: true,
      priceUpdated: false,
      order: summary,
      clientSecret: null,
      publishableKey: stripe.getPublishableKey(),
    });
  }

  let clientSecret = null;
  if (decision.paymentIntentId) {
    const paymentIntent = await stripe.getPaymentIntent(decision.paymentIntentId);
    clientSecret = paymentIntent.client_secret;
  }
  return res.status(200).json({
    success: true,
    alreadyPaid: false,
    priceUpdated: false,
    order: summary,
    clientSecret,
    publishableKey: stripe.getPublishableKey(),
  });
}

export default router;
