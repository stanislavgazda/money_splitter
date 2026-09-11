# Deployment – Komu koľko (PWA)

## What's in this project

| File | Purpose |
|---|---|
| `pwa/index.html` | The app (sync URL hardcoded, password auth, settings sync) |
| `pwa/manifest.json` | PWA manifest (name, colors, icons) |
| `pwa/sw.js` | Service worker – offline support + auto-updates |
| `pwa/icon-192.png`, `pwa/icon-512.png` | App icons |
| `google-apps-script.gs` | Updated backend (v2) – **must be redeployed** |

## Step 1 – Update the Apps Script (~3 min)

1. Open your Google Sheet → Extensions → Apps Script.
2. Replace all code with the contents of `google-apps-script.gs`.
3. Set the family password as a **Script Property** (not in the code, so the
   `.gs` file is safe to commit to a public repo): Project Settings (⚙️) →
   Script Properties → Add script property → Property `TOKEN`, Value = your password.
4. **Deploy → Manage deployments → ✏️ edit → Version: New version → Deploy.**
   Do NOT create a *new* deployment – editing the existing one keeps the same `/exec` URL that is hardcoded in the app.
   (Later password changes need only step 3 – no redeploy.)

The script now rejects every request without the password, and stores app settings (families, meal prices, currency) in a new **Settings** tab of the same Sheet.

## Step 2 – Publish on GitHub Pages (~5 min, once)

1. Create a new **public** repo, e.g. `komu-kolko`.
2. Push the **contents of the `pwa/` folder** to the repo root (so `index.html` is at the top level):
   ```bash
   cd pwa
   git init
   git add .
   git commit -m "Komu kolko PWA"
   git branch -M main
   git remote add origin https://github.com/<your-username>/komu-kolko.git
   git push -u origin main
   ```
3. On github.com: repo → **Settings → Pages** → Source: *Deploy from a branch* → Branch: `main`, folder `/ (root)` → Save.
4. After ~1 minute the app is live at:
   `https://<your-username>.github.io/komu-kolko/`

## Step 3 – Install on each phone (~1 min)

