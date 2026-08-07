// POST /api/webhook  (Stripe raw body)  -> 200 {received:true}
// Verifies the Stripe signature against the RAW request body (never JSON-parsed
// before verification) and fans state changes into the Sheet via Apps Script.
// Adapted from Helfzen's billing/webhook route (constructEvent on raw body,
// metadata-keyed linkage, idempotent downstream writes). Server-to-server: no CORS.

const Stripe = require('stripe');
const { readRawBody, callAppsScript } = require('./_relay');

// Disable Vercel's body parser so we receive the exact bytes Stripe signed.
module.exports.config = { api: { bodyParser: false } };

function idOf(v) {
  if (!v) return null;
  return typeof v === 'string' ? v : (v.id || null);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end('method_not_allowed');
    return;
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  // 1) Verify signature against the raw body. Failure => 400 (no processing).
  let event;
  try {
    const raw = await readRawBody(req);
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    res.statusCode = 400;
    res.end('signature_verification_failed: ' + ((err && err.message) || ''));
    return;
  }

  // 2) Apply the state change. markPaid is the only path that records a sale, so if
  //    it throws we return 500 and let Stripe retry (the Sheet write is idempotent —
  //    it just re-sets status='won'). markCanceled is best-effort.
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object || {};
        const sub = s.metadata && s.metadata.sub;
        const subscriptionId = idOf(s.subscription);
        const customerId = idOf(s.customer);
        if (sub) await callAppsScript('markPaid', { sub, subscriptionId, customerId });
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object || {};
        const subMeta = (sub.metadata && sub.metadata.sub) || null;
        try {
          await callAppsScript('markCanceled', {
            sub: subMeta,
            subscriptionId: sub.id || null,
            customerId: idOf(sub.customer),
          });
        } catch (_) { /* best-effort */ }
        break;
      }
      default:
        break; // acknowledged and ignored
    }
  } catch (err) {
    // Critical downstream (markPaid) failed — signal a retry to Stripe.
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'processing_failed' }));
    return;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ received: true }));
};
