# JCREMC Operation Round-Up — private board site

Private workspace for the ORU Advisory Board chair. It reads the **"Funds Requested By Organization"** Google Sheet live and has four views:

- **Search** (landing): has an organization been funded? Searches every cycle tab and groups spelling variants of the same org.
- **Dashboard**: total given, grants per cycle, committee roster and officers, top recipients.
- **Cycles**: each cycle tab laid out the way it is in the Sheet, with footer totals, filters and sortable columns.
- **Decide**: the current cycle as a card deck. **Fund** writes the full request to *Amount Funded*. **Partially fund** asks for an amount and an optional note. **Skip** writes $0 (not funded). Each decision has Undo and a **Change** button.

The repo holds no grant data and no passcode. Data only comes back from the Apps Script when the right passcode is sent, so it's fine if this repo is ever made public.

## One-time setup (~10 min)

1. Open the Sheet, then go to **Extensions → Apps Script**. Replace `Code.gs` with `apps-script/Code.gs` and save.
2. Reload the Sheet. A new **ORU Site** menu appears. Choose **ORU Site → Set passcode…**, approve the permissions prompt, and enter the passcode.
3. In Apps Script, go to **Deploy → New deployment → Web app**. Set *Execute as* to **Me** and *Who has access* to **Anyone**, then deploy and copy the `/exec` URL.
4. Paste that URL into `config.js` as `apiUrl` and commit.
5. On your phone, open the site, then use **Share → Add to Home Screen**.

## Each new cycle

Add the new tab in the usual format (for example `2027 April`). In Apps Script, set `CURRENT_TAB = '2027 April'`, then use **Deploy → Manage deployments → Edit → New version** so the URL stays the same. Only the current tab can be written to.

## Notes

- Ten wrong passcode tries lock the site for 15 minutes. You can change the passcode anytime from the ORU Site menu.
- Tab names must look like `YYYY April` or `YYYY October`. Columns are found by header name, so older layouts work too (for example, tabs with no Total Project Cost column).
- The colors follow the JCREMC 2026 Branding Guidelines: Blue PMS 294 `#3e5885`, Green PMS 363 `#608354`, Gray `#9c9da0`.
