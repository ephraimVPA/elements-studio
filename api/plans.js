// POST/GET /api/plans -> 200 { plans: [{id, unitAmount, currency, type, interval, name, description}] }
// Lists the active prices on the configured product so the claim banner renders the
// exact purchase options you set up in Stripe (e.g. $1,500 one-time, $24/mo, $45/mo).
// No amounts are hardcoded — add/remove prices in Stripe and the banner follows.
// Package copy is Stripe-driven too: `name` = the price's nickname, `description` =
// the price's metadata.description. Edit those in the Stripe dashboard to change what
// the picker says, no code deploy needed. The banner has safe fallbacks when unset.

const Stripe = require('stripe');
const { cors, sendJson } = require('./_relay');

const DEFAULT_PRODUCT_ID = 'prod_UgxvHqPSyqPBnD';

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  try {
    if (!process.env.STRIPE_SECRET_KEY) return sendJson(res, 500, { error: 'stripe_not_configured' });
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const productId = process.env.STRIPE_PRODUCT_ID || DEFAULT_PRODUCT_ID;

    const list = await stripe.prices.list({ product: productId, active: true, limit: 20 });
    const plans = list.data
      .filter(function (p) { return p.unit_amount != null; })
      .map(function (p) {
        return {
          id: p.id,
          unitAmount: p.unit_amount,
          currency: p.currency,
          type: p.recurring ? 'recurring' : 'one_time',
          interval: p.recurring ? p.recurring.interval : null,
          name: p.nickname || null,
          description: (p.metadata && p.metadata.description) || null,
        };
      });
    // recurring first (cheapest -> dearest), then one-time
    plans.sort(function (a, b) {
      if (a.type !== b.type) return a.type === 'recurring' ? -1 : 1;
      return a.unitAmount - b.unitAmount;
    });
    return sendJson(res, 200, { plans: plans });
  } catch (err) {
    return sendJson(res, 500, { error: (err && err.message) || 'plans_failed' });
  }
};
