# TaniSPPG — Integration Guide

Everything in this zip is a complete, deployable Next.js project. This guide explains **what each file does**, **how they connect**, and **the exact order to wire it all up**.

---

## Part 1 — The big picture

The app has TWO operating modes, switchable from a toggle in the dashboard header:

```
SIM MODE (default, zero setup)          LIVE MODE (full pipeline)
─────────────────────────────           ──────────────────────────────────────
Dashboard button click                  Dashboard button click
  → lib/sim.js generates 60-70            → POST /api/wa/blast
    deterministic replies                   → Supabase: create demand + item
    (offers, declines, unclear)             → farmers_to_notify() [PostGIS]
  → ticker + ranking + map                  → Fonnte sends real WA messages
    all run in browser memory           Farmer replies on WhatsApp
                                          → Fonnte POSTs /api/wa/webhook
NO database, NO API keys needed.          → lib/parser.ts (Gemini + regex)
This IS your demo-day insurance.          → offer → `applications` table
                                          → everything → `wa_inbound_log`
                                        Supabase Realtime pushes to dashboard
                                          → ranked_applications view (SQL scoring)
                                        Confirm click → /api/applications/confirm
                                          → farmer gets WA with pickup logistics
```

Sim and live render through the SAME components — judges cannot tell the UI apart, which is exactly the point: if live fails on stage, flip the toggle and keep talking.

---

## Part 2 — File-by-file map

### Config & infrastructure

| File | What it is | What you need to do |
|---|---|---|
| `package.json` | Dependencies (Next 14, Supabase, Gemini SDK, lucide) | `npm install`. Nothing to edit. |
| `tsconfig.json` | TS config; `@/*` alias; allows the `.jsx` components | Nothing to edit. |
| `.env.example` | Template for every secret | Copy → `.env.local`, fill in. Add the same vars in Vercel. |
| `.gitignore` | Keeps `.env.local` out of git | Nothing. Just never delete it. |
| `supabase/schema.sql` | Entire database: tables, PostGIS ranking view, `farmers_to_notify()`, reliability trigger, Realtime publication, seed data (1 SPPG + 50 farmers + 8 commodities), RLS | Paste the WHOLE file into Supabase SQL Editor → Run once. |

### Shared libraries (`lib/`)

| File | What it does | Used by |
|---|---|---|
| `lib/sim.js` | The simulation engine. 96-farmer seeded roster, reply generation with `kind: offer/decline/unclear`, `staggerDelay()` (first 8 replies slow + visible, rest accelerate so ~65 replies land in ~9s), `LOGISTICS` constants, formatting helpers | `components/dashboard.jsx`, `components/landing.jsx` |
| `lib/supabase.ts` | Two clients: `supabaseBrowser()` (anon key, read + Realtime, returns `null` if env missing → app gracefully stays in sim) and `supabaseAdmin()` (service key, writes, **server only**) | dashboard (browser), all API routes (admin) |
| `lib/parser.ts` | Gemini Flash parser with the full Bahasa/Sunda prompt + few-shots, and a regex fallback that catches "YA 80 9000" formats if Gemini is down. The fallback means a Gemini outage cannot kill your demo | `app/api/wa/webhook/route.ts` |

### Pages & components

| File | What it does | Notes |
|---|---|---|
| `app/layout.tsx` | Loads Fraunces / Work Sans / Space Mono via `next/font` (no FOUT flash, no `@import`) and applies them as CSS variables | Nothing to edit |
| `app/globals.css` | Your design tokens (`--sawah`, `--gold`, `--clay`…) + shared button/input classes, `prefers-reduced-motion` support | Edit here to retheme everything at once |
| `app/page.tsx` → `components/landing.jsx` | Your landing page, visually unchanged. Fixed: accordion chevron no longer hijacks navigation; buttons are real `<button>`s; petani chip reads `ROSTER_SIZE` so screen matches deck; router navigation instead of view-state | Content edits (copy, stats) go in `landing.jsx` |
| `app/dashboard/page.tsx` → `components/dashboard.jsx` | The main product. All v2 fixes live here (see Part 4) | This is the file your FE dev owns |

### API routes (`app/api/` — live mode only)

