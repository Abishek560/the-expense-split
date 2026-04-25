# App context — Trip Expense Splitter

## Mental model

- **Single trip per session:** One global `state` object: `tripName`, `started`, `members[]`, `expenses[]`. There is no multi-trip list in the UI; “Clear data” wipes storage and resets UI.
- **Trip lifecycle:** User enters trip name → **Start trip** sets `started: true` and locks the name field. Members and expenses are only meaningful after start (enforced in UI and validation).

## Members

- Each member: `{ id, name }` (`id` from `crypto.randomUUID` or a timestamp-based fallback).
- Names are trimmed; duplicates are rejected case-insensitively (`validateMemberName`).
- Members drive: payer `<select>`, participant checkboxes, balance rows, settlement graph.

## Expenses

Each expense stores:

- `id` (string)
- `title`, `amount` (number, stored rounded to 2 decimals)
- `paidById` — must be one of the members
- `participantIds` — non-empty subset of members; **payer must be included** (enforced in validation and UI: payer checkbox cannot be unchecked)
- `splitMethod` — one of: `equal` | `shares` | `percentage` | `custom`
- `splitDetails` — object keyed by member id; **empty for `equal`**; otherwise holds shares, percentages, or custom amounts per participant

## Split methods (how owed amounts are computed)

All flows go through **`computeOwedForExpense(expense)`** → returns `{ [memberId]: owedShare }` for participants.

| Method | Meaning | Notes |
|--------|---------|--------|
| **equal** | Total split evenly across `participantIds` | First *n−1* get `round2(amount/n)`; **last participant gets the remainder** so sums match exactly. |
| **shares** | Weighted by positive share numbers in `splitDetails` | Same “last id gets remainder” pattern after proportional allocation. |
| **percentage** | Percents per participant (validation: sum ≈ 100, ε = 0.01) | Same remainder pattern on last participant. |
| **custom** | Explicit amount per participant | Each value `round2`’d; validation requires sum of custom parts ≈ expense total. |

**Rounding rule:** For equal / shares / percentage, do not assume every row is `amount/n`; the **last participant in the array** absorbs rounding drift.

## Balances

**`computeBalances()`** (derived, not stored separately):

1. **`paid[id]`** — sum of `amount` for every expense where `paidById === id` (only if that id is still a member).
2. **`owed[id]`** — sum over expenses of that member’s share from `computeOwedForExpense` (only for current members).
3. **`net[id]`** — `paid[id] - owed[id]` (positive = should receive overall, negative = owes overall).

**`renderBalances()`** uses `net` for green/red/even styling and shows paid / owed detail.

## Settlement logic

- The Settlement panel and print report support two modes via the **“Simplify debt”** toggle:
  - **Simplified**: uses `simplifySettlements(netByMember)` (consolidated transfers to clear net balances).
  - **Direct (per-expense)**: uses `computeDirectExpenseDebts()` (each participant’s share owed to that expense’s payer; not consolidated).
- **`simplifySettlements(netByMember)`** — greedy pairing on **integer cents** of each member’s net:
  - Split members into creditors (net > 0) and debtors (net < 0).
  - Sort creditors descending, debtors ascending (most negative first).
  - Match largest creditor with largest debtor; create a transfer for `min(creditorCents, -debtorCents)`; repeat until settled.
- Output: list of `{ from, to, amount }` in dollars (2 decimals) for minimal transfers (not necessarily unique globally, but simple and deterministic).

## Data flow: state → calculations → render

1. **User action** (click, submit, change) → event handler in `DOMContentLoaded` setup.
2. **Validation** on drafts where applicable → mutate **`state`** (push member/expense, toggle flags, etc.).
3. **`saveState()`** after successful mutations — serializes a snapshot to `localStorage`.
4. **`renderAll()`** (or a subset) runs:
   - Syncs disabled/enabled UI, toolbar, modal state
   - **`computeBalances`** / **`simplifySettlements`** invoked inside render builders as needed (not stored on state)
   - DOM updated via `innerHTML` / `createElement` patterns per section

**Important:** Calculations are **pure functions of `state`**. If balances look wrong, trace `computeOwedForExpense` → `computeBalances` before changing render markup.

## Export / print

- **Export PDF** fills hidden `#print-report` with HTML from `buildPrintReportHtml()` then calls `window.print()`. User chooses “Save as PDF” in the browser dialog. Not a server-side PDF library.

## Persistence keys

- Trip snapshot: `tripExpenseSplitterState`
- Simplify debt preference: `tripExpenseSplitterSimplifyDebt`

## Files (no backend)

- `index.html` — structure, IDs used by `script.js`
- `style.css` — layout and visual tokens
- `script.js` — all behavior
