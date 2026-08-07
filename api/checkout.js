// POST /api/checkout  body {sub, business, price?}
//   -> 200 JSON { clientSecret, publishableKey }
// Creates an embedded Stripe Checkout Session the claim banner mounts inline
// (redirect_on_completion:"never"). Mode is derived from the chosen price:
// a recurring price -> subscription, a one-time price -> payment. `price` comes
// from /api/plans (the plan the buyer picked); if omitted, the product's
// default_price is used. Adapted from Helfzen's embedded checkout.

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
    const productId = process.env.STRIPE_PRODUCT_ID || DEFAULT_PRODUCT_ID;

    // Resolve the price: the picked one (body.price) or STRIPE_PRICE_ID, else the
    // product's default_price.
    let price = String(body.price || '') || process.env.STRIPE_PRICE_ID || '';
    if (!price) {
      const product = await stripe.products.retrieve(productId);
      const dp = product && product.default_price;
      price = typeof dp === 'string' ? dp : (dp && dp.id) || '';
    }
    if (!price) return sendJson(res, 500, { error: 'no_price_configured' });

    // Look up the price to pick the mode AND to make sure the buyer can only check
    // out a price that belongs to our product (no arbitrary price ids).
    const priceObj = await stripe.prices.retrieve(price);
    const belongsToProduct = priceObj && (priceObj.product === productId);
    if (!belongsToProduct) return sendJson(res, 400, { error: 'price_not_allowed' });
    const mode = priceObj.recurring ? 'subscription' : 'payment';

    const params = {
      mode,
      ui_mode: 'embedded',
      redirect_on_completion: 'never',
      line_items: [{ price, quantity: 1 }],
      allow_promotion_codes: true,
      metadata: { sub, business },
    };
    if (mode === 'subscription') params.subscription_data = { metadata: { sub, business } };
    else params.payment_intent_data = { metadata: { sub, business } };

    const session = await stripe.checkout.sessions.create(params);
    if (!session.client_secret) return sendJson(res, 500, { error: 'no_client_secret' });

    return sendJson(res, 200, {
      clientSecret: session.client_secret,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
    });
  } catch (err) {
    return sendJson(res, 500, { error: (err && err.message) || 'checkout_failed' });
  }
};
