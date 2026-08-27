# Circuit

A private fitness and accountability app for a small training group. Replaces the
daily WhatsApp workout and weigh-in updates with something the group actually
wants to open.

Mobile-first. Works offline. No backend yet — but the seams for one are already
cut.

```bash
npm install
cp .env.example .env   # then add your keys — see "Food scanning" below
npm run dev       # http://localhost:5173
npm run build     # typecheck + production build + service worker
npm run verify    # runs the data layer headlessly and checks the numbers
npm run icons     # regenerates the PWA icons
```

## Where things are

```
src/
  models/       TypeScript entities — normalised, backend-ready
  lib/db.ts     Dexie (IndexedDB) schema, one store per entity
  data/         Exercise library, plan templates, achievements, copy, seed data
  services/     The only code that touches storage
  utils/        BMI, BMR/TDEE, consistency, streaks, progress, dates, formatting
  context/      Auth, theme, toasts, the quick-log sheet
  components/   ui/ primitives, plus home/, group/, workout/, profile/, charts/
  pages/        One file per screen
  layouts/      App shell: bottom nav on phones, sidebar on desktop
  styles/       Design tokens and base styles
```

### The two scanners are the only network dependencies

Everything else in this app is local. Both scanners are the exception: each
sends a compressed copy of an image to an endpoint of ours, which runs on the
server and holds the credentials.

**Food** (`/api/food-scan`) *interprets* a photograph: a vision model says what
is on the plate, a nutrition database values it, and the result comes back as
structured JSON.

**Workouts** (`/api/workout-scan`) *transcribes* a screenshot. Workouts happen
in Home Workout, Lose Weight for Men and the rest; those apps have already
counted the minutes and the calories and printed them on a summary screen, so
this reads that screen rather than estimating anything. Every field it cannot
read comes back missing, the review form asks for it, and nothing is saved
until the user confirms.

```
browser                      server (server/foodScan/)
───────                      ─────────────────────────
pick photo
  ↓ downscale to ~1024px
POST /api/food-scan  ──────▶ GeminiFoodVisionProvider   → what is in the photo
                             FoodDataCentralNutrition…  → what that food contains
  ◀───────────────────────── structured, validated JSON
review + correct
  ↓ confirm
save nutrition to Dexie
release the object URL


browser                      server (server/workoutScan/)
───────                      ────────────────────────────
pick screenshot
  ↓ downscale to ~1024px
POST /api/workout-scan ────▶ GeminiWorkoutVisionProvider → what the screen says
                             validate → drops anything doubtful, lists the gaps
  ◀───────────────────────── structured fields + `missing`
review + fill the blanks
  ↓ confirm
save the workout session to Dexie
release the object URL
```

Neither image is ever stored. Not in IndexedDB, not in a record, not on the
server — it exists as an object URL while the review is on screen and is
revoked on confirm, on cancel and on unmount. `npm run verify` sweeps every
table for blobs, data URIs and oversized strings and fails if it finds one.

Set up:

1. `cp .env.example .env`
2. Get a Gemini key at <https://aistudio.google.com/apikey> and put it in
   `GEMINI_API_KEY`.
3. Get a free USDA FoodData Central key at
   <https://fdc.nal.usda.gov/api-key-signup> and put it in `FDC_API_KEY`.
   Without it, foods are still identified but arrive with zeroed nutrition for
   you to fill in.
4. `npm run dev`.

The Gemini key serves both scanners. Both keys are read only by the Node
process. Vite exposes just `VITE_`-prefixed
variables to the browser, so neither can reach a user's device — and the build
is checked for that in `npm run verify`.

There is no fallback to sample data in either flow. If analysis fails the user
is told and offered manual entry. `FOOD_SCAN_MOCK=1` and `WORKOUT_SCAN_MOCK=1`
swap in obviously-labelled placeholders for UI work; both are ignored when
`NODE_ENV=production`, and neither is ever used as a fallback when the real
provider fails.

### Services are the seam

Every screen reads and writes through `src/services/*`. Nothing else imports
`db` directly. Swapping IndexedDB for Firebase, Supabase or a REST API means
rewriting the bodies of those service methods — no screen has to change.

`authService` is deliberately honest about being local-only: it takes a passcode
argument it does not check, so the login form and its validation survive the move
to a real backend.

### Calculations live in one place

`utils/` owns every number: BMI, Mifflin-St Jeor BMR, TDEE, calorie and macro
targets, weight progress, weekly consistency, streaks. Components format results;
they never compute them.

### The data is normalised

Records reference each other by id and stay small enough to move to a real
database. Nothing stores binary data:

- **Progress photos** are metadata plus a `storageRef` — the image belongs in
  device storage or object storage, never in a database row.
