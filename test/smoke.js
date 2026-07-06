// Smoke test: boots the real server, exercises the full licensing lifecycle —
// key issue + local ed25519 verification (via the shipped offline snippet),
// activation/seat limits/idempotency, webhook HMAC delivery, signed expiring
// download URLs, revocation, tampered keys.
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { verifyLicense, verifyReceipt, canonicalize, machineFingerprint } from '../snippets/verify-node.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const TEST_PORT = 5390;
const HOOK_PORT = 5389;
const ADMIN_PASSWORD = 'smoke-test-password';
const DB_PATH = path.join(__dirname, 'smoke.db');
const DATA_DIR = path.join(__dirname, 'data');
const BASE = `http://127.0.0.1:${TEST_PORT}`;

// clean slate
for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) {
  if (fs.existsSync(f)) fs.unlinkSync(f);
}
fs.rmSync(DATA_DIR, { recursive: true, force: true });

let serverProc = null;
let hookServer = null;
const hookEvents = []; // { body, signature }

function startHookServer() {
  return new Promise((resolve) => {
    hookServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        hookEvents.push({ body, signature: req.headers['x-keymaster-signature'] || '' });
        res.writeHead(200);
        res.end('ok');
      });
    });
    hookServer.listen(HOOK_PORT, '127.0.0.1', resolve);
  });
}

