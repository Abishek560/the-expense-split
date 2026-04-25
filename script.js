/**
 * Trip Expense Splitter — state persisted in localStorage (vanilla JS).
 * Sections: state, persistence, helpers, validation, split math, balances, settlement, render, events.
 */

// --- App state (single trip per session) ---
const state = {
  tripName: null,
  started: false,
  members: [],
  expenses: [],
};

/** When non-null, expense modal is editing this expense id (add flow uses null). */
let editingExpenseId = null;

const STORAGE_KEY = "tripExpenseSplitterState";
const STORAGE_KEY_SIMPLIFY_DEBT = "tripExpenseSplitterSimplifyDebt";

function saveState() {
  try {
    const snapshot = {
      tripName: state.tripName,
      started: state.started,
      members: state.members.map((m) => ({ id: m.id, name: m.name })),
      expenses: state.expenses.map((e) => ({
        id: e.id,
        title: e.title,
        amount: e.amount,
        paidById: e.paidById,
        participantIds: e.participantIds.slice(),
        splitMethod: e.splitMethod,
        splitDetails: { ...(e.splitDetails || {}) },
      })),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch (err) {
    console.warn("saveState", err);
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return;
    if (typeof data.started !== "boolean") return;
    if (!Array.isArray(data.members) || !Array.isArray(data.expenses)) return;

    state.tripName = data.tripName == null ? null : String(data.tripName);
    state.started = data.started;
    state.members = data.members.map((m) => ({
      id: String(m.id),
      name: String(m.name || ""),
    }));
    state.expenses = data.expenses.map((e) => ({
      id: String(e.id),
      title: String(e.title || ""),
      amount: round2(Number(e.amount) || 0),
      paidById: String(e.paidById || ""),
      participantIds: Array.isArray(e.participantIds) ? e.participantIds.map(String) : [],
      splitMethod: e.splitMethod || "equal",
      splitDetails: e.splitDetails && typeof e.splitDetails === "object" ? { ...e.splitDetails } : {},
    }));

    const tripInput = qs("#trip-name-input");
    if (tripInput) {
      tripInput.value = state.tripName || "";
    }
  } catch (err) {
    console.warn("loadState", err);
  }
}

function resetState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.warn("resetState", err);
  }
  state.tripName = null;
  state.started = false;
  state.members = [];
  state.expenses = [];
  editingExpenseId = null;

  const tripInput = qs("#trip-name-input");
  if (tripInput) {
    tripInput.value = "";
  }
  const memberName = qs("#member-name-input");
  if (memberName) memberName.value = "";
  const etitle = qs("#expense-title");
  const eamt = qs("#expense-amount");
  if (etitle) etitle.value = "";
  if (eamt) eamt.value = "";

  setMessage(qs("#trip-message"), "");
  setMessage(qs("#member-message"), "");
  setMessage(qs("#expense-message"), "");

  closeExpenseModal();

  const memberRow = qs("#member-add-inline");
  const toggleBtn = qs("#btn-toggle-member-add");
  if (memberRow) memberRow.classList.add("hidden");
  if (toggleBtn) toggleBtn.setAttribute("aria-expanded", "false");

  renderAll();
}

let idCounter = 0;

function generateId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  idCounter += 1;
  return `m-${Date.now()}-${idCounter}`;
}

// --- Helpers ---
function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function formatMoney(n) {
  return round2(n).toFixed(2);
}

function formatShareCountPhrase(raw) {
  const n = round2(Number(raw) || 0);
  const unit = n === 1 ? "share" : "shares";
  return `${n} ${unit}`;
}

function formatPctForSplitDisplay(raw) {
  const n = round2(Number(raw) || 0);
  return `${String(parseFloat(n.toFixed(2)))}%`;
}

function getMemberName(memberId) {
  const m = state.members.find((x) => x.id === memberId);
  return m ? m.name : "?";
}

// --- Split calculation (last participant gets remainder) ---
function computeOwedForExpense(expense) {
  const ids = expense.participantIds.slice();
  const n = ids.length;
  const amount = expense.amount;
  const out = {};

  if (n === 0) return out;

  if (expense.splitMethod === "equal") {
    const base = round2(amount / n);
    let sum = 0;
    for (let i = 0; i < n - 1; i += 1) {
      out[ids[i]] = base;
      sum = round2(sum + base);
    }
    out[ids[n - 1]] = round2(amount - sum);
    return out;
  }

  if (expense.splitMethod === "shares") {
    const details = expense.splitDetails || {};
    let totalShares = 0;
    for (const id of ids) {
      totalShares += Number(details[id]) || 0;
    }
    if (totalShares <= 0) return out;
    let allocated = 0;
    for (let i = 0; i < n - 1; i += 1) {
      const id = ids[i];
      const s = Number(details[id]) || 0;
      const share = round2((amount * s) / totalShares);
      out[id] = share;
      allocated = round2(allocated + share);
    }
    const lastId = ids[n - 1];
    out[lastId] = round2(amount - allocated);
    return out;
  }

  if (expense.splitMethod === "percentage") {
    const details = expense.splitDetails || {};
    let allocated = 0;
    for (let i = 0; i < n - 1; i += 1) {
      const id = ids[i];
      const p = Number(details[id]) || 0;
      const share = round2((amount * p) / 100);
      out[id] = share;
      allocated = round2(allocated + share);
    }
    const lastId = ids[n - 1];
    out[lastId] = round2(amount - allocated);
    return out;
  }

  if (expense.splitMethod === "custom") {
    const details = expense.splitDetails || {};
    for (const id of ids) {
      out[id] = round2(Number(details[id]) || 0);
    }
    return out;
  }

  return out;
}

// --- Validation (pure) ---
const EPS = 0.01;

function validateStartTrip(name) {
  const errors = [];
  const trimmed = (name || "").trim();
  if (!trimmed) errors.push("Trip name cannot be empty.");
  return { ok: errors.length === 0, errors, tripName: trimmed };
}

function validateMemberName(name) {
  const errors = [];
  const trimmed = (name || "").trim();
  if (!trimmed) errors.push("Member name cannot be empty.");
  if (trimmed) {
    const key = trimmed.toLowerCase();
    const duplicate = state.members.some((m) => m.name.trim().toLowerCase() === key);
    if (duplicate) errors.push("That member name is already in the list.");
  }
  return { ok: errors.length === 0, errors, name: trimmed };
}

