// Business logic for expense claims: validation, policy checks, approvals,
// history and summaries. All rule-based: no AI.

import { listExpenses, getExpense, insertExpense, patchExpense } from "./store.js";

export const CATEGORIES = [
  "Travel",
  "Accommodation",
  "Meals",
  "Client Entertainment",
  "Fuel",
  "Software",
  "Office Supplies",
  "Other",
];

// Per-claim policy limits in INR. Claims above the limit are flagged for review.
export const POLICY_LIMITS = {
  Travel: 15000,
  Accommodation: 8000,
  Meals: 2000,
  "Client Entertainment": 5000,
  Fuel: 5000,
  Software: 10000,
  "Office Supplies": 5000,
  Other: 3000,
};

const MAX_AGE_DAYS = 60;
const EDITABLE = ["employee_name", "merchant", "amount", "currency", "expense_date", "category", "description", "payment_method"];

function cleanCategory(c) {
  if (!c) return "Other";
  const hit = CATEGORIES.find((x) => x.toLowerCase() === String(c).trim().toLowerCase());
  return hit || "Other";
}

function validate(fields, { partial = false } = {}) {
  const out = {};
  const errors = [];
  const need = (k) => !partial || k in fields;

  if (need("employee_name")) {
    const v = String(fields.employee_name ?? "").trim();
    if (!v) errors.push("employee_name is required");
    out.employee_name = v;
  }
  if (need("merchant")) {
    const v = String(fields.merchant ?? "").trim();
    if (!v) errors.push("merchant is required");
    out.merchant = v;
  }
  if (need("amount")) {
    const v = Number(fields.amount);
    if (!Number.isFinite(v) || v <= 0) errors.push("amount must be a positive number");
    out.amount = Math.round(v * 100) / 100;
  }
  if (need("expense_date")) {
    const v = String(fields.expense_date ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) errors.push("expense_date must be YYYY-MM-DD");
    out.expense_date = v;
  }
  if ("currency" in fields || !partial) out.currency = String(fields.currency || "INR").trim().toUpperCase().slice(0, 3);
  if ("category" in fields || !partial) out.category = cleanCategory(fields.category);
  if ("description" in fields) out.description = String(fields.description ?? "").trim();
  if ("payment_method" in fields) out.payment_method = String(fields.payment_method ?? "").trim();

  return { out, errors };
}

// Policy flags are computed fresh every time, so editing a claim updates its flags.
export function computeFlags(e, all) {
  const flags = [];
  const limit = POLICY_LIMITS[e.category] ?? POLICY_LIMITS.Other;
  if (e.currency === "INR" && e.amount > limit) {
    flags.push(`Over ${e.category} limit of ₹${limit.toLocaleString("en-IN")}`);
  }
  const ageDays = (Date.now() - Date.parse(e.expense_date)) / 86400000;
  if (ageDays > MAX_AGE_DAYS) flags.push(`Older than ${MAX_AGE_DAYS} days`);
  if (ageDays < -1) flags.push("Date is in the future");
  const dup = all.find(
    (o) =>
      o.id !== e.id &&
      o.status !== "rejected" &&
      o.merchant.trim().toLowerCase() === e.merchant.trim().toLowerCase() &&
      Number(o.amount) === Number(e.amount) &&
      o.expense_date === e.expense_date
  );
  if (dup) flags.push("Possible duplicate claim");
  if (!e.description) flags.push("No business purpose given");
  return flags;
}

function withFlags(e, all) {
  return { ...e, amount: Number(e.amount), flags: computeFlags({ ...e, amount: Number(e.amount) }, all) };
}

export async function getAll({ status, employee } = {}) {
  const all = (await listExpenses()).map((e) => ({ ...e, amount: Number(e.amount) }));
  let rows = all.map((e) => withFlags(e, all));
  if (status && status !== "all") rows = rows.filter((e) => e.status === status);
  if (employee) rows = rows.filter((e) => e.employee_name.toLowerCase().includes(String(employee).toLowerCase()));
  return rows;
}

export async function getOne(id) {
  const e = await getExpense(id);
  if (!e) return null;
  const all = (await listExpenses()).map((x) => ({ ...x, amount: Number(x.amount) }));
  return withFlags({ ...e, amount: Number(e.amount) }, all);
}

export async function createExpense(fields, source = "claude") {
  const { out, errors } = validate(fields);
  if (errors.length) throw new Error(errors.join("; "));
  const created = await insertExpense({
    ...out,
    description: out.description || "",
    payment_method: out.payment_method || "",
    status: "pending",
    source,
    review_note: "",
    history: [{ at: new Date().toISOString(), action: source === "claude" ? "Submitted via Claude" : "Submitted in app" }],
  });
  return getOne(created.id);
}

export async function updateExpense(id, fields, by = "app") {
  const current = await getExpense(id);
  if (!current) throw new Error("Claim not found");
  if (current.status !== "pending") throw new Error(`Claim is already ${current.status} and can no longer be edited`);
  const picked = Object.fromEntries(Object.entries(fields).filter(([k]) => EDITABLE.includes(k)));
  const { out, errors } = validate(picked, { partial: true });
  if (errors.length) throw new Error(errors.join("; "));
  const changed = Object.keys(out).filter((k) => String(out[k]) !== String(current[k]));
  if (!changed.length) return getOne(id);
  const history = [...(current.history || []), { at: new Date().toISOString(), action: `Edited ${changed.join(", ")} ${by === "claude" ? "via Claude" : "in app"}` }];
  await patchExpense(id, { ...out, history });
  return getOne(id);
}

export async function reviewExpense(id, decision, note = "") {
  if (!["approved", "rejected"].includes(decision)) throw new Error("decision must be approved or rejected");
  const current = await getExpense(id);
  if (!current) throw new Error("Claim not found");
  if (current.status !== "pending") throw new Error(`Claim is already ${current.status}`);
  if (decision === "rejected" && !String(note).trim()) throw new Error("Please give a reason when rejecting");
  const history = [
    ...(current.history || []),
    { at: new Date().toISOString(), action: decision === "approved" ? "Approved" : "Rejected", note: String(note).trim() },
  ];
  await patchExpense(id, { status: decision, review_note: String(note).trim(), history });
  return getOne(id);
}

export async function summary({ month } = {}) {
  const rows = await getAll();
  const m = month || new Date().toISOString().slice(0, 7);
  const inMonth = rows.filter((e) => e.expense_date.startsWith(m) && e.currency === "INR");
  const sum = (arr) => Math.round(arr.reduce((s, e) => s + e.amount, 0) * 100) / 100;
  const byCategory = {};
  for (const e of inMonth.filter((x) => x.status !== "rejected")) byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
  const byEmployee = {};
  for (const e of inMonth.filter((x) => x.status !== "rejected")) byEmployee[e.employee_name] = (byEmployee[e.employee_name] || 0) + e.amount;
  const pending = rows.filter((e) => e.status === "pending");
  return {
    month: m,
    currency: "INR",
    pending_count: pending.length,
    pending_amount: sum(pending.filter((e) => e.currency === "INR")),
    flagged_pending_count: pending.filter((e) => e.flags.length).length,
    approved_this_month: sum(inMonth.filter((e) => e.status === "approved")),
    rejected_this_month: sum(inMonth.filter((e) => e.status === "rejected")),
    by_category: byCategory,
    by_employee: byEmployee,
  };
}
