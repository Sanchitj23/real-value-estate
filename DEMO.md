# Local demo and 60-second video

## Run it locally without signing in

```sh
npm install
npm run demo
```

Then open <http://localhost:5199/dashboard>.

`npm run demo` starts the app in **demo mode**: pages open without the sign-in screen. It works only in this local
development run on `localhost`; the published site and `npm run dev` always ask for sign-in. Demo mode needs internet,
because it reads the same live public sample data as the published site.

What is different in demo mode:

- No account is signed in, so staff pages (Rule review, Data & jobs, Console) are not available.
- Plain-language AI summaries are off (they need an account and the hosted AI key). The instant answers, reports,
  law changes and the map all work.

**Before recording, open each link below once.** The first visit to a page takes about ten seconds while it compiles
and loads the data; after that the data is kept for ten minutes and pages open at once.

## Links that open a ready-made state

| What it shows | Link |
|---|---|
| Home, empty | `http://localhost:5199/dashboard` |
| Home with an answer already asked | `http://localhost:5199/dashboard?ask=What%20rental%20rules%20apply%20at%203438%20McKinley%20Ave%2C%20Los%20Angeles%3F` |
| Map zoomed to that address | `http://localhost:5199/map?address=A0474&layer=cat:security_deposits` |
| Map of New Jersey, by pricing-software rules | `http://localhost:5199/map?state=NJ&layer=cat:algorithmic_rent_setting` |
| Law changes | `http://localhost:5199/changes` |
| Full report for one address | `http://localhost:5199/property/A0474` |
| Address list filtered to a street | `http://localhost:5199/renter?q=clinton` |

## 60-second shot list

Record at 1280 × 800 or larger. Times are targets.

| Time | Screen and action | Say |
|---|---|---|
| 0–7 s | Home. Click the box, type `3438 McKinley Ave, Los Angeles`, press **Get answers**. | "Rental law is scattered across state and city codes. Type an address and ask." |
| 7–20 s | The answer card appears. Pause on the headline, then scroll slowly past the green points and the **Check** points. | "In seconds you see what applies, with the key figure, and exactly which facts would settle the rules that only may apply. Nothing is guessed." |
| 20–24 s | Click **See the legal text** on the first point, show the quoted sentence, go back. | "Every rule carries the exact sentence it came from." |
| 24–36 s | Click **Show on the map**. The map flies to the address. Click the **Rent increases** and **Pricing software** pills; the colours change. | "The map shows the same answers by place. Pick a topic and every address and city recolours." |
| 36–44 s | Click **New Jersey**, open **Or a law change…**, choose the FAIR Act. Click a city outline. | "Or pick a law: New Jersey's FAIR Act starts on 1 July 2027 and reaches every New Jersey address in the sample." |
| 44–52 s | Open **Law changes**. Show **Starting soon** and **Proposed**, click **See addresses** on one card. | "Law changes lists what is starting, what is only proposed, and who each one reaches." |
| 52–60 s | Open the full report for the address. Show the six topic cards, open one **Why, and the legal text**. | "Each answer is traceable to its source, dated, and labelled not legal advice. That is Housing Law Navigator." |

Tips for a clean take:

- Use the ready-made links to jump straight to a state if a click sequence is slow.
- The legend on the map is clickable: clicking a row hides those addresses, which makes a clear visual beat.
- Keep the mouse still while an answer loads; the answer card appears in one piece.
