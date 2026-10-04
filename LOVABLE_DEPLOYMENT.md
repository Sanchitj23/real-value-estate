# Deploy the corrected Housing Law Navigator

## What is ready in this repository

- Missing or unverified coverage, exemptions and operative dates stay unknown.
- Extraction checks field-specific quotes, calendar dates and executable conditions.
- Review requires fresh quotes for changed legal assertions. Publishing a rule and its evidence is transactional; failed candidates do not replace a valid current interpretation.
- Import activation and geography replacement are transactional. Completed source/property snapshots are immutable to application users.
- Extraction resumes each missing document part for the current pipeline/model. Running-part leases prevent duplicate simultaneous model calls.
- Material requirement/formula changes are detected even if both versions still apply.
- Renter, manager, map and property views share an evaluation date. Reports expose condition traces, missing-fact questions and source retrieval dates.
- Geography contradictions remain ambiguous. Unresolved addresses can be retried. Manager city filtering uses resolved legal municipality.
- Final exports have readiness gates and supplied-case specification checks. Diagnostic exports remain available separately. Each export stores frozen inputs/output in the staff audit log and downloads a receipt.
- Scenarios pin the edited rule version and are restricted to their creator/project admin. Raw model runs are restricted to staff.
- Admin can import the supplied bootstrap package directly from the app.

## Deploy in this order

1. Confirm Lovable is connected to `Sanchitj23/real-value-estate`, branch `main`, and has pulled the latest commit. Git synchronization alone does not confirm database migration or publication.
2. Apply **`drizzle/migrations/0002_evidence_integrity.sql`** to the existing Lovable Cloud database using its migration workflow. Keep migrations `0000` and `0001`; do not replay them on an existing database. On a fresh database apply all three in order.
3. Confirm the new `coverage_status`, `exemptions_status`, and `scenarios.base_rule_id` columns and RPCs `publish_rule_version`, `activate_dataset`, and `publish_resolution` exist. Existing database role policies remain authoritative.
4. Confirm the existing server environment has `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `LOVABLE_API_KEY`. Never put service credentials or the AI key in `VITE_*` variables or frontend code. Census geocoding needs no API key.
5. Open the preview and sign in as the existing project admin. In **Data & jobs**, click **Import supplied hackathon dataset**. Confirm the server receipt: **500 properties, 87 references, 54 captured texts, 33 missing/link-only texts**. An already active identical import is a no-op.
6. Run **Extract all pending sources**. This uses Lovable workspace AI credits; keep the tab open. Start with one source if checking gateway access. Reopening Admin resumes unfinished chunks rather than skipping a partly processed document. Running leases expire after 30 minutes; model calls have a 3-minute timeout. A rate-limit/credit failure stays resumable.
7. Run geography resolution, inspect ambiguous/no-match results, review extracted rules against their sources, and map T1–T5 IDs to the correct provisions. Do not manufacture a missing Hoboken source, operative date, exemption or result to make a case pass.
8. Check renter reports, manager filters, reviewer evidence/history, hypothetical scenarios and diagnostic exports. Specification checks must pass before final exports. The organizer score cannot be computed without the missing official scoring material.
9. Use **Publish / Update** to update the hosted site, then inspect the live URL. Do not equate a successful local build or Git push with a completed production deployment.

## Paste this into Lovable

```text
Use the latest main branch of Sanchitj23/real-value-estate. Read LOVABLE_DEPLOYMENT.md first. The code corrections are already implemented: do not redesign the app, replace the evaluator with chatbot responses, or seed artificial legal results.

Apply the existing migration drizzle/migrations/0002_evidence_integrity.sql to this project's existing Cloud database, preserving its data and prior migrations. Verify the new columns, staff-authorized publishing/import/geography RPCs and updated RLS policies. Check actual migration results; do not claim application merely because the file exists. Confirm the existing server-side Supabase and Lovable AI configuration without exposing credentials.

Run the build, TypeScript check and tests. Use the Admin preview to import the bundled public/data/housing_law_bootstrap.json only if it is not already active. Verify 500 properties, 87 references and 54 captured texts. Do not automatically run all paid AI extraction; show the admin the source/chunk plan and workspace credit requirement first.

Inspect the preview for real database errors, role actions, report uncertainty, evidence validation, resumable chunks, geography ambiguity, pinned hypothetical scenarios and export readiness. Preserve unknowns and all known source gaps. T1–T5 checks are specification diagnostics, not official judge scores. Do not fake passing cases or substitute postal city for jurisdiction.

Publish the validated update to the existing hosted project. Report the actual migration, import, extraction and publication statuses separately, together with any concrete error that remains.
```

## Verification performed locally

- TypeScript compilation.
- Regression tests for the evaluator, temporal precision, typed facts, material changes, evidence, chunk resumption and T1–T5 specification invariants.
- Production build.
- All three SQL migrations executed in a temporary PostgreSQL-compatible PGlite database, with synthetic auth fixtures. Checks covered transactional versioning, stale review, failed-write rollback, invalid-candidate retention, direct-history write rejection, admin role grants, field evidence, Unicode quote offsets, atomic geography replacement, source immutability and anonymous read boundaries.
- All 54 bundled text hashes match their corresponding `local_text_sha256` values. Organizer manifest hash discrepancies remain recorded; matching local hashes does not resolve that provenance gap.

These checks do not establish hosted integration, model quality or legal correctness. Production migration, AI access and published results still require checks in the actual Lovable project.

## Scope and remaining work

This is a corrected **hackathon sample platform**, not a finished nationwide commercial service.

- The supplied corpus still lacks 33 captures; some challenge cases may remain blocked by missing evidence. No official scoring script/answer key was supplied.
- The map is explicitly a coordinate plot with a table fallback, not a street basemap or official jurisdiction-boundary map.
- Manager views cover the supplied public sample, not saved organization/customer portfolios. Do not import private tenant, owner or customer information into these sample tables.
- Browser jobs persist chunk progress but do not keep running after the tab closes. A durable scheduled worker remains separate work.
- Only the selected scenario rule version is pinned. Scenario property/geography facts and other rules are current sample inputs; export receipts freeze the full evaluator input. Scenarios do not reconstruct complete historical case law or legislation histories.
- Provision identities still use document/category/title keys. Review duplicate provisions when re-extraction changes wording. Automatic continuous legal monitoring and complete conflict adjudication are not implemented.
- There is no investor return prediction or “best legal property” score. Legal applicability does not prove compliance, violation, damages or investment value.
- Quote provenance and executable-schema validation do not prove the legal interpretation. Expert review remains necessary.

## Export receipt

`export_id` identifies an immutable staff audit-log entry with action `export.snapshot`. Its detail includes the frozen properties, resolutions, rules, relations, source hashes and exported artifact. To verify `snapshot_and_artifact_sha256`, hash UTF-8 `canonicalJson({snapshot, artifact})` using the helper in `src/lib/engine/change.ts`; `hash_format` is `canonical-json-v1`. The hash covers that combined input/output object, not the downloaded artifact's formatted bytes alone.
