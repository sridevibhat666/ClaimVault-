// A minimal, dependency-free MCP server (Streamable HTTP transport, stateless).
// Claude calls these tools; this file only stores and returns data. No AI here.

import { CATEGORIES, POLICY_LIMITS, createExpense, getAll, getOne, updateExpense, summary } from "./expenses.js";

const SERVER_INFO = { name: "claimdesk", title: "ClaimDesk – Expense Claims", version: "1.0.0" };
const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS = `ClaimDesk stores employee expense claims so a manager can review, edit and approve them in the ClaimDesk web app.
When the user shares a receipt (photo, PDF or text), read it yourself and submit the claim with submit_expense_claim.
Use the receipt's final total (including taxes and tip), the date printed on it, and the merchant name.
If you don't know the employee's name or the business purpose, ask the user before submitting.
Approvals happen only in the web app, by a human.`;

const claimFields = {
  employee_name: { type: "string", description: "Full name of the employee claiming the expense" },
  merchant: { type: "string", description: "Merchant / vendor name as printed on the receipt" },
  amount: { type: "number", description: "Final total paid, including taxes and tip" },
  currency: { type: "string", description: "3-letter currency code, default INR" },
  expense_date: { type: "string", description: "Date on the receipt, YYYY-MM-DD" },
  category: { type: "string", enum: CATEGORIES, description: "Expense category" },
  description: { type: "string", description: "Business purpose, e.g. 'Lunch with Acme team to discuss renewal'" },
  payment_method: { type: "string", description: "e.g. Corporate card, Personal UPI, Cash" },
};

const TOOLS = [
  {
    name: "submit_expense_claim",
    title: "Submit expense claim",
    description:
      "Create a new expense claim in ClaimDesk from a receipt the user shared. It lands as 'pending' for a manager to review and approve in the web app. Returns the claim, any policy flags, and a link to it.",
    inputSchema: {
      type: "object",
      properties: claimFields,
      required: ["employee_name", "merchant", "amount", "expense_date", "category"],
    },
  },
  {
    name: "list_expense_claims",
    title: "List expense claims",
    description: "List expense claims, newest first. Optionally filter by status or employee name.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["all", "pending", "approved", "rejected"], description: "Default: all" },
        employee: { type: "string", description: "Part of an employee name to filter by" },
      },
    },
  },
  {
    name: "get_expense_claim",
    title: "Get expense claim",
    description: "Get one expense claim by id, including policy flags, review note and full history.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "update_expense_claim",
    title: "Update expense claim",
    description: "Correct fields on a claim that is still pending (e.g. wrong amount or category). Approved or rejected claims cannot be changed.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Claim id" }, ...claimFields },
      required: ["id"],
    },
  },
  {
    name: "get_spend_summary",
    title: "Get spend summary",
    description: "Totals for a month: pending, approved, rejected, flagged, and spend by category and by employee (INR). Use it to answer questions like 'how much did we spend on travel this month?'.",
    inputSchema: {
      type: "object",
      properties: { month: { type: "string", description: "YYYY-MM, default current month" } },
    },
  },
  {
    name: "get_expense_policy",
    title: "Get expense policy",
    description: "The company's expense categories and per-claim limits (INR). Claims above a limit are flagged for the manager.",
    inputSchema: { type: "object", properties: {} },
  },
];

function fmt(e, appUrl) {
  return {
    id: e.id,
    link: `${appUrl}/?claim=${e.id}`,
    employee_name: e.employee_name,
    merchant: e.merchant,
    amount: e.amount,
    currency: e.currency,
    expense_date: e.expense_date,
    category: e.category,
    description: e.description,
    payment_method: e.payment_method,
    status: e.status,
    policy_flags: e.flags,
    review_note: e.review_note || undefined,
  };
}

