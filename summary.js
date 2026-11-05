// GET /api/summary?month=YYYY-MM -> dashboard numbers, categories and policy
import { summary, CATEGORIES, POLICY_LIMITS } from "../lib/expenses.js";
import { storageMode } from "../lib/store.js";
import { json, query } from "../lib/http.js";

export default async function handler(req, res) {
  try {
    const q = query(req);
    return json(res, 200, { ...(await summary({ month: q.month })), categories: CATEGORIES, limits: POLICY_LIMITS, storage: storageMode });
  } catch (err) {
    return json(res, 500, { error: err.message });
  }
}
