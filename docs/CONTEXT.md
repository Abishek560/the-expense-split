# App context — Trip Expense Splitter

## Mental model

- **Single trip per session:** One global `state` object: `tripName`, `started`, `members[]`, `expenses[]`. There is no multi-trip list in the UI; “Clear data” wipes the saved trip snapshot and resets UI.
- **Trip lifecycle:** User enters trip name → **Start trip** sets `started: true` and switches from the pre-start bar to the app toolbar, member strip, expense panel, and settlement panel. Members and expenses are only meaningful after start (enforced in UI and validation).

## Namespaces / public API

`script.js` is still a single vanilla JS file, but behavior is organized under domain namespaces:

- `App.Trip` / `window.Trip` — state, persistence, lifecycle entrypoints.
- `App.Member` / `window.Member` — member names, avatars, add-member event entrypoints.
- `App.Expense` / `window.Expense` — expense list, modal, draft reading, add/edit/delete entrypoints, AI-assisted fill, and split UI.
- `App.Expense.split` — participant selection, select-all behavior, split-field rendering, and split calculations.
- `App.Expense.ai` — free-text expense parsing through an external worker, then form prefill for user review.
- `App.Settlement` / `window.Settlement` — balances, simplified settlements, direct debts, and settlement preference.
- `App.Util` / `window.Util` — DOM, formatting, escaping, ids, and small helpers.

Prefer these namespace methods for future work; some internal event handlers still exist as private functions and are wrapped by the public namespace methods.

## Members

- Each member: `{ id, name }` (`id` from `crypto.randomUUID` or a timestamp-based fallback).
- Names are trimmed; duplicates are rejected case-insensitively (`validateMemberName`).
- Members drive: payer `<select>`, participant checkboxes, member chips, balance details, and settlement rows.

## Expenses

Each expense stores:

- `id` (string)
- `title`, `amount` (number, stored rounded to 2 decimals)
- `paidById` — must be one of the members
- `participantIds` — non-empty subset of members; **payer does not have to be included**. Direct settlement skips self-debt when the payer is included.
- `splitMethod` — one of: `equal` | `shares` | `percentage` | `custom`
- `splitDetails` — object keyed by member id; **empty for `equal`**; otherwise holds shares, percentages, or custom amounts per participant

## Expense entry modes

- The add-expense modal opens in **AI-assisted** mode by default (`expenseEntryMode = "ai"`).
- AI-assisted mode uses `Expense.ai.fetchParse(input)` to POST `{ input, members }` to `EXPENSE_AI_WORKER_URL`. The worker holds the Groq API key; the browser app does not store model credentials.
- `Expense.ai.applyWorkerPayloadToForm(parsed)` validates the worker response, maps `paidByName` and `participantNames` back to existing members via `Member.findIdByName`, fills the manual form, switches the modal to **Manual**, and shows “Review the form, then save.”
- AI parsing is only a prefill step. The expense is not saved until the user submits the normal form and `Expense.addOrUpdateFromForm()` passes `validateExpenseDraft`.
- Edit mode always uses the manual panel. The AI/manual tab switch is hidden while editing an existing expense.
- `expenseEntryMode` is modal UI state only; it is not saved in `localStorage`.

## Split methods (how owed amounts are computed)

All flows go through **`Expense.split.computeOwedForExpense(expense)`** → returns `{ [memberId]: owedShare }` for participants.

| Method | Meaning | Notes |
|--------|---------|--------|
| **equal** | Total split evenly across `participantIds` | First *n−1* get `Util.round2(amount/n)`; **last participant gets the remainder** so sums match exactly. |
| **shares** | Weighted by positive share numbers in `splitDetails` | Same “last id gets remainder” pattern after proportional allocation. |
| **percentage** | Percents per participant (validation: sum ≈ 100, ε = 0.01) | Same remainder pattern on last participant. |
| **custom** | Explicit amount per participant | Each value is rounded with `Util.round2`; validation requires sum of custom parts ≈ expense total. |

**Rounding rule:** For equal / shares / percentage, do not assume every row is `amount/n`; the **last participant in the array** absorbs rounding drift.

## Balances

**`Settlement.computeBalances()`** (derived, not stored separately):

1. **`paid[id]`** — sum of `amount` for every expense where `paidById === id` (only if that id is still a member).
2. **`owed[id]`** — sum over expenses of that member’s share from `Expense.split.computeOwedForExpense` (only for current members).
3. **`net[id]`** — `paid[id] - owed[id]` (positive = should receive overall, negative = owes overall).

Balance data is rendered in two places:

- **`renderMemberList()`** shows each member chip with net status.
- **`Settlement.renderPanel()`** / internal `renderSettlementPanel()` shows payment suggestions and optional member balance details.

