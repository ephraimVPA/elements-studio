// POST /api/checkout  body {sub, business}
//   -> 200 JSON { clientSecret, publishableKey }
// Creates an embedded, subscription-mode Stripe Checkout Session that the claim
// banner mounts inline (redirect_on_completion:"never"). Adapted from Helfzen's
// createCheckoutSessionForOrg (embedded ui_mode + client_secret, metadata linkage).

const Stripe = require('stripe');
const { cors, readJson, sendJson } = require('./_relay');

const DEFAULT_PRODUCT_ID = 'prod_UgxvHqPSyqPBnD';

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'method_not_allowed' });

  try {
    if (!process.env.STRIPE_SECRET_KEY) return sendJson(res, 500, { error: 'stripe_not_configured' });
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    const body = await readJson(req);
    const sub = String(body.sub || '');
    const business = String(body.business || '');

    // Resolve the recurring price: an explicit STRIPE_PRICE_ID wins; otherwise use
    // the configured product's default_price.
    let price = process.env.STRIPE_PRICE_ID || '';
    if (!price) {
      const productId = process.env.STRIPE_PRODUCT_ID || DEFAULT_PRODUCT_ID;
      const product = await stripe.products.retrieve(productId);
      const dp = product && product.default_price;
      price = typeof dp === 'string' ? dp : (dp && dp.id) || '';
    }
    if (!price) return sendJson(res, 500, { error: 'no_price_configured' });

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      ui_mode: 'embedded',
      redirect_on_completion: 'never',
      line_items: [{ price, quantity: 1 }],
      allow_promotion_codes: true,
      metadata: { sub, business },
      subscription_data: { metadata: { sub, business } },
    });

    if (!session.client_secret) return sendJson(res, 500, { error: 'no_client_secret' });

    return sendJson(res, 200, {
      clientSecret: session.client_secret,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
    });
  } catch (err) {
    return sendJson(res, 500, { error: (err && err.message) || 'checkout_failed' });
  }
};