async function waitFor(fn, label, tries = 40, delay = 250) {
  for (let i = 0; i < tries; i++) {
    try {
      const v = await fn();
      if (v) return v;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, delay));
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

let cookie = '';
async function api(pathname, options = {}) {
  const isForm = options.body instanceof FormData;
  const res = await fetch(BASE + pathname, {
    redirect: 'manual',
    ...options,
    headers: {
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
      ...(cookie ? { Cookie: cookie } : {}),
      ...options.headers
    },
    body: isForm ? options.body : options.body ? JSON.stringify(options.body) : undefined
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, headers: res.headers };
}

async function main() {
  console.log('1. Starting webhook capture server on', HOOK_PORT, 'and Keymaster on', TEST_PORT);
  await startHookServer();
  serverProc = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(TEST_PORT),
      ADMIN_PASSWORD,
      DB_PATH,
      DATA_DIR,
      BASE_URL: BASE
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  serverProc.stdout.on('data', (d) => process.stdout.write(`   [server] ${d}`));
  serverProc.stderr.on('data', (d) => process.stderr.write(`   [server] ${d}`));

  await waitFor(async () => (await api('/api/health')).data.ok, 'server health');

  console.log('2. Keypair generated on first boot in DATA_DIR');
  assert.ok(fs.existsSync(path.join(DATA_DIR, 'keys', 'signing.pem')), 'signing.pem must exist');
  assert.ok(fs.existsSync(path.join(DATA_DIR, 'keys', 'signing.pub')), 'signing.pub must exist');

  console.log('3. Auth gates: wrong password 401, unauth 401, right password 200');
  const bad = await api('/api/admin/login', { method: 'POST', body: { password: 'wrong' } });
  assert.strictEqual(bad.status, 401, 'wrong password must 401');
  cookie = '';
  const unauth = await api('/api/admin/products');
  assert.strictEqual(unauth.status, 401, 'admin API must require auth');
  const good = await api('/api/admin/login', { method: 'POST', body: { password: ADMIN_PASSWORD } });
  assert.strictEqual(good.status, 200, 'login must succeed');

  console.log('4. Creating product (2 seats, webhook → capture server)');
  const prod = await api('/api/admin/products', {
    method: 'POST',
    body: {
      name: 'Smoke App',
      slug: 'smoke-app',
      default_seats: 2,
      webhook_url: `http://127.0.0.1:${HOOK_PORT}/hook`
    }
  });
  assert.strictEqual(prod.status, 201, 'product create must 201');
  const productId = prod.data.id;
  const webhookSecret = prod.data.webhook_secret;
  assert.ok(webhookSecret, 'product must have a webhook secret');

  console.log('5. Uploading a version with a real generated artifact (multipart)');
  const fixtureBytes = crypto.randomBytes(1024); // real 1KB binary fixture
  const form = new FormData();
  form.append('semver', '1.2.3');
  form.append('notes', 'smoke release');
  form.append('artifact', new Blob([fixtureBytes], { type: 'application/octet-stream' }), 'smoke-app.bin');
  const ver = await api(`/api/admin/products/${productId}/versions`, { method: 'POST', body: form });
  assert.strictEqual(ver.status, 201, 'version create must 201');
  assert.strictEqual(ver.data.size, 1024, 'stored artifact size must match');

  console.log('6. Issuing license → KM1 format, verify ed25519 signature locally via snippets/verify-node.js');
  const lic = await api('/api/admin/licenses', {
    method: 'POST',
    body: { product_id: productId, tier: 'pro', seats: 2, customer_email: 'smoke@example.com' }
  });
  assert.strictEqual(lic.status, 201, 'license create must 201');
  const key = lic.data.key;
  assert.match(key, /^KM1\./, 'key must start with KM1.');

  const pub = await api('/api/v1/pubkey');
  assert.strictEqual(pub.status, 200);
  const PUBKEY = pub.data.key;
  assert.strictEqual(pub.data.alg, 'ed25519');

  // Offline verification exactly as a customer app would do it:
  const offline = verifyLicense(key, PUBKEY);
  assert.strictEqual(offline.valid, true, 'snippet must verify the issued key');
  assert.strictEqual(offline.payload.p, 'smoke-app');
  assert.strictEqual(offline.payload.t, 'pro');
  assert.strictEqual(offline.payload.s, 2);
  // Cross-check the documented recipe with raw node:crypto too:
  const [, payloadB64, sigB64] = key.split('.');
  const rawOk = crypto.verify(
    null,
    Buffer.from(payloadB64, 'base64url'),
    crypto.createPublicKey({ key: Buffer.from(PUBKEY, 'base64'), format: 'der', type: 'spki' }),
    Buffer.from(sigB64, 'base64url')
  );
  assert.strictEqual(rawOk, true, 'raw crypto.verify must agree with the snippet');
  // Canonicalization must be deterministic (documented contract):
  assert.strictEqual(
    canonicalize({ b: 1, a: { d: 2, c: 3 } }),
    '{"a":{"c":3,"d":2},"b":1}',
    'canonicalize must sort keys with no whitespace'
  );
  assert.ok(/^[0-9a-f]{32}$/.test(machineFingerprint()), 'fingerprint helper returns 32 hex chars');

  console.log('7. Activation: FP1 ok + receipt, FP1 idempotent, FP2 ok, FP3 seat-limited');
  const act1 = await api('/api/v1/activate', {
    method: 'POST',
    body: { license_key: key, fingerprint: 'FP1', hostname: 'smoke-host', app_version: '1.0.0' }
  });
  assert.strictEqual(act1.status, 200, 'FP1 activate must 200');
  assert.ok(act1.data.receipt, 'activation must return a receipt');
  const rec = verifyReceipt(act1.data.receipt, PUBKEY);
  assert.strictEqual(rec.valid, true, 'receipt signature must verify');
  assert.strictEqual(rec.payload.f, 'FP1');
  assert.strictEqual(rec.stale, false, 'fresh receipt must not be stale');

  const act1b = await api('/api/v1/activate', { method: 'POST', body: { license_key: key, fingerprint: 'FP1' } });
  assert.strictEqual(act1b.status, 200, 'FP1 re-activate must be idempotent 200');
  assert.strictEqual(act1b.data.idempotent, true);

  const { default: Database } = await import('better-sqlite3');
  const db = new Database(DB_PATH, { readonly: true });
  const licId = offline.payload.l;
  let count = db.prepare('SELECT COUNT(*) AS n FROM activations WHERE license_id = ?').get(licId).n;
  assert.strictEqual(count, 1, 'idempotent re-activation must not add a row');

  const act2 = await api('/api/v1/activate', { method: 'POST', body: { license_key: key, fingerprint: 'FP2' } });
  assert.strictEqual(act2.status, 200, 'FP2 activate must 200');

  const act3 = await api('/api/v1/activate', { method: 'POST', body: { license_key: key, fingerprint: 'FP3' } });
  assert.strictEqual(act3.status, 403, 'FP3 must hit seat limit');
  assert.strictEqual(act3.data.reason, 'seat_limit');

  console.log('8. Deactivate FP2 frees the seat → FP3 activates');
  const deact = await api('/api/v1/deactivate', { method: 'POST', body: { license_key: key, fingerprint: 'FP2' } });
  assert.strictEqual(deact.status, 200);
  assert.strictEqual(deact.data.freed, true);
  const act3b = await api('/api/v1/activate', { method: 'POST', body: { license_key: key, fingerprint: 'FP3' } });
  assert.strictEqual(act3b.status, 200, 'FP3 must activate after FP2 freed');
  count = db.prepare('SELECT COUNT(*) AS n FROM activations WHERE license_id = ? AND deactivated_at IS NULL').get(licId).n;
  assert.strictEqual(count, 2, 'active seats must be 2 (FP1, FP3)');

  console.log('9. Webhook capture received activation events with valid X-Keymaster-Signature');
  await waitFor(
    () => hookEvents.filter((e) => JSON.parse(e.body).event === 'activation').length >= 2,
    'webhook activation deliveries'
  );
  for (const e of hookEvents) {
    const expected = crypto.createHmac('sha256', webhookSecret).update(e.body).digest('hex');
    assert.strictEqual(e.signature, expected, 'webhook HMAC signature must verify');
  }
  const kinds = hookEvents.map((e) => JSON.parse(e.body).event);
  assert.ok(kinds.includes('activation'), 'activation event delivered');
  assert.ok(kinds.includes('deactivation'), 'deactivation event delivered');
  assert.ok(kinds.includes('validation_failed'), 'validation_failed event delivered (seat limit)');

  console.log('10. Download: POST → signed URL → bytes match fixture; expired token rejected');
  const dl = await api('/api/v1/download', { method: 'POST', body: { license_key: key } });
  assert.strictEqual(dl.status, 200, 'download request must 200');
  assert.match(dl.data.url, /\/dl\//, 'must return a /dl/ URL');
  const fileRes = await fetch(dl.data.url);
  assert.strictEqual(fileRes.status, 200, 'signed URL must serve the artifact');
  const gotBytes = Buffer.from(await fileRes.arrayBuffer());
  assert.ok(gotBytes.equals(fixtureBytes), 'downloaded bytes must equal the uploaded fixture');
  assert.match(fileRes.headers.get('content-disposition') || '', /attachment/, 'must be a download');

  // hand-build an expired token with the real secret from settings
  const dlSecret = db.prepare("SELECT value FROM settings WHERE key = 'download_secret'").get().value;
  const versionId = ver.data.id;
  const expiredBody = Buffer.from(`${versionId}.${licId}.${Math.floor(Date.now() / 1000) - 60}`).toString('base64url');
  const expiredMac = crypto.createHmac('sha256', dlSecret).update(expiredBody).digest().toString('base64url');
  const expired = await fetch(`${BASE}/dl/${expiredBody}.${expiredMac}`);
  assert.ok([410, 403].includes(expired.status), `expired token must 410/403 (got ${expired.status})`);
  const forged = await fetch(`${BASE}/dl/${expiredBody}.${'A'.repeat(43)}`);
  assert.strictEqual(forged.status, 403, 'forged HMAC must 403');
  const dlRow = db.prepare('SELECT * FROM download_events WHERE license_id = ?').get(licId);
  assert.ok(dlRow, 'download event must be logged');

  console.log('11. GET download (portal flow) 302-redirects to a signed URL');
  const dlGet = await api(`/api/v1/download?license_key=${encodeURIComponent(key)}`);
  assert.strictEqual(dlGet.status, 302, 'GET download must 302');
  assert.match(dlGet.headers.get('location') || '', /\/dl\//);

  console.log('12. Portal page renders');
  const portal = await fetch(`${BASE}/license/${encodeURIComponent(key)}`);
  assert.strictEqual(portal.status, 200);
  const portalHtml = await portal.text();
  assert.ok(portalHtml.includes('Smoke App'), 'portal must show product name');
  assert.ok(portalHtml.includes('…'), 'portal must display the key masked');
  assert.ok(portalHtml.includes('Download v1.2.3'), 'portal must offer the latest version download');

  console.log('13. Revoke → validate says revoked; new activation 403; offline sig still verifies');
  const revoke = await api(`/api/admin/licenses/${licId}/revoke`, { method: 'POST', body: { reason: 'chargeback' } });
  assert.strictEqual(revoke.status, 200);
  const val = await api('/api/v1/validate', { method: 'POST', body: { license_key: key, fingerprint: 'FP1' } });
  assert.strictEqual(val.status, 403);
  assert.strictEqual(val.data.valid, false);
  assert.strictEqual(val.data.reason, 'revoked');
  const actRevoked = await api('/api/v1/activate', { method: 'POST', body: { license_key: key, fingerprint: 'FP9' } });
  assert.strictEqual(actRevoked.status, 403, 'activation on revoked license must 403');
  // Documented limitation, asserted honestly: the offline snippet CANNOT see
  // server-side revocation — the signature still verifies.
  const offlineAfterRevoke = verifyLicense(key, PUBKEY);
  assert.strictEqual(offlineAfterRevoke.valid, true, 'offline check stays valid after revoke (by design — needs online check-in)');

  console.log('14. Tampered key → 400 invalid_signature');
  // Tamper with the payload (bump seats 2 → 99) while keeping the original
  // signature — exactly what a cracker would try.
  const parts = key.split('.');
  const tamperedPayload = { ...JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')), s: 99 };
  const tampered = `${parts[0]}.${Buffer.from(canonicalize(tamperedPayload)).toString('base64url')}.${parts[2]}`;
  const actTampered = await api('/api/v1/activate', { method: 'POST', body: { license_key: tampered, fingerprint: 'FPX' } });
  assert.strictEqual(actTampered.status, 400, 'tampered key must 400');
  assert.strictEqual(actTampered.data.reason, 'invalid_signature');
  assert.strictEqual(verifyLicense(tampered, PUBKEY).valid, false, 'snippet must reject tampered key too');

  console.log('15. Stats endpoint reflects activity');
  const stats = await api('/api/admin/stats');
  assert.strictEqual(stats.data.licenses, 1);
  assert.ok(stats.data.active_seats >= 2);
  assert.strictEqual(stats.data.days.length, 30);

  db.close();
  console.log('\nSMOKE TEST PASSED ✔  (keys, offline verify, seats, webhooks HMAC, signed downloads, revoke, tamper)');
}

main()
  .then(() => cleanup(0))
  .catch((err) => {
    console.error('\nSMOKE TEST FAILED ✖');
    console.error(err);
    cleanup(1);
  });

function cleanup(code) {
  try { serverProc?.kill(); } catch { /* ignore */ }
  try { hookServer?.close(); } catch { /* ignore */ }
  setTimeout(() => {
    for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) {
      try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
    try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
    process.exit(code);
  }, 400);
}
