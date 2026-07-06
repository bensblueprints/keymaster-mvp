// Per-product activation webhooks.
// POST JSON { event, license, fingerprint, ts } with header
// X-Keymaster-Signature: hex(HMAC-SHA256(body, product.webhook_secret)).
// Retries x3 with backoff; every attempt outcome lands in webhook_deliveries.
const crypto = require('crypto');

const BACKOFF_MS = [0, 1000, 4000]; // delay before attempt 1, 2, 3

function signBody(body, secret) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

async function attempt(url, body, signature) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Keymaster-Signature': signature,
        'User-Agent': 'Keymaster/1.0'
      },
      body,
      signal: controller.signal
    });
    return { status: res.status, ok: res.status >= 200 && res.status < 300 };
  } finally {
    clearTimeout(timer);
  }
}

// Fire-and-forget: never blocks the API response.
function dispatchWebhook(db, product, event, data) {
  if (!product || !product.webhook_url) return;
  const payload = { event, ts: Math.floor(Date.now() / 1000), ...data };
  const body = JSON.stringify(payload);
  const signature = signBody(body, product.webhook_secret);
  const row = db
    .prepare('INSERT INTO webhook_deliveries (product_id, event, payload_json) VALUES (?, ?, ?)')
    .run(product.id, event, body);
  const deliveryId = row.lastInsertRowid;
  const update = db.prepare(
    'UPDATE webhook_deliveries SET status_code = ?, attempts = ?, last_error = ? WHERE id = ?'
  );

  (async () => {
    for (let i = 0; i < BACKOFF_MS.length; i++) {
      if (BACKOFF_MS[i]) await new Promise((r) => setTimeout(r, BACKOFF_MS[i]));
      try {
        const res = await attempt(product.webhook_url, body, signature);
        update.run(res.status, i + 1, res.ok ? '' : `HTTP ${res.status}`, deliveryId);
        if (res.ok) return;
      } catch (e) {
        try {
          update.run(null, i + 1, String(e.message || e).slice(0, 300), deliveryId);
        } catch {
          return; // db closed (e.g. test teardown) — stop retrying
        }
      }
    }
  })().catch(() => {});
}

module.exports = { dispatchWebhook, signBody };
