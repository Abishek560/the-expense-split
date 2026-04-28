# Agent instructions — Trip Expense Splitter

## Project overview

- **What it is:** A mostly browser-only “trip” expense splitter: one trip name, members, shared expenses with manual or AI-assisted entry, multiple split modes, per-member balances, and suggested settlement transfers.
- **Stack:** Single-page app in three files: `index.html`, `style.css`, `script.js`. No build step, no npm. AI-assisted expense parsing calls an external worker; there is no backend code in this repo.
- **Persistence:** Trip state is saved to `localStorage` under key `tripExpenseSplitterState` (see `Trip.save` / `Trip.load` in `script.js`). The **Simplify debt** toggle is saved separately under `tripExpenseSplitterSimplifyDebt`.
- **Organization:** `script.js` is one file, organized by namespaces: `Trip`, `Member`, `Expense`, `Expense.split`, `Expense.modal`, `Expense.ai`, `Settlement`, and `Util`. These are also exposed on `window` for debugging.

## Tech constraints (non-negotiable)

- **HTML + CSS + vanilla JavaScript only** — no React, Vue, Svelte, TypeScript compiler, bundlers, or UI libraries unless the project owner explicitly changes this policy.
- **Browser APIs:** `localStorage`, `DOM`, `fetch`, optional `window.print()` for export; keep compatibility in mind for older browsers where reasonable (e.g. `crypto.randomUUID` fallback exists).
- **AI worker:** Do not put API keys in frontend code. The browser posts text and member names to `EXPENSE_AI_WORKER_URL`; the worker owns any model credentials.

## Strict rules

- **No frameworks** and **no full rewrites** of the app into another architecture.
- When modifying expenses, **preserve or improve visibility of per-person split details** (see `docs/FEATURES.md`).
- **Do not** replace the whole file structure, introduce a SPA router, or migrate to a component framework “for cleanliness.”
- **Preserve behavior** unless the task explicitly changes requirements; regression-test mentally against split math, validation, and settlement output.

## How to approach changes

- **Small, focused edits:** Prefer touching one concern at a time (e.g. only modal CSS, or only one render function).
- **Read before write:** Match existing patterns — `Util.qs` / `Util.qsa`, `Trip.renderAll()` as the main refresh hub, `Trip.save()` after successful mutations.
- **Single source of truth:** State lives in the `state` object; avoid parallel caches of the same data.
- **After logic changes:** Ensure `Trip.renderAll()` (or the minimal render subset) still runs where needed and persistence still serializes all required fields.

## Priorities

1. **Preserve correctness** of splits, balances, and settlement suggestions (including rounding / remainder rules).
2. **Improve UX** (layout, clarity, keyboard, mobile) without breaking flows: start trip → add members → add expenses → read balances / settlements.
3. **Keep the codebase approachable** for the next agent: minimal diff, clear names, no duplicated split or balance logic outside the existing helpers.

## Where to look first

| Topic | Primary location |
|--------|------------------|
| State shape & persistence | `script.js` — `state`, `Trip.save`, `Trip.load`, `Trip.resetState` |
| Split math | `script.js` — `Expense.split.computeOwedForExpense` |
| Validation | `script.js` — `validateExpenseDraft`, `validateMemberName`, etc. |
| UI structure | `index.html` |
| Full refresh | `script.js` — `Trip.renderAll` / internal `renderAll` |
| Expense modal/list | `script.js` — `Expense.modal.open`, `Expense.modal.openForEdit`, `Expense.renderList`, `Expense.addOrUpdateFromForm`, `Expense.delete` |
| AI-assisted expense entry | `script.js` — `Expense.ai.fetchParse`, `Expense.ai.applyWorkerPayloadToForm`, `Expense.ai.onParseClick`, `Expense.modal.setEntryMode` |
| Participant UI | `script.js` — `Expense.split.renderPayerAndParticipants`, `Expense.split.renderSplitFields`, `Expense.split.onSelectAllToggle` |
| Settlement preference | `script.js` — `Settlement.loadSimplifyDebtPreference`, `Settlement.saveSimplifyDebtPreference` |
| Settlement math | `script.js` — `Settlement.computeBalances`, `Settlement.simplify`, `Settlement.computeDirectDebts` |

See also: `docs/CONTEXT.md`, `docs/RULES.md`, `docs/FEATURES.md`, `docs/UI_UX_GUIDE.md`, `docs/TASKS.md`, `docs/PROMPTS.md`.
