// Storage layer. Uses Supabase (Postgres) over plain REST when SUPABASE_URL and
// SUPABASE_SERVICE_KEY are set; otherwise falls back to in-memory storage
// (handy for local testing; resets on every restart).
// No AI anywhere in this app.

import { randomUUID } from "node:crypto";

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const useSupabase = Boolean(URL_ && KEY);

const mem = globalThis.__claimdeskMem || (globalThis.__claimdeskMem = []);

async function sb(path, options = {}) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: KEY,
      // Legacy service_role keys are JWTs and also go in Authorization.
      // Newer "sb_secret_..." keys work through the apikey header alone.
      ...(KEY.startsWith("eyJ") ? { Authorization: `Bearer ${KEY}` } : {}),
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Database error ${res.status}: ${text}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export async function listExpenses() {
  if (useSupabase) return sb("expenses?select=*&order=created_at.desc");
  return [...mem].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function getExpense(id) {
  if (useSupabase) {
    const rows = await sb(`expenses?select=*&id=eq.${encodeURIComponent(id)}`);
    return rows[0] || null;
  }
  return mem.find((e) => e.id === id) || null;
}

export async function insertExpense(row) {
  const now = new Date().toISOString();
  const full = { id: randomUUID(), created_at: now, updated_at: now, ...row };
  if (useSupabase) {
    const rows = await sb("expenses", { method: "POST", body: JSON.stringify(full) });
    return rows[0];
  }
  mem.push(full);
  return full;
}

export async function patchExpense(id, changes) {
  const patch = { ...changes, updated_at: new Date().toISOString() };
  if (useSupabase) {
    const rows = await sb(`expenses?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    return rows[0] || null;
  }
  const e = mem.find((x) => x.id === id);
  if (!e) return null;
  Object.assign(e, patch);
  return e;
}

export const storageMode = useSupabase ? "supabase" : "memory";
