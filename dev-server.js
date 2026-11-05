// Local server that mimics Vercel: serves index.html and /api/* routes.
// Run: npm run dev  ->  http://localhost:3000
import http from "node:http";
import { readFile } from "node:fs/promises";

const routes = {
  "/api/mcp": () => import("./api/mcp.js"),
  "/api/claims": () => import("./api/claims.js"),
  "/api/claim": () => import("./api/claim.js"),
  "/api/summary": () => import("./api/summary.js"),
};

const port = Number(process.env.PORT || 3000);
http
  .createServer(async (req, res) => {
    const path = new URL(req.url, "http://x").pathname;
    try {
      if (routes[path]) return (await routes[path]()).default(req, res);
      if (path === "/" || path === "/index.html") {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        return res.end(await readFile(new URL("./index.html", import.meta.url)));
      }
      res.statusCode = 404;
      res.end("Not found");
    } catch (err) {
      res.statusCode = 500;
      res.end(String(err));
    }
  })
  .listen(port, () => console.log(`ClaimDesk running at http://localhost:${port}  (MCP: /api/mcp)`));
