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

/** Add-expense modal only: `"manual"` | `"ai"`. Edit flow ignores this and always shows manual fields. */
let expenseEntryMode = "ai";

const STORAGE_KEY = "tripExpenseSplitterState";
const STORAGE_KEY_SIMPLIFY_DEBT = "tripExpenseSplitterSimplifyDebt";

/** POST `{ input, members }` — worker holds Groq API key. */
const EXPENSE_AI_WORKER_URL = "https://dawn-sun-9497.abishek-d.workers.dev/";

// --- App root + domain namespaces (implementations live here) ---
const App = {};

App.Trip = {};
App.Member = {};
App.Expense = { modal: {}, split: {}, ai: {} };
App.Settlement = {};

// --- Util (standalone helpers live here) ---
const Util = {
  // DOM
  qs(sel, root) {
    return (root || document).querySelector(sel);
  },
  qsa(sel, root) {
    return Array.from((root || document).querySelectorAll(sel));
  },

  // formatting / math
  round2(n) {
    return Math.round(Number(n) * 100) / 100;
  },
  formatMoney(n) {
    return Util.round2(n).toFixed(2);
  },
  formatShareCountPhrase(raw) {
    const n = Util.round2(Number(raw) || 0);
    const unit = n === 1 ? "share" : "shares";
    return `${n} ${unit}`;
  },
  formatPctForSplitDisplay(raw) {
    const n = Util.round2(Number(raw) || 0);
    return `${String(parseFloat(n.toFixed(2)))}%`;
  },

  // html safety
  escapeHtml(s) {
    const str = String(s ?? "");
    return str
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  },

  iconSvg(name, className) {
    const paths = {
      arrowRight: '<path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path>',
      chevronDown: '<path d="m6 9 6 6 6-6"></path>',
      edit: '<path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path>',
      plus: '<path d="M5 12h14"></path><path d="M12 5v14"></path>',
      receipt:
        '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"></path><path d="M16 8h-6"></path><path d="M16 12h-6"></path>',
      trash: '<path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v5"></path><path d="M14 11v5"></path>',
      checkCircle: '<path d="M9 12l2 2 4-4"></path><circle cx="12" cy="12" r="9"></circle>',
    };
    return `<svg class="icon ${className || ""}" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || ""}</svg>`;
  },

  setMessage(el, text) {
    el.textContent = text || "";
  },
};

App.Util = Util;

// Back-compat aliases while refactor is in progress.
const Trip = App.Trip;
const Member = App.Member;
const Expense = App.Expense;
const Settlement = App.Settlement;

// Attach public state + accessors (non-method data) to Trip
Trip.state = state;
Object.defineProperty(Trip, "editingExpenseId", {
  get() {
    return editingExpenseId;
  },
  set(v) {
    editingExpenseId = v;
  },
});

Trip.save = function save() {
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
    console.warn("Trip.save", err);
  }
};

Trip.load = function load() {
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
      amount: Util.round2(Number(e.amount) || 0),
      paidById: String(e.paidById || ""),
      participantIds: Array.isArray(e.participantIds) ? e.participantIds.map(String) : [],
      splitMethod: e.splitMethod || "equal",
      splitDetails: e.splitDetails && typeof e.splitDetails === "object" ? { ...e.splitDetails } : {},
    }));

    const tripInput = Util.qs("#trip-name-input");
    if (tripInput) {
      tripInput.value = state.tripName || "";
    }
  } catch (err) {
    console.warn("Trip.load", err);
  }
};

Trip.resetState = function resetState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.warn("Trip.resetState", err);
  }
  state.tripName = null;
  state.started = false;
  state.members = [];
  state.expenses = [];
  editingExpenseId = null;

  const tripInput = Util.qs("#trip-name-input");
  if (tripInput) {
    tripInput.value = "";
  }
  const memberName = Util.qs("#member-name-input");
  if (memberName) memberName.value = "";
  const etitle = Util.qs("#expense-title");
  const eamt = Util.qs("#expense-amount");
  if (etitle) etitle.value = "";
  if (eamt) eamt.value = "";

  Util.setMessage(Util.qs("#trip-message"), "");
  Util.setMessage(Util.qs("#member-message"), "");
  Util.setMessage(Util.qs("#expense-message"), "");

  Expense.modal.close();

  const memberRow = Util.qs("#member-add-inline");
  const toggleBtn = Util.qs("#btn-toggle-member-add");
  if (memberRow) memberRow.classList.add("hidden");
  if (toggleBtn) toggleBtn.setAttribute("aria-expanded", "false");

  Trip.renderAll();
};

// Trip orchestration + lifecycle entrypoints used by event wiring
Trip.renderAll = function renderAllPublic() {
  return renderAll();
};

Trip.start = function start() {
  return onStartTrip();
};

Trip.reset = function reset() {
  return onResetTrip();
};

let idCounter = 0;

Util.generateId = function generateId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  idCounter += 1;
  return `m-${Date.now()}-${idCounter}`;
};

Member.getName = function getName(memberId) {
  const m = state.members.find((x) => x.id === memberId);
  return m ? m.name : "?";
};

/** Case-insensitive match to current trip members (duplicate names are disallowed at add time). */
Member.findIdByName = function findIdByName(name) {
  const t = String(name ?? "").trim().toLowerCase();
  if (!t) return null;
  const m = state.members.find((x) => x.name.trim().toLowerCase() === t);
  return m ? m.id : null;
};

Member.getInitials = function getInitials(name) {
  const words = String(name || "?")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
};

Member.getAvatarColor = function getAvatarColor(memberId) {
  const palette = ["#dbeafe", "#dcfce7", "#fef3c7", "#fce7f3", "#ede9fe", "#ccfbf1", "#fee2e2", "#e0e7ff"];
  const seed = `${memberId}-${Member.getName(memberId)}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash + seed.charCodeAt(i) * (i + 1)) % palette.length;
  }
  return palette[hash];
};

Member.buildAvatarHtml = function buildAvatarHtml(memberId, className) {
  const name = Member.getName(memberId);
  const label = Member.getName(memberId);
  return `<span class="avatar ${className || ""}" style="--avatar-bg: ${Member.getAvatarColor(
    memberId,
  )}" aria-label="${Util.escapeHtml(label)}">${Util.escapeHtml(Member.getInitials(name))}</span>`;
};

// Member actions (used by event wiring)
Member.focusNameInput = function focusNameInput() {
  return focusMemberNameInput();
};

Member.add = function add() {
  return onAddMember();
};

Member.onNameKeydown = function onNameKeydown(ev) {
  return onMemberNameInputKeydown(ev);
};

// --- Split calculation (last participant gets remainder) ---
Expense.split.computeOwedForExpense = function computeOwedForExpense(expense) {
  const ids = expense.participantIds.slice();
  const n = ids.length;
  const amount = expense.amount;
  const out = {};

  if (n === 0) return out;

  if (expense.splitMethod === "equal") {
    const base = Util.round2(amount / n);
    let sum = 0;
    for (let i = 0; i < n - 1; i += 1) {
      out[ids[i]] = base;
      sum = Util.round2(sum + base);
    }
    out[ids[n - 1]] = Util.round2(amount - sum);
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
      const share = Util.round2((amount * s) / totalShares);
      out[id] = share;
      allocated = Util.round2(allocated + share);
    }
    const lastId = ids[n - 1];
    out[lastId] = Util.round2(amount - allocated);
    return out;
  }

  if (expense.splitMethod === "percentage") {
    const details = expense.splitDetails || {};
    let allocated = 0;
    for (let i = 0; i < n - 1; i += 1) {
      const id = ids[i];
      const p = Number(details[id]) || 0;
      const share = Util.round2((amount * p) / 100);
      out[id] = share;
      allocated = Util.round2(allocated + share);
    }
    const lastId = ids[n - 1];
    out[lastId] = Util.round2(amount - allocated);
    return out;
  }

  if (expense.splitMethod === "custom") {
    const details = expense.splitDetails || {};
    for (const id of ids) {
      out[id] = Util.round2(Number(details[id]) || 0);
    }
    return out;
  }

  return out;
};

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
      sumP = Util.round2(sumP + p);
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
      sumC = Util.round2(sumC + c);
    }
    if (Math.abs(sumC - amount) > EPS) {
      errors.push("Custom amounts must add up to the expense total.");
    }
  }

  return { ok: errors.length === 0, errors };
}

