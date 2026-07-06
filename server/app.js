const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const { openDb, getSetting, setSetting } = require('./db');
const keys = require('./keys');
const { dispatchWebhook } = require('./webhooks');
const { renderPortal } = require('./portal');

const now = () => Math.floor(Date.now() / 1000);
const newId = () => crypto.randomBytes(6).toString('hex');

function semverSortDesc(a, b) {
  const pa = String(a.semver).split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b.semver).split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pb[i] || 0) !== (pa[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
  return b.id - a.id;
}

function createApp(opts = {}) {
  const dataDir = opts.dataDir || process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  const dbPath = opts.dbPath || process.env.DB_PATH || null;
  const adminPassword = opts.adminPassword || process.env.ADMIN_PASSWORD || 'admin';
  const autologinToken = opts.autologinToken || process.env.AUTOLOGIN_TOKEN || null;
  const downloadTtl = Number(opts.downloadTtl || process.env.DOWNLOAD_TTL || 900);
  const baseUrlEnv = opts.baseUrl || process.env.BASE_URL || null;

  const db = openDb(dataDir, dbPath);
  const signing = keys.ensureKeys(dataDir);

  // HMAC secret for signed download URLs — server-side only, generated once.
  let dlSecret = getSetting(db, 'download_secret');
  if (!dlSecret) {
    dlSecret = crypto.randomBytes(32).toString('hex');
    setSetting(db, 'download_secret', dlSecret);
  }

  const artifactsDir = path.join(dataDir, 'artifacts');
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  const baseUrl = (req) => (baseUrlEnv || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');

  // ---------- helpers ----------
  const getProduct = db.prepare('SELECT * FROM products WHERE id = ?');
  const getLicenseByKey = db.prepare('SELECT * FROM licenses WHERE key = ?');
  const activeSeats = db.prepare(
    'SELECT COUNT(*) AS n FROM activations WHERE license_id = ? AND deactivated_at IS NULL'
  );

  function latestVersion(productId) {
    const rows = db.prepare('SELECT * FROM versions WHERE product_id = ?').all(productId);
    return rows.sort(semverSortDesc)[0] || null;
  }

  // Resolve + validate a license key for public API calls.
  // Returns { error:{status,body} } or { license, product, payload }.
  function resolveLicense(licenseKey) {
    const v = keys.verifyLicenseKey(licenseKey, signing.publicKey);
    if (!v.valid) return { error: { status: 400, body: { ok: false, valid: false, reason: v.reason } } };
    const license = getLicenseByKey.get(String(licenseKey).trim());
    if (!license) return { error: { status: 404, body: { ok: false, valid: false, reason: 'unknown_license' } } };
    const product = getProduct.get(license.product_id);
    if (license.revoked) {
      return { license, product, error: { status: 403, body: { ok: false, valid: false, reason: 'revoked' } } };
    }
    if (license.expires_at && new Date(license.expires_at + 'Z').getTime() / 1000 < now()) {
      return { license, product, error: { status: 403, body: { ok: false, valid: false, reason: 'expired' } } };
    }
    return { license, product, payload: v.payload };
  }

  // ---------- rate limiting (in-memory, per ip+bucket) ----------
  const rlMap = new Map();
  const RL_MAX = Number(process.env.RATE_LIMIT_MAX || 120); // per minute
  function rateLimit(req, res, next) {
    const k = `${req.ip}|${req.path}`;
    const nowMin = Math.floor(Date.now() / 60000);
    let e = rlMap.get(k);
    if (!e || e.min !== nowMin) e = { min: nowMin, n: 0 };
    e.n++;
    rlMap.set(k, e);
    if (rlMap.size > 50000) rlMap.clear();
    if (e.n > RL_MAX) return res.status(429).json({ ok: false, reason: 'rate_limited' });
    next();
  }

  // ---------- CORS for the public v1 API (desktop apps call it directly) ----------
  app.use('/api/v1', (req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.get('/api/health', (req, res) => res.json({ ok: true, app: 'keymaster', version: 1 }));

  // ================= PUBLIC v1 API =================

  app.get('/api/v1/pubkey', (req, res) => {
    res.json({
      alg: 'ed25519',
      format: 'spki-der-base64',
      key: signing.publicKeyBase64,
      pem: signing.publicKeyPem
    });
  });

  // POST /api/v1/activate { license_key, fingerprint, hostname?, app_version? }
  app.post('/api/v1/activate', rateLimit, (req, res) => {
    const { license_key, fingerprint, hostname, app_version } = req.body || {};
    if (!license_key || !fingerprint) {
      return res.status(400).json({ ok: false, reason: 'license_key and fingerprint are required' });
    }
    const r = resolveLicense(license_key);
    if (r.error) {
      if (r.license) {
        dispatchWebhook(db, r.product, 'validation_failed', {
          license: r.license.id,
          fingerprint,
          reason: r.error.body.reason
        });
      }
      return res.status(r.error.status).json(r.error.body);
    }
    const { license, product } = r;
    const fp = String(fingerprint).slice(0, 128);

    const existing = db
      .prepare('SELECT * FROM activations WHERE license_id = ? AND fingerprint = ?')
      .get(license.id, fp);

    let idempotent = false;
    if (existing && !existing.deactivated_at) {
      // Same machine re-activating — idempotent, refresh last_seen.
      db.prepare(
        "UPDATE activations SET last_seen = datetime('now'), hostname = COALESCE(?, hostname), app_version = COALESCE(?, app_version) WHERE id = ?"
      ).run(hostname || null, app_version || null, existing.id);
      idempotent = true;
    } else {
      const used = activeSeats.get(license.id).n;
      if (used >= license.seats) {
        dispatchWebhook(db, product, 'validation_failed', {
          license: license.id,
          fingerprint: fp,
          reason: 'seat_limit'
        });
        return res.status(403).json({
          ok: false,
          reason: 'seat_limit',
          seats: license.seats,
          seats_used: used
        });
      }
      if (existing) {
        db.prepare(
          "UPDATE activations SET deactivated_at = NULL, last_seen = datetime('now'), hostname = COALESCE(?, hostname), app_version = COALESCE(?, app_version) WHERE id = ?"
        ).run(hostname || null, app_version || null, existing.id);
      } else {
        db.prepare(
          'INSERT INTO activations (license_id, fingerprint, hostname, app_version) VALUES (?, ?, ?, ?)'
        ).run(license.id, fp, String(hostname || '').slice(0, 200), String(app_version || '').slice(0, 50));
      }
    }

    const receipt = keys.makeReceipt(
      {
        licenseId: license.id,
        fingerprint: fp,
        activatedAt: now(),
        validUntil: now() + 30 * 86400 // 30-day check-in window
      },
      signing.privateKey
    );

    if (!idempotent) {
      dispatchWebhook(db, product, 'activation', { license: license.id, fingerprint: fp });
    }

    res.json({
      ok: true,
      valid: true,
      idempotent,
      receipt,
      license: {
        id: license.id,
        product: product.slug,
        tier: license.tier,
        seats: license.seats,
        seats_used: activeSeats.get(license.id).n,
        expires_at: license.expires_at
      }
    });
  });

  // POST /api/v1/deactivate { license_key, fingerprint }
  app.post('/api/v1/deactivate', rateLimit, (req, res) => {
    const { license_key, fingerprint } = req.body || {};
    if (!license_key || !fingerprint) {
      return res.status(400).json({ ok: false, reason: 'license_key and fingerprint are required' });
    }
    const r = resolveLicense(license_key);
    // A revoked/expired license can still free its seats.
    const license = r.license || null;
    if (!license) return res.status(r.error?.status || 404).json(r.error?.body || { ok: false });
    const info = db
      .prepare(
        "UPDATE activations SET deactivated_at = datetime('now') WHERE license_id = ? AND fingerprint = ? AND deactivated_at IS NULL"
      )
      .run(license.id, String(fingerprint).slice(0, 128));
    if (info.changes > 0) {
      dispatchWebhook(db, getProduct.get(license.product_id), 'deactivation', {
        license: license.id,
        fingerprint: String(fingerprint).slice(0, 128)
      });
    }
    res.json({ ok: true, freed: info.changes > 0, seats_used: activeSeats.get(license.id).n });
  });

  // POST /api/v1/validate { license_key, fingerprint? } — lightweight check-in.
  app.post('/api/v1/validate', rateLimit, (req, res) => {
    const { license_key, fingerprint } = req.body || {};
    if (!license_key) return res.status(400).json({ ok: false, reason: 'license_key is required' });
    const r = resolveLicense(license_key);
    if (r.error) {
      if (r.license) {
        dispatchWebhook(db, r.product, 'validation_failed', {
          license: r.license.id,
          fingerprint: fingerprint || null,
          reason: r.error.body.reason
        });
      }
      return res.status(r.error.status).json(r.error.body);
    }
    const { license, product } = r;
    let seatHeld = null;
    if (fingerprint) {
      const a = db
        .prepare(
          'SELECT id FROM activations WHERE license_id = ? AND fingerprint = ? AND deactivated_at IS NULL'
        )
        .get(license.id, String(fingerprint).slice(0, 128));
      seatHeld = !!a;
      if (a) db.prepare("UPDATE activations SET last_seen = datetime('now') WHERE id = ?").run(a.id);
    }
    res.json({
      ok: true,
      valid: true,
      seat_held: seatHeld,
      product: product.slug,
      tier: license.tier,
      seats: license.seats,
      seats_used: activeSeats.get(license.id).n,
      expires_at: license.expires_at
    });
  });

  // Download: validate license → signed expiring URL.
  // GET  → 302 redirect straight to /dl/:token (browser flow, portal button)
  // POST → JSON { url, expires_at } (programmatic flow)
  function handleDownload(req, res) {
    const src = req.method === 'GET' ? req.query : req.body || {};
    const licenseKey = src.license_key;
    if (!licenseKey) return res.status(400).json({ ok: false, reason: 'license_key is required' });
    const r = resolveLicense(licenseKey);
    if (r.error) return res.status(r.error.status).json(r.error.body);
    const { license } = r;

    let version;
    if (src.version) {
      version = db
        .prepare('SELECT * FROM versions WHERE product_id = ? AND semver = ?')
        .get(license.product_id, String(src.version));
      if (!version) return res.status(404).json({ ok: false, reason: 'version_not_found' });
    } else {
      version = latestVersion(license.product_id);
      if (!version) return res.status(404).json({ ok: false, reason: 'no_versions' });
    }

    const exp = now() + downloadTtl;
    const token = keys.makeDownloadToken({ versionId: version.id, licenseId: license.id, exp }, dlSecret);
    const url = `${baseUrl(req)}/dl/${token}`;
    if (req.method === 'GET') return res.redirect(302, url);
    res.json({ ok: true, url, version: version.semver, expires_at: exp });
  }
  app.get('/api/v1/download', rateLimit, handleDownload);
  app.post('/api/v1/download', rateLimit, handleDownload);

  // Signed expiring artifact URL — the ONLY path to artifacts.
  app.get('/dl/:token', (req, res) => {
    const t = keys.verifyDownloadToken(req.params.token, dlSecret);
    if (!t) return res.status(403).json({ ok: false, reason: 'invalid_token' });
    if (t.expired) return res.status(410).json({ ok: false, reason: 'expired' });
    const version = db.prepare('SELECT * FROM versions WHERE id = ?').get(t.versionId);
    if (!version) return res.status(404).json({ ok: false, reason: 'version_not_found' });

    db.prepare('INSERT INTO download_events (license_id, version_id, ip) VALUES (?, ?, ?)').run(
      t.licenseId,
      version.id,
      req.ip || ''
    );

    if (version.artifact_url) return res.redirect(302, version.artifact_url);
    if (!version.artifact_path) return res.status(404).json({ ok: false, reason: 'no_artifact' });
    const abs = path.join(artifactsDir, path.basename(version.artifact_path));
    if (!fs.existsSync(abs)) return res.status(404).json({ ok: false, reason: 'artifact_missing' });
    const product = getProduct.get(version.product_id);
    const filename = `${product ? product.slug : 'artifact'}-${version.semver}${path.extname(abs)}`;
    res.download(abs, filename);
  });

  // ================= CUSTOMER PORTAL =================

  app.get('/license/:key', (req, res) => {
    const key = req.params.key;
    const v = keys.verifyLicenseKey(key, signing.publicKey);
    const license = v.valid ? getLicenseByKey.get(key.trim()) : null;
    if (!license) {
      return res.status(404).type('html').send(renderPortal({ found: false, status: 'not_found', key }));
    }
    const product = getProduct.get(license.product_id);
    const status = license.revoked
      ? 'revoked'
      : license.expires_at && new Date(license.expires_at + 'Z').getTime() < Date.now()
        ? 'expired'
        : 'active';
    res.type('html').send(
      renderPortal({
        found: true,
        key,
        license,
        product,
        status,
        seatsUsed: activeSeats.get(license.id).n,
        latestVersion: latestVersion(license.product_id)
      })
    );
  });

  // ================= ADMIN AUTH =================

  const sessions = new Set();
  function newSession(res) {
    const sid = crypto.randomBytes(24).toString('hex');
    sessions.add(sid);
    res.cookie('sid', sid, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 3600 * 1000 });
  }
  function requireAuth(req, res, next) {
    if (req.cookies.sid && sessions.has(req.cookies.sid)) return next();
    res.status(401).json({ error: 'Unauthorized' });
  }

  app.post('/api/admin/login', (req, res) => {
    const pw = String(req.body?.password || '');
    const a = Buffer.from(pw);
    const b = Buffer.from(adminPassword);
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!ok) return res.status(401).json({ error: 'Wrong password' });
    newSession(res);
    res.json({ ok: true });
  });
  app.post('/api/admin/logout', (req, res) => {
    sessions.delete(req.cookies.sid);
    res.clearCookie('sid');
    res.json({ ok: true });
  });
  app.get('/api/admin/me', (req, res) => {
    res.json({ authed: !!(req.cookies.sid && sessions.has(req.cookies.sid)) });
  });

  if (autologinToken) {
    app.get('/auth/auto', (req, res) => {
      if (req.query.token !== autologinToken) return res.status(403).send('Forbidden');
      newSession(res);
      res.redirect('/admin');
    });
  }

  // ================= ADMIN API =================

  app.get('/api/admin/pubkey', requireAuth, (req, res) => {
    res.json({ key: signing.publicKeyBase64, pem: signing.publicKeyPem });
  });

  // ---- products ----
  const productRow = (p) => ({
    ...p,
    licenses: db.prepare('SELECT COUNT(*) AS n FROM licenses WHERE product_id = ?').get(p.id).n,
    versions: db.prepare('SELECT COUNT(*) AS n FROM versions WHERE product_id = ?').get(p.id).n
  });

  app.get('/api/admin/products', requireAuth, (req, res) => {
    res.json(db.prepare('SELECT * FROM products ORDER BY created_at DESC').all().map(productRow));
  });

  app.post('/api/admin/products', requireAuth, (req, res) => {
    const name = String(req.body?.name || '').trim();
    let slug = String(req.body?.slug || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    if (!name) return res.status(400).json({ error: 'Name is required' });
    if (!slug) slug = name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    const seats = Math.max(1, Number(req.body?.default_seats) || 1);
    try {
      const info = db
        .prepare('INSERT INTO products (slug, name, default_seats, webhook_url, webhook_secret) VALUES (?, ?, ?, ?, ?)')
        .run(slug, name, seats, String(req.body?.webhook_url || ''), crypto.randomBytes(24).toString('hex'));
      res.status(201).json(productRow(getProduct.get(info.lastInsertRowid)));
    } catch (e) {
      if (/UNIQUE/.test(String(e))) return res.status(409).json({ error: 'Slug already exists' });
      throw e;
    }
  });

  app.get('/api/admin/products/:id', requireAuth, (req, res) => {
    const p = getProduct.get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    const versions = db
      .prepare('SELECT * FROM versions WHERE product_id = ?')
      .all(p.id)
      .sort(semverSortDesc);
    res.json({ ...productRow(p), versionList: versions });
  });

  app.put('/api/admin/products/:id', requireAuth, (req, res) => {
    const p = getProduct.get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    db.prepare('UPDATE products SET name = ?, default_seats = ?, webhook_url = ? WHERE id = ?').run(
      String(req.body?.name ?? p.name),
      Math.max(1, Number(req.body?.default_seats) || p.default_seats),
      String(req.body?.webhook_url ?? p.webhook_url),
      p.id
    );
    res.json(productRow(getProduct.get(p.id)));
  });

  app.delete('/api/admin/products/:id', requireAuth, (req, res) => {
    const p = getProduct.get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    const n = db.prepare('SELECT COUNT(*) AS n FROM licenses WHERE product_id = ?').get(p.id).n;
    if (n > 0) return res.status(409).json({ error: `Product has ${n} licenses — revoke/delete them first` });
    db.prepare('DELETE FROM versions WHERE product_id = ?').run(p.id);
    db.prepare('DELETE FROM products WHERE id = ?').run(p.id);
    res.json({ ok: true });
  });

  app.post('/api/admin/products/:id/webhook/test', requireAuth, async (req, res) => {
    const p = getProduct.get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    if (!p.webhook_url) return res.status(400).json({ error: 'No webhook URL configured' });
    dispatchWebhook(db, p, 'test', { license: 'test-license', fingerprint: 'test-fingerprint' });
    res.json({ ok: true, message: 'Test event dispatched — check the delivery log' });
  });

  app.post('/api/admin/products/:id/webhook/rotate-secret', requireAuth, (req, res) => {
    const p = getProduct.get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    db.prepare('UPDATE products SET webhook_secret = ? WHERE id = ?').run(crypto.randomBytes(24).toString('hex'), p.id);
    res.json(getProduct.get(p.id));
  });

  // ---- versions (multipart artifact upload OR external URL) ----
  const upload = multer({
    storage: multer.diskStorage({
      destination: artifactsDir,
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname || '') || '.bin';
        cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
      }
    }),
    limits: { fileSize: 2 * 1024 * 1024 * 1024 } // 2 GB
  });

  app.post('/api/admin/products/:id/versions', requireAuth, upload.single('artifact'), (req, res) => {
    const p = getProduct.get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    const semver = String(req.body?.semver || '').trim();
    if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(semver)) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'semver must look like 1.2.3' });
    }
    const artifactUrl = String(req.body?.artifact_url || '').trim() || null;
    const info = db
      .prepare(
        'INSERT INTO versions (product_id, semver, notes, artifact_path, artifact_url, size) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(
        p.id,
        semver,
        String(req.body?.notes || ''),
        req.file ? req.file.filename : null,
        req.file ? null : artifactUrl,
        req.file ? req.file.size : 0
      );
    res.status(201).json(db.prepare('SELECT * FROM versions WHERE id = ?').get(info.lastInsertRowid));
  });

  app.delete('/api/admin/versions/:id', requireAuth, (req, res) => {
    const v = db.prepare('SELECT * FROM versions WHERE id = ?').get(req.params.id);
    if (!v) return res.status(404).json({ error: 'Not found' });
    if (v.artifact_path) {
      try { fs.unlinkSync(path.join(artifactsDir, path.basename(v.artifact_path))); } catch { /* gone */ }
    }
    db.prepare('DELETE FROM versions WHERE id = ?').run(v.id);
    res.json({ ok: true });
  });

  // ---- licenses ----
  function issueLicense(product, body) {
    const licenseId = newId();
    const tier = String(body.tier || 'standard').slice(0, 40);
    const seats = Math.max(1, Number(body.seats) || product.default_seats);
    const expiresAt = body.expires_at ? String(body.expires_at) : null; // ISO date or datetime
    const expUnix = expiresAt ? Math.floor(new Date(expiresAt + (expiresAt.length <= 10 ? 'T23:59:59Z' : 'Z')).getTime() / 1000) : null;
    const key = keys.makeLicenseKey(
      { licenseId, productSlug: product.slug, tier, seats, issuedAt: now(), expiresAt: expUnix },
      signing.privateKey
    );
    db.prepare(
      `INSERT INTO licenses (id, product_id, key, tier, seats, customer_email, customer_name, expires_at, order_ref)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      licenseId,
      product.id,
      key,
      tier,
      seats,
      String(body.customer_email || ''),
      String(body.customer_name || ''),
      expUnix ? new Date(expUnix * 1000).toISOString().replace('T', ' ').slice(0, 19) : null,
      String(body.order_ref || '')
    );
    return db.prepare('SELECT * FROM licenses WHERE id = ?').get(licenseId);
  }

  app.post('/api/admin/licenses', requireAuth, (req, res) => {
    const product = getProduct.get(Number(req.body?.product_id));
    if (!product) return res.status(400).json({ error: 'product_id is required' });
    const count = Math.min(1000, Math.max(1, Number(req.body?.count) || 1));
    const out = [];
    const tx = db.transaction(() => {
      for (let i = 0; i < count; i++) out.push(issueLicense(product, req.body || {}));
    });
    tx();
    res.status(201).json(count === 1 ? out[0] : out);
  });

  const licenseListRow = (l) => ({
    ...l,
    product_slug: getProduct.get(l.product_id)?.slug,
    product_name: getProduct.get(l.product_id)?.name,
    seats_used: activeSeats.get(l.id).n
  });

  app.get('/api/admin/licenses', requireAuth, (req, res) => {
    const search = String(req.query.search || '').trim();
    const productId = Number(req.query.product_id) || null;
    let sql = 'SELECT * FROM licenses';
    const where = [];
    const params = [];
    if (search) {
      where.push('(key LIKE ? OR customer_email LIKE ? OR customer_name LIKE ? OR id LIKE ? OR order_ref LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like, like, like);
    }
    if (productId) {
      where.push('product_id = ?');
      params.push(productId);
    }
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY issued_at DESC LIMIT 500';
    res.json(db.prepare(sql).all(...params).map(licenseListRow));
  });

  app.get('/api/admin/licenses/:id', requireAuth, (req, res) => {
    const l = db.prepare('SELECT * FROM licenses WHERE id = ?').get(req.params.id);
    if (!l) return res.status(404).json({ error: 'Not found' });
    res.json({
      ...licenseListRow(l),
      activations: db
        .prepare('SELECT * FROM activations WHERE license_id = ? ORDER BY first_seen DESC')
        .all(l.id),
      downloads: db
        .prepare(
          `SELECT d.*, v.semver FROM download_events d LEFT JOIN versions v ON v.id = d.version_id
           WHERE d.license_id = ? ORDER BY d.created_at DESC LIMIT 100`
        )
        .all(l.id)
    });
  });

  app.post('/api/admin/licenses/:id/revoke', requireAuth, (req, res) => {
    const l = db.prepare('SELECT * FROM licenses WHERE id = ?').get(req.params.id);
    if (!l) return res.status(404).json({ error: 'Not found' });
    db.prepare('UPDATE licenses SET revoked = 1, revoked_reason = ? WHERE id = ?').run(
      String(req.body?.reason || ''),
      l.id
    );
    res.json(licenseListRow(db.prepare('SELECT * FROM licenses WHERE id = ?').get(l.id)));
  });

  app.post('/api/admin/licenses/:id/unrevoke', requireAuth, (req, res) => {
    const l = db.prepare('SELECT * FROM licenses WHERE id = ?').get(req.params.id);
    if (!l) return res.status(404).json({ error: 'Not found' });
    db.prepare("UPDATE licenses SET revoked = 0, revoked_reason = '' WHERE id = ?").run(l.id);
    res.json(licenseListRow(db.prepare('SELECT * FROM licenses WHERE id = ?').get(l.id)));
  });

  app.post('/api/admin/activations/:id/deactivate', requireAuth, (req, res) => {
    const a = db.prepare('SELECT * FROM activations WHERE id = ?').get(req.params.id);
    if (!a) return res.status(404).json({ error: 'Not found' });
    db.prepare("UPDATE activations SET deactivated_at = datetime('now') WHERE id = ?").run(a.id);
    res.json({ ok: true });
  });

  // ---- webhook deliveries ----
  app.get('/api/admin/webhook-deliveries', requireAuth, (req, res) => {
    const productId = Number(req.query.product_id) || null;
    const rows = productId
      ? db.prepare('SELECT * FROM webhook_deliveries WHERE product_id = ? ORDER BY id DESC LIMIT 200').all(productId)
      : db.prepare('SELECT * FROM webhook_deliveries ORDER BY id DESC LIMIT 200').all();
    const names = Object.fromEntries(db.prepare('SELECT id, name FROM products').all().map((p) => [p.id, p.name]));
    res.json(rows.map((r) => ({ ...r, product_name: names[r.product_id] || '?' })));
  });

  // ---- stats ----
  app.get('/api/admin/stats', requireAuth, (req, res) => {
    const licenses = db.prepare('SELECT COUNT(*) AS n FROM licenses').get().n;
    const revoked = db.prepare('SELECT COUNT(*) AS n FROM licenses WHERE revoked = 1').get().n;
    const seats = db.prepare('SELECT COUNT(*) AS n FROM activations WHERE deactivated_at IS NULL').get().n;
    const products = db.prepare('SELECT COUNT(*) AS n FROM products').get().n;
    const downloads = db.prepare('SELECT COUNT(*) AS n FROM download_events').get().n;
    const byDay = Object.fromEntries(
      db.prepare(
        `SELECT date(first_seen) AS d, COUNT(*) AS n FROM activations
         WHERE first_seen >= datetime('now','-30 days') GROUP BY d`
      ).all().map((r) => [r.d, r.n])
    );
    const days = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      days.push({ date: d, activations: byDay[d] || 0 });
    }
    res.json({ licenses, revoked, active_seats: seats, products, downloads, days });
  });

  // ================= ADMIN SPA =================
  const distDir = path.join(__dirname, '..', 'dist');
  if (fs.existsSync(distDir)) {
    app.use('/admin', express.static(distDir));
    app.get('/admin/*', (req, res) => res.sendFile(path.join(distDir, 'index.html')));
  } else {
    app.get('/admin', (req, res) =>
      res.status(503).type('html').send('<h1>Admin UI not built</h1><p>Run <code>npm run build</code> first.</p>')
    );
  }

  app.get('/', (req, res) => res.redirect('/admin'));

  app.locals.db = db;
  app.locals.signing = signing;
  return app;
}

module.exports = { createApp };
