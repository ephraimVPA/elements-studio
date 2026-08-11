// POST /api/voice — the AI answer line (Twilio Voice webhook).
//
// The missed-call funnel: Ephraim live-dials prospects from the Calls tab using the
// local Twilio number. Missed calls leave that number on caller ID; when a prospect
// calls back, THIS answers: identifies the business via the Sheet (Apps Script
// `callback` action, which also marks the row replied), discloses it is an AI
// assistant, texts the demo + claim link mid-call, and offers to connect to Ephraim.
// Landline callers (can't receive SMS) and unknown callers are bridged to Ephraim
// directly. Every call fires an alert SMS to OWNER_PHONE.
//
// Twilio number config: Voice webhook -> https://elementsstud.io/api/voice (POST).
// Second leg: Twilio calls back /api/voice?step=connect with the keypad digit.
//
// Vercel env:
//   APPS_SCRIPT_URL, APPS_SCRIPT_TOKEN   (same as the banner backend)
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
//   TWILIO_SMS_FROM   verified SMS sender (+18773437177) — NOT the local voice
//                     number, which has no A2P registration and would go undelivered
//   OWNER_PHONE       Ephraim's cell, E.164
//
// Compliance: inbound only — the caller dialed us, so TCPA outbound-call rules
// don't apply. The greeting still discloses "AI assistant" (state bot-disclosure
// laws + basic trust). The SMS it sends carries the STOP line like every other.

const VOICE = 'Polly.Matthew';

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function twiml(res, inner) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/xml');
  res.end('<?xml version="1.0" encoding="UTF-8"?><Response>' + inner + '</Response>');
}

function say(text) { return '<Say voice="' + VOICE + '">' + esc(text) + '</Say>'; }

function readForm(req) {
  return new Promise(function (resolve) {
    let data = '';
    req.on('data', function (c) { data += c; });
    req.on('end', function () {
      const out = {};
      data.split('&').forEach(function (kv) {
        const i = kv.indexOf('=');
        if (i > 0) out[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' '));
      });
      resolve(out);
    });
  });
}

async function sheetCallback(phone) {
  try {
    const r = await fetch(process.env.APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'callback', token: process.env.APPS_SCRIPT_TOKEN, phone: phone }),
      redirect: 'follow'
    });
    return await r.json();
  } catch (e) { return { found: false }; }
}

async function sendSms(to, body) {
  const sid = process.env.TWILIO_ACCOUNT_SID, tok = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_SMS_FROM || '+18773437177';
  if (!sid || !tok || !to) return false;
  try {
    const r = await fetch('https://api.twilio.com/2010-04-01/Accounts/' + sid + '/Messages.json', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(sid + ':' + tok).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }).toString()
    });
    return r.ok;
  } catch (e) { return false; }
}

function dialOwner(afterText) {
  const owner = process.env.OWNER_PHONE || '';
  if (!owner) return say(afterText || 'Ephraim will call you right back. Thanks for calling.');
  return '<Dial timeout="20">' + esc(owner) + '</Dial>' +
    say(afterText || 'Looks like Ephraim is on another call. He will call you right back. Thanks!');
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.statusCode = 405; return res.end('method_not_allowed'); }
  const form = await readForm(req);
  const from = form.From || '';
  const url = new URL(req.url, 'https://x.invalid');
  const step = url.searchParams.get('step');

  // Leg 2: they pressed a key after the text-handoff greeting.
  if (step === 'connect') {
    if ((form.Digits || '') === '1') return twiml(res, dialOwner());
    return twiml(res, say('No problem. The link is in your texts. Talk soon!'));
  }

  // Leg 1: new inbound call.
  const info = await sheetCallback(from);
  const owner = process.env.OWNER_PHONE || '';
  const canText = info.found && info.channel !== 'landline';

  if (owner) {
    sendSms(owner, 'CALLBACK: ' + (info.found ? (info.business + ' (' + (info.subdomain || '') + ')') : 'unknown caller') +
      ' ' + from + (canText ? ' -> texted them the link' : ' -> tried to connect to you'));
  }

  if (canText && info.demo_url) {
    await sendSms(from,
      'Hi, it\'s Ephraim at Elements Studio. Thanks for calling back! Here is the ' +
      (info.business || 'your business') + ' site: ' + info.demo_url +
      ' Claim it from the banner on the page, plans start at $25 a month. Questions? Just reply. Reply STOP to opt out.');
    return twiml(res,
      say('Hi! This is the Elements Studio A I assistant. You are calling about the website we built for ' +
          (info.business || 'your business') + ', right? Great. I just texted you the link. It has everything, and plans start at 25 dollars a month.') +
      '<Gather numDigits="1" action="/api/voice?step=connect" method="POST" timeout="6">' +
      say('If you would rather talk to Ephraim right now, press 1. Otherwise, check your texts. Thanks for calling!') +
      '</Gather>' +
      say('The link is in your texts. Talk soon!'));
  }

  if (info.found) {
    // Known business on a landline: texting is impossible, bridge straight to Ephraim.
    return twiml(res,
      say('Hi! This is the Elements Studio A I assistant. You are calling about the website we built for ' +
          (info.business || 'your business') + '. Connecting you to Ephraim now.') +
      dialOwner());
  }

  // Unknown caller.
  return twiml(res,
    say('Hi, you have reached Elements Studio. We build websites for local businesses. ' +
        'This is an A I assistant. Connecting you to Ephraim now.') +
    dialOwner());
};