async function callTool(name, args = {}, appUrl) {
  switch (name) {
    case "submit_expense_claim": {
      const e = await createExpense(args, "claude");
      return {
        message: e.flags.length
          ? `Claim submitted and sent for approval. Note: it has policy flags the manager will see: ${e.flags.join("; ")}.`
          : "Claim submitted and sent for approval. No policy issues found.",
        claim: fmt(e, appUrl),
      };
    }
    case "list_expense_claims": {
      const rows = await getAll({ status: args.status, employee: args.employee });
      return { count: rows.length, claims: rows.map((e) => fmt(e, appUrl)) };
    }
    case "get_expense_claim": {
      const e = await getOne(args.id);
      if (!e) throw new Error("Claim not found");
      return { ...fmt(e, appUrl), history: e.history };
    }
    case "update_expense_claim": {
      const { id, ...fields } = args;
      const e = await updateExpense(id, fields, "claude");
      return { message: "Claim updated.", claim: fmt(e, appUrl) };
    }
    case "get_spend_summary":
      return summary({ month: args.month });
    case "get_expense_policy":
      return { currency: "INR", categories: CATEGORIES, per_claim_limits: POLICY_LIMITS, other_checks: ["Claims older than 60 days", "Possible duplicates (same merchant, amount and date)", "Missing business purpose"] };
    default:
      throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32602 });
  }
}

async function handleMessage(msg, appUrl) {
  const { id, method, params } = msg || {};
  const isNotification = id === undefined || id === null;
  const reply = (result) => ({ jsonrpc: "2.0", id, result });
  const fail = (code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

  if (!msg || msg.jsonrpc !== "2.0" || typeof method !== "string") return fail(-32600, "Invalid request");
  if (isNotification) return null; // e.g. notifications/initialized

  try {
    switch (method) {
      case "initialize": {
        const asked = params?.protocolVersion;
        return reply({
          protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[1],
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS,
        });
      }
      case "ping":
        return reply({});
      case "tools/list":
        return reply({ tools: TOOLS });
      case "tools/call": {
        try {
          const data = await callTool(params?.name, params?.arguments || {}, appUrl);
          return reply({
            content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
            structuredContent: data,
          });
        } catch (err) {
          if (err.code === -32602) return fail(-32602, err.message);
          // Tool-level errors go back to Claude so it can fix its input and retry.
          return reply({ content: [{ type: "text", text: `Error: ${err.message}` }], isError: true });
        }
      }
      case "resources/list":
        return reply({ resources: [] });
      case "prompts/list":
        return reply({ prompts: [] });
      default:
        return fail(-32601, `Method not found: ${method}`);
    }
  } catch (err) {
    return fail(-32603, err.message);
  }
}

export function appUrlFrom(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = req.headers["x-forwarded-proto"] || (String(host).startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

// HTTP entry point: works with Vercel's (req, res) and the local dev server.
export async function mcpHttpHandler(req, res, body) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS, DELETE");
  if (req.method === "OPTIONS") return send(res, 204);

  // Optional shared secret: set MCP_TOKEN and connect with .../api/mcp?key=YOUR_TOKEN
  const token = process.env.MCP_TOKEN;
  if (token) {
    const key = new URL(req.url, "http://x").searchParams.get("key");
    if (key !== token) return send(res, 401, { error: "Missing or wrong ?key=" });
  }

  if (req.method === "GET") {
    // No server-initiated streams in this stateless server.
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "Use POST for MCP messages" });
  }
  if (req.method === "DELETE") return send(res, 204);
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });

  let payload = body;
  if (typeof payload === "string") {
    try { payload = JSON.parse(payload); } catch { return send(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); }
  }

  const appUrl = appUrlFrom(req);
  if (Array.isArray(payload)) {
    const out = (await Promise.all(payload.map((m) => handleMessage(m, appUrl)))).filter(Boolean);
    return out.length ? send(res, 200, out) : send(res, 202);
  }
  const out = await handleMessage(payload, appUrl);
  return out ? send(res, 200, out) : send(res, 202);
}

function send(res, status, json) {
  res.statusCode = status;
  if (json === undefined) return res.end();
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(json));
}
