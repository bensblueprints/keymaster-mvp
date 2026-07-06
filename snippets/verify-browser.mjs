// Keymaster offline license verification — zero-dependency browser/WebCrypto
// example (also works in Node 20+, Deno, Bun, Cloudflare Workers).
// Ed25519 via SubtleCrypto — supported in all evergreen browsers.
//
//   import { verifyLicense } from './verify-browser.mjs';
//   const PUBKEY = 'MCowBQYDK2VwAyEA...'; // GET /api/v1/pubkey → .key (SPKI DER base64)
//   const { valid, reason, payload } = await verifyLicense(key, PUBKEY);

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function b64ToBytes(s) {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

async function importPubkey(publicKeyBase64) {
  return crypto.subtle.importKey('spki', b64ToBytes(publicKeyBase64), { name: 'Ed25519' }, false, ['verify']);
}

async function verifyToken(token, expectedPrefix, publicKeyBase64) {
  if (typeof token !== 'string') return { valid: false, reason: 'malformed' };
  const parts = token.trim().split('.');
  if (parts.length !== 3 || parts[0] !== expectedPrefix) return { valid: false, reason: 'malformed' };
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
  } catch {
    return { valid: false, reason: 'malformed' };
  }
  let ok = false;
  try {
    const key = await importPubkey(publicKeyBase64);
    ok = await crypto.subtle.verify({ name: 'Ed25519' }, key, b64urlToBytes(parts[2]), b64urlToBytes(parts[1]));
  } catch {
    ok = false;
  }
  return ok ? { valid: true, payload } : { valid: false, reason: 'invalid_signature' };
}

/** Verify a KM1 license key offline. Reasons: malformed | invalid_signature | expired */
export async function verifyLicense(licenseKey, publicKeyBase64, nowSeconds = Math.floor(Date.now() / 1000)) {
  const r = await verifyToken(licenseKey, 'KM1', publicKeyBase64);
  if (!r.valid) return r;
  if (r.payload.e && nowSeconds > r.payload.e) return { valid: false, reason: 'expired', payload: r.payload };
  return r;
}

/** Verify a KMR1 activation receipt. `stale` = check-in window passed. */
export async function verifyReceipt(receipt, publicKeyBase64, nowSeconds = Math.floor(Date.now() / 1000)) {
  const r = await verifyToken(receipt, 'KMR1', publicKeyBase64);
  if (!r.valid) return r;
  return { ...r, stale: nowSeconds > r.payload.u };
}
