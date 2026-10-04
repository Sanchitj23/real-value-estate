<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Housing Law Navigator architecture
- Legal evaluation lives only in `src/lib/engine/` (pure TS, three-valued logic); UI renders its results and never reinterprets law — keeps all workspaces consistent.
- Engine reads go through public server fns in `src/lib/engine.functions.ts`; staff writes (import, extraction, geocoding, review) go through `requireSupabaseAuth` server fns in `src/lib/admin.functions.ts` with role checks — RLS stays authoritative.
- Rule edits and re-extractions insert a new `rule_versions` row (is_current flip), never update in place — preserves audit trail.
- Scenarios are patches applied in memory at evaluation time, never written to rules — hypotheticals must not overwrite law.
- Long jobs are client-driven loops over bounded server calls (one text chunk / ten addresses) that skip finished work — resumable within Worker limits.
- The requirement quote, status, dates and headline value must match stored source text (exact or whitespace-collapsed) or the rule is invalid; a missing or unmatched coverage/exemption quote only leaves that scope "unknown" with a warning.
- Public surface is only the landing (/) and /auth; all workspaces live under src/routes/_authenticated/ with a sidebar dashboard layout — app is sign-in first.
- Imports require 500 properties and 87 references with at least the 54 baseline texts; supplemental texts arrive as a new dataset version — history stays immutable.
- Scope has three states: checked conditions (evaluated), wording that exists but could not be checked (unknown), and no wording at all (answer given with the assumption stated in `assumptions`) — "unknown" is reserved for answers that depend on a missing fact.
- Effective dates may be derived, always labelled: from a quoted relative clause plus the enactment date, or for a California state statute with no stated date, 1 January after enactment. Year built decides a certificate-of-occupancy cutoff except in the cutoff year.
- `PIPELINE` in `engine/extraction.ts` versions the reading instructions; bumping it re-reads every part, and `finishSource` then retires the older automatic rules of each fully re-read source (reviewed rules are kept).
- Geocoding uses the postal city only as a search hint (`engine/geocode.ts`); the legal city always comes from the returned Census geography.
- The assistant (`assistant.functions.ts`) only words facts the engine produced and never decides applicability; it uses the low-cost model in `ai.server.ts`, and falls back to templated wording at no charge if the model is unavailable.
- Assistant credits are an append-only ledger in `audit_log` (`assistant.query`, `credits.grant`, `credits.request`) read with the service role — no extra table; staff are not metered; browsing is never metered.
- Plain-language labels live in `engine/plain.ts`; the home page is the assistant, and readiness/jobs live only on the staff Data & jobs page.
- `src/test/pages.test.tsx` renders every signed-in page with in-memory stand-ins; keep it passing when changing a page.
- Asking a question first returns `getInsights`: a public, AI-free read that turns engine results into actionable points (`engine/insights.ts`); the AI summary is an optional second step that uses a credit. Keep the first step free of AI and accounts.
- `npm run demo` (Vite mode "demo") skips only the client-side sign-in redirect, and only in a dev build on localhost (`src/lib/demo.ts`). Never widen that gate or let it reach server authorization; production builds strip it.
- Map tiles are OpenStreetMap standard tiles (no key); CARTO basemaps now require an API key.
