# Money Splitter – Setup

Two parts: a Google Sheet (shared database) and the app in `pwa/`. One-time setup ≈ 10 minutes.

## 1. Create the Google Sheet backend

1. Go to [sheets.google.com](https://sheets.google.com) and create a new blank spreadsheet. Name it e.g. **Money Splitter**.
2. Menu: **Extensions → Apps Script**.
3. Delete any code in the editor, then paste the entire contents of `google-apps-script.gs`.
4. Click **Deploy → New deployment**.
5. Click the gear icon next to "Select type" → choose **Web app**.
6. Set:
   - **Execute as:** Me (your account)
   - **Who has access:** **Anyone**
7. Click **Deploy**, authorize the script when asked (you may need to click *Advanced → Go to … (unsafe)* – it's your own script, this is normal).
8. Copy the **Web app URL** (ends with `/exec`).

> **Security note:** anyone with this URL can read/write the ledger. Don't post it publicly; sharing within the family is the intended use.

## 2. Connect the app

1. Open the app (the URL from GitHub Pages – see step 3 below, or `pwa/index.html` directly).
2. Go to **Settings → Google Sheet sync**, paste the URL, tap **Save & test connection**.
3. You should see "✓ Connected". Every saved meal now appears as a row in the Sheet, and all devices using the same URL share balances.

## 3. Put it on phones

The app is already hosted on GitHub Pages (deploys automatically from `main` – see `DEPLOYMENT.md`). Send that link to each person; they open it and use the browser's **Add to Home screen**. Each person pastes the same sync URL once in Settings.

## 4. Daily use

- **New meal**: pick who cooked/paid, tap what was served, set portions per family (child = 0.5), save. The app shows who owes whom for that meal.
- **Balances**: running totals across all meals. **Settle** records a payment and clears the debt. At the top, **Babin výrok dňa** shows one saying, the same one for everybody that day.
- **Settings**: edit families, per-person default prices, currency, and submit new **babine výroky** (the app only takes them – it never lists them).
- If you know the real total cost of a meal, enter it in the override field – portions then just split that amount.

## Notes

- If offline, entries are queued (badge shows "Offline") and sent when connection returns.
- The Sheet is human-readable – grandma can open it and see every meal and payment.
- Výroky live one per row in column A of the **Výroky** sheet. That sheet is the only place to read, fix or delete them – the app just shows one a day and has a box to submit a new one. Each výrok is shown once before any of them comes round again.
- If you edit the Apps Script later, use **Deploy → Manage deployments → edit (pencil) → New version**, otherwise the URL keeps serving the old code.
- If you rename a family in Settings, old entries keep the old name.
- GitHub Pages is set to deploy from a branch (not Actions), so `git push` to `main` is all that's needed – no manual redeploy or workflow step required.
