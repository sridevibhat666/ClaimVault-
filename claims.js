// GET /api/claims?status=pending  -> list claims
// POST /api/claims                -> create a claim manually from the app
import { getAll, createExpense } from "../expenses.js";
import { json, readBody, query } from "../http.js";

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const q = query(req);
      return json(res, 200, await getAll({ status: q.status, employee: q.employee }));
    }
    if (req.method === "POST") return json(res, 201, await createExpense(await readBody(req), "app"));
    return json(res, 405, { error: "Method not allowed" });
  } catch (err) {
    return json(res, 400, { error: err.message });
  }
}
