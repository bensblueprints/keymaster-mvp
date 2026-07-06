const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

function nativeBindingPath() {
  // Under Electron the Node-ABI binding won't load; use the vendored Electron prebuild.
  if (!process.versions.electron) return null;
  const p = path.join(__dirname, '..', 'vendor', 'better_sqlite3-electron.node');
  return fs.existsSync(p) ? p : null;
}

function openDb(dataDir, dbPath) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'artifacts'), { recursive: true });
  const nativeBinding = nativeBindingPath();
  const file = dbPath || path.join(dataDir, 'keymaster.db');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file, nativeBinding ? { nativeBinding } : {});
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      default_seats INTEGER NOT NULL DEFAULT 1,
      webhook_url TEXT DEFAULT '',
      webhook_secret TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id),
      semver TEXT NOT NULL,
      notes TEXT DEFAULT '',
      artifact_path TEXT DEFAULT NULL,
      artifact_url TEXT DEFAULT NULL,
      size INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS licenses (
      id TEXT PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id),
      key TEXT NOT NULL UNIQUE,
      tier TEXT NOT NULL DEFAULT 'standard',
      seats INTEGER NOT NULL DEFAULT 1,
      customer_email TEXT DEFAULT '',
      customer_name TEXT DEFAULT '',
      issued_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT DEFAULT NULL,
      revoked INTEGER NOT NULL DEFAULT 0,
      revoked_reason TEXT DEFAULT '',
      order_ref TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS activations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      license_id TEXT NOT NULL REFERENCES licenses(id),
      fingerprint TEXT NOT NULL,
      hostname TEXT DEFAULT '',
      app_version TEXT DEFAULT '',
      first_seen TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen TEXT NOT NULL DEFAULT (datetime('now')),
      deactivated_at TEXT DEFAULT NULL,
      UNIQUE(license_id, fingerprint)
    );
    CREATE TABLE IF NOT EXISTS download_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      license_id TEXT NOT NULL,
      version_id INTEGER NOT NULL,
      ip TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      event TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status_code INTEGER DEFAULT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_activations_license ON activations(license_id);
    CREATE INDEX IF NOT EXISTS idx_licenses_product ON licenses(product_id);
    CREATE INDEX IF NOT EXISTS idx_versions_product ON versions(product_id);
    CREATE INDEX IF NOT EXISTS idx_deliveries_product ON webhook_deliveries(product_id);
  `);

  return db;
}

function getSetting(db, key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(db, key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

module.exports = { openDb, getSetting, setSetting };
