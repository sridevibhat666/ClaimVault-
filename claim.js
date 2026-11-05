// GET   /api/claim?id=...                 -> one claim with history
// PATCH /api/claim?id=...  {fields}       -> edit a pending claim
// POST  /api/claim?id=...  {decision,note} -> approve / reject
import { getOne, updateExpense, reviewExpense } from "../expenses.js";
import { json, readBody, query } from "../http.js";

export default async function handler(req, res) {
  const { id } = query(req);
  if (!id) return json(res, 400, { error: "id is required" });
  try {
    if (req.method === "GET") {
      const e = await getOne(id);
      return e ? json(res, 200, e) : json(res, 404, { error: "Claim not found" });
    }
    if (req.method === "PATCH") return json(res, 200, await updateExpense(id, await readBody(req), "app"));
    if (req.method === "POST") {
      const { decision, note } = await readBody(req);
      return json(res, 200, await reviewExpense(id, decision, note));
    }
    return json(res, 405, { error: "Method not allowed" });
  } catch (err) {
    return json(res, 400, { error: err.message });
  }
}