## Settlement logic

- The Settlement panel and print report support two modes via the **“Simplify debt”** toggle:
  - **Simplified**: uses `Settlement.simplify(netByMember)` (consolidated transfers to clear net balances).
  - **Direct (per-expense)**: uses `Settlement.computeDirectDebts()` (each participant’s share owed to that expense’s payer; not consolidated).
- **`Settlement.simplify(netByMember)`** — greedy pairing on integer smallest units (`cents` variable names in code, used for rupees/paise rounding):
  - Split members into creditors (net > 0) and debtors (net < 0).
  - Sort creditors descending, debtors ascending (most negative first).
  - Match largest creditor with largest debtor; create a transfer for `min(creditorCents, -debtorCents)`; repeat until settled.
- Output: list of `{ from, to, amount }` in rupees (2 decimals) for minimal transfers (not necessarily unique globally, but simple and deterministic).

## App flow

1. **Boot:** `Trip.load()` restores `tripExpenseSplitterState`; `Settlement.loadSimplifyDebtPreference()` restores the settlement toggle; event listeners are registered; `Trip.renderAll()` syncs the UI.
2. **Start trip:** `Trip.start()` validates the trip name, updates `state.tripName` and `state.started`, renders, then calls `Trip.save()`.
3. **Add members:** `Member.add()` validates names, rejects case-insensitive duplicates, pushes a member, renders member chips, payer options, and participant checkboxes, then calls `Trip.save()`.
4. **Add/edit expenses:** The **Add expense** button lives in the Expenses panel header. `Expense.modal.open()` starts the add flow in AI-assisted mode; users can switch to Manual. AI fill populates the manual form for review. `Expense.modal.openForEdit()` opens existing expenses in Manual mode only. Submit runs `Expense.addOrUpdateFromForm()`, which reads the draft, validates split details, writes to `state.expenses`, closes the modal, renders, and calls `Trip.save()`.
5. **Delete expenses:** Expense card delete actions are delegated from `.panel-expenses-main`, call `Expense.delete()`, confirm with the user, remove the expense, render, and call `Trip.save()`.
6. **Settle/export:** `Settlement.renderPanel()` derives settlement rows from current state. `onExportPdf()` builds `#print-report` with `buildPrintReportHtml()` and calls `window.print()`.
7. **Clear data:** `Trip.resetState()` removes only the saved trip snapshot and resets the in-memory trip. The simplify-debt preference remains in `localStorage`.

## Data flow: state → calculations → render

1. **User action** (click, submit, change) → event handler in `DOMContentLoaded` setup.
2. **Validation** on drafts where applicable → mutate **`state`** (push member/expense, toggle flags, etc.).
3. **`Trip.save()`** after successful mutations — serializes a snapshot to `localStorage`.
4. **`Trip.renderAll()`** (or a subset) runs:
   - Syncs disabled/enabled UI, toolbar, modal state
   - **`Settlement.computeBalances`** / **`Settlement.simplify`** invoked inside render builders as needed (not stored on state)
   - DOM updated via `innerHTML` / `createElement` patterns per section

**Important:** Calculations are **pure functions of `state`**. If balances look wrong, trace `Expense.split.computeOwedForExpense` → `Settlement.computeBalances` before changing render markup.

## Export / print

- **Export PDF** fills hidden `#print-report` with HTML from `buildPrintReportHtml()` then calls `window.print()`. User chooses “Save as PDF” in the browser dialog. Not a server-side PDF library.

## Persistence keys

- Trip snapshot: `tripExpenseSplitterState`
- Simplify debt preference: `tripExpenseSplitterSimplifyDebt` (`"1"` or `"0"`). This preference is not cleared by **Clear data**.

## Event wiring notes

- `DOMContentLoaded` wires the public namespace methods (`Trip.start`, `Member.add`, `Expense.addOrUpdateFromForm`, `Expense.modal.open`, `Expense.delete`, `Settlement.renderPanel`).
- AI expense fill wires `#btn-expense-ai-parse` to `Expense.ai.onParseClick()` and the entry tabs to `Expense.modal.setEntryMode("ai"|"manual")`.
- Participant checkbox changes re-render split-specific fields; the master checkbox uses `Expense.split.onSelectAllToggle`, which delegates to `Expense.split.onParticipantSelectAllChange`.
- Escape closes the expense modal and calls `Trip.renderAll()`.

## Files / external services

- `index.html` — structure, IDs used by `script.js`, including the modal AI/manual entry panels
- `style.css` — layout and visual tokens
- `script.js` — browser behavior; calls an external worker for AI-assisted expense parsing