// --- Balances ---
Settlement.computeBalances = function computeBalances() {
  const paid = {};
  const owed = {};
  state.members.forEach((m) => {
    paid[m.id] = 0;
    owed[m.id] = 0;
  });

  for (const e of state.expenses) {
    if (state.members.some((m) => m.id === e.paidById)) {
      paid[e.paidById] = Util.round2(paid[e.paidById] + e.amount);
    }
    const shares = Expense.split.computeOwedForExpense(e);
    for (const pid of e.participantIds) {
      if (owed[pid] !== undefined) {
        owed[pid] = Util.round2(owed[pid] + (shares[pid] || 0));
      }
    }
  }

  const net = {};
  state.members.forEach((m) => {
    net[m.id] = Util.round2(paid[m.id] - owed[m.id]);
  });

  return { paid, owed, net };
};

// --- Settlement (greedy pairing, integer cents) ---
Settlement.simplify = function simplify(netByMember) {
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
      amount: Util.round2(payCents / 100),
    });

    c.cents -= payCents;
    d.cents += payCents;

    if (c.cents === 0) i += 1;
    if (d.cents === 0) j += 1;
  }

  return txs;
};

Settlement.isActiveMemberId = function isActiveMemberId(memberId) {
  return state.members.some((m) => m.id === memberId);
};

/**
 * Per-expense debt lines: each non-payer participant owes their computed share to that expense’s payer.
 * Order follows `state.expenses`. Uses `computeOwedForExpense` only (no balance / settlement simplification).
 */
Settlement.computeDirectDebts = function computeDirectDebts() {
  const rows = [];
  for (const e of state.expenses) {
    if (!Settlement.isActiveMemberId(e.paidById)) continue;
    const shares = Expense.split.computeOwedForExpense(e);
    for (const pid of e.participantIds) {
      if (pid === e.paidById) continue;
      if (!Settlement.isActiveMemberId(pid)) continue;
      const amt = Util.round2(Number(shares[pid]) || 0);
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
};

Settlement.loadSimplifyDebtPreference = function loadSimplifyDebtPreference() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SIMPLIFY_DEBT);
    if (raw === null) return true;
    return raw === "1" || raw === "true";
  } catch (err) {
    console.warn("Settlement.loadSimplifyDebtPreference", err);
    return true;
  }
};

Settlement.saveSimplifyDebtPreference = function saveSimplifyDebtPreference(on) {
  try {
    localStorage.setItem(STORAGE_KEY_SIMPLIFY_DEBT, on ? "1" : "0");
  } catch (err) {
    console.warn("Settlement.saveSimplifyDebtPreference", err);
  }
};

function isSimplifyDebtEnabled() {
  const el = Util.qs("#simplify-debt");
  if (!el) return true;
  return Boolean(el.checked);
}

function formatSettlementRupeeHtml(n) {
  return `₹${Util.escapeHtml(Util.formatMoney(Util.round2(Number(n) || 0)))}`;
}

/** @param {{from: string, to: string, amount: number}[]} txs */
function buildSimplifiedFlowsHtml(memberId, txs) {
  const incoming = txs.filter((t) => t.to === memberId);
  const outgoing = txs.filter((t) => t.from === memberId);
  if (incoming.length > 0) {
    const parts = incoming.map(
      (t) => `${Util.escapeHtml(Member.getName(t.from))} ${formatSettlementRupeeHtml(t.amount)}`,
    );
    return `<div class="settlement-balance-row__flows"><span class="settlement-balance-row__flows-label">From:</span> ${parts.join(", ")}</div>`;
  }
  if (outgoing.length > 0) {
    const parts = outgoing.map(
      (t) => `${Util.escapeHtml(Member.getName(t.to))} ${formatSettlementRupeeHtml(t.amount)}`,
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
        `${Util.escapeHtml(r.expenseTitle)} — ${Util.escapeHtml(Member.getName(r.from))} ${formatSettlementRupeeHtml(
          r.amount,
        )}`,
    );
    return `<div class="settlement-balance-row__flows"><span class="settlement-balance-row__flows-label">From:</span> ${parts.join(", ")}</div>`;
  }
  if (outgoing.length > 0) {
    const parts = outgoing.map(
      (r) =>
        `${Util.escapeHtml(r.expenseTitle)} — ${Util.escapeHtml(Member.getName(r.to))} ${formatSettlementRupeeHtml(
          r.amount,
        )}`,
    );
    return `<div class="settlement-balance-row__flows"><span class="settlement-balance-row__flows-label">Pay to:</span> ${parts.join(", ")}</div>`;
  }
  return "";
}

function buildExpenseSplitSummaryText(expense) {
  const count = expense.participantIds.length;
  if (count === 0) return "No participants";

  if (expense.splitMethod === "equal") {
    const owed = Expense.split.computeOwedForExpense(expense);
    const amounts = expense.participantIds.map((id) => Util.round2(owed[id] || 0));
    const first = amounts[0];
    const allSame = amounts.every((amt) => Math.abs(amt - first) <= EPS);
    if (allSame) return `₹${Util.formatMoney(first)} per person`;
  }

  return `Split among ${count} ${count === 1 ? "member" : "members"}`;
}

function buildCompactNameList(names, maxNames, maxChars) {
  const shown = [];
  let length = 0;

  for (const name of names) {
    const nextLength = length + (shown.length > 0 ? 2 : 0) + name.length;
    if (shown.length >= maxNames || (shown.length > 0 && nextLength > maxChars)) break;
    shown.push(name);
    length = nextLength;
  }

  const hiddenCount = names.length - shown.length;
  return `${shown.join(", ")}${hiddenCount > 0 ? ` +${hiddenCount} more` : ""}`;
}

function buildSettlementPaymentLines(transfers) {
  const groups = new Map();

  transfers.forEach((transfer) => {
    const amount = Util.round2(transfer.amount);
    if (amount <= EPS) return;
    const key = `${transfer.to}|${Math.round(amount * 100)}`;
    if (!groups.has(key)) {
      groups.set(key, {
        to: transfer.to,
        amount,
        from: [],
      });
    }
    groups.get(key).from.push(transfer.from);
  });

  return Array.from(groups.values()).flatMap((group) => {
    const uniqueFrom = Array.from(new Set(group.from));
    if (uniqueFrom.length > 1 && uniqueFrom.length === group.from.length) {
      const names = uniqueFrom.map((id) => Member.getName(id));
      const fullNameList = names.join(", ");
      const canShowAllNames = names.length <= 5 && fullNameList.length <= 42;
      const primaryFrom = canShowAllNames ? fullNameList : `${names.length} people`;
      const secondaryNames = canShowAllNames ? "" : buildCompactNameList(names, 5, 48);
      const individualRows = uniqueFrom
        .map(
          (from) =>
            `<div class="settlement-payment__individual"><span>${Util.escapeHtml(
              Member.getName(from),
            )}</span>${Util.iconSvg("arrowRight", "settlement-payment__arrow")}<span>${Util.escapeHtml(
              Member.getName(group.to),
            )}</span><strong>${formatSettlementRupeeHtml(group.amount)}</strong></div>`,
        )
        .join("");

      return `<details class="settlement-payment__group-details">
        <summary>
          <span class="settlement-payment__main">
            <span class="settlement-payment__from" title="${Util.escapeHtml(fullNameList)}">${Util.escapeHtml(
              primaryFrom,
            )}</span>${Util.iconSvg(
              "arrowRight",
              "settlement-payment__arrow",
            )}<span class="settlement-payment__to">${Util.escapeHtml(
              Member.getName(group.to),
            )}</span><span class="settlement-payment__amount">${formatSettlementRupeeHtml(
              group.amount,
            )} each</span>
          </span>
          ${
            secondaryNames
              ? `<span class="settlement-payment__names" title="${Util.escapeHtml(fullNameList)}">${Util.escapeHtml(
                  secondaryNames,
                )}</span>`
              : ""
          }
        </summary>
        <div class="settlement-payment__individuals">${individualRows}</div>
      </details>`;
    }

    return group.from.map(
      (from) =>
        `<span class="settlement-payment__from">${Util.escapeHtml(Member.getName(from))}</span>${Util.iconSvg(
          "arrowRight",
          "settlement-payment__arrow",
        )}<span class="settlement-payment__to">${Util.escapeHtml(
          Member.getName(group.to),
        )}</span><span class="settlement-payment__amount">${formatSettlementRupeeHtml(group.amount)}</span>`,
    );
  });
}

