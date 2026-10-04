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
- Extracted quotes must match stored source text (exact or whitespace-collapsed, offsets into stored text) or the rule is marked invalid.
