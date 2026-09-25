# MCP spec 2 of 3: auth plumbing, fleet reads, static tools (admin-only)

Issue: #562. Status: design approved 2026-09-25. Depends on spec 1
(`2026-09-25-mcp-oauth-read-only-tokens-design.md`, merged #572, applied in prod).

## Goal

An admin connects Claude (Desktop, claude.ai, Claude Code) to `https://starborneplanner.com/mcp`,
signs in through Supabase OAuth, approves on the app's consent page, and can call read-only tools:
ship templates, skills, gear sets, implants, their profiles, and their fleet with final stats.
Spec 3 adds `simulate_battle` / `sweep_stat` on top of the same server.

Admin-only until the Auth API question (below) is answered; lifting the gate is a later PR.

## Facts this design rests on

- Supabase Auth is an OAuth 2.1 server with dynamic client registration (DCR), built to the MCP
  auth spec. OAuth-issued access tokens carry `client_id`; website sessions do not.
- Prod signs with ES256 (rotated 2026-09-25); legacy HS256 is the *previous* key and stays
  unrevoked (the legacy anon/service-role API keys are signed by it). Tokens are verified against
  `<SUPABASE_URL>/auth/v1/.well-known/jwks.json` — no secret on Netlify.
- Spec 1's pre-request hook makes any `client_id` token read-only on the Data API. Every read here
  is a `GET` (`.select()`); an RPC, if ever needed, uses `{ get: true }`.
- Netlify Functions (Node, Lambda): synchronous limit 60 s, not configurable.
- `@supabase/supabase-js` 2.116 exposes `supabase.auth.oauth.getAuthorizationDetails(id)`,
  `approveAuthorization(id, { skipBrowserRedirect? })`, `denyAuthorization(id, …)`. Details carry
  `client` (name etc.), `redirect_uri`, `user { id, email }`, `scope`.

## Request flow

1. Client `POST /mcp` without a token → **401**, header
   `WWW-Authenticate: Bearer resource_metadata="https://starborneplanner.com/.well-known/oauth-protected-resource"`.
2. Client `GET /.well-known/oauth-protected-resource` (and the path-suffixed
   `/.well-known/oauth-protected-resource/mcp`) → JSON
   `{ "resource": "https://starborneplanner.com/mcp", "authorization_servers": ["<SUPABASE_URL>/auth/v1"], "bearer_methods_supported": ["header"] }`.
3. Client discovers Supabase's authorization-server metadata, registers itself (DCR), and opens
   the authorize URL. Supabase redirects the browser to `/oauth/consent?authorization_id=…`.
4. Consent page (below) approves → Supabase redirects to the client with a code → client
   exchanges it for tokens.
5. Client `POST /mcp` with `Authorization: Bearer <token>`. The function:
   1. verifies the ES256 signature via JWKS (`jose.createRemoteJWKSet`, module-scoped so a warm
      instance reuses it), `iss` = `<SUPABASE_URL>/auth/v1`, `exp`;
   2. requires `client_id` present (a website session token is refused);
   3. **admin gate**: `select is_admin from users where id = <sub>` with the caller's client —
      `true` or refuse;
   4. builds `createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: 'Bearer <token>' } }, auth: { persistSession: false, autoRefreshToken: false } })`
      and hands it to the tool as `ctx.db`;
   5. runs a fresh stateless `McpServer` + `StreamableHTTPServerTransport`
      (`sessionIdGenerator: undefined`) for this one request, per
      https://developers.netlify.com/guides/write-mcps-on-netlify/.

Env: the function reads the existing public `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` from
`process.env` (never `import.meta.env`); Netlify exposes site env vars to functions when their scope
includes Functions. No service-role key, no JWT secret.

## Components

### `src/mcp/` — transport-agnostic tools

- `types.ts` — `McpToolContext = { db: SupabaseClient; authUserId: string }`;
  `McpTool<I> = { name; description; input: z.ZodType<I>; run(input: I, ctx): Promise<unknown> }`.
- `registry.ts` — the tool list; `registerTools(server: McpServer, ctx)` wires each tool's Zod
  schema and wraps `run` so any thrown error becomes a tool result with `isError: true` (see
  Errors).
- `tools/ships.ts` — `search_ships({ query?, type?, rarity?, faction?, limit≤50 })`,
  `get_ship({ name })` from `ship_templates`: name, type, rarity, faction, affinity, base stats.
- `tools/skills.ts` — `get_ship_skills({ name, refits? 0|2|4 })`: skill text for active, charge,
  the refit-active passive (via `getShipSkillRows()` on a template-built `Ship` with `refits`
  of that length), plus the parsed effects the web app shows (`parseAllSkillEffects`).
- `tools/gear.ts` — `list_gear_sets()`, `list_implants({ query? })` from `src/constants`.
- `tools/profiles.ts` — `list_profiles()`: rows of `users` where
  `id = authUserId OR owner_auth_user_id = authUserId` (same predicate as
  `altAccountService`): id, username, in_game_id, is_main.
- `tools/fleet.ts` — `get_my_fleet({ profile_id?, name?, type?, limit≤100 })`: profile defaults to
  the main account and must be one of `list_profiles`' ids (RLS enforces it too). Returns compact
  rows `{ id, name, type, rarity, level, refits, stats: { hp, attack, defence, speed, crit, critDamage, hacking, security, … } }`
  with **final** stats from `calculateTotalStats` (gear + implants + refits + engineering for the
  ship's type), plus `total` so the agent knows when a filter truncated.

### `src/services/fleetReads.ts` — shared read path (extraction)

The fleet read code currently lives in React contexts and uses the global `supabase` client
(`src/config/supabase.ts`, which reads `import.meta.env` and cannot run in a function):

- `ShipsContext.tsx` — the nested `ships` select (base stats, equipment, refits + refit stats,
  implants, `ship_templates!inner` skill columns) and `transformShipData`;
- `InventoryProvider.tsx` — `loadBatch`: keyset-paged `inventory_items` by `id`, `BATCH_SIZE`,
  retry, and `transformGearData`;
- `EngineeringStatsProvider.tsx` — the `engineering_stats` read.

Extract each into a pure function taking `(db: SupabaseClient, profileId: string)`:
`fetchShips`, `fetchInventory`, `fetchEngineeringStats`, returning the same domain objects the
contexts build today (including the #568/#569 read guards). The contexts call these with the
global client; their state, storage and migration handling stay where they are. Behaviour is
unchanged — this is the riskiest part of the spec because every signed-in load goes through it.

### `netlify/functions/mcp.ts` — adapter

Token verification, admin gate, per-request server/transport, protected-resource metadata. Its
`config.path` covers `/mcp`, `/.well-known/oauth-protected-resource`,
`/.well-known/oauth-protected-resource/mcp`. It holds no tool logic.

Verification pieces live in `src/mcp/auth.ts` (`verifyAccessToken(token, { jwks, issuer })` →
`{ sub, clientId }` or throws a typed `AuthError('unauthenticated' | 'not_oauth')`) so they are
unit-testable with a local key set.

### `src/pages/OAuthConsentPage.tsx` + route `/oauth/consent`

- Not signed in → the existing Google sign-in, returning to the same URL.
- Signed in, **not admin** → "MCP access is currently limited to admins" and a Deny that calls
  `denyAuthorization`. The same gate as the function: once DCR is on, any registered app can send
  a player here, and nobody but an admin can approve while the gate stands.
- Admin → `getAuthorizationDetails(id)`; show client name, the redirect URI's host, the signed-in
  email, and "Read-only access to your ships, gear and engineering stats"; Approve / Deny via
  `approveAuthorization` / `denyAuthorization` (default redirect).
- Missing/invalid `authorization_id` or an API error → an error card, no buttons.
- Built from `Button`, `card`, and existing layout components; no raw buttons or custom boxes.

The admin check on the page is a UX gate; the function's check is the enforcement.

### Dependencies

`@modelcontextprotocol/sdk`, `jose` → **`dependencies`** (shipped runtime, so `npm run audit`
covers them). Rewrite `package.json`'s `//dependencies` comment from "packages that end up in the
browser bundle" to "shipped runtime — the browser bundle or a Netlify function".

## Errors

| Case | Response |
|---|---|
| No token / bad signature / wrong `iss` / expired | HTTP 401 + `WWW-Authenticate` with `resource_metadata` |
| Valid token, no `client_id` | HTTP 401, same header |
| OAuth token, not admin | HTTP 403, JSON-RPC error "MCP access is currently limited to admins" |
| Non-POST on `/mcp` | HTTP 405 (stateless: no GET/SSE stream, no DELETE session) |
| Tool input fails Zod | tool result `isError: true`, the validation message |
| Supabase error | tool result `isError: true`, a short message; no stack, no SQL |
| `PT403` from the spec-1 hook | tool result `isError: true`, "this tool cannot change your data" |
| Unknown profile id | tool result `isError: true`, "not one of your profiles" |

## Testing

- `src/mcp/__tests__/auth.test.ts` — `verifyAccessToken` against a locally generated ES256 key
  set (`jose.generateKeyPair('ES256')` + `createLocalJWKSet`): good token; expired; wrong issuer;
  wrong key; missing `client_id` → `not_oauth`.
- `src/mcp/__tests__/tools.*.test.ts` — each tool's `run` against a fake `ctx.db` (a minimal
  chainable stub returning fixtures): input validation, filters, limits, `total`, error mapping.
- `src/services/__tests__/fleetReads.test.ts` — pins each extracted function's output to the
  transform the contexts produce today, using the same raw-row fixtures the existing context
  tests use, and that inventory paging walks past one `BATCH_SIZE`.
- The existing context tests (ships, inventory, engineering, `idReadsArePaged`) stay green
  unchanged — they are the tripwire that the extraction did not move behaviour.
- `src/pages/__tests__/OAuthConsentPage.test.tsx` — mocked `supabase.auth.oauth`: admin sees
  details + Approve calls `approveAuthorization`; non-admin sees the gate and only Deny; missing
  `authorization_id` shows the error card.
- `scripts/oauth-probe.ts` (manual, not in CI) — see Rollout step 5.

## Rollout (the user)

1. PR merges to `main`.
2. In Netlify → Environment variables, confirm `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
   have the Functions scope. Cut a release. Consent route and `/mcp` are live; with the OAuth server off nobody can get a token.
3. Check routing on prod: `curl -i -X POST https://starborneplanner.com/mcp` must return 401 with
   the `WWW-Authenticate` header, and `curl https://starborneplanner.com/.well-known/oauth-protected-resource`
   JSON — **not** `index.html`. Netlify does not document whether a function's custom path beats
   the SPA's `/* → /index.html 200` rewrite; if HTML comes back, add `force = true` rewrites for
   these paths above the catch-all in `netlify.toml`.
4. Supabase dashboard: Authentication → URL Configuration: Site URL is
   `https://starborneplanner.com`. Authentication → OAuth Server: enable, Authorization Path
   `/oauth/consent`, Allow Dynamic OAuth Apps on.
5. Connect from Claude, approve, exercise each tool.
6. **Auth API probe.** Claude does not expose its token, so `scripts/oauth-probe.ts` (run with
   `npx tsx`, Node 22) does its own flow: registers a client via DCR with a
   `http://127.0.0.1:<port>/callback` redirect, opens the authorize URL, receives the code on a
   one-shot local server, exchanges it with PKCE, then calls `PUT <SUPABASE_URL>/auth/v1/user`
   with `{ "data": { "mcp_probe": "<timestamp>" } }` and prints the status. It also confirms a
   Data API `POST` with the same token gets 403 (spec 1, end to end).
   - Rejected → the Auth API is closed to OAuth tokens; the gate can be lifted.
   - Accepted → closing it blocks the public rollout; the admin gate stays.

## Out of scope

- Lifting the admin gate, per-user rate limiting and the usage counter (needs spec 1's one
  allowlisted RPC), changelog entry, DocumentationPage section — the rollout PR.
- A stdio transport — handler unit tests cover the same logic.
- `simulate_battle`, `sweep_stat` — spec 3.

No changelog entry: admins only, nothing a player sees.