function validateExpenseDraft(draft) {
  const errors = [];
  if (!state.started) {
    errors.push("Start the trip before adding expenses.");
  }
  const title = (draft.title || "").trim();
  if (!title) errors.push("Expense title cannot be empty.");

  const amount = Number(draft.amount);
  if (!(amount > 0)) errors.push("Amount must be greater than 0.");

  if (!draft.paidById) errors.push("Select who paid.");
  const participantIds = draft.participantIds || [];
  if (participantIds.length === 0) errors.push("Select at least one participant.");

  const method = draft.splitMethod;
  const n = participantIds.length;

  if (method === "shares" && n > 0) {
    const details = draft.splitDetails || {};
    let sumShares = 0;
    for (const id of participantIds) {
      const s = Number(details[id]);
      if (!Number.isFinite(s) || s <= 0) {
        errors.push("Each participant needs a share greater than 0.");
        break;
      }
      sumShares += s;
    }
    if (sumShares <= 0) errors.push("Total shares must be greater than 0.");
  }

  if (method === "percentage" && n > 0) {
    const details = draft.splitDetails || {};
    let sumP = 0;
    for (const id of participantIds) {
      const p = Number(details[id]);
      if (!Number.isFinite(p)) {
        errors.push("Enter a valid percentage for each participant.");
        break;
      }
      sumP = round2(sumP + p);
    }
    if (Math.abs(sumP - 100) > EPS) {
      errors.push("Percentages must add up to 100.");
    }
  }

  if (method === "custom" && n > 0 && amount > 0) {
    const details = draft.splitDetails || {};
    let sumC = 0;
    for (const id of participantIds) {
      const c = Number(details[id]);
      if (!Number.isFinite(c) || c < 0) {
        errors.push("Enter a valid custom amount for each participant.");
        break;
      }
      sumC = round2(sumC + c);
    }
    if (Math.abs(sumC - amount) > EPS) {
      errors.push("Custom amounts must add up to the expense total.");
    }
  }

  return { ok: errors.length === 0, errors };
}

// --- Balances ---
function computeBalances() {
  const paid = {};
  const owed = {};
  state.members.forEach((m) => {
    paid[m.id] = 0;
    owed[m.id] = 0;
  });

  for (const e of state.expenses) {
    if (state.members.some((m) => m.id === e.paidById)) {
      paid[e.paidById] = round2(paid[e.paidById] + e.amount);
    }
    const shares = computeOwedForExpense(e);
    for (const pid of e.participantIds) {
      if (owed[pid] !== undefined) {
        owed[pid] = round2(owed[pid] + (shares[pid] || 0));
      }
    }
  }

  const net = {};
  state.members.forEach((m) => {
    net[m.id] = round2(paid[m.id] - owed[m.id]);
  });

  return { paid, owed, net };
}

// --- Settlement (greedy pairing, integer cents) ---
function simplifySettlements(netByMember) {
  const txs = [];
  const creditors = [];
  const debtors = [];

  state.members.forEach((m) => {
    const cents = Math.round(netByMember[m.id] * 100);
    if (cents > 0) creditors.push({ id: m.id, cents });
    else if (cents < 0) debtors.push({ id: m.id, cents });
  });

  creditors.sort((a, b) => b.cents - a.cents);
  debtors.sort((a, b) => a.cents - b.cents);

  let i = 0;
  let j = 0;
  while (i < creditors.length && j < debtors.length) {
    const c = creditors[i];
    const d = debtors[j];
    const payCents = Math.min(c.cents, -d.cents);
    if (payCents <= 0) break;

    txs.push({
      from: d.id,
      to: c.id,
      amount: round2(payCents / 100),
    });

    c.cents -= payCents;
    d.cents += payCents;

    if (c.cents === 0) i += 1;
    if (d.cents === 0) j += 1;
  }

  return txs;
}

function isActiveMemberId(memberId) {
  return state.members.some((m) => m.id === memberId);
}

/**
 * Per-expense debt lines: each non-payer participant owes their computed share to that expense’s payer.
 * Order follows `state.expenses`. Uses `computeOwedForExpense` only (no balance / settlement simplification).
 */
function computeDirectExpenseDebts() {
  const rows = [];
  for (const e of state.expenses) {
    if (!isActiveMemberId(e.paidById)) continue;
    const shares = computeOwedForExpense(e);
    for (const pid of e.participantIds) {
      if (pid === e.paidById) continue;
      if (!isActiveMemberId(pid)) continue;
      const amt = round2(Number(shares[pid]) || 0);
      if (amt <= EPS) continue;
      rows.push({
        expenseTitle: e.title,
        from: pid,
        to: e.paidById,
        amount: amt,
      });
    }
  }
  return rows;
}

function loadSimplifyDebtPreference() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SIMPLIFY_DEBT);
    if (raw === null) return true;
    return raw === "1" || raw === "true";
  } catch (err) {
    console.warn("loadSimplifyDebtPreference", err);
    return true;
  }
}

function saveSimplifyDebtPreference(on) {
  try {
    localStorage.setItem(STORAGE_KEY_SIMPLIFY_DEBT, on ? "1" : "0");
  } catch (err) {
    console.warn("saveSimplifyDebtPreference", err);
  }
}

function isSimplifyDebtEnabled() {
  const el = qs("#simplify-debt");
  if (!el) return true;
  return Boolean(el.checked);
}

function formatSettlementRupeeHtml(n) {
  return `₹${escapeHtml(formatMoney(round2(Number(n) || 0)))}`;
}

/** @param {{from: string, to: string, amount: number}[]} txs */
function buildSimplifiedFlowsHtml(memberId, txs) {
  const incoming = txs.filter((t) => t.to === memberId);
  const outgoing = txs.filter((t) => t.from === memberId);
  if (incoming.length > 0) {
    const parts = incoming.map(
      (t) => `${escapeHtml(getMemberName(t.from))} ${formatSettlementRupeeHtml(t.amount)}`,
    );
    return `<div class="settlement-balance-row__flows"><span class="settlement-balance-row__flows-label">From:</span> ${parts.join(", ")}</div>`;
  }
  if (outgoing.length > 0) {
    const parts = outgoing.map(
      (t) => `${escapeHtml(getMemberName(t.to))} ${formatSettlementRupeeHtml(t.amount)}`,
    );
    return `<div class="settlement-balance-row__flows"><span class="settlement-balance-row__flows-label">Pay to:</span> ${parts.join(", ")}</div>`;
  }
  return "";
}

/** @param {{expenseTitle: string, from: string, to: string, amount: number}[]} rows */
function buildDirectFlowsHtml(memberId, rows) {
  const incoming = rows.filter((r) => r.to === memberId);
  const outgoing = rows.filter((r) => r.from === memberId);
  if (incoming.length > 0) {
    const parts = incoming.map(
      (r) =>
        `${escapeHtml(r.expenseTitle)} — ${escapeHtml(getMemberName(r.from))} ${formatSettlementRupeeHtml(r.amount)}`,
    );
    return `<div class="settlement-balance-row__flows"><span class="settlement-balance-row__flows-label">From:</span> ${parts.join(", ")}</div>`;
  }
  if (outgoing.length > 0) {
    const parts = outgoing.map(
      (r) =>
        `${escapeHtml(r.expenseTitle)} — ${escapeHtml(getMemberName(r.to))} ${formatSettlementRupeeHtml(r.amount)}`,
    );
    return `<div class="settlement-balance-row__flows"><span class="settlement-balance-row__flows-label">Pay to:</span> ${parts.join(", ")}</div>`;
  }
  return "";
}