// --- Read expense draft from DOM ---
Expense.split.getCheckedParticipantIds = function getCheckedParticipantIds() {
  return Util.qsa("#participant-checkboxes input[type=checkbox]:checked").map((el) => el.value);
};

Expense.split.syncParticipantSelectAllCheckbox = function syncParticipantSelectAllCheckbox() {
  const master = Util.qs("#participant-select-all");
  if (!master) return;
  const boxes = Util.qsa("#participant-checkboxes input[type=checkbox]");
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
};

// Back-compat: older event wiring calls this name.
Expense.split.syncSelectAll = function syncSelectAll() {
  return Expense.split.syncParticipantSelectAllCheckbox();
};

Expense.split.onParticipantMemberCheckboxChange = function onParticipantMemberCheckboxChange() {
  Expense.split.syncParticipantSelectAllCheckbox();
  Expense.split.renderSplitFields();
};

Expense.split.onParticipantSelectAllChange = function onParticipantSelectAllChange() {
  const master = Util.qs("#participant-select-all");
  if (!master) return;
  const boxes = Util.qsa("#participant-checkboxes input[type=checkbox]");
  if (master.checked) {
    boxes.forEach((b) => {
      b.checked = true;
    });
  } else {
    boxes.forEach((b) => {
      b.checked = false;
    });
  }
  Expense.split.syncParticipantSelectAllCheckbox();
  Expense.split.renderSplitFields();
};

// Back-compat: current event wiring uses this shorter name.
Expense.split.onSelectAllToggle = function onSelectAllToggle() {
  return Expense.split.onParticipantSelectAllChange();
};

Expense.split.readSplitDetailsFromDom = function readSplitDetailsFromDom(method, participantIds) {
  const details = {};
  if (method === "equal") return details;

  for (const id of participantIds) {
    if (method === "shares") {
      const el = Util.qs(`#split-share-${id}`);
      details[id] = el ? Number(el.value) : NaN;
    } else if (method === "percentage") {
      const el = Util.qs(`#split-pct-${id}`);
      details[id] = el ? Number(el.value) : NaN;
    } else if (method === "custom") {
      const el = Util.qs(`#split-custom-${id}`);
      details[id] = el ? Number(el.value) : NaN;
    }
  }
  return details;
};

Expense.readDraftFromForm = function readDraftFromForm() {
  const title = Util.qs("#expense-title").value;
  const amount = Util.qs("#expense-amount").value;
  const paidById = Util.qs("#expense-payer").value;
  const participantIds = Expense.split.getCheckedParticipantIds();
  const splitMethod = Util.qs("#split-method").value;
  const splitDetails = Expense.split.readSplitDetailsFromDom(splitMethod, participantIds);
  return {
    title,
    amount,
    paidById,
    participantIds,
    splitMethod,
    splitDetails,
  };
};

const EXPENSE_AI_SPLIT_METHODS = new Set(["equal", "shares", "percentage", "custom"]);

Expense.ai.fetchParse = async function fetchParse(input) {
  const members = state.members.map((m) => m.name);
  const res = await fetch(EXPENSE_AI_WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input, members }),
  });
  const text = await res.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error("Invalid response from AI service.");
  }
  if (!res.ok) {
    const err = body.error || body.message || res.statusText || "Request failed";
    throw new Error(typeof err === "string" ? err : "Request failed");
  }
  if (body.error) {
    throw new Error(String(body.error));
  }
  return body;
};

