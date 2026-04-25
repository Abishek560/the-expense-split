# UI / UX guide — Trip Expense Splitter

Lightweight patterns for layout and interaction. Pair with `docs/FEATURES.md` for product intent.

## Expense cards

- **Current behavior:** Expense cards show the title, amount, payer, participant summary, Edit/Delete actions, and a collapsed **Show split details** block.
- **Split details:** The `<details>` / `<summary>` pattern keeps the list compact by default while exposing per-person amounts calculated by `Expense.split.computeOwedForExpense`.
- **If refining later:** Keep the chevron/tap target comfortable on mobile and preserve access to exact per-person amounts.

## Primary Flow

- Start with the pre-start trip-name bar.
- After **Start trip**, show the toolbar, member strip, expense list, and settlement panel.
- Add members before expenses; the Add Expense button remains disabled until there is at least one member.
- The Add Expense modal collects title, amount, payer, participants, split method, and any split-specific fields.
- Settlement updates from state after each successful member or expense change.

## Interaction Notes

- Escape closes the Add Expense modal and refreshes the UI through `Trip.renderAll()`.
- The member add row is inline and toggled by **+ Add member**; Enter in the name input submits via `Member.onNameKeydown`.
- The expense list uses event delegation from `.panel-expenses-main` for empty-add, edit, and delete actions.