// --- DOM ---
function qs(sel, root) {
  return (root || document).querySelector(sel);
}

function qsa(sel, root) {
  return Array.from((root || document).querySelectorAll(sel));
}

// --- Read expense draft from DOM ---
function getCheckedParticipantIds() {
  return qsa("#participant-checkboxes input[type=checkbox]:checked").map((el) => el.value);
}

function syncParticipantSelectAllCheckbox() {
  const master = qs("#participant-select-all");
  if (!master) return;
  const boxes = qsa("#participant-checkboxes input[type=checkbox]");
  if (boxes.length === 0) {
    master.checked = false;
    master.indeterminate = false;
    return;
  }
  const total = boxes.length;
  const checked = boxes.filter((b) => b.checked).length;
  if (checked === total) {
    master.checked = true;
    master.indeterminate = false;
  } else if (checked === 0) {
    master.checked = false;
    master.indeterminate = false;
  } else {
    master.checked = false;
    master.indeterminate = true;
  }
}

function onParticipantMemberCheckboxChange() {
  syncParticipantSelectAllCheckbox();
  renderSplitFields();
}

function onParticipantSelectAllChange() {
  const master = qs("#participant-select-all");
  if (!master) return;
  const boxes = qsa("#participant-checkboxes input[type=checkbox]");
  if (master.checked) {
    boxes.forEach((b) => {
      b.checked = true;
    });
  } else {
    boxes.forEach((b) => {
      b.checked = false;
    });
  }
  syncParticipantSelectAllCheckbox();
  renderSplitFields();
}

function readSplitDetailsFromDom(method, participantIds) {
  const details = {};
  if (method === "equal") return details;

  for (const id of participantIds) {
    if (method === "shares") {
      const el = qs(`#split-share-${id}`);
      details[id] = el ? Number(el.value) : NaN;
    } else if (method === "percentage") {
      const el = qs(`#split-pct-${id}`);
      details[id] = el ? Number(el.value) : NaN;
    } else if (method === "custom") {
      const el = qs(`#split-custom-${id}`);
      details[id] = el ? Number(el.value) : NaN;
    }
  }
  return details;
}

function readExpenseDraftFromForm() {
  const title = qs("#expense-title").value;
  const amount = qs("#expense-amount").value;
  const paidById = qs("#expense-payer").value;
  const participantIds = getCheckedParticipantIds();
  const splitMethod = qs("#split-method").value;
  const splitDetails = readSplitDetailsFromDom(splitMethod, participantIds);
  return {
    title,
    amount,
    paidById,
    participantIds,
    splitMethod,
    splitDetails,
  };
}

function splitMethodLabel(method) {
  if (method === "equal") return "Equal";
  if (method === "shares") return "By shares";
  if (method === "percentage") return "By percentage";
  if (method === "custom") return "Custom amount";
  return method;
}

// --- Render ---
function setMessage(el, text) {
  el.textContent = text || "";
}

function updateTripSectionDisabled() {
  const started = state.started;
  qs("#trip-name-input").disabled = started;
  qs("#btn-start-trip").disabled = started;
}

function syncExpenseFormUi() {
  const expenseLocked = !(state.started && state.members.length > 0);
  const modalOpen = isExpenseModalOpen();
  const formDisabled = expenseLocked || !modalOpen;

  ["#expense-title", "#expense-amount", "#expense-payer", "#split-method", "#btn-add-expense"].forEach((sel) => {
    const el = qs(sel);
    if (el) el.disabled = formDisabled;
  });
  qsa("#participant-checkboxes input[type=checkbox]").forEach((el) => {
    el.disabled = formDisabled;
  });
  const selectAll = qs("#participant-select-all");
  if (selectAll) selectAll.disabled = formDisabled;

  const openBtn = qs("#btn-open-expense-modal");
  if (openBtn) openBtn.disabled = expenseLocked || modalOpen;
}

function updateDependentSectionsEnabled() {
  const on = state.started;
  qs("#member-name-input").disabled = !on;
  qs("#btn-add-member").disabled = !on;
}

function syncAppPageMode() {
  const page = qs("#app-page");
  if (page) page.classList.toggle("is-trip-started", state.started);
}

function renderHeaderSummary() {
  const barTitle = qs("#bar-trip-title");
  const totalEl = qs("#summary-total-expenses");
  const countEl = qs("#summary-member-count");
  if (!totalEl || !countEl) return;

  if (barTitle) {
    barTitle.textContent = state.started && state.tripName ? state.tripName : "";
  }

  const total = state.expenses.reduce((sum, e) => round2(sum + e.amount), 0);
  totalEl.textContent = formatMoney(total);

  countEl.textContent = String(state.members.length);
}

function renderMemberList() {
  const chips = qs("#member-chips");
  const empty = qs("#member-list-empty");
  if (!chips || !empty) return;
  chips.innerHTML = "";
  if (state.members.length === 0) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  state.members.forEach((m) => {
    const span = document.createElement("span");
    span.className = "member-chip";
    span.textContent = m.name;
    chips.appendChild(span);
  });
}

/**
 * Rebuilds payer select and participant checkboxes.
 * @param {object} [opts]
 * @param {string[]} [opts.selectParticipantIds] — if set, only these members are checked.
 * @param {string} [opts.payerId] — after rebuild, select this payer if they exist in `state.members`.
 */
function renderPayerAndParticipants(opts) {
  const payerSel = qs("#expense-payer");
  const prevPayer = payerSel.value;
  payerSel.innerHTML = '<option value="">Select member</option>';
  state.members.forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.name;
    payerSel.appendChild(opt);
  });

  const selectIds =
    opts && Array.isArray(opts.selectParticipantIds) ? opts.selectParticipantIds.map(String) : null;
  const forcePayerId =
    opts && opts.payerId && state.members.some((m) => m.id === String(opts.payerId)) ? String(opts.payerId) : "";

  if (forcePayerId) {
    payerSel.value = forcePayerId;
  } else if (prevPayer && state.members.some((m) => m.id === prevPayer)) {
    payerSel.value = prevPayer;
  }

  const box = qs("#participant-checkboxes");
  box.innerHTML = "";
  state.members.forEach((m) => {
    const row = document.createElement("div");
    row.className = "checkbox-row checkbox-row--participant";
    const id = `part-${m.id}`;
    row.innerHTML = `
      <input type="checkbox" id="${id}" value="${m.id}" />
      <label for="${id}">${m.name}</label>
    `;
    box.appendChild(row);
  });

  qsa("#participant-checkboxes input[type=checkbox]").forEach((cb) => {
    if (selectIds) {
      cb.checked = selectIds.includes(cb.value);
    } else {
      cb.checked = true;
    }
  });
  syncParticipantSelectAllCheckbox();

  qsa("#participant-checkboxes input[type=checkbox]").forEach((cb) => {
    cb.addEventListener("change", onParticipantMemberCheckboxChange);
  });
}

