# Tasks — current ideas & future improvements

Use this as a backlog; verify behavior in `script.js` before implementing (some items may already be partially done).

## Expense list UI

- Current expense cards already include a collapsed **Show split details** section. Future work can improve the summary copy, animation, or default-open behavior if needed. See `docs/FEATURES.md`, `docs/UI_UX_GUIDE.md`.
- The primary **Add expense** action now sits in the Expenses panel header; keep this placement in mind when adjusting toolbar or panel layouts.

## UX — Add Expense modal

- Current add flow starts on the **AI-assisted** tab and switches to Manual after a successful parse. Edit flow is Manual-only.
- Improve focus order, spacing, and hierarchy (title / amount / payer / participants / split).
- Consider inline validation hints vs single `#expense-message` line.
- Optional: trap focus inside modal for accessibility; ensure Escape still closes (already wired).

## AI-assisted expense entry

- Improve parse-result review clarity: make it obvious that AI fill only prefills the form and does not save.
- Consider examples for common inputs: equal split, payer not participating, shares, percentages, and custom amounts.
- Keep worker failures graceful and visible in `#expense-message`.

## UX — Split inputs

- When participants or split method change, split fields are re-rendered — **values reset**; consider preserving inputs where ids overlap, or warn user.
- The participant **Select all** control is wired through `Expense.split.onSelectAllToggle`; keep it synced with individual checkbox behavior.
- Improve labels / placeholders for shares, percentage, and custom rows (clarity for first-time users).
- Show live “sum to 100%” or “sum to total” indicators for percentage/custom before submit (non-blocking hints).

## Keyboard interactions

- **Member name:** Enter already submits add member (`Member.onNameKeydown`) — keep when changing member UI.
- Extend: Enter in trip name field to start trip (if valid); focus trap + Escape behavior for the modal.

## Balances UI

- Current presentation uses member chips plus a unified settlement panel with optional balance details; still can feel dense — explore typography, spacing, and visual grouping.
- Optional: sort by net amount or group “owed” vs “owed to you.”

## Mobile responsiveness

- Audit `main-grid`, sidebar, toolbar, and modal on narrow widths (stack order, tap targets, horizontal scroll).
- Toolbar actions may need wrapping or a compact menu on small screens.

## Possible future features (not in original UI)

- Multiple trips with a selector (would require state schema + UI redesign — **large change;** align with owner first).
- Currency selector (display only; math stays numeric).

## Already implemented (avoid redundant work)

- **localStorage** persistence for trip state.
- **Print / Save as PDF** via browser print and `#print-report`.
- **Edit expense** (via Edit button on expense cards).
- **Delete expense** (via Delete button on expense cards).
- **AI-assisted expense fill** for new expenses, backed by an external worker and reviewed through the manual form before save.
- **Collapsible split details** on expense cards.
- **Simplify debt** toggle (switches simplified vs per-expense reimbursements) and persisted preference.
- **Enter** on member name input adds member.
