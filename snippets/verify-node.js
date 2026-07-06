// Keymaster offline license verification — zero-dependency Node.js example.
// Copy this file into your app (or vendor it); it only uses node:crypto/node:os.
//
// Usage:
//   const { verifyLicense, verifyReceipt, machineFingerprint } = require('./verify-node.js');
//   const PUBKEY = 'MCowBQYDK2VwAyEA...'; // from GET /api/v1/pubkey → .key (SPKI DER base64) — embed at build time
//   const result = verifyLicense(userPastedKey, PUBKEY);
//   if (!result.valid) showError(result.reason);
//
// Key format (see docs/API.md for the byte-for-byte spec):
//   KM1.<base64url(canonical JSON payload)>.<base64url(ed25519 signature)>
//   payload: { l: licenseId, p: productSlug, t: tier, s: seats, i: issuedAt, e?: expiresAt } (unix seconds)
// Activation receipts: same construction, prefix KMR1,
//   payload: { l: licenseId, f: fingerprint, a: activatedAt, u: validUntil }
//
// HONEST LIMITATION: offline verification proves the key was signed by your
// server and is not expired. It CANNOT see server-side revocations or seat
// counts. Recommended pattern (shown in exampleStartupCheck below): verify
// offline instantly, then POST /api/v1/validate in the background when online,
// and only lock the app out if the cached activation receipt's check-in
// window (`u`) has lapsed AND the server is reachable and says invalid.
'use strict';
const crypto = require('crypto');

// Canonical JSON: keys sorted lexicographically (recursively), no whitespace.
// Must match the server's canonicalize() exactly or signatures won't verify.
function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
}

function publicKeyFromBase64(publicKeyBase64) {
  return crypto.createPublicKey({
    key: Buffer.from(publicKeyBase64, 'base64'),
    format: 'der',
    type: 'spki'
  });
}

// Parse a KM1/KMR1 token without verifying. Returns null if malformed.
function parseToken(token, expectedPrefix) {
  if (typeof token !== 'string') return null;
  const parts = token.trim().split('.');
  if (parts.length !== 3 || parts[0] !== expectedPrefix) return null;
  try {
    return {
      payload: JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')),
      payloadB64: parts[1],
      sigB64: parts[2]
    };
  } catch {
    return null;
  }
}

function verifyToken(token, expectedPrefix, publicKeyBase64) {
  const parsed = parseToken(token, expectedPrefix);
  if (!parsed) return { valid: false, reason: 'malformed' };
  let ok = false;
  try {
    ok = crypto.verify(
      null,
      Buffer.from(parsed.payloadB64, 'base64url'),
      publicKeyFromBase64(publicKeyBase64),
      Buffer.from(parsed.sigB64, 'base64url')
    );
  } catch {
    ok = false;
  }
  if (!ok) return { valid: false, reason: 'invalid_signature' };
  return { valid: true, payload: parsed.payload };
}

/**
 * Verify a license key fully offline.
 * @returns {{valid:boolean, reason?:string, payload?:object}}
 *   reasons: malformed | invalid_signature | expired
 */
function verifyLicense(licenseKey, publicKeyBase64, nowSeconds = Math.floor(Date.now() / 1000)) {
  const r = verifyToken(licenseKey, 'KM1', publicKeyBase64);
  if (!r.valid) return r;
  if (r.payload.e && nowSeconds > r.payload.e) {
    return { valid: false, reason: 'expired', payload: r.payload };
  }
  return r;
}

/**
 * Verify a cached activation receipt (returned by POST /api/v1/activate).
 * @returns {{valid:boolean, reason?:string, payload?:object, stale?:boolean}}
 *   stale=true means the signature is fine but the check-in window (`u`)
 *   has passed — re-validate online (apply your own grace period).
 */
function verifyReceipt(receipt, publicKeyBase64, nowSeconds = Math.floor(Date.now() / 1000)) {
  const r = verifyToken(receipt, 'KMR1', publicKeyBase64);
  if (!r.valid) return r;
  return { ...r, stale: nowSeconds > r.payload.u };
}

/**
 * Machine fingerprint helper — SHA-256 of hostname + first non-internal MAC
 * + platform + arch. This is a HEURISTIC, not tamper-proof hardware identity:
 * it changes if the user renames the machine or swaps the NIC, and a
 * determined user can spoof it. Good enough for honest-customer seat limits.
 */
function machineFingerprint() {
  const os = require('os');
  let mac = '';
  const ifaces = os.networkInterfaces();
  outer: for (const name of Object.keys(ifaces).sort()) {
    for (const i of ifaces[name] || []) {
      if (!i.internal && i.mac && i.mac !== '00:00:00:00:00:00') {
        mac = i.mac;
        break outer;
      }
    }
  }
  return crypto
    .createHash('sha256')
    .update([os.hostname(), mac, os.platform(), os.arch()].join('|'))
    .digest('hex')
    .slice(0, 32);
}

// ---------------------------------------------------------------------------
// Example startup flow (the recommended online/offline hybrid):
// ---------------------------------------------------------------------------
async function exampleStartupCheck({ licenseKey, cachedReceipt, publicKeyBase64, serverUrl, graceSeconds = 7 * 86400 }) {
  // 1. Instant offline gate — no network needed.
  const lic = verifyLicense(licenseKey, publicKeyBase64);
  if (!lic.valid) return { allow: false, reason: lic.reason };

  // 2. Cached receipt proves the server accepted this machine at some point.
  const rec = cachedReceipt ? verifyReceipt(cachedReceipt, publicKeyBase64) : null;
  const receiptOkOrInGrace =
    rec && rec.valid && (!rec.stale || Math.floor(Date.now() / 1000) < rec.payload.u + graceSeconds);

  // 3. Background online check-in (catches revocations / freed seats).
  try {
    const res = await fetch(`${serverUrl}/api/v1/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ license_key: licenseKey, fingerprint: machineFingerprint() })
    });
    const data = await res.json();
    if (!data.valid) return { allow: false, reason: data.reason }; // server explicitly says no
    return { allow: true, online: true };
  } catch {
    // Offline: fall back to the cached receipt + grace period.
    return { allow: !!receiptOkOrInGrace, offline: true, reason: receiptOkOrInGrace ? undefined : 'checkin_required' };
  }
}

module.exports = {
  canonicalize,
  parseToken,
  verifyLicense,
  verifyReceipt,
  machineFingerprint,
  exampleStartupCheck
};