/**
 * Maps worker JSON into the expense modal. Caller must have the modal open with members loaded.
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
Expense.ai.applyWorkerPayloadToForm = function applyWorkerPayloadToForm(parsed) {
  const msg = Util.qs("#expense-message");
  const title = String(parsed.title ?? "").trim();
  if (!title) {
    return { ok: false, error: "AI did not return a title." };
  }
  const amount = Number(parsed.amount);
  if (!(amount > 0) || !Number.isFinite(amount)) {
    return { ok: false, error: "AI did not return a valid amount." };
  }

  const payerId = Member.findIdByName(parsed.paidByName);
  if (!payerId) {
    return {
      ok: false,
      error: `Could not match payer "${String(parsed.paidByName ?? "").trim() || "(missing)"}" to a trip member.`,
    };
  }

  const names = Array.isArray(parsed.participantNames) ? parsed.participantNames : [];
  if (names.length === 0) {
    return { ok: false, error: "AI did not return any participants." };
  }

  const participantIds = [];
  for (const n of names) {
    const id = Member.findIdByName(n);
    if (!id) {
      return {
        ok: false,
        error: `Could not match participant "${String(n).trim()}" to a trip member.`,
      };
    }
    participantIds.push(id);
  }
  const seen = new Set();
  const uniqueParticipantIds = participantIds.filter((id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  let splitMethod = String(parsed.splitMethod || "equal").trim();
  if (!EXPENSE_AI_SPLIT_METHODS.has(splitMethod)) {
    splitMethod = "equal";
  }

  const byName = parsed.splitDetailsByName;
  const prefill =
    splitMethod !== "equal" && byName && typeof byName === "object"
      ? (() => {
          const out = {};
          for (const id of uniqueParticipantIds) {
            const memberName = Member.getName(id);
            const key = Object.keys(byName).find(
              (k) => String(k).trim().toLowerCase() === memberName.trim().toLowerCase(),
            );
            if (key == null) continue;
            const v = Number(byName[key]);
            if (Number.isFinite(v)) {
              out[id] = v;
            }
          }
          return out;
        })()
      : null;

  Expense.split.renderPayerAndParticipants({
    selectParticipantIds: uniqueParticipantIds,
    payerId,
  });

  const titleEl = Util.qs("#expense-title");
  const amtEl = Util.qs("#expense-amount");
  const methodEl = Util.qs("#split-method");
  if (titleEl) titleEl.value = title;
  if (amtEl) amtEl.value = Util.formatMoney(amount);
  if (methodEl) methodEl.value = splitMethod;

  syncExpenseFormUi();
  Expense.split.renderSplitFields(prefill && Object.keys(prefill).length > 0 ? prefill : null);

  Util.setMessage(msg, "Review the form, then save.");
  return { ok: true };
};

Expense.ai.onParseClick = async function onParseClick() {
  const msg = Util.qs("#expense-message");
  const inputEl = Util.qs("#expense-ai-input");
  const btn = Util.qs("#btn-expense-ai-parse");
  if (!Expense.modal.isOpen() || !inputEl || !btn || btn.disabled) return;

  const raw = String(inputEl.value || "").trim();
  Util.setMessage(msg, "");
  if (!raw) {
    Util.setMessage(msg, "Enter a short description of the expense.");
    return;
  }
  if (!state.started || state.members.length === 0) {
    Util.setMessage(msg, "Add members before using AI fill.");
    return;
  }

  const prevLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Parsing…";

  try {
    const parsed = await Expense.ai.fetchParse(raw);
    const applied = Expense.ai.applyWorkerPayloadToForm(parsed);
    if (!applied.ok) {
      Util.setMessage(msg, applied.error);
      return;
    }
    inputEl.value = "";
    Expense.modal.setEntryMode("manual");
    const titleInput = Util.qs("#expense-title");
    if (titleInput && !titleInput.disabled) {
      titleInput.focus();
    }
  } catch (e) {
    const m = e && e.message ? String(e.message) : "Could not reach AI service.";
    Util.setMessage(msg, m);
  } finally {
    btn.disabled = false;
    btn.textContent = prevLabel;
    syncExpenseFormUi();
  }
};

Expense.split.methodLabel = function methodLabel(method) {
  if (method === "equal") return "Equal";
  if (method === "shares") return "By shares";
  if (method === "percentage") return "By percentage";
  if (method === "custom") return "Custom amount";
  return method;
};

// --- Render ---

function updateTripSectionDisabled() {
  const started = state.started;
  Util.qs("#trip-name-input").disabled = started;
  Util.qs("#btn-start-trip").disabled = started;
}

function syncExpenseFormUi() {
  const expenseLocked = !(state.started && state.members.length > 0);
  const modalOpen = Expense.modal.isOpen();
  const formDisabled = expenseLocked || !modalOpen;
  const isEditing = editingExpenseId != null;
  const isAddAi = modalOpen && !isEditing && expenseEntryMode === "ai";
  const manualFieldsDisabled = formDisabled || isAddAi;
  const aiFieldsDisabled = formDisabled || isEditing || (modalOpen && !isEditing && expenseEntryMode !== "ai");

  ["#expense-title", "#expense-amount", "#expense-payer", "#split-method"].forEach((sel) => {
    const el = Util.qs(sel);
    if (el) el.disabled = manualFieldsDisabled;
  });
  Util.qsa("#participant-checkboxes input[type=checkbox]").forEach((el) => {
    el.disabled = manualFieldsDisabled;
  });
  const selectAll = Util.qs("#participant-select-all");
  if (selectAll) selectAll.disabled = manualFieldsDisabled;

  const saveBtn = Util.qs("#btn-add-expense");
  if (saveBtn) saveBtn.disabled = manualFieldsDisabled;

  const aiInput = Util.qs("#expense-ai-input");
  const aiBtn = Util.qs("#btn-expense-ai-parse");
  if (aiInput) aiInput.disabled = aiFieldsDisabled;
  if (aiBtn) aiBtn.disabled = aiFieldsDisabled;

  const modeSwitch = Util.qs("#expense-entry-mode-switch");
  const tabManual = Util.qs("#tab-expense-entry-manual");
  const tabAi = Util.qs("#tab-expense-entry-ai");
  if (modeSwitch) {
    if (isEditing) {
      modeSwitch.hidden = true;
      modeSwitch.setAttribute("aria-hidden", "true");
    } else {
      modeSwitch.hidden = false;
      modeSwitch.setAttribute("aria-hidden", "false");
    }
  }
  const tabsDisabled = formDisabled || isEditing;
  if (tabManual) tabManual.disabled = tabsDisabled;
  if (tabAi) tabAi.disabled = tabsDisabled;

  const openBtn = Util.qs("#btn-open-expense-modal");
  if (openBtn) {
    openBtn.disabled = expenseLocked || modalOpen;
    openBtn.classList.toggle("btn-primary", !expenseLocked);
    openBtn.classList.toggle("btn-disabled-quiet", expenseLocked);
    openBtn.title = expenseLocked ? "Add members first to split expenses" : "";
  }
}

function updateDependentSectionsEnabled() {
  const on = state.started;
  Util.qs("#member-name-input").disabled = !on;
  Util.qs("#btn-add-member").disabled = !on;
}

function syncPrimaryActionState() {
  const addMemberBtn = Util.qs("#btn-toggle-member-add");
  if (!addMemberBtn) return;
  const membersFirst = state.started && state.members.length === 0;
  addMemberBtn.classList.toggle("btn-primary", membersFirst);
  addMemberBtn.classList.toggle("btn-outline-member", !membersFirst);
}

function syncAppPageMode() {
  const page = Util.qs("#app-page");
  if (page) page.classList.toggle("is-trip-started", state.started);
}

function renderHeaderSummary() {
  const barTitle = Util.qs("#bar-trip-title");
  const totalEl = Util.qs("#summary-total-expenses");
  const countEl = Util.qs("#summary-member-count");
  if (!totalEl || !countEl) return;

  if (barTitle) {
    barTitle.textContent = state.started && state.tripName ? state.tripName : "";
  }

  const total = state.expenses.reduce((sum, e) => Util.round2(sum + e.amount), 0);
  totalEl.textContent = Util.formatMoney(total);

  countEl.textContent = String(state.members.length);
}

function renderMemberList() {
  const chips = Util.qs("#member-chips");
  const empty = Util.qs("#member-list-empty");
  if (!chips || !empty) return;
  chips.innerHTML = "";
  if (state.members.length === 0) {
    empty.innerHTML = "<strong>No members yet</strong><span>Add people to start splitting</span>";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  const { net } = Settlement.computeBalances();
  state.members.forEach((m) => {
    const span = document.createElement("span");
    span.className = "member-chip";
    const balance = Util.round2(net[m.id] || 0);
    const label = m.name;
    const balanceText =
      Math.abs(balance) > EPS ? ` ${balance > 0 ? "+" : "-"}₹${Util.formatMoney(Math.abs(balance))}` : "";
    span.innerHTML = `${Member.buildAvatarHtml(m.id, "member-chip__avatar")}<span>${Util.escapeHtml(label)}</span>${
      balanceText ? `<small>${Util.escapeHtml(balanceText)}</small>` : ""
    }`;
    chips.appendChild(span);
  });
}

/**
 * Rebuilds payer select and participant checkboxes.
 * @param {object} [opts]
 * @param {string[]} [opts.selectParticipantIds] — if set, only these members are checked.
 * @param {string} [opts.payerId] — after rebuild, select this payer if they exist in `state.members`.
 */
Expense.split.renderPayerAndParticipants = function renderPayerAndParticipants(opts) {
  const payerSel = Util.qs("#expense-payer");
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

  const box = Util.qs("#participant-checkboxes");
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

  Util.qsa("#participant-checkboxes input[type=checkbox]").forEach((cb) => {
    if (selectIds) {
      cb.checked = selectIds.includes(cb.value);
    } else {
      cb.checked = true;
    }
  });
  Expense.split.syncParticipantSelectAllCheckbox();

  Util.qsa("#participant-checkboxes input[type=checkbox]").forEach((cb) => {
    cb.addEventListener("change", Expense.split.onParticipantMemberCheckboxChange);
  });
};

/**
 * Renders share / percentage / custom inputs for checked participants.
 * @param {Record<string, number>|null|undefined} [prefillSplitDetails] — when provided, fills inputs from these values (e.g. opening edit).
 */
