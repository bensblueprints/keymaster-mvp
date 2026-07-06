// Minimal public customer portal: GET /license/:key
// No accounts — the key itself is the credential.
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function maskKey(key) {
  if (!key || key.length < 24) return esc(key || '');
  return `${esc(key.slice(0, 12))}…${esc(key.slice(-8))}`;
}

function renderPortal({ found, key, license, product, seatsUsed, latestVersion, status }) {
  const statusColors = {
    active: ['#22c55e', 'Active'],
    expired: ['#f59e0b', 'Expired'],
    revoked: ['#ef4444', 'Revoked'],
    not_found: ['#ef4444', 'Not found']
  };
  const [color, label] = statusColors[status] || statusColors.not_found;

  const body = !found
    ? `<div class="card">
        <div class="pill" style="--c:${color}">${label}</div>
        <h1>License not found</h1>
        <p class="muted">This license key was not recognized by this server. Check for copy-paste errors, or contact the vendor you bought from.</p>
      </div>`
    : `<div class="card">
        <div class="row"><span class="pill" style="--c:${color}">${label}</span><span class="muted mono">${maskKey(key)}</span></div>
        <h1>${esc(product.name)}</h1>
        <div class="grid">
          <div><div class="k">Tier</div><div class="v">${esc(license.tier)}</div></div>
          <div><div class="k">Seats</div><div class="v">${seatsUsed} / ${license.seats} used</div></div>
          <div><div class="k">Issued</div><div class="v">${esc(license.issued_at.slice(0, 10))}</div></div>
          <div><div class="k">Expires</div><div class="v">${license.expires_at ? esc(license.expires_at.slice(0, 10)) : 'Never (perpetual)'}</div></div>
        </div>
        ${license.revoked ? `<p class="warn">This license was revoked${license.revoked_reason ? `: ${esc(license.revoked_reason)}` : ''}.</p>` : ''}
        ${
          latestVersion && status === 'active'
            ? `<a class="btn" href="/api/v1/download?license_key=${encodeURIComponent(key)}">Download v${esc(latestVersion.semver)}</a>
               <p class="muted small">Download links are signed and expire after a few minutes — click again if yours lapses.</p>`
            : `<p class="muted small">${latestVersion ? 'Downloads are unavailable for this license.' : 'No downloadable version has been published yet.'}</p>`
        }
      </div>`;

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>License — Keymaster</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box;margin:0}
  body{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;background:#09090b;color:#e4e4e7;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
  .card{background:#111113;border:1px solid #26262a;border-radius:16px;padding:36px;max-width:480px;width:100%;box-shadow:0 10px 40px rgba(0,0,0,.5)}
  h1{font-size:26px;margin:14px 0 22px;letter-spacing:-.02em}
  .row{display:flex;align-items:center;gap:12px;justify-content:space-between}
  .pill{display:inline-block;padding:4px 12px;border-radius:999px;font-size:12px;font-weight:600;color:var(--c);background:color-mix(in srgb,var(--c) 12%,transparent);border:1px solid color-mix(in srgb,var(--c) 35%,transparent)}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px}
  .k{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#71717a;margin-bottom:3px}
  .v{font-size:15px;font-weight:500}
  .btn{display:block;text-align:center;background:#8b5cf6;color:#fff;text-decoration:none;font-weight:600;padding:12px;border-radius:10px;margin-top:6px}
  .btn:hover{background:#7c3aed}
  .muted{color:#71717a}.small{font-size:12px;margin-top:12px}.mono{font-family:ui-monospace,monospace;font-size:12px}
  .warn{color:#fca5a5;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.25);padding:10px 14px;border-radius:10px;font-size:13px;margin-bottom:16px}
</style></head>
<body>${body}</body></html>`;
}

module.exports = { renderPortal };
