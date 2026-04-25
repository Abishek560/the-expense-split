# Reusable prompts — Trip Expense Splitter

Copy/adapt these when starting a new agent session. Keep scope small; cite `docs/AGENT.md` and `docs/RULES.md`.

---

## Per-person share on expense cards

> Add per-person share breakdown for each expense card: expandable/collapsible rows, summary by default, expanded shows each participant’s owed share for that expense (equal, shares, percentage, custom). Reuse existing split math (`computeOwedForExpense`); do not duplicate allocation logic. Follow `docs/FEATURES.md` and `docs/UI_UX_GUIDE.md`. Vanilla JS only; minimal diff.

---

## UI refactor (layout / CSS only)

> Refactor the Trip Expense Splitter UI using only `index.html` and `style.css`. Do not change `script.js` behavior or element IDs that `script.js` depends on. Preserve accessibility (labels, `aria-*` where present). Goal: [describe: e.g. cleaner toolbar, better spacing]. No frameworks.

---

## Split UX improvement

> Improve the Add Expense flow for split methods (shares, percentage, custom) in vanilla JS. Keep `computeOwedForExpense` and `validateExpenseDraft` rules identical unless you find a bug — document any math change. Prefer minimal changes: possibly `renderSplitFields`, related HTML in the modal, and CSS. Do not duplicate split logic outside existing functions.

---

## Modal UX (Add Expense)

> Polish the Add Expense modal UX: focus management, hints, and mobile layout. Only touch `index.html`, `style.css`, and the minimal sections of `script.js` needed for behavior (e.g. focus, optional aria). Do not rewrite the whole app or introduce libraries.

---

## localStorage persistence (enhance / fix)

> The app already persists to `localStorage` under `tripExpenseSplitterState`. [Choose one:] (a) Fix a specific bug: [describe]. (b) Add migration/version field to the snapshot for future schema changes without breaking existing users. (c) Add a visible “last saved” or export JSON backup. Keep vanilla JS; extend `saveState`/`loadState` carefully with backward compatibility.

---

## PDF / export

> The app uses `window.print()` and `#print-report` for export. Improve the print layout or user guidance (button title, short on-page hint) without adding server-side PDF generation. Optionally adjust `@media print` in `style.css` and `buildPrintReportHtml()` structure — keep output consistent with on-screen balances and settlements.

---

## Keyboard & a11y pass

> Add or refine keyboard support and accessibility: [list: e.g. Enter to start trip, focus trap in modal, visible focus rings]. Use small, focused changes in `script.js` / HTML / CSS. Do not introduce frameworks.

---

## Mobile responsiveness

> Improve mobile layout for the main grid, toolbar, and expense modal. CSS-first; only change JS if required for layout (e.g. class toggles). No new dependencies.

---

## Generic safe-change prompt

> Make a minimal change to [feature]. Read `docs/CONTEXT.md` and the relevant functions in `script.js`. Do not duplicate split/balance/settlement logic. Do not introduce frameworks or rewrite unrelated files. After edits, describe what you changed and how to verify manually.
