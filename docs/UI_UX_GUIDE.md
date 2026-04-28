# UI / UX guide — Trip Expense Splitter

Lightweight patterns for layout and interaction. Pair with `docs/FEATURES.md` for product intent.

## Expense cards

- **Current behavior:** Expense cards show the title, amount, payer, participant summary, Edit/Delete actions, and a collapsed **Show split details** block.
- **Split details:** The `<details>` / `<summary>` pattern keeps the list compact by default while exposing per-person amounts calculated by `Expense.split.computeOwedForExpense`.
- **If refining later:** Keep the chevron/tap target comfortable on mobile and preserve access to exact per-person amounts.

## Primary Flow

- Start with the pre-start trip-name bar.
- After **Start trip**, show the toolbar, member strip, expense list, and settlement panel.
- Add members before expenses; the **Add expense** button in the Expenses panel header remains disabled until there is at least one member.
- The Add Expense modal opens in **AI-assisted** mode for new expenses, with a Manual tab for direct entry.
- AI-assisted fill moves users into the Manual tab after parsing, where they review title, amount, payer, participants, split method, and any split-specific fields before saving.
- Editing an existing expense skips AI mode and shows Manual fields only.
- Settlement updates from state after each successful member or expense change.

## Interaction Notes

- Escape closes the Add Expense modal and refreshes the UI through `Trip.renderAll()`.
- The member add row is inline and toggled by **+ Add member**; Enter in the name input submits via `Member.onNameKeydown`.
- The expense panel uses direct wiring for the header **Add expense** button and event delegation from `.panel-expenses-main` for expense-card edit/delete actions.
- The expense modal tab switch uses `Expense.modal.setEntryMode("ai"|"manual")`; keep `aria-selected`, tab focus, and panel visibility in sync.
- The AI fill button uses `Expense.ai.onParseClick()`; keep errors in `#expense-message` and never save without user review.
- Participant **Select all** calls `Expense.split.onSelectAllToggle`, which syncs all checkboxes and re-renders split inputs.
