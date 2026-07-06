// Ed25519 signing keys + the KM1 license key format.
//
// Key string format (documented byte-for-byte in docs/API.md):
//   KM1.<base64url(canonical-JSON payload)>.<base64url(ed25519 signature over those exact payload bytes)>
// Activation receipts use the same construction with prefix KMR1.
//
// Canonical JSON = keys sorted lexicographically (recursively), no whitespace,
// UTF-8. The SAME canonicalize() lives in snippets/verify-node.js — if you
// implement this in another language, sort keys and strip whitespace or
// signatures will not match.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ---------- canonical JSON ----------
function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
}

// ---------- base64url ----------
const b64url = (buf) => Buffer.from(buf).toString('base64url');
const b64urlDecode = (str) => Buffer.from(str, 'base64url');

// ---------- keypair management ----------
// PEM files live in <dataDir>/keys/. Generated on first boot.
// BACK THEM UP — lose signing.pem and you can never issue keys that verify
// against the public key you shipped inside your app.
function ensureKeys(dataDir) {
  const keysDir = path.join(dataDir, 'keys');
  fs.mkdirSync(keysDir, { recursive: true });
  const privPath = path.join(keysDir, 'signing.pem');
  const pubPath = path.join(keysDir, 'signing.pub');

  if (!fs.existsSync(privPath)) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    fs.writeFileSync(privPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    fs.writeFileSync(pubPath, publicKey.export({ type: 'spki', format: 'pem' }));
    console.log(`[keymaster] Generated new ed25519 signing keypair in ${keysDir} — BACK IT UP.`);
  }

  const privateKey = crypto.createPrivateKey(fs.readFileSync(privPath, 'utf8'));
  const publicKey = crypto.createPublicKey(fs.readFileSync(pubPath, 'utf8'));
  return {
    privateKey,
    publicKey,
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    // SPKI DER base64 — what clients embed and what /api/v1/pubkey returns.
    publicKeyBase64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
  };
}

// ---------- generic sign / parse / verify ----------
function signToken(prefix, payload, privateKey) {
  const payloadB64 = b64url(canonicalize(payload));
  const sig = crypto.sign(null, b64urlDecode(payloadB64), privateKey);
  return `${prefix}.${payloadB64}.${b64url(sig)}`;
}

function parseToken(token, expectedPrefix) {
  if (typeof token !== 'string') return null;
  const parts = token.trim().split('.');
  if (parts.length !== 3 || parts[0] !== expectedPrefix) return null;
  let payload;
  try {
    payload = JSON.parse(b64urlDecode(parts[1]).toString('utf8'));
  } catch {
    return null;
  }
  return { payload, payloadB64: parts[1], sigB64: parts[2] };
}

function verifyToken(token, expectedPrefix, publicKey) {
  const parsed = parseToken(token, expectedPrefix);
  if (!parsed) return { valid: false, reason: 'malformed' };
  let ok = false;
  try {
    ok = crypto.verify(null, b64urlDecode(parsed.payloadB64), publicKey, b64urlDecode(parsed.sigB64));
  } catch {
    ok = false;
  }
  if (!ok) return { valid: false, reason: 'invalid_signature' };
  return { valid: true, payload: parsed.payload };
}

// ---------- license keys (KM1) ----------
// Payload is deliberately tiny (keys get pasted into support tickets/emails):
//   l  license id (hex string)
//   p  product slug
//   t  tier
//   s  seats
//   i  issued_at (unix seconds)
//   e  expires_at (unix seconds) — OMITTED for perpetual licenses
// Customer email is stored server-side only, never embedded in the key.
function makeLicenseKey({ licenseId, productSlug, tier, seats, issuedAt, expiresAt }, privateKey) {
  const payload = {
    l: licenseId,
    p: productSlug,
    t: tier,
    s: seats,
    i: issuedAt,
    ...(expiresAt ? { e: expiresAt } : {})
  };
  return signToken('KM1', payload, privateKey);
}

const parseLicenseKey = (key) => parseToken(key, 'KM1');
const verifyLicenseKey = (key, publicKey) => verifyToken(key, 'KM1', publicKey);

// ---------- activation receipts (KMR1) ----------
// Signed proof the server accepted an activation. Clients cache it for
// offline runs; `u` is the check-in window — re-validate online before it
// passes (plus whatever grace period you choose).
function makeReceipt({ licenseId, fingerprint, activatedAt, validUntil }, privateKey) {
  return signToken('KMR1', { l: licenseId, f: fingerprint, a: activatedAt, u: validUntil }, privateKey);
}

const verifyReceipt = (receipt, publicKey) => verifyToken(receipt, 'KMR1', publicKey);

// ---------- signed download tokens (HMAC, server-side secret) ----------
function makeDownloadToken({ versionId, licenseId, exp }, secret) {
  const body = b64url(`${versionId}.${licenseId}.${exp}`);
  const mac = crypto.createHmac('sha256', secret).update(body).digest();
  return `${body}.${b64url(mac)}`;
}

function verifyDownloadToken(token, secret) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const expected = crypto.createHmac('sha256', secret).update(parts[0]).digest();
  const given = b64urlDecode(parts[1]);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  const [versionId, licenseId, exp] = b64urlDecode(parts[0]).toString('utf8').split('.');
  if (!versionId || !exp) return null;
  if (Math.floor(Date.now() / 1000) > Number(exp)) return { expired: true };
  return { versionId: Number(versionId), licenseId, exp: Number(exp) };
}

module.exports = {
  canonicalize,
  b64url,
  b64urlDecode,
  ensureKeys,
  makeLicenseKey,
  parseLicenseKey,
  verifyLicenseKey,
  makeReceipt,
  verifyReceipt,
  makeDownloadToken,
  verifyDownloadToken
};
