# Roadmap (from DASHBOARD_AND_WORKFLOW_GAPS.md)

- [x] Dashboard readiness model (import / extraction / geography / review) with one next action; loading + error states
- [x] Renter page reads `q` search param from dashboard
- [x] Property report: no false "no missing facts" when no rules evaluated
- [ ] Run real extraction + geocoding — BLOCKED: needs admin signed in in the browser + AI credits
- [x] Category summaries show mixed outcomes instead of one ranked status
- [x] Separate legal / operational / review status vocabularies
- [x] Address lookup: search + result cards first, table behind advanced view
- [x] Comparison shows actual terms, dates, evidence
- [x] Scenario form patches only changed fields
- [x] T2 semantic identity validation; T5 validates all MA cap outcomes
- [x] Export: separate A+B readiness from C checks
- [x] Supplemental versioned source intake; show missing-text dependencies
- [x] Truthful persisted job progress; resume pending by default
- [x] Dataset-scope mappings/relations/monitoring

## Product pass (assistant, credits, map, plain-language pages)

- [x] Home is the assistant; readiness checklist moved to staff Data & jobs
- [x] Assistant with 2 free questions per account, credit requests, admin grants (Console → Users)
- [x] Account page (profile, plan, credits, password); password reset on the sign-in page
- [x] Property report: at-a-glance topic cards, short rule rows, evidence behind "Why, and the legal text"; print view
- [x] Law changes: starting soon / proposed / recently started, addresses reached, compare two dates
- [x] Interactive map: OpenStreetMap tiles, Census city outlines, colour by topic or by law change
- [x] Geocoder: city search hint, ZIP fallback, street-range fallback
- [x] Reader v3 (`extract-v3-scope`): coverage vs conduct, relative effective dates; older automatic rules retired per source
- [x] One button on Data & jobs: read remaining texts, place addresses, link T1–T5 IDs
- [ ] Run that button as admin after publishing — needs the admin signed in and AI credits
- [ ] Source texts still missing for Hoboken, Jersey City (pricing-software ordinances), Newark and the MA ballot ruling — T2 and T5 stay blocked until supplied
