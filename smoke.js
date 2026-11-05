// End-to-end smoke test: pretends to be Claude talking MCP, then acts as the
// manager in the web app. Run with the dev server up: npm run dev, then npm test
const BASE = process.env.BASE || "http://localhost:3000";
let ok = 0;
const assert = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); ok++; console.log("  ✓", msg); };

async function rpc(method, params, id = 1) {
  const res = await fetch(`${BASE}/api/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  return { status: res.status, body: res.status === 202 ? null : await res.json() };
}
const call = async (name, args) => {
  const r = await rpc("tools/call", { name, arguments: args });
  return r.body.result;
};
const app = async (path, opts = {}) => (await fetch(BASE + path, { headers: { "Content-Type": "application/json" }, ...opts })).json();

const today = new Date().toISOString().slice(0, 10);

console.log("MCP handshake");
const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
assert(init.body.result.serverInfo.name === "claimdesk", "initialize returns server info");
assert(init.body.result.protocolVersion === "2025-06-18", "protocol version negotiated");
const notif = await fetch(`${BASE}/api/mcp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
assert(notif.status === 202, "notification accepted with 202");
const tools = (await rpc("tools/list")).body.result.tools.map((t) => t.name);
assert(tools.includes("submit_expense_claim") && tools.length === 6, "6 tools listed");

console.log("Claude files claims");
const r1 = await call("submit_expense_claim", { employee_name: "Priya Sharma", merchant: "Truffles, Koramangala", amount: 1840, expense_date: today, category: "Meals", description: "Team lunch after sprint demo", payment_method: "Corporate card" });
assert(!r1.isError && r1.structuredContent.claim.status === "pending", "clean claim submitted as pending");
assert(r1.structuredContent.claim.policy_flags.length === 0, "clean claim has no flags");
const r2 = await call("submit_expense_claim", { employee_name: "Rahul Verma", merchant: "Taj West End", amount: 6500, expense_date: today, category: "meals", description: "Client dinner" });
assert(r2.structuredContent.claim.category === "Meals", "category matched case-insensitively");
assert(r2.structuredContent.claim.policy_flags.some((f) => f.includes("limit")), "over-limit claim flagged");
const r3 = await call("submit_expense_claim", { employee_name: "Rahul Verma", merchant: "taj west end", amount: 6500, expense_date: today, category: "Meals", description: "Client dinner" });
assert(r3.structuredContent.claim.policy_flags.includes("Possible duplicate claim"), "duplicate flagged");
const bad = await call("submit_expense_claim", { employee_name: "X", merchant: "Y", amount: -5, expense_date: "yesterday", category: "Meals" });
assert(bad.isError && /amount/.test(bad.content[0].text) && /expense_date/.test(bad.content[0].text), "bad input returns a helpful tool error");

console.log("Claude reads back");
const list = await call("list_expense_claims", { status: "pending" });
assert(list.structuredContent.count === 3, "3 pending claims listed");
const sum = await call("get_spend_summary", {});
assert(sum.structuredContent.pending_amount === 1840 + 6500 * 2, "summary pending amount correct");
assert(sum.structuredContent.flagged_pending_count === 2, "summary flagged count correct");
const upd = await call("update_expense_claim", { id: r2.structuredContent.claim.id, amount: 4500, category: "Client Entertainment" });
assert(upd.structuredContent.claim.amount === 4500 && !upd.structuredContent.claim.policy_flags.some((f) => f.includes("limit")), "Claude update re-runs policy checks");

console.log("Manager works in the app");
const id1 = r1.structuredContent.claim.id;
const edited = await app(`/api/claim?id=${id1}`, { method: "PATCH", body: JSON.stringify({ amount: 1790, description: "Team lunch after sprint demo (tip removed)" }) });
assert(edited.amount === 1790 && edited.history.at(-1).action.includes("in app"), "edit in app saved with history");
const approved = await app(`/api/claim?id=${id1}`, { method: "POST", body: JSON.stringify({ decision: "approved" }) });
assert(approved.status === "approved", "approve works");
const lockEdit = await app(`/api/claim?id=${id1}`, { method: "PATCH", body: JSON.stringify({ amount: 1 }) });
assert(/already approved/.test(lockEdit.error), "approved claim is locked");
const noReason = await app(`/api/claim?id=${r3.structuredContent.claim.id}`, { method: "POST", body: JSON.stringify({ decision: "rejected" }) });
assert(/reason/.test(noReason.error), "reject requires a reason");
const rej = await app(`/api/claim?id=${r3.structuredContent.claim.id}`, { method: "POST", body: JSON.stringify({ decision: "rejected", note: "Duplicate of earlier claim" }) });
assert(rej.status === "rejected", "reject works");
const viaClaude = await call("get_expense_claim", { id: r3.structuredContent.claim.id });
assert(viaClaude.structuredContent.review_note === "Duplicate of earlier claim", "Claude can see the manager's decision");
const s = await app("/api/summary");
assert(s.approved_this_month === 1790 && s.rejected_this_month === 6500, "dashboard totals correct");
const html = await (await fetch(BASE + "/")).text();
assert(html.includes("ClaimDesk"), "dashboard page served");

console.log(`\nAll ${ok} checks passed.`);
