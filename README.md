# Vault — local credential keeper

A Chrome/Brave extension that stores login credentials locally, encrypted with
a master password. Nothing is ever sent over the network — there are no host
permissions and no remote requests, only `chrome.storage.local` on your machine.

## How it works
- First launch asks you to set a master password. It is never stored — only
  used with PBKDF2 (250,000 iterations) to derive an AES-256-GCM key.
- All credentials are encrypted as one blob before being written to
  `chrome.storage.local`.
- Optionally "keep unlocked for 15 minutes" caches the derived key in
  `chrome.storage.session`, which Chrome clears automatically when the browser
  closes — so quick re-opens of the popup skip re-typing the password, but it
  never persists to disk in the clear.
- Forgetting the master password means the vault can't be decrypted — that's
  a property of real encryption, not a bug.

## Install (unpacked, for local/dev use)
1. Open `chrome://extensions` (or `brave://extensions`).
2. Turn on "Developer mode" (top right).
3. Click "Load unpacked" and select this `credential-vault` folder.
4. Pin the extension and click its icon to open the vault.

## Files
- `manifest.json` — MV3 manifest, `storage` permission only
- `popup.html` / `popup.css` / `popup.js` — the UI and app logic
- `crypto.js` — Web Crypto helpers (PBKDF2 + AES-GCM)
- `icons/` — extension icons
