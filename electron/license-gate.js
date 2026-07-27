/*
 * license-gate.js — Electron bootstrap gate for Whop-native licensing.
 * Vendored next to whop-license.js in each desktop app's src/.
 *
 * Usage in main.js (the ONLY per-app change):
 *   const { gateLicense } = require('./license-gate');
 *   app.whenReady().then(async () => {
 *     if (!(await gateLicense())) return;   // quit already requested
 *     createWindow(); ...
 *   });
 *
 * Handles: first-run OAuth activation, device-limit self-serve deactivation,
 * grace-period expiry re-login, and exposes IPC for a "Manage devices" UI:
 *   license:status / license:devices / license:deactivate(deviceId) /
 *   license:deactivateThisDevice
 */
const { app, dialog, shell, ipcMain } = require('electron');
const license = require('./whop-license');

const stateDir = () => app.getPath('userData');
const fmt = t => { try { return new Date(t).toLocaleDateString(); } catch { return '?'; } };

async function gateLicense() {
  // Documented bypass for CI and local smoke runs — never ship it set.
  if (process.env.SKIP_LICENSE_CHECK) return true;
  for (;;) {
    try {
      const r = await license.ensureLicensed({ stateDir: stateDir(), openUrl: u => shell.openExternal(u) });
      if (r.firstActivation) {
        dialog.showMessageBoxSync({ type: 'info', title: 'Activated', message: 'License activated on this device. Enjoy!' });
      }
      return true;
    } catch (e) {
      if (e.code === 'DEVICE_LIMIT' && Array.isArray(e.devices) && e.devices.length) {
        const buttons = [...e.devices.map(d => `Deactivate "${d.label || 'Unknown device'}" (last used ${fmt(d.last_seen_at)})`), 'Quit'];
        const { response } = await dialog.showMessageBox({
          type: 'warning', title: 'Device limit reached', buttons, cancelId: buttons.length - 1,
          message: 'This license is already active on the maximum number of devices.',
          detail: 'Deactivate one of your other devices to activate this one.',
        });
        if (response < e.devices.length) {
          try { await e.deactivate(e.devices[response].id); } catch (err) {
            dialog.showErrorBox('Deactivation failed', err.message);
          }
          continue; // retry activation with the freed slot
        }
      } else {
        const { response } = await dialog.showMessageBox({
          type: 'error', title: 'License required', buttons: ['Try again', 'Buy a license', 'Quit'], cancelId: 2,
          message: e.message || 'Could not verify your license.',
        });
        if (response === 0) continue;
        if (response === 1) { shell.openExternal('https://onetimesuite.com/'); continue; }
      }
      app.quit();
      return false;
    }
  }
}

/* Optional renderer-side "Manage devices" IPC (safe to register always). */
function registerLicenseIpc() {
  const cfg = license.loadConfig();
  const withToken = async fn => {
    const fs = require('fs'); const path = require('path');
    const s = JSON.parse(fs.readFileSync(path.join(stateDir(), 'whop-license.json'), 'utf8'));
    const t = await license.refreshTokens(cfg, s.refreshToken);
    return fn(t.access_token, s);
  };
  ipcMain.handle('license:status', () => {
    try {
      const fs = require('fs'); const path = require('path');
      const s = JSON.parse(fs.readFileSync(path.join(stateDir(), 'whop-license.json'), 'utf8'));
      return { activated: true, userId: s.userId, activatedAt: s.activatedAt, lastCheck: s.lastCheck };
    } catch { return { activated: false }; }
  });
  ipcMain.handle('license:devices', () => withToken(t => license.listDevices(cfg, t)));
  ipcMain.handle('license:deactivate', (_e, deviceId) => withToken(t => license.deactivateRemoteDevice(cfg, t, deviceId)));
  ipcMain.handle('license:deactivateThisDevice', () => withToken(async (t, s) => {
    await license.deactivateRemoteDevice(cfg, t, { deviceHash: s.deviceHash }); // free the remote slot
    license.deactivateDevice({ stateDir: stateDir() });                          // clear local activation
    return { ok: true };
  }));
}

module.exports = { gateLicense, registerLicenseIpc };