1. Open the URL in **Chrome** (Android) or **Safari** (iPhone).
2. Enter the family password when prompted (once per device – it's remembered).
3. Install:
   - **Android/Chrome:** menu ⋮ → **Install app** (or the "Add to home screen" banner).
   - **iPhone/Safari:** Share □↑ → **Add to Home Screen**.

The app now has its own icon, opens fullscreen, and works offline (entries queue and sync when back online).

## Bill scanning (Skenovať účet)

The third split mode photographs a receipt and lets you tag each item with a family.
Extraction runs through Gemini, called server-side by the Apps Script, so the API
key never appears in the public repo.

1. Get a free API key at https://aistudio.google.com/apikey (same Google account is fine).
2. Apps Script → Project Settings (⚙️) → Script Properties → Add:
   Property `GEMINI_API_KEY`, Value = the key.
3. Paste the updated `google-apps-script.gs` and redeploy (Manage deployments → edit → New version).

Free-tier limits are far above family usage. If a scan fails, the app shows the
server's error message (e.g. missing key, unreadable photo).

## Comments and saved receipts

Every entry can carry a short note ("za čo to bolo") and a photo of the bill.
Both appear in the app's history and in the Sheet.

- **Poznámka** – free text, all three split modes plus settlements.
- **Účtenka** – in *Skenovať účet* the scanned photo is attached automatically;
  in *Na porcie* and *Konkrétne sumy* there's a **📷 Priložiť účtenku** button
  (no Gemini call – it's just a reminder of what the bill was).

Photos go to a Drive folder **"Komu koľko – účtenky"** in the sheet owner's
account; the entry stores only the file id and link, so syncs stay small
(~150 KB per receipt, roughly 30 MB a year). Deleting an entry also trashes its
photo. Files are shared *anyone with the link* so the link opens from the app
and straight from the Sheet — the link itself is unguessable, but note the photo
is not behind the family password.

**Required once after pasting the new `google-apps-script.gs`:**

1. In the Apps Script editor select the function `testDrive` and **Run**.
   Authorize when asked – this grants the new Drive permission and creates the
   folder. Skipping it means entries still save but photos silently don't.
2. **Deploy → Manage deployments → ✏️ edit → New version → Deploy.**

The `Ledger` sheet gains two columns (`Poznámka`, `Účtenka`) automatically on
the first entry saved after the update. Existing rows are preserved.

## Testing before the family sees it

Work on a `feat/...` branch. GitHub Pages only serves `main`, so nothing on a
branch reaches anyone's phone. Test locally against a **separate** Sheet —
branching separates code, but the backend has no branches, so without this you'd
be writing into the real family ledger.

### Once per test environment

1. **Copy the Sheet** – open the production sheet → **File → Make a copy**
   ("Money Splitter TEST"). Use a copy rather than an empty sheet: schema
   changes then run against real data, at zero risk to the original.
2. **Extensions → Apps Script** in the copy, paste all of `google-apps-script.gs`.
3. **⚙️ Project Settings → Script properties** – add `TOKEN` (any test password)
   and `GEMINI_API_KEY`. Copies do **not** inherit script properties; without
   these the script refuses every request.
4. Change `var PHOTO_FOLDER` to `Komu koľko – účtenky TEST`, or test photos land
   in the production receipts folder. This edit lives only in the test copy –
   never commit it. Re-apply it each time you paste an updated script.
5. Run **`testDrive`** (function dropdown → Run) and authorize
   (*Advanced → Go to … (unsafe)* is expected for your own script).
6. **Deploy → New deployment** → gear → **Web app**, Execute as **Me**, access
   **Anyone** → Deploy. The dialog shows the **Web app URL ending in `/exec`** –
   that's what the app needs. Lost it? **Deploy → Manage deployments**.

Do steps 4–5 *before* step 6: a deployment pins the code as it was at that
moment, so editing afterwards means Manage deployments → edit → New version.
`testDrive` is the exception – run from the editor it always uses current code,
so the folder appearing in Drive does not prove the deployed URL will use it.

### Each test session

```bash
cd pwa && python -m http.server 8000 --bind 127.0.0.1
```

Open <http://localhost:8000/>, F12 → device toolbar (Ctrl+Shift+M) for phone
layout. In **⚙️ Nastavenia** paste the test `/exec` URL and test password, then
**Uložiť a otestovať pripojenie**.

Never edit `DEFAULT_SYNC_URL` for this. The URL is stored per browser origin, so
`localhost` keeps pointing at test while the deployed app keeps pointing at
production — there is nothing to remember to revert before merging.

What localhost cannot cover: real camera capture (desktop opens a file picker),
iOS Safari, and installed-PWA behaviour. Worth one pass on a real phone after
merging, before telling anyone the feature exists.

## Making changes later

- **App (UI, logic):** edit `pwa/index.html` in VS Code → `git push` (or drag-and-drop onto the repo on github.com). Pages redeploys in ~1 min; phones load the new version next time the app is opened online. No reinstall needed.
- **Backend:** edit code at script.google.com → Manage deployments → edit → New version. URL stays the same.
- **Password change:** edit the `TOKEN` script property (Project Settings → Script Properties, no redeploy needed), then enter the new password on each phone (Settings tab or the prompt).

## How settings sync works

- Families, meal prices, and currency now live in the Sheet's **Settings** tab and sync to all devices.
- Newest change wins (timestamped); syncs on app open, when opening Zostatky, and when tapping the badge.
- The password itself never syncs – it stays on each device.

## Notes

- The page is public but useless without the password; `noindex` keeps it out of search engines.
- Don't commit `Link na synchronizáciu.txt` or the password anywhere public other than inside `index.html`'s sync URL (the URL alone grants nothing without the password).