| File | Trigger | What it does |
|---|---|---|
| `wa/blast/route.ts` | Dashboard "Kirim permintaan" in live mode | Creates commodity (if new) + demand + demand_item, runs `farmers_to_notify()`, sends Fonnte WA to each recipient **capped by `BLAST_MAX_RECIPIENTS`** (default 10 — so you can't accidentally spam 50 fake numbers), logs to `wa_outbound_log`, returns `demandItemId` |
| `wa/webhook/route.ts` | Fonnte POSTs here on every inbound WA | Identifies farmer by number → finds the last demand they were notified about → parses with Gemini → offers upserted into `applications` (Realtime pushes to dashboard), ALL replies logged to `wa_inbound_log` (so declines/unclear show in the ticker) → sends auto-acknowledgment WA ("Penawaran dicatat…") or clarification request for unclear replies |
| `applications/confirm/route.ts` | Dashboard "Konfirmasi" click in live mode | Marks application `accepted`, creates `matches` row (which arms the reliability-score trigger), sends the farmer their win WA including Gapoktan pickup logistics |

---

## Part 3 — Setup, in order (60–90 min total)

### Step 1 — Local project (10 min) — [FE dev]
```bash
unzip tanisppg-app.zip && cd tanisppg-app
npm install
cp .env.example .env.local        # leave values empty for now
npm run dev                        # http://localhost:3000
```
✅ Checkpoint: landing renders, dashboard works fully in **sim mode** with zero config. Everyone on the team can develop UI without any keys.

### Step 2 — GitHub + Vercel (10 min) — [FE dev]
```bash
git init && git add -A && git commit -m "TaniSPPG v2" && git push
```
Import the repo at vercel.com → deploy. You now have a public URL — **required before Step 5**, because Fonnte's webhook needs it.

### Step 3 — Supabase (15 min) — [BE dev]
1. supabase.com → New project (Singapore region)
2. SQL Editor → paste ALL of `supabase/schema.sql` → Run
3. Verify: `select count(*) from farmers;` → 50
4. Settings → API → copy URL, `anon` key, `service_role` key into `.env.local` AND Vercel env vars
5. **Point 2–3 farmers at your team's real numbers:**
```sql
update farmers set wa_number = '+62812XXXXXXX'
where id in (select id from farmers limit 1);
```
(Repeat with `offset 1`, `offset 2` for more teammates.)

### Step 4 — Gemini (5 min) — [INT dev]
aistudio.google.com → Get API key → `GEMINI_API_KEY` in `.env.local` + Vercel.

### Step 5 — Fonnte (15 min) — [INT dev]
1. fonnte.com → register → connect a **spare** WA number (scan QR)
2. Copy device token → `FONNTE_TOKEN` in `.env.local` + Vercel
3. Device settings → **Webhook URL**: `https://YOUR-APP.vercel.app/api/wa/webhook`
4. Smoke test outbound with curl before touching the UI:
```bash
curl -X POST https://api.fonnte.com/send \
  -H "Authorization: YOUR_TOKEN" \
  -d "target=+628XXXXXXXXX" -d "message=tes tanisppg"
```

### Step 6 — Full live round-trip (15 min) — [ALL]
1. Redeploy on Vercel (env vars need a fresh deploy to apply)
2. Open `/dashboard` → toggle **Live** → "Kirim permintaan ke petani"
3. Teammate's phone receives the WA → reply: `punya 80kg pak harga 9rb`
4. Watch the dashboard: reply appears in the ticker with parsed pills, ranked list updates — no refresh needed (Realtime)
5. Click **Konfirmasi** → teammate receives the win WA with pickup logistics

✅ This moment (step 6.5 working end-to-end) is your hour-4 checkpoint from the build playbook. Record a screen video of it NOW — that's your insurance clip.

---

## Part 4 — What changed vs your prototype (so you can review the diff)

1. **[BUG FIX] Per-ingredient timers.** `timersRef.current` is now a map keyed by ingredient id. Broadcasting tomat while wortel is mid-stream no longer kills wortel's replies (your version cleared ALL timers globally — reproducible by switching tabs mid-broadcast).
2. **[BUG FIX] Stale offers on edit.** Changing distributor price or unit after replies arrived resets that ingredient with a visible hint ("Harga diubah — kirim ulang"). Previously the map and ranking could show contradictory prices.
3. **[BUG FIX] `demand` clamped ≥ 1.** No more Infinity → 100% progress bar on a zero demand.
4. **[BUG FIX] Accordion chevron** on the landing no longer navigates away; accordion heads are real buttons (keyboard accessible).
5. **[NEW] Decline/unclear replies.** ~14% of simulated farmers decline ("teu aya stok ayeuna pak") and ~7% send something ambiguous ("ada sih lumayan"). The ticker renders them gray/amber with "difilter otomatis" / "AI minta klarifikasi" tags. In live mode these come from `wa_inbound_log`. **This visibly answers the judge question "what about messy replies?" before it's asked.**
6. **[NEW] Roster 12 → 96 farmers** with an accelerating reply stagger (~9s total instead of 50s). The landing's "petani terdaftar" chip reads the real constant, so **screen now matches deck**. Named farmers (Pak Ujang, Bu Euis…) reply first-ish for the readable demo moment.
7. **[NEW] Logistics card.** Once any farmer is confirmed, the Gapoktan pickup card appears (aggregator / schedule / meeting point + "WA terkirim ke N petani"). Closes the koperasi loop on screen.
8. **[NEW] Sim/Live toggle** wired to the full backend. Fonts moved to `next/font`. Reduced-motion respected.

---

## Part 5 — Demo-day runbook

- **Rehearse in sim mode.** It's deterministic — the same ingredient always produces the same replies in a shuffled order, so your narration always matches.
- **Open in live mode** for the wow moment: one real WA round-trip on a phone (blast → reply → ticker updates live → confirm → win WA).
- **If anything live hiccups on stage:** flip the toggle to Simulasi mid-sentence and keep going — same UI, zero dead air. That toggle is your parachute; practice pulling it once.
- **The numbers to say out loud** come from the summary card (balasan masuk / penawaran valid / hemat %) — they're computed from what's actually on screen, so pitch and product can't contradict each other.
- Keep `BLAST_MAX_RECIPIENTS=10` for the demo. Raise it only if you've pointed more real numbers at seed farmers.

## Part 6 — Known limitations (honest Q&A prep)

- Fonnte is an unofficial WA gateway — fine for a pilot pitch, production would move to the WhatsApp Business API. Say this proactively if asked about scale.
- Live mode's "menerima balasan" state never auto-completes (real replies trickle in for hours); the Reset button is your manual exit.
- Live confirmations are final (the farmer already got the WA); sim confirmations toggle freely.
- One SPPG is hardcoded (first row). Multi-SPPG = post-hackathon.
- The radar map is schematic (distance + hashed angle). If judges ask about real geo: the *ranking* distances ARE real PostGIS `ST_Distance` calculations — the radar is just the visualization; Leaflet is the planned upgrade.
