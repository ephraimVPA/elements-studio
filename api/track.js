// POST /api/track  body {sub, type, business}  -> 204
// Fire-and-forget analytics event (banner_dismiss, cta_click, ...). Never blocks
// the page: any failure is swallowed and we still return 204.

const { cors, readJson, geoFromHeaders, callAppsScript, sendJson } = require('./_relay');

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'method_not_allowed' });

  try {
    const body = await readJson(req);
    await callAppsScript('track', {
      sub: String(body.sub || ''),
      event: String(body.type || ''),
      business: String(body.business || ''),
      geo: geoFromHeaders(req),
    });
  } catch (_) {
    // tracking must never surface an error to the visitor
  }

  res.statusCode = 204;
  res.end();
};