Expense.split.renderSplitFields = function renderSplitFields(prefillSplitDetails) {
  const container = Util.qs("#split-fields");
  const method = Util.qs("#split-method").value;
  const participantIds = Expense.split.getCheckedParticipantIds();

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
      const name = Member.getName(id);
      if (method === "shares") {
        return `
        <div class="split-row">
          <label for="split-share-${id}">Shares for ${name}</label>
          <input type="text" inputmode="decimal" id="split-share-${id}" placeholder="e.g. 1" />
        </div>`;
      }
      if (method === "percentage") {
        return `
        <div class="split-row">
          <label for="split-pct-${id}">% for ${name}</label>
          <input type="text" inputmode="decimal" id="split-pct-${id}" placeholder="%" />
        </div>`;
      }
      if (method === "custom") {
        return `
        <div class="split-row">
          <label for="split-custom-${id}">Amount owed by ${name}</label>
          <input type="text" inputmode="decimal" id="split-custom-${id}" placeholder="0.00" />
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
      const el = Util.qs(`#split-share-${id}`);
      if (el) el.value = String(n);
    } else if (method === "percentage") {
      const el = Util.qs(`#split-pct-${id}`);
      if (el) el.value = String(n);
    } else if (method === "custom") {
      const el = Util.qs(`#split-custom-${id}`);
      if (el) el.value = Util.formatMoney(n);
    }
  }
};