- **Food photos** are never persisted at all. When the scan flow lands, the image
  is analysed and discarded; only the resulting nutrition numbers are saved.
- **Motivation videos** are external URLs (YouTube/Vimeo). We never host video.

### Ownership

All members can see all members' progress — that is the point of the app.
Only the owner can edit their own profile and entries: `useAuth().isOwner(id)`
gates the edit affordances, and `/u/:userId` simply does not render them. When a
backend arrives, the same rule moves into security rules.

## What is built

**Phases 1–6: foundation, daily dashboard, the workout system, the
weight/health/progress engine, nutrition, and the group/motivation layer.**

- Local auth: pick a member or sign in by username; session persists across reloads
- Mobile bottom nav with a raised log action; desktop sidebar and two-column home
- Home: greeting, stories rail, and the group's feed — write a post with an
  optional photo and an optional workout/weigh-in/steps/achievement attached,
  choose who can see it, react, comment in the overlay, and edit or delete your
  own; long captions fold behind "See more"
- Quick-log sheet: weight, steps, water, food, check-in
- Workout, in three tabs (Today / Plan / History):
  - **Player** — a full-screen mode outside the app shell: prep screen, one
    exercise at a time, per-set logging, rest countdown with skip and +15s,
    countdown for timed holds, pause/resume, skip exercise, undo a set, and a
    completion screen with difficulty and an optional note
  - **Plan** — day-by-day progress through the active plan, and plan switching
    that never touches finished history
  - **History** — all-time stats, month calendar separating workout days from
    scheduled rest days, expandable per-session exercise breakdown, weekly
    summary with week navigation, and personal bests once real sets exist
- Progress, in four tabs (Journey / Body / Energy / Group):
  - **Journey** — goal progress in any direction, the official weekly weigh-in
    against last week's, trend chart with a goal line, consistency breakdown,
    plain observations drawn from the records, and a filterable weight history
    where entries can be corrected or deleted
  - **Body** — BMI with a what-if calculator that saves nothing, plus body
    measurements with charts only where there is enough data to draw one
  - **Energy** — BMR → TDEE → goal adjustment → daily target and macro split,
    hedged as estimates throughout
  - **Group** — everyone compared on progress toward their own goal, never on
    raw kilograms
- Nutrition: calorie and macro totals against the estimated target, meal
  sections with edit and delete, water with quick adds and a seven-day read,
  day-by-day history, and a food scanner that fills in an estimate from a photo
  which is **never stored** — see "The data is normalised" above
- Profile: full stats, BMR/TDEE/calorie/macro targets, achievements, editing
- Our progress: every member's goal, weight journey, weekly change, training,
  steps, consistency and streak — compared on progress toward each person's own
  goal, never on kilograms; plus friendly weekly categories and the group feed
- Updates: the full feed grouped by day, with four reactions and no comments
- Weekly review: your week, week-over-week comparison, and plain sentences
  drawn from the records — with an honest "not enough history yet" when there
  isn't a previous week
- Achievements: derived from what you actually logged, never granted
- Motivation: external video links (metadata only) with add/edit/remove, plus
  the daily line on Home
- More: group directory, light/dark/system theme, demo data reset, sign out
- PWA: installable, standalone, offline precache, generated icons
- Light and dark themes, friendly empty states, no raw errors

**Not built yet** (later phases): nutrition screen and food photo scanning,
progress photos, motivation video collection, weekly review page,
health-platform integrations, exercise artwork.

## Seed data

Seeds on first run and anchors every date to *today*, so the demo never goes
stale. Three members with distinct goals and histories, built from the numbers
the group has actually been posting:

| | Ahmed | Nadia | Samir |
|---|---|---|---|
| Weight | 82.0 → 76.8 kg | 87.3 → 84.2 kg | 73.2 → 71.4 kg |
| Goal | Lose weight, 72 kg | Lose weight, 78 kg | Get fitter, 70 kg |
| Streak | 12 days | 8 days | 15 days |

Ahmed's history reproduces the reference numbers exactly — this week 4 workouts /
41:08 / 868.4 kcal, last week 5 / 49:10 / 1,038.0 kcal, 56,421 steps this week,
1,840 kcal eaten today. Those are *derived* from individual records, not
hard-coded strings: `npm run verify` seeds a fresh database and asserts them.

`More → Data → Reset to demo data` restores it all.

## Notes

- Calorie burn is a MET-based estimate and is labelled as one everywhere it appears.
- BMI is shown with the explicit caveat that it is one signal among several.
- Streaks survive today not being logged yet; only a fully missed day breaks them.
- Consistency is weighted toward training and capped per part, so one strong area
  cannot mask a missing one — and one bad day does not read as failure.
