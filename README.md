# AI-Powered ORM (MVP 7-Day POC)

AI-Powered ORM is a web dashboard to:
- Fetch Google Maps reviews by Place ID
- Generate 3 AI reply suggestions per review
- Approve one suggestion and mark the review as `resolved`

## Current Scope
- Day 1: Next.js + Tailwind + Supabase setup
- Day 2: Fetch and persist latest 5 reviews from Google Places
- Day 3: Single-screen dashboard with `pending/resolved` status
- Day 4: AI suggestion generation (3 options) via Gemini Flash 2
- Day 5: Approve flow (`pending -> resolved`)
- Day 6: Validation, timeout/retry, error hardening, QA checklist
- Day 7: Deploy and demo handoff docs

## Tech Stack
- Next.js 16 (App Router)
- TypeScript
- Tailwind CSS
- Supabase (Postgres)
- Google Places API
- Gemini API (`gemini-2.0-flash-lite` by default)

## Quick Start (Local)
1. Install dependencies:
```bash
npm install
```

2. Configure environment:
```bash
cp .env.example .env.local
```
Then fill:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `GOOGLE_PLACES_API_KEY`
- `GEMINI_API_KEY`
- optional: `GEMINI_MODEL` (default `gemini-2.0-flash-lite`)

3. Apply database schema in Supabase SQL Editor:
- Run: `supabase/schema.sql`

4. Run app:
```bash
npm run dev
```
Open `http://localhost:3000`.

## Core Routes
- `POST /api/reviews/fetch`
  - input: `{ "placeId": "..." }`
  - effect: fetch latest reviews from Google Places and upsert to `reviews`

- `POST /api/reviews/generate`
  - input: `{ "reviewId": "uuid" }`
  - effect: generate exactly 3 suggestions and store in `ai_suggestions`

- `POST /api/reviews/approve`
  - input: `{ "reviewId": "uuid", "suggestionId": "uuid" }`
  - effect: mark one suggestion selected and set review status to `resolved`

- `GET /api/health`
  - smoke check endpoint for deployment verification

## Database
- Schema file: `supabase/schema.sql`
- Main tables:
  - `reviews`
  - `ai_suggestions`

## QA and Release Docs
- Day 6 QA checklist:
  - `docs/day6-qa-checklist.md`
- Day 7 deployment checklist:
  - `docs/day7-deploy-checklist.md`
- Day 7 demo runbook:
  - `docs/day7-demo-script.md`

## Build Verification
```bash
npm run typecheck
npm run build
```
