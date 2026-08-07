// POST /api/visit  body {sub, business}
//   -> 200 JSON { days:<int>, firstVisitAt:<ISO string|null> }
// Records the first visit and returns the countdown window for the claim banner.

const { cors, readJson, geoFromHeaders, callAppsScript, sendJson } = require('./_relay');

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'method_not_allowed' });

  try {
    const body = await readJson(req);
    const sub = String(body.sub || '');
    const business = String(body.business || '');
    const geo = geoFromHeaders(req);

    const r = await callAppsScript('visit', {
      sub,
      business,
      geo,
      referrer: req.headers.referer || req.headers.referrer || '',
      ua: String(req.headers['user-agent'] || '').slice(0, 300),
    });

    return sendJson(res, 200, {
      days: (r && typeof r.days !== 'undefined') ? r.days : null,
      firstVisitAt: (r && typeof r.firstVisitAt !== 'undefined') ? r.firstVisitAt : null,
    });
  } catch (err) {
    return sendJson(res, 500, { error: (err && err.message) || 'visit_failed' });
  }
};
