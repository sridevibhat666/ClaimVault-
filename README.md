# ClaimDesk: expense claims that run on your own Claude

Employees drop a receipt into **their own Claude**. Claude reads it and files the claim in ClaimDesk through MCP.
The manager opens ClaimDesk, fixes anything wrong, and approves or rejects it.

**There is no AI inside this app.** It has no OpenAI or Anthropic keys and makes no AI calls. Claude does the reading, and the
customer's Claude plan pays for it. ClaimDesk does the saving, editing, policy checks, approvals and reporting.

```
Receipt photo ──► Employee's Claude ──(MCP)──► ClaimDesk API ──► Supabase DB
                  (reads & extracts)            (rules, no AI)        ▲
                                                                      │
                               Manager ◄── ClaimDesk dashboard ───────┘
                               (edit / approve / reject)
```

## What's inside

| File | What it does |
|---|---|
| `index.html` | The dashboard: list of claims, totals, edit drawer, approve/reject. Refreshes every 4 seconds. |
| `api/mcp.js` + `lib/mcp.js` | The MCP plug that Claude connects to. Hand-written, with no extra libraries. |
| `api/claims.js`, `api/claim.js`, `api/summary.js` | The API the dashboard uses. |
| `lib/expenses.js` | Business rules: validation, policy limits, duplicate check, approval flow, history. |
| `lib/store.js` | Saves to Supabase, or to memory if no database is set up (for local testing). |
| `schema.sql` | Creates the database table. |
| `test/smoke.js` | 22 end-to-end checks that act as Claude and as the manager. |

There are no npm packages to install.

### Claude's tools (MCP)
- `submit_expense_claim`: file a claim from a receipt
- `list_expense_claims`: see claims, filtered by status or employee
- `get_expense_claim`: one claim, with its history and the manager's note
- `update_expense_claim`: fix a claim that is still pending
- `get_spend_summary`: "how much did we spend on travel this month?"
- `get_expense_policy`: the categories and limits

Approving and rejecting are deliberately **not** tools. A human decides in the app.

### Policy checks (plain rules, no AI)
- Over the category limit (Meals ₹2,000, Travel ₹15,000, and so on; edit `POLICY_LIMITS` in `lib/expenses.js`)
- Possible duplicate (same merchant, amount and date)
- Receipt older than 60 days, or dated in the future
- No business purpose given

---

## Put it live (about 20 minutes, all free)

### 1. Database: Supabase
1. Sign up at **supabase.com** → **New project** (any name, choose a password, pick the Mumbai region).
2. Left menu → **SQL Editor** → **New query** → paste everything from `schema.sql` → **Run**.
3. Left menu → **Project Settings** → **API**. Copy two things:
   - **Project URL**, which looks like `https://abcd1234.supabase.co`
   - the **service_role** secret key (it may be labelled "secret key"). Keep this private.

### 2. Code: GitHub
1. Sign up at **github.com** → **New repository** → name it `claimdesk` → **Create**.
2. Click **"uploading an existing file"** and drag in **everything inside** the `claimdesk` folder
   (`api`, `lib`, `test`, `index.html`, `package.json`, `vercel.json`, `schema.sql`, `dev-server.js`, `README.md`). Then click **Commit**.

### 3. Hosting: Vercel
1. Sign up at **vercel.com** using your GitHub account → **Add New… → Project** → import `claimdesk`.
2. Leave **Framework Preset** as **Other**. Open **Environment Variables** and add:
   - `SUPABASE_URL` = your Project URL
   - `SUPABASE_SERVICE_KEY` = your service_role key
3. Click **Deploy**. You'll get a link like `https://claimdesk-xyz.vercel.app`. That's your live app.
4. Open it. The top-right corner should say **"Live · updates automatically"**. If it says "Demo mode", the two
   environment variables are missing: add them, then go to **Deployments → ⋯ → Redeploy**.

### 4. Connect Claude
1. Open **claude.ai** → **Settings** → **Connectors** → **Add custom connector**.
2. Name: `ClaimDesk`. URL: `https://YOUR-APP.vercel.app/api/mcp` (the dashboard shows it with a Copy button).
3. Click **Add**. In a new chat, check that ClaimDesk is switched on in the tools menu.
4. Upload a receipt photo and type: **"File this as my expense. I'm Priya Sharma, it was a team lunch."**
5. Watch the claim appear on the dashboard within a few seconds.

**Optional lock:** add an environment variable `MCP_TOKEN=some-secret` in Vercel and connect with
`https://YOUR-APP.vercel.app/api/mcp?key=some-secret`. Without the key, the MCP plug refuses requests.

---

## What to send Volopay

```
Video: <your Loom / YouTube unlisted link>

Live app: https://YOUR-APP.vercel.app   (no login needed)

MCP link: https://YOUR-APP.vercel.app/api/mcp
How to connect:
  1. claude.ai → Settings → Connectors → Add custom connector
  2. Name: ClaimDesk   URL: (link above)   → Add
  3. New chat → upload any receipt → "File this as my expense, I'm <name>, <purpose>"
  4. Open the live app: the claim is there. Click it to edit, approve or reject.
```

## Run it on your own computer (optional)
Install Node.js 18 or newer, then in this folder:
```
npm run dev      # http://localhost:3000, in-memory data
npm test         # in a second terminal: runs the 22 end-to-end checks
```
To use the real database locally, set `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` before `npm run dev`.
