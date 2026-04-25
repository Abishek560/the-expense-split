# Strict constraints — agents & contributors

## Architecture

- **Do not rewrite the entire app** (no greenfield replacement of `script.js` / `index.html` in one shot).
- **Do not introduce frameworks** (no React/Vue/Angular/Svelte, no Tailwind build pipeline, no Webpack/Vite unless the project owner explicitly opts in).
- **Do not add** npm dependencies, TypeScript compilation, or multi-page routing unless explicitly requested.

## Behavior & regressions

- **Do not break existing features:** start trip, add member, add expense (all split modes), balances, settlements, clear data, localStorage restore, print/export flow.
- **Do not change split / balance / settlement math** unless fixing a documented bug; preserve the “last participant gets remainder” contract for equal/shares/percentage.
- **Do not remove** `Trip.save()` calls from successful mutation paths without replacing persistence intentionally.

## Code quality

- **Avoid duplicating logic:** Reuse `Expense.split.computeOwedForExpense`, `Settlement.computeBalances`, `validateExpenseDraft`, `Util.round2`, etc. Do not copy-paste formulas into render-only code.
- **Keep changes minimal and readable:** Small PR-sized diffs; one feature or fix per change set when possible.
- **Respect existing conventions:** `Util.qs` / `Util.qsa` for DOM; string templates for larger HTML chunks; `Util.escapeHtml` for user-controlled text in `innerHTML`.

## UI / HTML

- **Do not** rename critical element IDs without updating **all** references in `script.js` (grep before and after).
- **Prefer** extending CSS classes and markup incrementally over wholesale class renames unless doing a scoped stylesheet refactor.

## Documentation

- **Agent docs** (`docs/*.md`) describe intent and constraints; they are not a substitute for reading `script.js` when implementing.
