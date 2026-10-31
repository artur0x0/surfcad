// routes/webhooks.js - Webhook handlers (kebab-case schema)
import { Router } from 'express';
import express from 'express';
import Order from '../db/models/Order.js';
import MoldingLead from '../db/models/MoldingLead.js';
import stripe from '../services/stripe.js';
import email from '../services/email.js';
import { applyReviewCheckoutSession, applyReviewPaymentIntent } from '../services/moldingReviewCheckout.js';

const router = Router();

/**
 * POST /api/webhooks/stripe
 * Handle Stripe webhook events
 * Note: This route needs raw body parsing, not JSON
 */
router.post('/stripe', 
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const signature = req.headers['stripe-signature'];
    
    if (!signature) {
      console.error('[Webhook] Missing Stripe signature');
      return res.status(400).json({ error: 'Missing signature' });
    }
    
    let event;
    
    try {
      event = stripe.verifyWebhookSignature(req.body, signature);
    } catch (error) {
      console.error('[Webhook] Signature verification failed:', error.message);
      return res.status(400).json({ error: 'Invalid signature' });
    }
    
    console.log(`[Webhook] Received Stripe event: ${event.type}`);
    
    try {
      switch (event.type) {
        case 'payment_intent.succeeded':
          if (event.data.object?.metadata?.purpose === 'molding_review') {
            await applyReviewPaymentIntent({ MoldingLead }, event.data.object);
            break;
          }
          await handlePaymentSucceeded(event.data.object);
          break;
          
        case 'payment_intent.payment_failed':
          if (event.data.object?.metadata?.purpose === 'molding_review') break;
          await handlePaymentFailed(event.data.object);
          break;

        case 'checkout.session.completed':
        case 'checkout.session.async_payment_succeeded':
          await applyReviewCheckoutSession({ MoldingLead }, event.data.object);
          break;

        case 'checkout.session.async_payment_failed':
        case 'checkout.session.expired':
          break;
          
        case 'charge.refunded':
          await handleRefund(event.data.object);
          break;
          
        case 'charge.dispute.created':
          await handleDispute(event.data.object);
          break;
          
        default:
          console.log(`[Webhook] Unhandled event type: ${event.type}`);
      }
      
      return res.json({ received: true });
      
    } catch (error) {
      console.error(`[Webhook] Error handling ${event.type}:`, error);
      // Return 200 to prevent Stripe from retrying
      return res.json({ received: true, error: error.message });
    }
  }
);

/**
 * Handle successful payment
 */
async function handlePaymentSucceeded(paymentIntent) {
  const { orderId } = paymentIntent.metadata;
  
  if (!orderId) {
    console.warn('[Webhook] Payment succeeded but no orderId in metadata');
    return;
  }
  
  const order = await Order.findById(orderId);
  
  if (!order) {
    console.error(`[Webhook] Order not found: ${orderId}`);
    return;
  }
  
  // Skip if already paid
  if (order.status === 'paid') {
    console.log(`[Webhook] Order ${order['order-number']} already marked as paid`);
    return;
  }
  
  // Update order with payment details
  const paymentDetails = await stripe.handlePaymentSuccess(paymentIntent);
  
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
  
  console.log(`[Webhook] Order ${order['order-number']} marked as paid`);
  
  // Send emails
  const userEmail = order['guest-email'] || 
    (await order.populate('user-id'))['user-id']?.email;
    
  if (userEmail) {
    email.sendOrderConfirmation(order, userEmail).catch(console.error);
    email.sendAdminOrderNotification(order, userEmail).catch(console.error);
  }
}

/**
 * Handle failed payment
 */
async function handlePaymentFailed(paymentIntent) {
  const { orderId } = paymentIntent.metadata;
  
  if (!orderId) return;
  
  const order = await Order.findById(orderId);
  
  if (!order) return;
  
  // Add timeline event but don't change status (user can retry)
  order.timeline.push({
    status: 'payment_failed',
    timestamp: new Date(),
    note: paymentIntent.last_payment_error?.message || 'Payment failed',
    actor: 'system',
  });
  
  await order.save();
  
  console.log(`[Webhook] Payment failed for order ${order['order-number']}`);
}

/**
 * Handle refund
 */
async function handleRefund(charge) {
  // Find order by payment intent
  const order = await Order.findOne({
    'payment.stripe-payment-intent-id': charge.payment_intent,
  });
  
  if (!order) {
    console.warn('[Webhook] Order not found for refund');
    return;
  }
  
  const refundAmount = charge.amount_refunded / 100;
  const isFullRefund = charge.refunded;
  
  order.payment['refunded-at'] = new Date();
  order.payment['refund-amount'] = refundAmount;
  
  if (isFullRefund) {
    order.addTimelineEvent('refunded', `Full refund: $${refundAmount.toFixed(2)}`);
  } else {
    order.timeline.push({
      status: 'partial_refund',
      timestamp: new Date(),
      note: `Partial refund: $${refundAmount.toFixed(2)}`,
      actor: 'system',
    });
  }
  
  await order.save();
  
  console.log(`[Webhook] Refund processed for order ${order['order-number']}`);
}

/**
 * Handle dispute
 */
async function handleDispute(dispute) {
  const order = await Order.findOne({
    'payment.stripe-payment-intent-id': dispute.payment_intent,
  });
  
  if (!order) return;
  
  order.timeline.push({
    status: 'dispute',
    timestamp: new Date(),
    note: `Dispute opened: ${dispute.reason}`,
    actor: 'system',
  });
  
  await order.save();
  
  // Notify admin
  console.warn(`[Webhook] DISPUTE opened for order ${order['order-number']}`);

  // Notify admin via email
  const userEmail = order['guest-email'] || 
    (await order.populate('user-id'))?.['user-id']?.email;

  await email.sendAdminDisputeNotification(order, dispute, userEmail || 'unknown@email.com')
    .catch(err => console.error('[Webhook] Failed to send dispute admin email:', err));
  }

export default router;
