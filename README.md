# JCREMC Operation Round-Up — private board site

Private workspace for the ORU Advisory Board chair. It reads the **"Funds Requested By Organization"** Google Sheet live and has four views:

- **Search** (landing): has an organization been funded? Searches every cycle tab and groups spelling variants of the same org.
- **Dashboard**: total given, grants per cycle, committee roster and officers (editable — writes back to the ORU Advisory Board tab), top recipients.
- **Cycles**: each cycle tab laid out the way it is in the Sheet, with footer totals, filters and sortable columns.
- **Decide**: the current cycle as a card deck. **Fund** writes the full request to *Amount Funded*. **Partially fund** asks for an amount and an optional note. **Skip** leaves Amount Funded blank and tags Notes with `[Discuss]` so it lands in the "Discuss at board meeting" pile on every device. A small "Not funding this one" link writes $0. Each decision has Undo and a **Change** button.

- **Board meeting mode**: big-screen view of the Discuss pile (or everything undecided) with a live budget; Fund / Partial / Not funding right from each card.
- **Results summary**: funded list with totals, copy as text or paste into a spreadsheet.
- **Flags** on each application (funded last cycle, asks more than project cost, past notes like "outside Johnson Co", first-time applicant) and a budget check before going over.
- **Application files** from the shared Drive folders for each cycle.

The repo holds no grant data and no passcode. Data only comes back from the Apps Script when the right passcode is sent, so it's fine if this repo is ever made public.

## One-time setup (~10 min)

1. Open the Sheet, then go to **Extensions → Apps Script**. Replace `Code.gs` with `apps-script/Code.gs` and save.
2. Pick **authorize** in the function menu and click **Run** once (grants Sheet + Drive access).
3. Reload the Sheet. A new **ORU Site** menu appears. Choose **ORU Site → Set passcode…**, approve the permissions prompt, and enter the passcode.
4. In Apps Script, go to **Deploy → New deployment → Web app**. Set *Execute as* to **Me** and *Who has access* to **Anyone**, then deploy and copy the `/exec` URL.
5. Paste that URL into `config.js` as `apiUrl` and commit.
6. On your phone, open the site, then use **Share → Add to Home Screen**.

## Each new cycle

Just add the new tab in the usual format (for example `2027 April`). The newest tab automatically becomes the current cycle (`CURRENT_TAB = 'auto'` in Code.gs). Only the current tab's Amount Funded can be written to.

## Notes

- Ten wrong passcode tries lock the site for 15 minutes. You can change the passcode anytime from the ORU Site menu.
- Tab names must look like `YYYY April` or `YYYY October`. Columns are found by header name, so older layouts work too (for example, tabs with no Total Project Cost column).
- The colors follow the JCREMC 2026 Branding Guidelines: Blue PMS 294 `#3e5885`, Green PMS 363 `#608354`, Gray `#9c9da0`.
