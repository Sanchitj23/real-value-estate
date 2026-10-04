# Go Build Complete

Okay go and build end to end

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://real-value-estate.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/8bc811e8-9522-442a-9b07-140749a8647b).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
# Deployment of the corrected data and legal engine

See [LOVABLE_DEPLOYMENT.md](./LOVABLE_DEPLOYMENT.md) for the migration, bundled dataset import, verification and Lovable publish steps. Apply migration `0002_evidence_integrity.sql` before publishing this update. Git sync, database migration and updating the live site are separate steps.


## Run locally

```sh
npm install
npm run dev      # normal run: every page asks for sign-in
npm run demo     # local demo on http://localhost:5199 without sign-in (see DEMO.md)
npm test         # engine and page tests
```

The app reads its data from the hosted database named in `.env`, so it needs internet. Reading legal texts, placing
addresses and AI summaries run only on the hosted server, signed in as staff, from **Data & jobs**.

## How it works

1. **Read** — an AI reader turns each supplied legal text into structured rules. Every rule must quote its source
   exactly or it is rejected (`src/lib/admin.functions.ts`, `src/lib/engine/validation.ts`).
2. **Place** — each address is resolved to its legal city with the US Census geocoder; the mailing city is only a
   search hint (`src/lib/engine/geocode.ts`).
3. **Apply** — a pure TypeScript engine evaluates every rule for every address and date with three-valued logic:
   applies, unknown, not yet effective, pending (`src/lib/engine/applicability.ts`).
4. **Explain** — results are shown as actionable points, a report per address, a law-changes view and a map; the
   same engine produces `rules.json`, `lookups.json` and `changes.json`.

Not legal advice. Prototype using supplied public sources.