function buildPrintExpenseSplitTableHtml(e) {
  const owed = Expense.split.computeOwedForExpense(e);
  const details = e.splitDetails || {};
  const method = e.splitMethod;
  const n = e.participantIds.length;
  const cellRupee = (amt) => `₹${Util.escapeHtml(Util.formatMoney(amt))}`;

  const body = e.participantIds
    .map((id) => {
      const name = Util.escapeHtml(Member.getName(id));
      const raw = owed[id];
      const amt = raw != null ? raw : 0;
      let mid = "—";
      if (method === "equal") {
        mid = Util.escapeHtml(n > 0 ? `Equal (1/${n})` : "Equal");
      } else if (method === "custom") {
        mid = Util.escapeHtml("As specified");
      } else if (method === "shares") {
        mid = Util.escapeHtml(Util.formatShareCountPhrase(details[id]));
      } else if (method === "percentage") {
        mid = Util.escapeHtml(Util.formatPctForSplitDisplay(details[id]));
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
  const owed = Expense.split.computeOwedForExpense(e);
  const details = e.splitDetails || {};
  const method = e.splitMethod;
  const dot = '<span class="expense-card__split-dot" aria-hidden="true"> · </span>';
  const pipe = '<span class="expense-card__split-pipe" aria-hidden="true"> | </span>';
  return e.participantIds
    .map((id, i) => {
      const name = Util.escapeHtml(Member.getName(id));
      const avatar = Member.buildAvatarHtml(id, "expense-card__split-avatar");
      const rawOwed = owed[id];
      const amt = rawOwed != null ? rawOwed : 0;
      const money = `<span class="expense-card__split-amt">₹${Util.escapeHtml(Util.formatMoney(amt))}</span>`;
      let chunk;
      if (method === "shares") {
        const sharePhrase = Util.escapeHtml(Util.formatShareCountPhrase(details[id]));
        chunk = `<span class="expense-card__split-chunk">${avatar}<span class="expense-card__split-name">${name}</span>${dot}<span class="expense-card__split-detail">${sharePhrase}</span>${dot}${money}</span>`;
      } else if (method === "percentage") {
        const pct = Util.escapeHtml(Util.formatPctForSplitDisplay(details[id]));
        chunk = `<span class="expense-card__split-chunk">${avatar}<span class="expense-card__split-name">${name}</span>${dot}<span class="expense-card__split-detail">${pct}</span>${dot}${money}</span>`;
      } else {
        chunk = `<span class="expense-card__split-chunk">${avatar}<span class="expense-card__split-name">${name}</span>${dot}${money}</span>`;
      }
      if (i === 0) return chunk;
      return `<span class="expense-card__split-cell">${pipe}${chunk}</span>`;
    })
    .join("");
}

Expense.renderList = function renderList() {
  const wrap = Util.qs("#expense-list-container");
  if (state.expenses.length === 0) {
    const canAdd = state.started && state.members.length > 0;
    const hint = canAdd ? "" : "Add members first to split expenses";
    const mutedClass = canAdd ? "" : " expense-empty--muted";
    wrap.innerHTML = `
      <div class="expense-empty${mutedClass}">
        <div class="empty-state-icon" aria-hidden="true">${Util.iconSvg("receipt")}</div>
        <p class="expense-empty__title">No expenses yet</p>
        ${hint ? `<p class="expense-empty__hint">${Util.escapeHtml(hint)}</p>` : ""}
      </div>`;
    return;
  }

  const cards = state.expenses
    .map((e) => {
      const payer = Member.getName(e.paidById);
      const splitInline = buildExpenseSplitInlineHtml(e);
      const splitSummary = buildExpenseSplitSummaryText(e);
      return `
      <li class="expense-card" data-expense-id="${Util.escapeHtml(e.id)}">
        <div class="expense-card__top">
          <div class="expense-card__heading">
            <span class="expense-card__title">${Util.escapeHtml(e.title)}</span>
            <span class="expense-card__paid">Paid by <strong>${Util.escapeHtml(payer)}</strong></span>
          </div>
          <span class="expense-card__amount">₹${Util.escapeHtml(Util.formatMoney(e.amount))}</span>
          <div class="expense-card__actions" aria-label="Expense actions">
            <button type="button" class="btn btn-ghost btn-compact expense-card__edit" aria-label="Edit ${Util.escapeHtml(
              e.title,
            )}">
              ${Util.iconSvg("edit")}
              Edit
            </button>
            <button type="button" class="btn btn-ghost btn-compact expense-card__delete" aria-label="Delete ${Util.escapeHtml(
              e.title,
            )}">
              ${Util.iconSvg("trash")}
              Delete
            </button>
          </div>
        </div>
        <p class="expense-card__meta">
          <span>${Util.escapeHtml(splitSummary)}</span>
          <span class="method-badge">${Util.escapeHtml(Expense.split.methodLabel(e.splitMethod))}</span>
        </p>
        <details class="expense-card__split" role="region" aria-label="Split for ${Util.escapeHtml(e.title)}">
          <summary>${Util.iconSvg("chevronDown", "details-chevron")}<span>Show split details</span></summary>
          <p class="expense-card__split-inline">${splitInline}</p>
        </details>
      </li>`;
    })
    .join("");

  wrap.innerHTML = `<ul class="expense-cards">${cards}</ul>`;
};

/** Right sidebar: concise outcome first, with member detail only on demand. */
function renderSettlementPanel() {
  const balanceWrap = Util.qs("#balances-container");
  const hintSettle = Util.qs("#hint-settle");
  const panel = Util.qs(".panel-settlement-unified");

  if (!balanceWrap) return;

  if (panel) {
    panel.classList.toggle("panel-settlement-unified--ghost", state.expenses.length === 0);
  }

  if (state.expenses.length === 0) {
    if (hintSettle) hintSettle.textContent = "";
    balanceWrap.innerHTML = '<p class="empty-panel empty-panel--ghost">No balances yet</p>';
    return;
  }

  const { paid, owed, net } = Settlement.computeBalances();
  const simplify = isSimplifyDebtEnabled();
  const txs = state.expenses.length > 0 && simplify ? Settlement.simplify(net) : [];
  const directRows = state.expenses.length > 0 && !simplify ? Settlement.computeDirectDebts() : [];
  const transfers = simplify ? txs : directRows.map((row) => ({ from: row.from, to: row.to, amount: row.amount }));

  if (hintSettle) {
    hintSettle.textContent = simplify ? "Simplified balances" : "Expense-wise balances";
  }

  const paymentCount = transfers.length;
  const paymentCountText = `${paymentCount} ${paymentCount === 1 ? "payment" : "payments"} needed to settle`;
  const summaryText = paymentCount === 0 ? "All settled" : paymentCountText;
  const summaryTone = paymentCount === 0 ? "settlement-summary--settled" : "settlement-summary--neutral";
  const summarySubText = paymentCount === 0 ? "No one owes anything" : "Based on current expenses";
  const paymentLines = buildSettlementPaymentLines(transfers);
  const paymentsHtml =
    paymentLines.length > 0
      ? `<ul class="settlement-payments">${paymentLines
          .map((line) => `<li class="settlement-payment">${line}</li>`)
          .join("")}</ul>`
      : `<div class="settlement-all-settled">
          <div class="empty-state-icon empty-state-icon--settled">${Util.iconSvg("checkCircle")}</div>
          <p class="settlement-all-settled__title">All settled</p>
          <p class="settlement-all-settled__hint">No one owes anything</p>
        </div>`;

  const detailRows = state.members
    .filter((m) => Math.abs(net[m.id]) > EPS)
    .map((m) => {
      const n = net[m.id];
      const tone =
        n > EPS ? "settlement-balance-row--receive" : n < -EPS ? "settlement-balance-row--owe" : "settlement-balance-row--even";
      let netLine;
      if (n > EPS) {
        netLine = `Receives ${formatSettlementRupeeHtml(n)}`;
      } else if (n < -EPS) {
        netLine = `Owes ${formatSettlementRupeeHtml(Util.round2(-n))}`;
      } else {
        netLine = `Even ${formatSettlementRupeeHtml(n)}`;
      }

      const paidShare = `Paid ${formatSettlementRupeeHtml(paid[m.id])} · Share ${formatSettlementRupeeHtml(owed[m.id])}`;

      return `<div class="settlement-balance-row ${tone}">
  <div class="settlement-balance-row__name">${Member.buildAvatarHtml(
    m.id,
    "settlement-balance-row__avatar",
  )}<span>${Util.escapeHtml(Member.getName(m.id))}</span></div>
  <div class="settlement-balance-row__netline">${netLine}</div>
  <div class="settlement-balance-row__detail">${paidShare}</div>
</div>`;
    })
    .join("");

  const detailHtml = detailRows
    ? `<details class="settlement-detail">
        <summary>${Util.iconSvg("chevronDown", "details-chevron")}<span>Member balance details</span></summary>
        <div class="settlement-balance-rows">${detailRows}</div>
      </details>`
    : "";

  balanceWrap.innerHTML = `
    <div class="settlement-summary ${summaryTone}">
      <div class="settlement-summary__main">${summaryText}</div>
      <div class="settlement-summary__sub">${Util.escapeHtml(summarySubText)}</div>
    </div>
    ${paymentsHtml}
    ${detailHtml}`;
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
  return `₹${Util.escapeHtml(Util.formatMoney(n))}`;
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
    } else if (
      Math.abs(v - bestAmt) <= EPS &&
      Member.getName(m.id).localeCompare(Member.getName(bestId)) < 0
    ) {
      bestId = m.id;
    }
  }
  return bestId;
}

function buildSimplifiedSettlementTableHtml(net) {
  const txs = Settlement.simplify(net);
  if (txs.length === 0) {
    return "<p class=\"print-settled-msg\"><strong>All settled.</strong> No payments are required between members.</p>";
  }
  const rows = txs
    .map((t) => {
      const from = Util.escapeHtml(Member.getName(t.from));
      const to = Util.escapeHtml(Member.getName(t.to));
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
  const rows = Settlement.computeDirectDebts();
  if (rows.length === 0) {
    return "<p class=\"print-settled-msg\"><strong>All settled.</strong> No per-expense reimbursements are listed.</p>";
  }
  const trs = rows
    .map((r) => {
      const title = Util.escapeHtml(r.expenseTitle);
      const from = Util.escapeHtml(Member.getName(r.from));
      const to = Util.escapeHtml(Member.getName(r.to));
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
  const r = receivers.length ? Util.escapeHtml(receivers.join(", ")) : "<em>none</em>";
  const o = owers.length ? Util.escapeHtml(owers.join(", ")) : "<em>none</em>";
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
<td>${Util.escapeHtml(m.name)}</td>
<td class="num">${formatReportRupeeHtml(paid[m.id])}</td>
<td class="num">${formatReportRupeeHtml(owed[m.id])}</td>
<td class="num">${formatReportRupeeHtml(n)}</td>
<td class="${statusClass}">${Util.escapeHtml(statusText)}</td>
</tr>`;
    })
    .join("");
}

function buildDetailedMemberOverviewTableHtml(paid, owed, net) {
  const rows = state.members
    .map((m) => {
      const count = state.expenses.filter((e) => e.participantIds.includes(m.id)).length;
      return `<tr>
<td>${Util.escapeHtml(m.name)}</td>
<td class="num">${formatReportRupeeHtml(paid[m.id])}</td>
<td class="num">${formatReportRupeeHtml(owed[m.id])}</td>
<td class="num">${formatReportRupeeHtml(net[m.id])}</td>
<td class="num">${Util.escapeHtml(String(count))}</td>
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
  const { paid, owed, net } = Settlement.computeBalances();
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
                const shares = Expense.split.computeOwedForExpense(e);
                const my = shares[m.id] != null ? shares[m.id] : 0;
                return `<tr>
<td>${Util.escapeHtml(e.title)}</td>
<td>${Util.escapeHtml(Member.getName(e.paidById))}</td>
<td class="num">${formatReportRupeeHtml(e.amount)}</td>
<td class="num">${formatReportRupeeHtml(my)}</td>
</tr>`;
              })
              .join("")}</tbody>
</table>`;
      return `<div class="print-user-block print-appendix-member">
<h3 class="print-h3">${Util.escapeHtml(m.name)}</h3>
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
    const { paid, owed, net } = Settlement.computeBalances();
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
  const detailedEl = Util.qs("#report-detailed");
  const includeDetailed = Boolean(detailedEl && detailedEl.checked);
  const simplifyDebt = isSimplifyDebtEnabled();

  const tripTitle =
    state.started && state.tripName && state.tripName.trim()
      ? Util.escapeHtml(state.tripName.trim())
      : Util.escapeHtml("Untitled trip");
  const generated = Util.escapeHtml(formatReportGeneratedAt());
  const totalTripCost = Util.round2(state.expenses.reduce((sum, e) => Util.round2(sum + e.amount), 0));
  const memberCount = state.members.length;
  const expenseCount = state.expenses.length;

  const { paid, owed, net } = Settlement.computeBalances();
  const txs =
    simplifyDebt && state.members.length > 0 && state.expenses.length > 0 ? Settlement.simplify(net) : [];
  const directDebtRows =
    !simplifyDebt && state.members.length > 0 && state.expenses.length > 0 ? Settlement.computeDirectDebts() : [];
  const totalToSettle = simplifyDebt
    ? txs.length === 0
      ? 0
      : Util.round2(txs.reduce((s, t) => Util.round2(s + t.amount), 0))
    : directDebtRows.length === 0
      ? 0
      : Util.round2(directDebtRows.reduce((s, r) => Util.round2(s + r.amount), 0));

  const settlementLead = simplifyDebt
    ? "Who should pay whom? Use the transfers below to settle up."
    : "Each row is one participant’s share owed to whoever paid for that expense (expense-wise view; not consolidated).";

  const totalSettleRowLabel = simplifyDebt ? "Total amount to settle" : "Total of listed reimbursements";

  const highestId = computeHighestPayerId(paid);
  const highestLine =
    highestId && (paid[highestId] || 0) > EPS
      ? `${Util.escapeHtml(Member.getName(highestId))} (${formatReportRupeeHtml(paid[highestId])})`
      : expenseCount === 0
        ? "— (no expenses yet)"
        : "—";

  const expenseDetailBlocks =
    state.expenses.length === 0
      ? "<p class=\"print-muted\">No expenses recorded.</p>"
      : state.expenses
          .map((e) => {
            const payer = Util.escapeHtml(Member.getName(e.paidById));
            const participants = e.participantIds.map((id) => Util.escapeHtml(Member.getName(id))).join(", ");
            const splitTable = buildPrintExpenseSplitTableHtml(e);
            return `<div class="print-expense-block">
<h3 class="print-h3">${Util.escapeHtml(e.title)}</h3>
<dl class="print-expense-dl">
<div><dt>Paid by</dt><dd>${payer}</dd></div>
<div><dt>Total</dt><dd>${formatReportRupeeHtml(e.amount)}</dd></div>
<div><dt>Split type</dt><dd>${Util.escapeHtml(Expense.split.methodLabel(e.splitMethod))}</dd></div>
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
          <div><dt>Members</dt><dd><strong>${Util.escapeHtml(String(memberCount))}</strong></dd></div>
        </dl>
      </header>

      <section class="print-section print-section--tight">
        <h2 class="print-h2">Executive summary</h2>
        <table class="print-table print-table--kv">
          <tbody>
            <tr><th scope="row">Total trip cost</th><td class="num">${formatReportRupeeHtml(totalTripCost)}</td></tr>
            <tr><th scope="row">Total members</th><td>${Util.escapeHtml(String(memberCount))}</td></tr>
            <tr><th scope="row">Number of expenses</th><td>${Util.escapeHtml(String(expenseCount))}</td></tr>
            <tr><th scope="row">Highest payer</th><td>${highestLine}</td></tr>
            <tr><th scope="row">${Util.escapeHtml(totalSettleRowLabel)}</th><td class="num"><strong>${formatReportRupeeHtml(totalToSettle)}</strong></td></tr>
          </tbody>
        </table>
        <p class="print-lede">${buildExecutiveSummaryLine(net)}</p>
      </section>

      <section class="print-section">
        <h2 class="print-h2">Settlement summary</h2>
        <p class="print-section__lead">${Util.escapeHtml(settlementLead)}</p>
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
  const root = Util.qs("#print-report");
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
  const btn = Util.qs("#btn-export-pdf");
  if (btn) btn.disabled = !state.started;
}

Expense.modal.isOpen = function isOpen() {
  const modal = Util.qs("#expense-modal");
  return Boolean(modal && modal.classList.contains("is-open"));
};

Expense.modal.setMode = function setMode(isEdit) {
  const heading = Util.qs("#modal-expense-heading");
  const submitBtn = Util.qs("#btn-add-expense");
  if (heading) heading.textContent = isEdit ? "Edit expense" : "Add expense";
  if (submitBtn) submitBtn.textContent = isEdit ? "Save changes" : "Save expense";
};

Expense.modal.clearForm = function clearForm() {
  const titleEl = Util.qs("#expense-title");
  const amtEl = Util.qs("#expense-amount");
  const payerEl = Util.qs("#expense-payer");
  const aiEl = Util.qs("#expense-ai-input");
  if (titleEl) titleEl.value = "";
  if (amtEl) amtEl.value = "";
  if (payerEl) payerEl.value = "";
  if (aiEl) aiEl.value = "";
};

/** Modal body keeps scroll position across opens; reset so the AI block stays visible. */
Expense.modal.resetBodyScroll = function resetBodyScroll() {
  const body = Util.qs("#expense-modal .modal-body");
  if (body) body.scrollTop = 0;
};

/**
 * Add flow only: switch between manual and AI-assisted panels. No-op while editing an expense.
 * @param {"manual"|"ai"} mode
 */
Expense.modal.setEntryMode = function setEntryMode(mode) {
  if (editingExpenseId) return;
  const form = Util.qs("#expense-form");
  if (!form) return;

  const next = mode === "ai" ? "ai" : "manual";
  if (next === "ai" && expenseEntryMode !== "ai") {
    const aiEl = Util.qs("#expense-ai-input");
    if (aiEl) aiEl.value = "";
  }
  expenseEntryMode = next;
  form.classList.remove("expense-form--entry-manual", "expense-form--entry-ai");
  form.classList.add(next === "ai" ? "expense-form--entry-ai" : "expense-form--entry-manual");

  const tabManual = Util.qs("#tab-expense-entry-manual");
  const tabAi = Util.qs("#tab-expense-entry-ai");
  const isManual = next === "manual";
  if (tabManual) {
    tabManual.setAttribute("aria-selected", isManual ? "true" : "false");
    tabManual.tabIndex = isManual ? 0 : -1;
  }
  if (tabAi) {
    tabAi.setAttribute("aria-selected", isManual ? "false" : "true");
    tabAi.tabIndex = isManual ? -1 : 0;
  }

  syncExpenseFormUi();
};

Expense.modal.open = function open() {
  const modal = Util.qs("#expense-modal");
  const openBtn = Util.qs("#btn-open-expense-modal");
  if (!modal || !openBtn || openBtn.disabled) return;
  editingExpenseId = null;
  const form = Util.qs("#expense-form");
  if (form) {
    form.classList.remove("expense-form--editing");
  }
  Expense.modal.setMode(false);
  Expense.modal.clearForm();
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  Expense.split.renderPayerAndParticipants();
  Expense.modal.setEntryMode("ai");
  Expense.split.renderSplitFields();
  Util.setMessage(Util.qs("#expense-message"), "");
  Expense.modal.resetBodyScroll();
  const aiInput = Util.qs("#expense-ai-input");
  if (aiInput && !aiInput.disabled) {
    aiInput.focus();
  }
};

Expense.modal.openForEdit = function openForEdit(expenseId) {
  const modal = Util.qs("#expense-modal");
  const e = state.expenses.find((x) => x.id === expenseId);
  if (!modal || !e) return;
  if (!state.started || state.members.length === 0) return;

  editingExpenseId = expenseId;
  const form = Util.qs("#expense-form");
  if (form) {
    form.classList.add("expense-form--editing");
    form.classList.remove("expense-form--entry-ai");
    form.classList.add("expense-form--entry-manual");
  }
  expenseEntryMode = "manual";
  Expense.modal.setMode(true);
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";

  Util.qs("#expense-title").value = e.title;
  Util.qs("#expense-amount").value = Util.formatMoney(e.amount);
  const aiClear = Util.qs("#expense-ai-input");
  if (aiClear) aiClear.value = "";

  Expense.split.renderPayerAndParticipants({
    selectParticipantIds: e.participantIds,
    payerId: e.paidById,
  });
  Util.qs("#split-method").value = e.splitMethod;
  syncExpenseFormUi();
  const prefill = e.splitMethod === "equal" ? null : { ...(e.splitDetails || {}) };
  Expense.split.renderSplitFields(prefill);
  Util.setMessage(Util.qs("#expense-message"), "");
  Expense.modal.resetBodyScroll();
  const titleInput = Util.qs("#expense-title");
  if (titleInput && !titleInput.disabled) {
    titleInput.focus();
  }
};

Expense.modal.close = function close() {
  const modal = Util.qs("#expense-modal");
  if (!modal) return;
  Expense.modal.resetBodyScroll();
  modal.classList.remove("is-open");
  modal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  editingExpenseId = null;
  const form = Util.qs("#expense-form");
  if (form) form.classList.remove("expense-form--editing");
  Expense.modal.setMode(false);
  Expense.modal.clearForm();
  Expense.modal.setEntryMode("ai");
  Util.setMessage(Util.qs("#expense-message"), "");
};

function renderAll() {
  syncAppPageMode();
  updateTripSectionDisabled();
  updateDependentSectionsEnabled();
  syncPrimaryActionState();
  syncExportPdfButton();
  renderHeaderSummary();
  renderMemberList();
  if (!Expense.modal.isOpen()) {
    Expense.split.renderPayerAndParticipants();
    Expense.split.renderSplitFields();
  }
  syncExpenseFormUi();
  Expense.renderList();
  renderSettlementPanel();
}

// --- Events ---
function onStartTrip() {
  const msg = Util.qs("#trip-message");
  Util.setMessage(msg, "");
  const v = validateStartTrip(Util.qs("#trip-name-input").value);
  if (!v.ok) {
    Util.setMessage(msg, v.errors[0]);
    return;
  }
  state.tripName = v.tripName;
  state.started = true;
  renderAll();
  Trip.save();
}

function focusMemberNameInput() {
  const input = Util.qs("#member-name-input");
  if (!input || input.disabled) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      input.focus();
    });
  });
}

function onAddMember() {
  const msg = Util.qs("#member-message");
  Util.setMessage(msg, "");
  const v = validateMemberName(Util.qs("#member-name-input").value);
  if (!v.ok) {
    Util.setMessage(msg, v.errors[0]);
    focusMemberNameInput();
    return;
  }
  state.members.push({ id: Util.generateId(), name: v.name });
  Util.qs("#member-name-input").value = "";
  renderAll();
  Trip.save();
  focusMemberNameInput();
}

function onMemberNameInputKeydown(ev) {
  const key = ev && ev.key;
  const code = ev && ev.code;
  if (!(key === "Enter" || key === "Return" || code === "NumpadEnter")) return;
  ev.preventDefault();
  Member.add();
}

function onAddExpense(ev) {
  ev.preventDefault();
  const msg = Util.qs("#expense-message");
  Util.setMessage(msg, "");

  const draft = Expense.readDraftFromForm();
  draft.amount = Number(draft.amount);
  const v = validateExpenseDraft(draft);
  if (!v.ok) {
    Util.setMessage(msg, v.errors[0]);
    return;
  }

  const expensePayload = {
    title: draft.title.trim(),
    amount: Util.round2(draft.amount),
    paidById: draft.paidById,
    participantIds: draft.participantIds.slice(),
    splitMethod: draft.splitMethod,
    splitDetails:
      draft.splitMethod === "equal"
        ? {}
        : Object.fromEntries(
            draft.participantIds.map((id) => [id, Util.round2(Number(draft.splitDetails[id]))]),
          ),
  };

  const editId = editingExpenseId;
  if (editId) {
    const idx = state.expenses.findIndex((x) => x.id === editId);
    if (idx === -1) {
      Util.setMessage(msg, "That expense is no longer in the list.");
      return;
    }
    state.expenses[idx] = {
      id: editId,
      ...expensePayload,
    };
  } else {
    state.expenses.push({
      id: Util.generateId(),
      ...expensePayload,
    });
  }

  Expense.modal.close();
  renderAll();
  Trip.save();
}

function onResetTrip() {
  if (
    !window.confirm(
      "Clear all trip data from this browser? This cannot be undone.",
    )
  ) {
    return;
  }
  Trip.resetState();
}

function onDeleteExpense(expenseId) {
  const idx = state.expenses.findIndex((x) => x.id === expenseId);
  if (idx === -1) return;

  const expense = state.expenses[idx];
  if (!window.confirm(`Delete "${expense.title}"? This cannot be undone.`)) {
    return;
  }

  state.expenses.splice(idx, 1);
  renderAll();
  Trip.save();
}

// --- Domain-first namespaces (preferred public API) ---
Member.add = onAddMember;
Member.onNameKeydown = onMemberNameInputKeydown;
Expense.addOrUpdateFromForm = onAddExpense;
Expense.delete = onDeleteExpense;
Settlement.renderPanel = renderSettlementPanel;

// Convenience for debugging in DevTools / future extraction.
window.App = App;
window.Trip = Trip;
window.Member = Member;
window.Expense = Expense;
window.Settlement = Settlement;
window.Util = Util;

document.addEventListener("DOMContentLoaded", () => {
  Trip.load();

  const simplifyDebtEl = Util.qs("#simplify-debt");
  if (simplifyDebtEl) {
    simplifyDebtEl.checked = Settlement.loadSimplifyDebtPreference();
    simplifyDebtEl.addEventListener("change", () => {
      Settlement.saveSimplifyDebtPreference(simplifyDebtEl.checked);
      Settlement.renderPanel();
    });
  }

  Util.qs("#btn-start-trip").addEventListener("click", Trip.start);
  Util.qs("#btn-add-member").addEventListener("click", Member.add);
  const memberNameInput = Util.qs("#member-name-input");
  if (memberNameInput) {
    memberNameInput.addEventListener("keydown", Member.onNameKeydown);
  }
  Util.qs("#expense-form").addEventListener("submit", Expense.addOrUpdateFromForm);
  const expenseAiParse = Util.qs("#btn-expense-ai-parse");
  if (expenseAiParse) {
    expenseAiParse.addEventListener("click", () => {
      Expense.ai.onParseClick();
    });
  }
  const tabEntryManual = Util.qs("#tab-expense-entry-manual");
  const tabEntryAi = Util.qs("#tab-expense-entry-ai");
  if (tabEntryManual) {
    tabEntryManual.addEventListener("click", () => {
      Expense.modal.setEntryMode("manual");
      const el = Util.qs("#expense-title");
      if (el && !el.disabled) el.focus();
    });
  }
  if (tabEntryAi) {
    tabEntryAi.addEventListener("click", () => {
      Expense.modal.setEntryMode("ai");
      const el = Util.qs("#expense-ai-input");
      if (el && !el.disabled) el.focus();
    });
  }
  Util.qs("#split-method").addEventListener("change", () => {
    Expense.split.renderSplitFields();
  });

  const selectAllParticipants = Util.qs("#participant-select-all");
  if (selectAllParticipants) {
    selectAllParticipants.addEventListener("change", Expense.split.onSelectAllToggle);
  }
  Util.qs("#expense-payer").addEventListener("change", () => {
    Expense.split.syncSelectAll();
    Expense.split.renderSplitFields();
  });

  const toggleMemberAdd = Util.qs("#btn-toggle-member-add");
  if (toggleMemberAdd) {
    toggleMemberAdd.addEventListener("click", () => {
      const row = Util.qs("#member-add-inline");
      if (!row) return;
      row.classList.toggle("hidden");
      const open = !row.classList.contains("hidden");
      toggleMemberAdd.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) {
        const input = Util.qs("#member-name-input");
        if (input && !input.disabled) input.focus();
      }
    });
    toggleMemberAdd.setAttribute("aria-expanded", "false");
    toggleMemberAdd.setAttribute("aria-controls", "member-add-inline");
  }

  Util.qs("#btn-open-expense-modal").addEventListener("click", Expense.modal.open);
  Util.qs("#btn-close-expense-modal").addEventListener("click", Expense.modal.close);
  const cancelModal = Util.qs("#btn-cancel-expense-modal");
  if (cancelModal) cancelModal.addEventListener("click", Expense.modal.close);
  Util.qs("#expense-modal-backdrop").addEventListener("click", Expense.modal.close);

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && Expense.modal.isOpen()) {
      Expense.modal.close();
      Trip.renderAll();
    }
  });

  const exportPdf = Util.qs("#btn-export-pdf");
  if (exportPdf) exportPdf.addEventListener("click", onExportPdf);

  const resetTrip = Util.qs("#btn-reset-trip");
  if (resetTrip) resetTrip.addEventListener("click", Trip.reset);

  const expensesPanel = Util.qs(".panel-expenses-main");
  if (expensesPanel) {
    expensesPanel.addEventListener("click", (ev) => {
      const emptyAdd = ev.target && ev.target.closest && ev.target.closest("#btn-empty-add-expense");
      if (emptyAdd) {
        Expense.modal.open();
        return;
      }
      const editBtn = ev.target && ev.target.closest && ev.target.closest(".expense-card__edit");
      if (editBtn) {
        const card = editBtn.closest(".expense-card");
        const id = card && card.dataset ? card.dataset.expenseId : null;
        if (id) Expense.modal.openForEdit(id);
        return;
      }
      const deleteBtn = ev.target && ev.target.closest && ev.target.closest(".expense-card__delete");
      if (deleteBtn) {
        const card = deleteBtn.closest(".expense-card");
        const id = card && card.dataset ? card.dataset.expenseId : null;
        if (id) Expense.delete(id);
        return;
      }
    });
  }

  Trip.renderAll();
});
