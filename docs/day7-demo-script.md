# Day 7 Demo Script (5-7 minutes)

Date: 2026-05-22

## Demo Goal
Show the full POC flow:
`Place ID -> Fetch Reviews -> Generate AI -> Approve -> Resolved`

## Setup (before presenting)
1. Open deployed app URL.
2. Prepare one known valid `Place ID`.
3. Ensure network/devtools is open (optional) to show API status 200.

## Live Script
1. Intro (30s)
- "This MVP helps business users fetch customer reviews and generate AI replies, then approve one response in a single dashboard."

2. Health check (30s)
- Open `/api/health`.
- Point out `status: ok` and env checks are configured.

3. Fetch reviews (1-2m)
- Go to `/`.
- Enter Place ID.
- Click `Fetch`.
- Explain that the app retrieves and stores up to 5 latest reviews in Supabase.

4. Generate AI replies (1-2m)
- Choose one pending review.
- Click `Generate AI`.
- Show exactly 3 suggestions with different tones.

5. Approve one reply (1m)
- Click `Approve` on one suggestion.
- Show status changes from `pending` to `resolved`.
- Show summary cards updating counts.

6. Wrap-up (30s)
- "Core workflow is complete and deployable. Next step is adding RLS policies and production monitoring."

## Backup Plan (if API fails during demo)
1. Use previously fetched reviews already in DB.
2. Show generate/approve steps on existing review rows.
3. If Gemini rate limited, explain fallback and retry once.
