// _relay.js — shared helpers for the Elements Studio serverless API (CommonJS).
// Plain Vercel Node functions: module.exports = async (req, res) => {}.
// No framework; everything here is dependency-free (uses global fetch, Node 18+).

/**
 * CORS for the same-origin claim banner. Reflects the request Origin only when it
 * is an elementsstud.io origin (the apex, or any *.elementsstud.io subdomain), and
 * short-circuits pre-flight OPTIONS. Returns true if the request was fully handled
 * (OPTIONS) so callers can `if (cors(req, res)) return;`.
 */
function cors(req, res) {
  const origin = String((req.headers && req.headers.origin) || '');
  let allow = '';
  if (origin === 'https://elementsstud.io') {
    allow = origin;
  } else if (/^https:\/\/[^/]+\.elementsstud\.io$/.test(origin) && origin.endsWith('.elementsstud.io')) {
    allow = origin;
  }
  if (allow) {
    res.setHeader('Access-Control-Allow-Origin', allow);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }
  return false;
}

/** Read the raw request body as a Buffer (needed for Stripe signature verification). */
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Parse the request body as JSON. Prefers an already-parsed req.body (Vercel's
 * default bodyParser) and only touches the raw stream when it hasn't been read.
 * Never throws — returns {} on empty/invalid input.
 */
async function readJson(req) {
  const b = req.body;
  if (b && typeof b === 'object' && !Buffer.isBuffer(b)) return b;
  if (typeof b === 'string' && b.length) {
    try { return JSON.parse(b); } catch (_) { return {}; }
  }
  const raw = await readRawBody(req);
  const text = raw.toString('utf8').trim();
  if (!text) return {};
  try { return JSON.parse(text); } catch (_) { return {}; }
}

/** Write a JSON response on the raw Node ServerResponse (no framework helpers assumed). */
function sendJson(res, statusCode, obj) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

/**
 * Server-to-server call into the Google Apps Script web app. POSTs
 * { token, action, ...payload } to APPS_SCRIPT_URL and returns the parsed JSON.
 * Follows the /exec -> googleusercontent.com redirect Apps Script issues.
 */
async function callAppsScript(action, payload) {
  const url = process.env.APPS_SCRIPT_URL;
  if (!url) throw new Error('APPS_SCRIPT_URL is not set');
  const body = Object.assign({ token: process.env.APPS_SCRIPT_TOKEN, action }, payload || {});
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    redirect: 'follow',
  });
  const text = await resp.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch (_) { json = { ok: false, raw: text }; }
  if (!resp.ok) throw new Error('Apps Script HTTP ' + resp.status + ': ' + (text || '').slice(0, 200));
  return json;
}

/** Best-effort visitor geo from Vercel's edge headers. */
function geoFromHeaders(req) {
  const h = (req && req.headers) || {};
  const dec = (v) => { try { return decodeURIComponent(String(v || '')); } catch (_) { return String(v || ''); } };
  return {
    country: dec(h['x-vercel-ip-country']),
    region: dec(h['x-vercel-ip-country-region']),
    city: dec(h['x-vercel-ip-city']),
  };
}

module.exports = { cors, readRawBody, readJson, sendJson, callAppsScript, geoFromHeaders };
