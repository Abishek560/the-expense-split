# Tasks — current ideas & future improvements

Use this as a backlog; verify behavior in `script.js` before implementing (some items may already be partially done).

## Expense list UI

- Current expense cards already include a collapsed **Show split details** section. Future work can improve the summary copy, animation, or default-open behavior if needed. See `docs/FEATURES.md`, `docs/UI_UX_GUIDE.md`.

## UX — Add Expense modal

- Improve focus order, spacing, and hierarchy (title / amount / payer / participants / split).
- Consider inline validation hints vs single `#expense-message` line.
- Optional: trap focus inside modal for accessibility; ensure Escape still closes (already wired).

## UX — Split inputs

- When participants or split method change, split fields are re-rendered — **values reset**; consider preserving inputs where ids overlap, or warn user.
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
- **Collapsible split details** on expense cards.
- **Simplify debt** toggle (switches simplified vs per-expense reimbursements) and persisted preference.
- **Enter** on member name input adds member.