/**
 * Renders share / percentage / custom inputs for checked participants.
 * @param {Record<string, number>|null|undefined} [prefillSplitDetails] — when provided, fills inputs from these values (e.g. opening edit).
 */
function renderSplitFields(prefillSplitDetails) {
  const container = qs("#split-fields");
  const method = qs("#split-method").value;
  const participantIds = getCheckedParticipantIds();

  if (participantIds.length === 0) {
    container.innerHTML = '<p class="hint">Select participants to configure the split.</p>';
    return;
  }

  if (method === "equal") {
    container.innerHTML = '<p class="hint">Amount is split equally among selected participants.</p>';
    return;
  }

  const rows = participantIds
    .map((id) => {
      const name = getMemberName(id);
      if (method === "shares") {
        return `
        <div class="split-row">
          <label for="split-share-${id}">Shares for ${name}</label>
          <input type="number" id="split-share-${id}" min="0" step="0.01" placeholder="e.g. 1" />
        </div>`;
      }
      if (method === "percentage") {
        return `
        <div class="split-row">
          <label for="split-pct-${id}">% for ${name}</label>
          <input type="number" id="split-pct-${id}" min="0" max="100" step="0.1" placeholder="%" />
        </div>`;
      }
      if (method === "custom") {
        return `
        <div class="split-row">
          <label for="split-custom-${id}">Amount owed by ${name}</label>
          <input type="number" id="split-custom-${id}" min="0" step="0.01" placeholder="0.00" />
        </div>`;
      }
      return "";
    })
    .join("");

  container.innerHTML = rows;

  if (!prefillSplitDetails || typeof prefillSplitDetails !== "object") return;

  for (const id of participantIds) {
    const raw = prefillSplitDetails[id];
    if (raw == null || !Number.isFinite(Number(raw))) continue;
    const n = Number(raw);
    if (method === "shares") {
      const el = qs(`#split-share-${id}`);
      if (el) el.value = String(n);
    } else if (method === "percentage") {
      const el = qs(`#split-pct-${id}`);
      if (el) el.value = String(n);
    } else if (method === "custom") {
      const el = qs(`#split-custom-${id}`);
      if (el) el.value = formatMoney(n);
    }
  }
}

function buildPrintExpenseSplitTableHtml(e) {
  const owed = computeOwedForExpense(e);
  const details = e.splitDetails || {};
  const method = e.splitMethod;
  const n = e.participantIds.length;
  const cellRupee = (amt) => `₹${escapeHtml(formatMoney(amt))}`;

  const body = e.participantIds
    .map((id) => {
      const name = escapeHtml(getMemberName(id));
      const raw = owed[id];
      const amt = raw != null ? raw : 0;
      let mid = "—";
      if (method === "equal") {
        mid = escapeHtml(n > 0 ? `Equal (1/${n})` : "Equal");
      } else if (method === "custom") {
        mid = escapeHtml("As specified");
      } else if (method === "shares") {
        mid = escapeHtml(formatShareCountPhrase(details[id]));
      } else if (method === "percentage") {
        mid = escapeHtml(formatPctForSplitDisplay(details[id]));
      }
      return `<tr><td>${name}</td><td class="print-split-mid">${mid}</td><td class="num">${cellRupee(amt)}</td></tr>`;
    })
    .join("");

  return `<table class="print-table print-split-table">
<thead><tr><th>Person</th><th class="print-split-mid">Share / %</th><th class="num">Amount</th></tr></thead>
<tbody>${body}</tbody>
</table>`;
}

function buildExpenseSplitInlineHtml(e) {
  const owed = computeOwedForExpense(e);
  const details = e.splitDetails || {};
  const method = e.splitMethod;
  const dot = '<span class="expense-card__split-dot" aria-hidden="true"> · </span>';
  const pipe = '<span class="expense-card__split-pipe" aria-hidden="true"> | </span>';
  return e.participantIds
    .map((id, i) => {
      const name = escapeHtml(getMemberName(id));
      const rawOwed = owed[id];
      const amt = rawOwed != null ? rawOwed : 0;
      const money = `<span class="expense-card__split-amt">₹${escapeHtml(formatMoney(amt))}</span>`;
      let chunk;
      if (method === "shares") {
        const sharePhrase = escapeHtml(formatShareCountPhrase(details[id]));
        chunk = `<span class="expense-card__split-chunk"><span class="expense-card__split-name">${name}</span>${dot}<span class="expense-card__split-detail">${sharePhrase}</span>${dot}${money}</span>`;
      } else if (method === "percentage") {
        const pct = escapeHtml(formatPctForSplitDisplay(details[id]));
        chunk = `<span class="expense-card__split-chunk"><span class="expense-card__split-name">${name}</span>${dot}<span class="expense-card__split-detail">${pct}</span>${dot}${money}</span>`;
      } else {
        chunk = `<span class="expense-card__split-chunk"><span class="expense-card__split-name">${name}</span>${dot}${money}</span>`;
      }
      if (i === 0) return chunk;
      return `<span class="expense-card__split-cell">${pipe}${chunk}</span>`;
    })
    .join("");
}

