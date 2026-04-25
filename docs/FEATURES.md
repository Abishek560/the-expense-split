# Features — Trip Expense Splitter

High-level product behavior; implementation details live in `docs/CONTEXT.md` and `script.js`.

## Expenses

- Each expense should show **per-person share details** so the user can see how much each participant owes for that expense.
- The breakdown must reflect the expense’s split method:

  - **Equal** — even split across participants  
  - **Shares** — weighted by share counts  
  - **Percentage** — each participant’s percent of the total  
  - **Custom amount** — explicit rupee amounts per participant  

- Each expense can be **edited** after it’s added.

## Settlement

- Settlement supports a **“Simplify debt”** toggle:
  - **On**: shows a minimal set of transfers to settle net balances.
  - **Off**: shows per-expense reimbursements (each participant’s share owed to that expense’s payer).

### Examples (illustrative amounts)

**Equal**

- Abi ₹227.50  
- SM ₹227.50  

**Shares**

- Abi: 1 share, ₹260  
- SM: 2 shares, ₹520  

**Percentage**

- Abi: 25%, ₹455  

**Custom**

- Abi: ₹300  
