# Kokiri — Architecture Document

Last updated: 2026-08-13

## 1. What Kokiri Is

Kokiri is Daniel's personal operations system: a public directory of live projects, a private multi-sheet data workspace ("Kokiri OS"), and an autonomous agent dashboard — all running on free-tier infrastructure with no traditional server.

Three layers:

1. **Static frontend** — plain HTML/CSS/JS, hosted on GitHub Pages, no build step.
2. **Backend** — Supabase (Postgres + Auth + Edge Functions + `pg_cron`), free tier.
3. **Intelligence** — OpenRouter (free-tier LLMs) and OmniRoute (Daniel's local Ollama gateway), called either from the browser or from a scheduled server-side function.

No Node server, no framework, no paid hosting.

---

## 2. Repository & Hosting

- **Repo:** `danielfanto95-pixel/kokiri` on GitHub
- **Hosting:** GitHub Pages, served from `master` branch root
- **URL:** `https://danielfanto95-pixel.github.io/kokiri/`
- **Deploy mechanism:** every `git push` to `master` triggers GitHub's own Pages build — no CI config needed, no GitHub Actions written by hand

### Pages in the repo

| File | Purpose | Auth required? |
|---|---|---|
| `index.html` | Public directory — links to every live project (Furin Fitness, Hajime Solutions, standalone sites, tools) | No |
| `login.html` | Sign in / sign up | No (this *is* the auth gate) |
| `app.html` | Kokiri OS — dynamic multi-sheet spreadsheet engine, 20 tabs | Yes |
| `agents.html` | Agent Dashboard — agents, tools, tasks, timelines, triage, tribunal, chat | Yes |

`app.html` and `agents.html` both check `supabase.auth.getSession()` on load and redirect to `login.html` if no session exists. This is a client-side gate for UX only — the actual security boundary is Postgres Row Level Security (RLS), described below.

---

## 3. Backend: Supabase Project

- **Project ref:** `qahriykfwknuoqctsaek`
- **Plan:** Free tier
- **Region:** `ca-central-1`

Everything server-side lives in this one project: the database, auth, Edge Functions, secrets (Vault), and the cron scheduler.

### 3.1 Auth & the single-user lock

Kokiri is explicitly single-tenant — only Daniel should ever have an account. This is enforced at the **database level**, not just the UI:

```sql
create trigger restrict_signup_single_user_trigger
before insert on auth.users
for each row execute function public.restrict_signup_single_user();
```

The trigger function raises an exception on any signup attempt once `auth.users` already has one row. This means even if someone finds the public `login.html` URL and the Sign Up button, the database itself refuses the insert — this isn't bypassable from the client.

Every RLS policy across the app checks `auth.role() = 'authenticated'` — since only one account can ever exist, "authenticated" and "Daniel" are permanently equivalent.

### 3.2 Data model — two subsystems

**A. Kokiri OS (dynamic spreadsheet engine)**

Generic tables that can represent *any* number of sheets with *any* columns, without schema migrations when columns are added:

```
kokiri_sheets   (id, slug, name, sort_order)
kokiri_columns  (id, sheet_id → sheets, column_key, name, sort_order)
kokiri_rows     (id, sheet_id → sheets, data jsonb, sort_order)
```

A row's actual values live in the `data` JSONB column, keyed by `column_key`. Adding a column is just an `insert` into `kokiri_columns` — no `ALTER TABLE`. This is what lets the in-browser "+ Add Column" button work instantly with zero backend deploy.

Seeded with the 20 tabs imported from Daniel's original Google Sheet (Personal Jobs, Schedule, Story, Sagas, Sources, CRM, etc.), preserving real row data where the source had it.

**B. Agent Dashboard (fixed schema)**

Unlike the sheets engine, agents have a defined shape, so this uses normal relational tables:

```
agents          (id, name, purpose, icon, model_pref, status, sort_order)
agent_tools     (id, agent_id → agents, name, description, config, enabled)
agent_tasks     (id, agent_id → agents, title, description, status, priority, due_date)
agent_timeline  (id, agent_id → agents, event_text, event_type, occurred_at)
agent_triage    (id, agent_id → agents, issue_text, severity, status)
agent_tribunal  (id, agent_id → agents, title, verdict, adjustment)  -- history of automated runs + human adjustments
chat_messages   (id, agent_id → agents nullable, role, content, model_used)  -- nullable agent_id = general chat
kokiri_settings (id, key, value)  -- browser-facing key/value store (intelligence URLs, model prefs)
```

### 3.3 Row Level Security

Every table has RLS enabled. The standing policy on all app tables:

```sql
create policy "Authenticated full access" on <table>
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
```

Anonymous (logged-out) requests are refused by Postgres itself, not just hidden by the frontend.

### 3.4 Secrets — two separate paths, deliberately

There are **two different places an OpenRouter API key can live**, and they serve different callers:

| Storage | Who reads it | Used by |
|---|---|---|
| `kokiri_settings` table (plaintext, RLS-protected) | Daniel's browser, when logged in | Interactive chat in `agents.html` |
| **Supabase Vault** (`vault.secrets`, encrypted) | Only the `agent-runner` Edge Function, via `service_role` | Autonomous scheduled runs |

Why split: the browser needs its own copy to call OpenRouter directly (client-side fetch, no server round-trip needed for interactive chat). The **scheduled** runner is a different execution context — it runs with no browser present, so it can't read `kokiri_settings` the same way, and more importantly, secrets that power unattended, server-side execution deserve stronger protection than a plaintext settings row. Vault encrypts at rest and is only reachable through a locked-down Postgres function:

```sql
create function public.get_secret(secret_name text) returns text
  security definer
  ...
revoke execute on function public.get_secret(text) from public, anon, authenticated;
grant execute on function public.get_secret(text) to service_role;
```

Only `service_role` (used server-side by the Edge Function) can call `get_secret()`. Daniel's own logged-in session cannot — even accidentally.

### 3.5 Edge Function: `agent-runner`

A Deno-based serverless function, deployed to Supabase, that acts as the actual "runtime" for agents:

1. Fetches all `agents` where `status = 'active'`
2. For each, pulls up to 3 `agent_tasks` where `status = 'todo'`
3. Calls OpenRouter (key fetched from Vault via `get_secret()`) with a system prompt built from the agent's `purpose`
4. Logs the model's response to `agent_timeline` (as an `automated_run` event) and `agent_tribunal` (as a verdict, with a note that it needs human confirmation)
5. Flips the task to `in_progress`

**Current capability: reasoning/triage only.** The runner can *think* about a task and report back — it cannot yet perform real-world actions (send an email, write to Notion, update a Google Sheet). Real tool execution is a planned next phase (see §6).

**Model routing note:** the Edge Function only ever calls OpenRouter, never OmniRoute — OmniRoute lives on Daniel's local machine at `localhost:20128`, which Supabase's cloud runtime has no path to reach. OmniRoute is only usable from the interactive browser chat, and only when Daniel is on the same machine running it.

### 3.6 Scheduling: `pg_cron`

```sql
select cron.schedule(
  'agent-runner-every-30-min',
  '*/30 * * * *',
  $$ select net.http_post(url := '.../functions/v1/agent-runner', ...) $$
);
```

Fires every 30 minutes, independent of whether anyone has the dashboard open. This is what makes agents "always on" rather than only running when Daniel is actively using the app. As a side effect, this recurring activity also keeps the Supabase free-tier project from auto-pausing due to inactivity.

---

## 4. Frontend Architecture

No framework, no bundler — each page is a single `.html` file with:
- Inline `<style>` for its theme
- A `<script type="module">` block that imports `@supabase/supabase-js` from a CDN (`esm.sh`) and talks directly to Supabase's REST API

### 4.1 Two visual themes, deliberately different

- **Kokiri OS / directory** (`index.html`, `login.html`, `app.html`): forest-green "Kokiri Forest" theme — Cinzel display font, leaf-green palette, calm.
- **Agent Dashboard** (`agents.html`): "Sheikah tech" futuristic theme — Orbitron display font, cyan/gold on near-black, circuit-line background, glassmorphism panels. Intentionally distinct so the agent console *feels* like a different kind of tool (operational, high-tech) from the calmer data workspace.

### 4.2 Navigation

A shared right-hand nav pattern appears on both `app.html` and `agents.html`, grouped under two headers:
- **Kokiri** — all 20 sheet tabs (clicking from the Agent Dashboard jumps to that tab in `app.html`)
- **Agents** — the live agent list (clicking from Kokiri OS jumps into that agent's page in `agents.html`)

This makes the two "apps" feel like one system with a single, consistent way to move between any sheet or any agent, regardless of which page you're currently on.

### 4.3 Intelligence call flow (browser-side chat)

```
User sends message
  → try POST http://localhost:20128/v1/chat/completions   (OmniRoute, 1.5s timeout)
      ↳ success → use response, tag source "omnirouter"
      ↳ fail/timeout → fall through
  → POST https://openrouter.ai/api/v1/chat/completions      (OpenRouter, key from kokiri_settings)
      ↳ success → use response, tag source "openrouter"
      ↳ fail → surface error to user, prompt to check Settings
```

Every message (user and assistant) is persisted to `chat_messages`, scoped by `agent_id` (null = general chat). Assistant replies get a **"+ Assign as Task"** button that inserts a row into `agent_tasks` for the currently selected agent — this is the manual bridge between "talking to intelligence" and "an agent has a task."

---

## 5. Data Provenance

The 20 sheets in Kokiri OS were imported from Daniel's original Google Sheet (`1xtblK1XPGsupUZkoYlCAepPUs5o4MMBEBxtigiyk5lo`) via the Google Sheets API. Column structure was inferred per-tab from header rows (or, for a few tabs with no header row, from positional structure). All real row data was migrated faithfully — long-text fields (automation prompts, task logs) included verbatim.

Two tabs (`Masters Applications`, `Clients`) were empty in the source and were created with zero columns, ready for Daniel to define structure through the "+ Add Column" UI whenever needed.

---

## 6. Known Limitations & Next Steps

| Limitation | Why | Path forward |
|---|---|---|
| Agents can't perform real actions yet | `agent-runner` only calls an LLM and logs its text response — no tool-calling wired in | Add per-tool credentials (Notion integration token, Google service account, Gmail app password) stored in Vault, then extend `agent-runner` to dispatch based on `agent_tools.config` |
| OmniRoute only works from Daniel's own machine | It's bound to `localhost`; Supabase's cloud runtime and any other device have no route to it | Not fixable without exposing OmniRoute publicly (not recommended) — OpenRouter remains the "works from anywhere" fallback by design |
| OpenRouter free models are rate-limited | Free tier, shared capacity | Current usage (a handful of tasks per 30 min) is well under limits; would need paid OpenRouter credit only if usage scales significantly |
| No retry/backoff on OpenRouter 429s | Not yet needed at current volume | Add simple retry logic to `agent-runner` if/when rate limits start getting hit |
| Single Edge Function does all agent reasoning | Simplicity over separation | Fine at current scale; could split per-agent-type functions later if logic diverges significantly |

---

## 7. Cost Model

| Component | Tier | Cost |
|---|---|---|
| GitHub Pages hosting | Free | $0 |
| Supabase (DB, Auth, Edge Functions, `pg_cron`) | Free tier | $0 (well under 500K function invocations/month at current ~1,440/month) |
| OpenRouter free models | Free tier | $0, rate-limited |
| OmniRoute | Self-hosted, local | $0 (electricity only) |

**Total recurring cost at current usage: $0/month.**

---

## 8. Security Summary

- Single-user enforced at the database trigger level, not just UI
- RLS on every table — logged-out requests refused by Postgres
- Two-tier secret handling: browser-facing settings (plaintext, low-risk since only Daniel can ever be authenticated) vs. Vault-encrypted secrets for unattended server-side execution
- `get_secret()` locked to `service_role` only — Daniel's own session cannot read the Vault-stored key even by accident
- No API keys ever committed to the repo or embedded in client-visible source beyond the Supabase *publishable* key (safe by design — protected by RLS, not secrecy)