function renderExpenseList() {
  const wrap = qs("#expense-list-container");
  if (state.expenses.length === 0) {
    const canAdd = state.started && state.members.length > 0;
    const hint =
      state.members.length === 0
        ? "Add at least one member above, then you can log expenses here."
        : "When you’re ready, add your first shared expense.";
    const disabledAttr = canAdd ? "" : " disabled";
    wrap.innerHTML = `
      <div class="expense-empty">
        <p class="expense-empty__title">No expenses yet</p>
        <p class="expense-empty__hint">${escapeHtml(hint)}</p>
        <button type="button" id="btn-empty-add-expense" class="btn btn-primary"${disabledAttr}>Add your first expense</button>
      </div>`;
    return;
  }

  const cards = state.expenses
    .map((e) => {
      const payer = getMemberName(e.paidById);
      const parts = e.participantIds.map((id) => getMemberName(id)).join(", ");
      const splitInline = buildExpenseSplitInlineHtml(e);
      return `
      <li class="expense-card" data-expense-id="${escapeHtml(e.id)}">
        <div class="expense-card__top">
          <span class="expense-card__title">${escapeHtml(e.title)}</span>
          <span class="expense-card__amount">${escapeHtml(formatMoney(e.amount))}</span>
        </div>
        <p class="expense-card__meta">
          <span>Paid by ${escapeHtml(payer)}</span>
          <span class="expense-card__dot" aria-hidden="true">·</span>
          <span>${escapeHtml(parts)}</span>
          <span class="expense-card__dot" aria-hidden="true">·</span>
          <span class="method-badge">${escapeHtml(splitMethodLabel(e.splitMethod))}</span>
        </p>
        <div class="expense-card__split" role="region" aria-label="Split for ${escapeHtml(e.title)}">
          <p class="expense-card__split-inline">${splitInline}</p>
        </div>
        <div class="expense-card__actions">
          <button type="button" class="btn btn-ghost btn-compact expense-card__edit" aria-label="Edit ${escapeHtml(
            e.title,
          )}">
            Edit
          </button>
        </div>
      </li>`;
    })
    .join("");

  wrap.innerHTML = `<ul class="expense-cards">${cards}</ul>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Right sidebar: one row per member — net, paid/share, and pay-from / pay-to lines (no separate payment list). */
function renderSettlementPanel() {
  const balanceWrap = qs("#balances-container");
  const hintSettle = qs("#hint-settle");

  if (!balanceWrap) return;

  if (state.members.length === 0) {
    if (hintSettle) hintSettle.textContent = "";
    balanceWrap.innerHTML = '<p class="empty-panel">Add members to see settlement.</p>';
    return;
  }

  const { paid, owed, net } = computeBalances();
  const simplify = isSimplifyDebtEnabled();
  let txs = null;
  let directRows = null;
  if (state.expenses.length > 0) {
    if (simplify) txs = simplifySettlements(net);
    else directRows = computeDirectExpenseDebts();
  }

  if (hintSettle) {
    if (state.expenses.length === 0) {
      hintSettle.textContent = "Add expenses to see how payments route to each person.";
    } else {
      const settled = simplify ? txs.length === 0 : directRows.length === 0;
      if (settled) {
        hintSettle.textContent = "Everyone is even — no payments needed between members.";
      } else if (simplify) {
        hintSettle.textContent = "Fewest transfers that match each person’s net balance.";
      } else {
        hintSettle.textContent = "Each line is that expense’s share, owed to whoever paid.";
      }
    }
  }

  const rows = state.members
    .map((m) => {
      const n = net[m.id];
      const tone =
        n > EPS ? "settlement-balance-row--receive" : n < -EPS ? "settlement-balance-row--owe" : "settlement-balance-row--even";
      let netLine;
      if (n > EPS) {
        netLine = `Receives ${formatSettlementRupeeHtml(n)}`;
      } else if (n < -EPS) {
        netLine = `Owes ${formatSettlementRupeeHtml(round2(-n))}`;
      } else {
        netLine = `Even ${formatSettlementRupeeHtml(n)}`;
      }

      const paidShare = `Paid ${formatSettlementRupeeHtml(paid[m.id])} · Share ${formatSettlementRupeeHtml(owed[m.id])}`;

      let flows = "";
      if (state.expenses.length > 0 && Math.abs(n) > EPS) {
        if (simplify && txs && txs.length > 0) {
          flows = buildSimplifiedFlowsHtml(m.id, txs);
        } else if (!simplify && directRows && directRows.length > 0) {
          flows = buildDirectFlowsHtml(m.id, directRows);
        }
      }

      return `<div class="settlement-balance-row ${tone}">
  <div class="settlement-balance-row__name">${escapeHtml(m.name)}</div>
  <div class="settlement-balance-row__netline">${netLine}</div>
  <div class="settlement-balance-row__detail">${paidShare}</div>
  ${flows}
</div>`;
    })
    .join("");

  balanceWrap.innerHTML = `<div class="settlement-balance-rows">${rows}</div>`;
}

// --- Print / PDF report (read-only snapshot; uses existing helpers) ---
function formatReportGeneratedAt() {
  return new Date().toLocaleString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatReportRupeeHtml(n) {
  return `₹${escapeHtml(formatMoney(n))}`;
}

function computeHighestPayerId(paid) {
  if (state.members.length === 0) return null;
  let bestId = state.members[0].id;
  let bestAmt = paid[bestId] || 0;
  for (let i = 1; i < state.members.length; i += 1) {
    const m = state.members[i];
    const v = paid[m.id] || 0;
    if (v > bestAmt + EPS) {
      bestAmt = v;
      bestId = m.id;
    } else if (Math.abs(v - bestAmt) <= EPS && getMemberName(m.id).localeCompare(getMemberName(bestId)) < 0) {
      bestId = m.id;
    }
  }
  return bestId;
}

function buildSimplifiedSettlementTableHtml(net) {
  const txs = simplifySettlements(net);
  if (txs.length === 0) {
    return "<p class=\"print-settled-msg\"><strong>All settled.</strong> No payments are required between members.</p>";
  }
  const rows = txs
    .map((t) => {
      const from = escapeHtml(getMemberName(t.from));
      const to = escapeHtml(getMemberName(t.to));
      return `<tr>
<td>${from}</td>
<td>${to}</td>
<td class="num">${formatReportRupeeHtml(t.amount)}</td>
</tr>`;
    })
    .join("");
  return `<table class="print-table print-table--settle">
<thead><tr><th>From</th><th>To</th><th class="num">Amount</th></tr></thead>
<tbody>${rows}</tbody>
</table>`;
}

function buildDirectDebtTableHtml() {
  const rows = computeDirectExpenseDebts();
  if (rows.length === 0) {
    return "<p class=\"print-settled-msg\"><strong>All settled.</strong> No per-expense reimbursements are listed.</p>";
  }
  const trs = rows
    .map((r) => {
      const title = escapeHtml(r.expenseTitle);
      const from = escapeHtml(getMemberName(r.from));
      const to = escapeHtml(getMemberName(r.to));
      return `<tr>
<td>${title}</td>
<td>${from}</td>
<td>${to}</td>
<td class="num">${formatReportRupeeHtml(r.amount)}</td>
</tr>`;
    })
    .join("");
  return `<table class="print-table print-table--settle print-table--direct-debts">
<thead><tr><th>Expense</th><th>Owes</th><th>To (paid by)</th><th class="num">Amount</th></tr></thead>
<tbody>${trs}</tbody>
</table>`;
}

function buildSettlementTableHtml(net) {
  if (state.members.length === 0 || state.expenses.length === 0) {
    return "<p class=\"print-muted\">Add members and expenses to see suggested settlements.</p>";
  }
  if (isSimplifyDebtEnabled()) {
    return buildSimplifiedSettlementTableHtml(net);
  }
  return buildDirectDebtTableHtml();
}

function buildExecutiveSummaryLine(net) {
  const receivers = state.members.filter((m) => net[m.id] > EPS).map((m) => m.name);
  const owers = state.members.filter((m) => net[m.id] < -EPS).map((m) => m.name);
  if (receivers.length === 0 && owers.length === 0) {
    return "Everyone is even — no one is owed money and no one owes more than their share.";
  }
  const r = receivers.length ? escapeHtml(receivers.join(", ")) : "<em>none</em>";
  const o = owers.length ? escapeHtml(owers.join(", ")) : "<em>none</em>";
  return `<strong>Receives</strong> (net positive): ${r}. <strong>Owes</strong> (net negative): ${o}.`;
}

function buildMemberBalanceRowsHtml(paid, owed, net) {
  if (state.members.length === 0) {
    return '<tr><td colspan="5" class="print-muted">No members.</td></tr>';
  }
  return state.members
    .map((m) => {
      const n = net[m.id];
      let statusText;
      let statusClass;
      if (n > EPS) {
        statusText = "Should receive";
        statusClass = "print-status print-status--receive";
      } else if (n < -EPS) {
        statusText = "Owes";
        statusClass = "print-status print-status--owe";
      } else {
        statusText = "Settled";
        statusClass = "print-status print-status--settled";
      }
      return `<tr>
<td>${escapeHtml(m.name)}</td>
<td class="num">${formatReportRupeeHtml(paid[m.id])}</td>
<td class="num">${formatReportRupeeHtml(owed[m.id])}</td>
<td class="num">${formatReportRupeeHtml(n)}</td>
<td class="${statusClass}">${escapeHtml(statusText)}</td>
</tr>`;
    })
    .join("");
}

function buildDetailedMemberOverviewTableHtml(paid, owed, net) {
  const rows = state.members
    .map((m) => {
      const count = state.expenses.filter((e) => e.participantIds.includes(m.id)).length;
      return `<tr>
<td>${escapeHtml(m.name)}</td>
<td class="num">${formatReportRupeeHtml(paid[m.id])}</td>
<td class="num">${formatReportRupeeHtml(owed[m.id])}</td>
<td class="num">${formatReportRupeeHtml(net[m.id])}</td>
<td class="num">${escapeHtml(String(count))}</td>
</tr>`;
    })
    .join("");
  return `<table class="print-table print-table--compact">
<thead><tr>
<th>Member</th>
<th class="num">Paid</th>
<th class="num">Share</th>
<th class="num">Net</th>
<th class="num">Expenses</th>
</tr></thead>
<tbody>${rows}</tbody>
</table>`;
}

function buildDetailedMemberExpenseBlocksHtml() {
  if (state.members.length === 0) {
    return "<p class=\"print-muted\">No members.</p>";
  }
  const { paid, owed, net } = computeBalances();
  return state.members
    .map((m) => {
      const participated = state.expenses.filter((e) => e.participantIds.includes(m.id));
      const lines =
        participated.length === 0
          ? "<p class=\"print-muted\">Not listed on any expense.</p>"
          : `<table class="print-table print-user-exp-table">
<thead><tr>
<th>Expense</th>
<th>Paid by</th>
<th class="num">Total</th>
<th class="num">Share</th>
</tr></thead>
<tbody>${participated
              .map((e) => {
                const shares = computeOwedForExpense(e);
                const my = shares[m.id] != null ? shares[m.id] : 0;
                return `<tr>
<td>${escapeHtml(e.title)}</td>
<td>${escapeHtml(getMemberName(e.paidById))}</td>
<td class="num">${formatReportRupeeHtml(e.amount)}</td>
<td class="num">${formatReportRupeeHtml(my)}</td>
</tr>`;
              })
              .join("")}</tbody>
</table>`;
      return `<div class="print-user-block print-appendix-member">
<h3 class="print-h3">${escapeHtml(m.name)}</h3>
<ul class="print-user-totals print-user-totals--inline">
<li><strong>Paid:</strong> ${formatReportRupeeHtml(paid[m.id])}</li>
<li><strong>Share:</strong> ${formatReportRupeeHtml(owed[m.id])}</li>
<li><strong>Net:</strong> ${formatReportRupeeHtml(net[m.id])}</li>
</ul>
${lines}
</div>`;
    })
    .join("");
}

function buildAppendixHtml(includeDetailed, simplifyDebt) {
  const parts = [];
  if (includeDetailed) {
    const { paid, owed, net } = computeBalances();
    parts.push(`<h2 class="print-h2">Appendix A — Member overview (detailed)</h2>
<p class="print-meta">Participation counts how many expenses include each member.</p>
${buildDetailedMemberOverviewTableHtml(paid, owed, net)}
<h2 class="print-h2">Appendix B — Per-member expense lines</h2>
${buildDetailedMemberExpenseBlocksHtml()}`);
  }

  const settlementNote = simplifyDebt
    ? "<strong>Settlements</strong> in this report are a minimal set of transfers that clear net balances (same idea as the app’s simplified payment list in Settlement)."
    : "<strong>Settlement list</strong> in this report shows each expense separately: each participant’s split owed to that expense’s payer (not consolidated across expenses).";

  parts.push(`<h2 class="print-h2">${includeDetailed ? "Appendix C" : "Appendix"} — How amounts are calculated</h2>
<ul class="print-list print-list--notes">
<li><strong>Total paid</strong> is the sum of expense amounts where that member is the payer.</li>
<li><strong>Total share</strong> is the sum of that member’s split for each expense they participated in.</li>
<li><strong>Net balance</strong> is total paid minus total share. Positive means the group owes that member; negative means they owe the group.</li>
<li>${settlementNote}</li>
</ul>
<h3 class="print-h3 print-h3--sub">Rounding</h3>
<p class="print-meta">Amounts are stored in rupees with two decimal places. For <strong>equal</strong>, <strong>shares</strong>, and <strong>percentage</strong> splits, each person’s share is rounded to two decimals; the <strong>last participant in the list</strong> receives any small remainder so the shares add up exactly to the expense total.</p>`);

  if (!includeDetailed) {
    parts.push(
      "<p class=\"print-meta\">Each expense above includes a participant table with the exact share used in these totals.</p>",
    );
  }

  return parts.join("\n");
}

function buildPrintReportHtml() {
  const detailedEl = qs("#report-detailed");
  const includeDetailed = Boolean(detailedEl && detailedEl.checked);
  const simplifyDebt = isSimplifyDebtEnabled();

  const tripTitle =
    state.started && state.tripName && state.tripName.trim()
      ? escapeHtml(state.tripName.trim())
      : escapeHtml("Untitled trip");
  const generated = escapeHtml(formatReportGeneratedAt());
  const totalTripCost = round2(state.expenses.reduce((sum, e) => round2(sum + e.amount), 0));
  const memberCount = state.members.length;
  const expenseCount = state.expenses.length;

  const { paid, owed, net } = computeBalances();
  const txs =
    simplifyDebt && state.members.length > 0 && state.expenses.length > 0 ? simplifySettlements(net) : [];
  const directDebtRows =
    !simplifyDebt && state.members.length > 0 && state.expenses.length > 0 ? computeDirectExpenseDebts() : [];
  const totalToSettle = simplifyDebt
    ? txs.length === 0
      ? 0
      : round2(txs.reduce((s, t) => round2(s + t.amount), 0))
    : directDebtRows.length === 0
      ? 0
      : round2(directDebtRows.reduce((s, r) => round2(s + r.amount), 0));

  const settlementLead = simplifyDebt
    ? "Who should pay whom? Use the transfers below to settle up."
    : "Each row is one participant’s share owed to whoever paid for that expense (expense-wise view; not consolidated).";

  const totalSettleRowLabel = simplifyDebt ? "Total amount to settle" : "Total of listed reimbursements";

  const highestId = computeHighestPayerId(paid);
  const highestLine =
    highestId && (paid[highestId] || 0) > EPS
      ? `${escapeHtml(getMemberName(highestId))} (${formatReportRupeeHtml(paid[highestId])})`
      : expenseCount === 0
        ? "— (no expenses yet)"
        : "—";

  const expenseDetailBlocks =
    state.expenses.length === 0
      ? "<p class=\"print-muted\">No expenses recorded.</p>"
      : state.expenses
          .map((e) => {
            const payer = escapeHtml(getMemberName(e.paidById));
            const participants = e.participantIds.map((id) => escapeHtml(getMemberName(id))).join(", ");
            const splitTable = buildPrintExpenseSplitTableHtml(e);
            return `<div class="print-expense-block">
<h3 class="print-h3">${escapeHtml(e.title)}</h3>
<dl class="print-expense-dl">
<div><dt>Paid by</dt><dd>${payer}</dd></div>
<div><dt>Total</dt><dd>${formatReportRupeeHtml(e.amount)}</dd></div>
<div><dt>Split type</dt><dd>${escapeHtml(splitMethodLabel(e.splitMethod))}</dd></div>
<div><dt>Participants</dt><dd>${participants}</dd></div>
</dl>
${splitTable}
</div>`;
          })
          .join("");

  return `
    <div class="print-report-inner">
      <header class="print-cover">
        <p class="print-cover__label">Trip Expense Report</p>
        <h1 class="print-cover__title">${tripTitle}</h1>
        <dl class="print-cover__meta">
          <div><dt>Generated</dt><dd>${generated}</dd></div>
          <div><dt>Currency</dt><dd>INR (₹)</dd></div>
          <div><dt>Total expenses</dt><dd><strong>${formatReportRupeeHtml(totalTripCost)}</strong></dd></div>
          <div><dt>Members</dt><dd><strong>${escapeHtml(String(memberCount))}</strong></dd></div>
        </dl>
      </header>

      <section class="print-section print-section--tight">
        <h2 class="print-h2">Executive summary</h2>
        <table class="print-table print-table--kv">
          <tbody>
            <tr><th scope="row">Total trip cost</th><td class="num">${formatReportRupeeHtml(totalTripCost)}</td></tr>
            <tr><th scope="row">Total members</th><td>${escapeHtml(String(memberCount))}</td></tr>
            <tr><th scope="row">Number of expenses</th><td>${escapeHtml(String(expenseCount))}</td></tr>
            <tr><th scope="row">Highest payer</th><td>${highestLine}</td></tr>
            <tr><th scope="row">${escapeHtml(totalSettleRowLabel)}</th><td class="num"><strong>${formatReportRupeeHtml(totalToSettle)}</strong></td></tr>
          </tbody>
        </table>
        <p class="print-lede">${buildExecutiveSummaryLine(net)}</p>
      </section>

      <section class="print-section">
        <h2 class="print-h2">Settlement summary</h2>
        <p class="print-section__lead">${escapeHtml(settlementLead)}</p>
        ${buildSettlementTableHtml(net)}
      </section>

      <section class="print-section">
        <h2 class="print-h2">Member balance summary</h2>
        <table class="print-table print-table--balances">
          <thead>
            <tr>
              <th>Member</th>
              <th class="num">Total paid</th>
              <th class="num">Total share</th>
              <th class="num">Net balance</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>${buildMemberBalanceRowsHtml(paid, owed, net)}</tbody>
        </table>
      </section>

      <section class="print-section print-section--expenses${expenseCount > 0 ? " print-section--break-before" : ""}">
        <h2 class="print-h2">Expense breakdown</h2>
        ${expenseDetailBlocks}
      </section>

      <section class="print-section print-section--appendix print-section--break-before">
        ${buildAppendixHtml(includeDetailed, simplifyDebt)}
      </section>
    </div>
  `;
}

function onExportPdf() {
  if (!state.started) return;
  const root = qs("#print-report");
  if (!root) return;
  root.innerHTML = buildPrintReportHtml();
  root.setAttribute("aria-hidden", "false");

  const prevTitle = document.title;
  const tripShort =
    state.tripName && state.tripName.trim() ? state.tripName.trim() : "Trip expense report";
  document.title = `${tripShort} — Expense report`;

  const cleanup = () => {
    document.title = prevTitle;
    root.innerHTML = "";
    root.setAttribute("aria-hidden", "true");
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);

  window.print();
}

function syncExportPdfButton() {
  const btn = qs("#btn-export-pdf");
  if (btn) btn.disabled = !state.started;
}

function isExpenseModalOpen() {
  const modal = qs("#expense-modal");
  return Boolean(modal && modal.classList.contains("is-open"));
}

function setExpenseModalMode(isEdit) {
  const heading = qs("#modal-expense-heading");
  const submitBtn = qs("#btn-add-expense");
  if (heading) heading.textContent = isEdit ? "Edit expense" : "Add expense";
  if (submitBtn) submitBtn.textContent = isEdit ? "Save changes" : "Save expense";
}

function clearExpenseModalForm() {
  const titleEl = qs("#expense-title");
  const amtEl = qs("#expense-amount");
  const payerEl = qs("#expense-payer");
  if (titleEl) titleEl.value = "";
  if (amtEl) amtEl.value = "";
  if (payerEl) payerEl.value = "";
}

function openExpenseModal() {
  const modal = qs("#expense-modal");
  const openBtn = qs("#btn-open-expense-modal");
  if (!modal || !openBtn || openBtn.disabled) return;
  editingExpenseId = null;
  setExpenseModalMode(false);
  clearExpenseModalForm();
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  renderPayerAndParticipants();
  syncExpenseFormUi();
  renderSplitFields();
  setMessage(qs("#expense-message"), "");
  const titleInput = qs("#expense-title");
  if (titleInput && !titleInput.disabled) {
    titleInput.focus();
  }
}

function openExpenseModalForEdit(expenseId) {
  const modal = qs("#expense-modal");
  const e = state.expenses.find((x) => x.id === expenseId);
  if (!modal || !e) return;
  if (!state.started || state.members.length === 0) return;

  editingExpenseId = expenseId;
  setExpenseModalMode(true);
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";

  qs("#expense-title").value = e.title;
  qs("#expense-amount").value = formatMoney(e.amount);

  renderPayerAndParticipants({
    selectParticipantIds: e.participantIds,
    payerId: e.paidById,
  });
  qs("#split-method").value = e.splitMethod;
  syncExpenseFormUi();
  const prefill = e.splitMethod === "equal" ? null : { ...(e.splitDetails || {}) };
  renderSplitFields(prefill);
  setMessage(qs("#expense-message"), "");
  const titleInput = qs("#expense-title");
  if (titleInput && !titleInput.disabled) {
    titleInput.focus();
  }
}

function closeExpenseModal() {
  const modal = qs("#expense-modal");
  if (!modal) return;
  modal.classList.remove("is-open");
  modal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  editingExpenseId = null;
  setExpenseModalMode(false);
  clearExpenseModalForm();
  setMessage(qs("#expense-message"), "");
  syncExpenseFormUi();
}

function renderAll() {
  syncAppPageMode();
  updateTripSectionDisabled();
  updateDependentSectionsEnabled();
  syncExportPdfButton();
  renderHeaderSummary();
  renderMemberList();
  if (!isExpenseModalOpen()) {
    renderPayerAndParticipants();
    renderSplitFields();
  }
  syncExpenseFormUi();
  renderExpenseList();
  renderSettlementPanel();
}

// --- Events ---
function onStartTrip() {
  const msg = qs("#trip-message");
  setMessage(msg, "");
  const v = validateStartTrip(qs("#trip-name-input").value);
  if (!v.ok) {
    setMessage(msg, v.errors[0]);
    return;
  }
  state.tripName = v.tripName;
  state.started = true;
  renderAll();
  saveState();
}

function focusMemberNameInput() {
  const input = qs("#member-name-input");
  if (!input || input.disabled) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      input.focus();
    });
  });
}

function onAddMember() {
  const msg = qs("#member-message");
  setMessage(msg, "");
  const v = validateMemberName(qs("#member-name-input").value);
  if (!v.ok) {
    setMessage(msg, v.errors[0]);
    focusMemberNameInput();
    return;
  }
  state.members.push({ id: generateId(), name: v.name });
  qs("#member-name-input").value = "";
  renderAll();
  saveState();
  focusMemberNameInput();
}

function onMemberNameInputKeydown(ev) {
  if (ev.key !== "Enter") return;
  ev.preventDefault();
  onAddMember();
}

function onAddExpense(ev) {
  ev.preventDefault();
  const msg = qs("#expense-message");
  setMessage(msg, "");

  const draft = readExpenseDraftFromForm();
  draft.amount = Number(draft.amount);
  const v = validateExpenseDraft(draft);
  if (!v.ok) {
    setMessage(msg, v.errors[0]);
    return;
  }

  const expensePayload = {
    title: draft.title.trim(),
    amount: round2(draft.amount),
    paidById: draft.paidById,
    participantIds: draft.participantIds.slice(),
    splitMethod: draft.splitMethod,
    splitDetails:
      draft.splitMethod === "equal"
        ? {}
        : Object.fromEntries(draft.participantIds.map((id) => [id, round2(Number(draft.splitDetails[id]))])),
  };

  const editId = editingExpenseId;
  if (editId) {
    const idx = state.expenses.findIndex((x) => x.id === editId);
    if (idx === -1) {
      setMessage(msg, "That expense is no longer in the list.");
      return;
    }
    state.expenses[idx] = {
      id: editId,
      ...expensePayload,
    };
  } else {
    state.expenses.push({
      id: generateId(),
      ...expensePayload,
    });
  }

  closeExpenseModal();
  renderAll();
  saveState();
}

function onResetTrip() {
  if (
    !window.confirm(
      "Clear all trip data from this browser? This cannot be undone.",
    )
  ) {
    return;
  }
  resetState();
}

document.addEventListener("DOMContentLoaded", () => {
  loadState();

  const simplifyDebtEl = qs("#simplify-debt");
  if (simplifyDebtEl) {
    simplifyDebtEl.checked = loadSimplifyDebtPreference();
    simplifyDebtEl.addEventListener("change", () => {
      saveSimplifyDebtPreference(simplifyDebtEl.checked);
      renderSettlementPanel();
    });
  }

  qs("#btn-start-trip").addEventListener("click", onStartTrip);
  qs("#btn-add-member").addEventListener("click", onAddMember);
  const memberNameInput = qs("#member-name-input");
  if (memberNameInput) {
    memberNameInput.addEventListener("keydown", onMemberNameInputKeydown);
  }
  qs("#expense-form").addEventListener("submit", onAddExpense);
  qs("#split-method").addEventListener("change", () => {
    renderSplitFields();
  });

  const selectAllParticipants = qs("#participant-select-all");
  if (selectAllParticipants) {
    selectAllParticipants.addEventListener("change", onParticipantSelectAllChange);
  }
  qs("#expense-payer").addEventListener("change", () => {
    syncParticipantSelectAllCheckbox();
    renderSplitFields();
  });

  const toggleMemberAdd = qs("#btn-toggle-member-add");
  if (toggleMemberAdd) {
    toggleMemberAdd.addEventListener("click", () => {
      const row = qs("#member-add-inline");
      if (!row) return;
      row.classList.toggle("hidden");
      const open = !row.classList.contains("hidden");
      toggleMemberAdd.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) {
        const input = qs("#member-name-input");
        if (input && !input.disabled) input.focus();
      }
    });
    toggleMemberAdd.setAttribute("aria-expanded", "false");
    toggleMemberAdd.setAttribute("aria-controls", "member-add-inline");
  }

  qs("#btn-open-expense-modal").addEventListener("click", openExpenseModal);
  qs("#btn-close-expense-modal").addEventListener("click", closeExpenseModal);
  const cancelModal = qs("#btn-cancel-expense-modal");
  if (cancelModal) cancelModal.addEventListener("click", closeExpenseModal);
  qs("#expense-modal-backdrop").addEventListener("click", closeExpenseModal);

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && isExpenseModalOpen()) {
      closeExpenseModal();
      renderAll();
    }
  });

  const exportPdf = qs("#btn-export-pdf");
  if (exportPdf) exportPdf.addEventListener("click", onExportPdf);

  const resetTrip = qs("#btn-reset-trip");
  if (resetTrip) resetTrip.addEventListener("click", onResetTrip);

  const expensesPanel = qs(".panel-expenses-main");
  if (expensesPanel) {
    expensesPanel.addEventListener("click", (ev) => {
      const emptyAdd = ev.target && ev.target.closest && ev.target.closest("#btn-empty-add-expense");
      if (emptyAdd) {
        openExpenseModal();
        return;
      }
      const editBtn = ev.target && ev.target.closest && ev.target.closest(".expense-card__edit");
      if (editBtn) {
        const card = editBtn.closest(".expense-card");
        const id = card && card.dataset ? card.dataset.expenseId : null;
        if (id) openExpenseModalForEdit(id);
        return;
      }
    });
  }

  renderAll();
});
