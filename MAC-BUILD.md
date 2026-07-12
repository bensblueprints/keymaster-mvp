# Building the macOS app (.dmg)

Two ways to get a Mac build of this app:

## Option A — GitHub Actions (no Mac needed)

This repo ships a `mac-build.yml` workflow that builds the DMG on a free
GitHub-hosted macOS runner.

1. Go to the repo on GitHub → **Actions** tab → **Mac Build** workflow.
2. Click **Run workflow** (branch: `main`) and wait ~3–6 minutes.
3. Open the finished run and download the **macos-dmg** artifact (a zip
   containing the `.dmg`).

The workflow also runs automatically when a GitHub release is published
(the DMG gets attached to the release) or when a `v*` tag is pushed.

## Option B — Build locally on a Mac

### 1. One-time machine setup

```bash
# Xcode command line tools (compilers for native modules)
xcode-select --install

# Node 20 via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
# restart the terminal, then:
nvm install 20
nvm use 20
```

### 2. Clone and build

```bash
git clone https://github.com/bensblueprints/<REPO-NAME>.git
cd <REPO-NAME>

npm ci          # or `npm install` if there is no package-lock.json

npx electron-builder --mac dmg --publish never \
  -c.mac.category=public.app-category.productivity \
  -c.mac.target=dmg
```

The `-c.mac.*` flags are only needed if the app's `package.json` `build`
config has no `mac` section — they're harmless either way.

### 3. Where the DMG lands

Check `build.directories.output` in `package.json`:

- most apps: `dist/<Product Name>-<version>.dmg`
- some apps: `release/<Product Name>-<version>.dmg`

## Native module troubleshooting (better-sqlite3 etc.)

Some apps use native modules. electron-builder rebuilds them for Electron's
ABI automatically via node-gyp. If the rebuild fails:

- Make sure Xcode CLT is installed: `xcode-select -p` should print a path.
  If not: `xcode-select --install`.
- node-gyp needs Python 3: `python3 --version` (macOS ships it with CLT).
- Wipe and retry: `rm -rf node_modules && npm ci`.
- Force a rebuild against Electron:
  `npx electron-rebuild` (or `npx electron-builder install-app-deps`).
- Apps with `scripts/setup-native.js` (vendored dual bindings) run it
  automatically on `postinstall`; it's safe if it logs "could not fetch
  Electron prebuild" — electron-builder rebuilds from source at package time.

## Unsigned app warning (Gatekeeper)

These DMGs are **unsigned** — there's no Apple Developer ID certificate yet.
On first launch macOS will say the app "cannot be opened because the
developer cannot be verified."

Workarounds (tell your users):

- Right-click (Ctrl-click) the app → **Open** → **Open** again, or
- `xattr -d com.apple.quarantine "/Applications/<App>.app"`, or
- System Settings → Privacy & Security → "Open Anyway".

Proper fix later: buy an Apple Developer account ($99/yr), export a
Developer ID Application certificate, and set `CSC_LINK` /
`CSC_KEY_PASSWORD` secrets so electron-builder signs and notarizes builds.
