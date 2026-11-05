import { mcpHttpHandler } from "../lib/mcp.js";

export default async function handler(req, res) {
  let body = req.body;
  if (body === undefined && req.method === "POST") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    body = Buffer.concat(chunks).toString("utf8");
  }
  return mcpHttpHandler(req, res, body);
}
