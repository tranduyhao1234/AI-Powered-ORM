# Day 6 QA Checklist

Date: 2026-05-22

## Preconditions
- Supabase schema from `supabase/schema.sql` is already applied.
- `.env.local` has:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
  - `GOOGLE_PLACES_API_KEY`
  - `GEMINI_API_KEY`
- App runs with `npm run dev`.

## Happy Path
1. Open dashboard `/`.
Expected: page loads with summary cards and empty-state review list.

2. Enter a valid Google Place ID and click `Fetch`.
Expected:
- API returns 200.
- Top message shows saved count.
- Up to 5 latest reviews appear in list.
- Status defaults to `pending`.

3. Click `Generate AI` on one pending review.
Expected:
- API returns 200.
- Exactly 3 suggestions appear.
- Each suggestion has tone + reply text.

4. Click `Approve` for one suggestion.
Expected:
- API returns 200.
- Selected suggestion shows `Approved`.
- Review status changes to `resolved`.
- Summary cards update (`pending` decreases, `resolved` increases).

## Validation / Error Cases
1. Fetch with invalid place ID format.
Expected: 400 with message `placeId is required and must be a valid Google Place ID.`

2. Generate with malformed/non-UUID reviewId (manual API call).
Expected: 400 with code `INVALID_REVIEW_ID`.

3. Approve with mismatched suggestionId/reviewId (manual API call).
Expected: 400 with code `SUGGESTION_REVIEW_MISMATCH`.

4. Remove `GEMINI_API_KEY` then Generate AI.
Expected: 500 with code `MISSING_GEMINI_KEY`.

## Performance / Reliability Checks
1. Trigger `Fetch` twice quickly.
Expected: no crash, latest DB state remains consistent (upsert by external id).

2. Trigger `Generate AI` twice on same review.
Expected: older suggestions are replaced; still only latest 3 suggestions are shown.

3. Simulate temporary network slowness.
Expected: external calls timeout/retry once, and API returns controlled error (not unhandled exception).

## Release Readiness
- `npm run typecheck` passes.
- `npm run build` passes.
- Manual happy path validated at least once end-to-end.
