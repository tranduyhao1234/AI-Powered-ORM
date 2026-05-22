# Day 7 Deploy Checklist (Vercel)

Date: 2026-05-22

## 1) Pre-Deploy
1. Push latest code to GitHub.
2. Confirm local checks pass:
   - `npm run typecheck`
   - `npm run build`
3. Confirm Supabase schema is applied (`supabase/schema.sql`).

## 2) Create Vercel Project
1. Import repository in Vercel.
2. Framework preset: Next.js.
3. Root directory: repository root.
4. Build command: `npm run build` (default).
5. Output: default Next.js output.

## 3) Configure Production Environment Variables
Set in Vercel Project Settings -> Environment Variables:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `GOOGLE_PLACES_API_KEY`
- `GEMINI_API_KEY`
- `GEMINI_MODEL` = `gemini-2.0-flash-lite` (optional override)

Important:
- Use a separate production `GEMINI_API_KEY` and `GOOGLE_PLACES_API_KEY`.
- Restrict keys by API and domain/IP where possible.

## 4) Deploy
1. Trigger deploy from main branch.
2. Wait for deployment to complete.
3. Open deployment URL.

## 5) Smoke Tests (Production)
1. `GET /api/health`
Expected:
- `status = "ok"`
- all `checks` are `true`

2. Dashboard load `/`
Expected:
- no runtime crash
- review list renders (or empty state)

3. Fetch flow:
- input valid Place ID and click `Fetch`
Expected:
- 200 response
- review list updates

4. Generate flow:
- click `Generate AI` on one review
Expected:
- 3 suggestions shown

5. Approve flow:
- click `Approve` for one suggestion
Expected:
- selected suggestion marked approved
- review status becomes `resolved`

## 6) Post-Deploy Hardening
1. Rotate keys if exposed in chat/screenshots.
2. Add API monitoring/alerts (Vercel + Supabase logs).
3. If moving beyond POC, enable RLS with explicit policies.
