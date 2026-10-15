// services/email.js - Azure Communication Services email (kebab-case schema)
import { EmailClient } from '@azure/communication-email';
import config from '../config/index.js';
import { lineTableHtml, lineTableText } from './orderMail.js';

let emailClient = null;

/**
 * Initialize email client
 */
function getEmailClient() {
  if (!emailClient && config.azure.commConnectionString) {
    emailClient = new EmailClient(config.azure.commConnectionString);
  }
  return emailClient;
}

/**
 * Helper to get order fields (handles both kebab and camelCase)
 */
function getOrderFields(order) {
  return {
    orderNumber: order['order-number'] || order.orderNumber,
    modelData: order['model-data'] || order.modelData,
    guestEmail: order['guest-email'] || order.guestEmail,
    createdAt: order['created-at'] || order.createdAt,
  };
}

/**
 * Helper to get address fields
 */
function getAddressFields(address) {
  return {
    name: address.name,
    street: address['address-1'] || address.street,
    street2: address['address-2'] || address.street2,
    city: address.city,
    state: address.state,
    zip: address.zip,
  };
}

/**
 * Send email verification code to user
 */
export async function sendVerificationEmail(email, code, name) {
  const client = getEmailClient();
  
  if (!client) {
    console.warn('[Email] Azure not configured, skipping verification email');
    // In development, log the code
    console.log(`[Email] DEV MODE - Verification code for ${email}: ${code}`);
    return false;
  }
  
  const subject = `${code} is your verification code`;
  
  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #1e1e1e; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
    .header h1 { margin: 0; font-size: 24px; }
    .content { background: #f8f9fa; padding: 30px; border: 1px solid #e9ecef; }
    .code-box { background: white; padding: 30px; border-radius: 8px; text-align: center; margin: 20px 0; border: 2px dashed #1e1e1e; }
    .code { font-size: 36px; font-weight: bold; color: #1a1a2e; letter-spacing: 8px; font-family: monospace; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 14px; }
    .warning { color: #856404; background: #fff3cd; padding: 12px; border-radius: 6px; font-size: 13px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Verify Your Email</h1>
    </div>
    <div class="content">
      <p>Hi${name ? ` ${name}` : ''},</p>
      <p>Thanks for signing up! Please use the verification code below to complete your registration:</p>
      
      <div class="code-box">
        <div class="code">${code}</div>
      </div>
      
      <p>This code will expire in <strong>15 minutes</strong>.</p>
      
      <div class="warning">
        ⚠️ If you didn't create an account with SurfCAD, please ignore this email.
      </div>
    </div>
    <div class="footer">
      <p>&copy; ${new Date().getFullYear()} SurfCAD. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
  `;
  
  const plainTextContent = `
Your SurfCAD Verification Code

Hi${name ? ` ${name}` : ''},

Thanks for signing up! Your verification code is:

${code}

This code will expire in 15 minutes.

If you didn't create an account with SurfCAD, please ignore this email.
  `;
  
  try {
    const message = {
      senderAddress: config.azure.emailSender,
      content: {
        subject,
        plainText: plainTextContent,
        html: htmlContent,
      },
      recipients: {
        to: [{ address: email }],
      },
    };
    
    const poller = await client.beginSend(message);
    const result = await poller.pollUntilDone();
    
    console.log(`[Email] Verification email sent to ${email}, messageId: ${result.id}`);
    return true;
  } catch (error) {
    console.error('[Email] Failed to send verification email:', error);
    return false;
  }
}

/**
 * Send admin notification for new verified user
 */
export async function sendAdminNewUserNotification(user) {
  const client = getEmailClient();
  
  if (!client || !config.adminEmail) {
    console.warn('[Email] Skipping admin new user notification (not configured)');
    return false;
  }
  
  const subject = `New User Verified: ${user.email}`;
  
  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: monospace; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 8px; text-align: left; border-bottom: 1px solid #ddd; }
    th { background: #f5f5f5; }
  </style>
</head>
<body>
  <div class="container">
    <h2>👤 New User Verified</h2>
    
    <table>
      <tr><th>Email</th><td>${user.email}</td></tr>
      <tr><th>Name</th><td>${user.name || 'Not provided'}</td></tr>
      <tr><th>Auth Provider</th><td>${user.authProvider}</td></tr>
      <tr><th>Verified At</th><td>${new Date().toLocaleString()}</td></tr>
      <tr><th>Created At</th><td>${new Date(user.createdAt).toLocaleString()}</td></tr>
    </table>
    
    <p style="color: #666; font-size: 12px; margin-top: 20px;">
      User ID: ${user._id}
    </p>
  </div>
</body>
</html>
  `;
  
  try {
    const message = {
      senderAddress: config.azure.emailSender,
      content: {
        subject,
        html: htmlContent,
      },
      recipients: {
        to: [{ address: config.adminEmail }],
      },
    };
    
    const poller = await client.beginSend(message);
    await poller.pollUntilDone();
    
    console.log(`[Email] Admin notification sent for new user ${user.email}`);
    return true;
  } catch (error) {
    console.error('[Email] Failed to send admin new user notification:', error);
    return false;
  }
}

/**
 * Send order confirmation email to customer
 */
export async function sendOrderConfirmation(order, customerEmail) {
  const client = getEmailClient();
  
  if (!client) {
    console.warn('[Email] Azure not configured, skipping order confirmation');
    return false;
  }
  
  const { orderNumber } = getOrderFields(order);
  const address = getAddressFields(order.shipping.address);
  const linesHtml = lineTableHtml(order);
  const linesText = lineTableText(order);
  
  const subject = `Order Confirmed: ${orderNumber}`;
  
  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #1e1e1e; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
    .header h1 { margin: 0; font-size: 24px; }
    .content { background: #f8f9fa; padding: 30px; border: 1px solid #e9ecef; }
    .order-details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
    .detail-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee; }
    .detail-row:last-child { border-bottom: none; }
    .label { color: #666; }
    .value { font-weight: 600; }
    .total-row { font-size: 18px; color: #1a1a2e; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 14px; }
    .button { display: inline-block; background: #1e1e1e; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Order Confirmed! 🎉</h1>
    </div>
    <div class="content">
      <p>Thank you for your order! We've received your order and will begin manufacturing shortly.</p>
      
      <div class="order-details">
        <h3 style="margin-top: 0;">Order Details</h3>
        <div class="detail-row">
          <span class="label">Order Number</span>
          <span class="value">${orderNumber}</span>
        </div>
        ${linesHtml}
        <div class="detail-row">
          <span class="label">Shipping</span>
          <span class="value">${order.shipping.service || 'Standard'}</span>
        </div>
        <div class="detail-row total-row">
          <span class="label">Total</span>
          <span class="value">$${order.quote.total.toFixed(2)}</span>
        </div>
      </div>
      
      <h3>Shipping Address</h3>
      <p>
        ${address.name}<br>
        ${address.street}<br>
        ${address.street2 ? address.street2 + '<br>' : ''}
        ${address.city}, ${address.state} ${address.zip}
      </p>
      
      <p>We'll send you another email with tracking information once your order ships.</p>
    </div>
    <div class="footer">
      <p>Questions? Reply to this email or contact support.</p>
      <p>&copy; ${new Date().getFullYear()} SurfCAD. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
  `;
  
  const plainTextContent = `
Order Confirmed: ${orderNumber}

Thank you for your order! We've received your order and will begin manufacturing shortly.

Order Details:
- Order Number: ${orderNumber}
${linesText}
- Shipping: ${order.shipping.service || 'Standard'}
- Total: $${order.quote.total.toFixed(2)}

Shipping Address:
${address.name}
${address.street}
${address.street2 || ''}
${address.city}, ${address.state} ${address.zip}

We'll send you tracking information once your order ships.
  `;
  
  try {
    const message = {
      senderAddress: config.azure.emailSender,
      content: {
        subject,
        plainText: plainTextContent,
        html: htmlContent,
      },
      recipients: {
        to: [{ address: customerEmail }],
      },
    };
    
    const poller = await client.beginSend(message);
    const result = await poller.pollUntilDone();
    
    console.log(`[Email] Order confirmation sent to ${customerEmail}, messageId: ${result.id}`);
    return true;
  } catch (error) {
    console.error('[Email] Failed to send order confirmation:', error);
    return false;
  }
}

/**
 * Send order notification to admin
 */
export async function sendAdminOrderNotification(order, customerEmail) {
  const client = getEmailClient();
  
  if (!client || !config.adminEmail) {
    console.warn('[Email] Skipping admin notification (not configured)');
    return false;
  }
  
  const { orderNumber } = getOrderFields(order);
  const address = getAddressFields(order.shipping.address);
  const linesHtml = lineTableHtml(order, { downloads: true });
  const boxCount = Number(order.shipping?.['package-count']) || 1;
  
  const subject = `🔔 New Order: ${orderNumber} - $${order.quote.total.toFixed(2)}`;
  
  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: monospace; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 8px; text-align: left; border-bottom: 1px solid #ddd; }
    th { background: #f5f5f5; }
  </style>
</head>
<body>
  <div class="container">
    <h2>🔔 New Order Received</h2>
    
    <table>
      <tr><th>Order #</th><td>${orderNumber}</td></tr>
      <tr><th>Customer</th><td>${customerEmail}</td></tr>
      <tr><th>Status</th><td>${order.status}</td></tr>
      ${boxCount > 1 ? `<tr><th>Boxes</th><td>${boxCount}</td></tr>` : ''}
    </table>

    <h3>Parts</h3>
    ${linesHtml}
    
    <h3>Pricing</h3>
    <table>
      <tr><th>Material Cost</th><td>$${order.quote['material-cost']?.toFixed(2) || order.quote.material?.toFixed(2)}</td></tr>
      <tr><th>Machine Cost</th><td>$${order.quote['machine-cost']?.toFixed(2) || order.quote.machine?.toFixed(2)}</td></tr>
      <tr><th>Shipping</th><td>$${order.quote['shipping-cost']?.toFixed(2) || order.quote.shipping?.toFixed(2)}</td></tr>
      <tr><th>Tax</th><td>$${order.quote.tax.toFixed(2)}</td></tr>
      <tr><th><strong>Total</strong></th><td><strong>$${order.quote.total.toFixed(2)}</strong></td></tr>
    </table>
    
    <h3>Shipping</h3>
    <p>
      ${address.name}<br>
      ${address.street}<br>
      ${address.street2 || ''}<br>
      ${address.city}, ${address.state} ${address.zip}<br>
      ${order.shipping.address.phone || 'No phone'}
    </p>
    <p><strong>Method:</strong> ${order.shipping.service || order.shipping.method}</p>
    
    <p style="color: #666; font-size: 12px;">
      Received: ${new Date(order['created-at'] || order.createdAt).toLocaleString()}
    </p>
  </div>
</body>
</html>
  `;
  
  try {
    const message = {
      senderAddress: config.azure.emailSender,
      content: {
        subject,
        html: htmlContent,
      },
      recipients: {
        to: [{ address: config.adminEmail }],
      },
    };
    
    const poller = await client.beginSend(message);
    await poller.pollUntilDone();
    
    console.log(`[Email] Admin notification sent for order ${orderNumber}`);
    return true;
  } catch (error) {
    console.error('[Email] Failed to send admin notification:', error);
    return false;
  }
}

/**
 * Send shipping notification with tracking
 */
export async function sendShippingNotification(order, customerEmail) {
  const client = getEmailClient();
  
  if (!client) {
    console.warn('[Email] Azure not configured, skipping shipping notification');
    return false;
  }
  
  const { orderNumber } = getOrderFields(order);
  const address = getAddressFields(order.shipping.address);
  const linesHtml = lineTableHtml(order);
  const trackingNumber = order.shipping['tracking-number'] || order.shipping.trackingNumber;
  const trackingUrl = order.shipping['tracking-url'] || order.shipping.trackingUrl || 
    `https://www.ups.com/track?tracknum=${trackingNumber}`;
  
  const subject = `Your Order Has Shipped: ${orderNumber}`;
  
  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #2d5a27; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background: #f8f9fa; padding: 30px; border: 1px solid #e9ecef; }
    .tracking-box { background: white; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0; }
    .tracking-number { font-size: 24px; font-weight: bold; color: #2d5a27; font-family: monospace; }
    .button { display: inline-block; background: #2d5a27; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 14px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📦 Your Order Has Shipped!</h1>
    </div>
    <div class="content">
      <p>Great news! Your order <strong>${orderNumber}</strong> is on its way.</p>
      ${linesHtml}
      
      <div class="tracking-box">
        <p style="margin: 0 0 10px 0;">Tracking Number</p>
        <div class="tracking-number">${trackingNumber}</div>
        <p style="margin: 15px 0 0 0;">
          <a href="${trackingUrl}" class="button">Track Package</a>
        </p>
      </div>
      
      <h3>Shipping To</h3>
      <p>
        ${address.name}<br>
        ${address.street}<br>
        ${address.city}, ${address.state} ${address.zip}
      </p>
      
      <p><strong>Carrier:</strong> ${order.shipping.carrier}<br>
      <strong>Service:</strong> ${order.shipping.service}</p>
    </div>
    <div class="footer">
      <p>&copy; ${new Date().getFullYear()} SurfCAD. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
  `;
  
  try {
    const message = {
      senderAddress: config.azure.emailSender,
      content: {
        subject,
        html: htmlContent,
      },
      recipients: {
        to: [{ address: customerEmail }],
      },
    };
    
    const poller = await client.beginSend(message);
    await poller.pollUntilDone();
    
    console.log(`[Email] Shipping notification sent to ${customerEmail}`);
    return true;
  } catch (error) {
    console.error('[Email] Failed to send shipping notification:', error);
    return false;
  }
}

/**
 * Send urgent admin notification when a dispute is opened
 * @param {Object} order - The order document
 * @param {Object} dispute - The Stripe dispute object
 * @param {string} customerEmail - Customer's email address
 */
export async function sendAdminDisputeNotification(order, dispute, customerEmail) {
  const client = getEmailClient();
  
  if (!client || !config.adminEmail) {
    console.warn('[Email] Skipping admin dispute notification (not configured)');
    return false;
  }

  const { orderNumber } = getOrderFields(order);
  const linesHtml = lineTableHtml(order);
  const disputeAmount = (dispute.amount / 100).toFixed(2);
  const disputeReason = dispute.reason?.replace(/_/g, ' ') || 'Unknown reason';
  const disputeStatus = dispute.status || 'open';

  const subject = `🚨 DISPUTE OPENED: Order ${orderNumber} - $${disputeAmount}`;

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: monospace; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
    th { background: #f5f5f5; }
    .alert { background: #ffebee; color: #c62828; padding: 16px; border-radius: 6px; margin: 16px 0; font-weight: bold; }
  </style>
</head>
<body>
  <div class="container">
    <h2>🚨 STRIPE DISPUTE OPENED</h2>
    
    <div class="alert">
      A customer has opened a dispute for $${disputeAmount}
    </div>

    <table>
      <tr><th>Order #</th><td>${orderNumber}</td></tr>
      <tr><th>Customer</th><td>${customerEmail}</td></tr>
      <tr><th>Dispute Amount</th><td>$${disputeAmount}</td></tr>
      <tr><th>Reason</th><td>${disputeReason}</td></tr>
      <tr><th>Status</th><td>${disputeStatus}</td></tr>
      <tr><th>Dispute ID</th><td>${dispute.id}</td></tr>
      <tr><th>Payment Intent</th><td>${dispute.payment_intent || '—'}</td></tr>
    </table>

    <h3>Order Summary</h3>
    ${linesHtml}
    <p>Created: ${new Date(order['created-at'] || order.createdAt).toLocaleString()}</p>

    <p style="margin-top: 24px; color: #555;">
      <strong>Action required:</strong> Review evidence requirements and respond within the deadline.<br>
      Stripe Dashboard → Disputes → ${dispute.id}
    </p>

    <p style="color: #666; font-size: 12px; margin-top: 24px;">
      Order ID: ${order._id}<br>
      Dispute opened: ${new Date().toLocaleString()}
    </p>
  </div>
</body>
</html>
  `;

  try {
    const message = {
      senderAddress: config.azure.emailSender,
      content: {
        subject,
        html: htmlContent,
      },
      recipients: {
        to: [{ address: config.adminEmail }],
      },
    };
    
    const poller = await client.beginSend(message);
    await poller.pollUntilDone();
    
    console.log(`[Email] Admin DISPUTE notification sent for order ${orderNumber} / dispute ${dispute.id}`);
    return true;
  } catch (error) {
    console.error('[Email] Failed to send admin dispute notification:', error);
    return false;
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Notify admin (Artur via ADMIN_EMAIL) about a new partner lead.
 */
export async function sendPartnerLeadNotification(lead) {
  const client = getEmailClient();

  if (!client || !config.adminEmail) {
    console.warn('[Email] Skipping partner lead notification (not configured)');
    return false;
  }

  const typeLabel = lead.partnerType === 'other' && lead.partnerTypeOther
    ? `Other — ${lead.partnerTypeOther}`
    : lead.partnerType;

  const subject = `Partner inquiry: ${lead.company} (${lead.email})`;

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: monospace; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 8px; text-align: left; border-bottom: 1px solid #ddd; vertical-align: top; }
    th { background: #f5f5f5; width: 140px; }
    pre { white-space: pre-wrap; margin: 0; font-family: inherit; }
  </style>
</head>
<body>
  <div class="container">
    <h2>Become a partner — new submission</h2>
    <table>
      <tr><th>Name</th><td>${escapeHtml(lead.name)}</td></tr>
      <tr><th>Email</th><td>${escapeHtml(lead.email)}</td></tr>
      <tr><th>Company</th><td>${escapeHtml(lead.company)}</td></tr>
      <tr><th>Website</th><td>${escapeHtml(lead.website || '—')}</td></tr>
      <tr><th>Partner type</th><td>${escapeHtml(typeLabel)}</td></tr>
      <tr><th>Message</th><td><pre>${escapeHtml(lead.message)}</pre></td></tr>
      <tr><th>Submitted</th><td>${new Date(lead.createdAt || Date.now()).toLocaleString()}</td></tr>
    </table>
    <p style="color: #666; font-size: 12px; margin-top: 20px;">
      Lead ID: ${escapeHtml(lead._id)}
    </p>
  </div>
</body>
</html>
  `;

  try {
    const message = {
      senderAddress: config.azure.emailSender,
      content: {
        subject,
        html: htmlContent,
      },
      recipients: {
        to: [{ address: config.adminEmail }],
      },
    };

    const poller = await client.beginSend(message);
    await poller.pollUntilDone();

    console.log(`[Email] Partner lead notification sent for ${lead.email}`);
    return true;
  } catch (error) {
    console.error('[Email] Failed to send partner lead notification:', error);
    return false;
  }
}

export default {
  sendVerificationEmail,
  sendAdminNewUserNotification,
  sendOrderConfirmation,
  sendAdminOrderNotification,
  sendAdminDisputeNotification,
  sendShippingNotification,
  sendPartnerLeadNotification,
};
