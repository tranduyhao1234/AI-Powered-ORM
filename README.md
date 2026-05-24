# AI-Powered ORM / ReviewAI Dashboard

A modern SaaS dashboard for managing Google Maps-style customer reviews with AI-generated reply suggestions.

The application supports this workflow:

1. Enter a Google Place ID.
2. Fetch the latest reviews into Supabase.
3. Queue AI reply generation in the background.
4. Show 3 AI-generated reply suggestions for each review only when the user clicks `Generate AI`.
5. Approve one reply and mark the review as `resolved`.

This MVP does not publish replies back to Google. Approval only updates the application database.

## Tech Stack

- Next.js 16 App Router
- React 19
- TypeScript
- Supabase Postgres
- LongCat OpenAI-compatible API
- Google Places API, optional for production review fetching
- Vercel deployment

## Features

- Single dashboard for review operations
- Place ID input and review fetching
- Latest fetched reviews work queue
- Old reviews separated from the latest fetch context
- Pending / resolved status management
- Star rating display
- AI-generated reply suggestions with 3 tones
- Background AI generation queue through Supabase
- Cache-first AI suggestion loading for fast UI response
- Vercel-ready environment configuration

## Architecture

```text
Browser
  -> POST /api/reviews/fetch
      -> Fetch reviews from Google or LongCat demo mode
      -> Upsert latest reviews into Supabase
      -> Enqueue AI jobs in ai_generation_jobs

Browser/background trigger
  -> POST /api/ai-jobs/process
      -> Process queued jobs
      -> Call LongCat
      -> Save valid suggestions into ai_suggestions

User clicks Generate AI
  -> POST /api/reviews/generate
      -> Return cached suggestions if available
      -> Otherwise enqueue priority AI job and return pending

User clicks Approve
  -> POST /api/reviews/approve
      -> Mark selected suggestion
      -> Mark review as resolved
```

## Requirements

- Node.js 20 or newer
- npm
- Supabase project
- LongCat API key
- Google Places API key if using real Google review fetching

## Local Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create local environment file

```bash
cp .env.example .env.local
```

On Windows PowerShell, use:

```powershell
Copy-Item .env.example .env.local
```

### 3. Configure environment variables

Use placeholders only. Do not commit real API keys.

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-key

# Review source: google for production, longcat for AI demo/free mode.
REVIEW_SOURCE=longcat
ALLOW_SAMPLE_FALLBACK=false
ENABLE_LONGCAT_REVIEW_FALLBACK=true

# Google Places, required only when REVIEW_SOURCE=google.
GOOGLE_PLACES_API_KEY=your-google-places-api-key

# LongCat AI.
LONGCAT_API_KEY=your-longcat-api-key
LONGCAT_BASE_URL=https://api.longcat.chat/openai/v1
LONGCAT_MODEL=LongCat-Flash-Chat
LONGCAT_FALLBACK_MODEL=LongCat-Flash-Lite
LONGCAT_PARALLEL_TONE_GENERATION=true

# Latency controls.
API_FAST_MODE=true
GOOGLE_API_TIMEOUT_MS=2500
AI_API_TIMEOUT_MS=4500
LONGCAT_REVIEW_TIMEOUT_MS=30000
EXTERNAL_API_RETRIES=0
EXTERNAL_API_RETRY_DELAY_MS=120
AI_RESPONSE_DEADLINE_MS=5000
LONGCAT_GENERATE_ATTEMPTS=2

# Background AI jobs.
AUTO_GENERATE_AI_ON_FETCH=true
AI_INSTANT_MODE=false
AI_JOB_MAX_ATTEMPTS=3
AI_JOB_PROCESS_LIMIT=1
AI_JOB_LONGCAT_TIMEOUT_MS=6000
AI_JOB_LONGCAT_ATTEMPTS=1
```

Important:

- `LONGCAT_API_KEY` must stay server-side only. Do not prefix it with `NEXT_PUBLIC_`.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is safe for browser usage, but it is not a service-role key.
- After changing environment variables locally, restart `npm run dev`.
- After changing environment variables on Vercel, redeploy the project.

### 4. Create Supabase tables

Open Supabase SQL Editor and run:

```text
supabase/schema.sql
```

The schema creates these main tables:

- `reviews`
- `ai_suggestions`
- `ai_generation_jobs`

If you see an error like `relation "ai_generation_jobs" does not exist`, run the schema again in Supabase SQL Editor.

### 5. Run the app locally

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

## Vercel Deployment

### 1. Push the repository to GitHub

```bash
git add .
git commit -m "Prepare Vercel deployment docs"
git push
```

### 2. Import project in Vercel

1. Open Vercel Dashboard.
2. Click `Add New` -> `Project`.
3. Import this GitHub repository.
4. Keep framework preset as `Next.js`.
5. Keep build command as:

```bash
npm run build
```

### 3. Add environment variables in Vercel

Go to:

```text
Project Settings -> Environment Variables
```

Add the same variables from `.env.local`, especially:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
LONGCAT_API_KEY=
LONGCAT_BASE_URL=https://api.longcat.chat/openai/v1
LONGCAT_MODEL=LongCat-Flash-Chat
LONGCAT_FALLBACK_MODEL=LongCat-Flash-Lite
LONGCAT_PARALLEL_TONE_GENERATION=true
REVIEW_SOURCE=longcat
ENABLE_LONGCAT_REVIEW_FALLBACK=true
ALLOW_SAMPLE_FALLBACK=false
API_FAST_MODE=true
AI_RESPONSE_DEADLINE_MS=5000
AI_JOB_PROCESS_LIMIT=1
AI_JOB_LONGCAT_TIMEOUT_MS=6000
AI_JOB_LONGCAT_ATTEMPTS=1
```

If you want real Google Places data, also add:

```env
REVIEW_SOURCE=google
GOOGLE_PLACES_API_KEY=your-google-places-api-key
```

### 4. Deploy

Click `Deploy`.

After deployment, verify the health endpoint:

```text
https://your-domain.vercel.app/api/health
```

Expected result: JSON showing configured services.

## Background AI Jobs on Vercel

The app is optimized so fetching reviews is fast. Review fetching does not wait for every AI response to finish.

AI generation is handled by:

```text
POST /api/ai-jobs/process
```

Current behavior:

- After fetching reviews, the frontend triggers background processing.
- When a user clicks `Generate AI`, the app first checks cached suggestions.
- If suggestions are not ready, it queues a priority job and triggers processing.

For production-grade reliability, add a scheduled worker. Options:

1. Use Vercel Cron with a small GET wrapper around `/api/ai-jobs/process`.
2. Use an external cron service that can call `POST /api/ai-jobs/process` every minute.
3. Move AI job processing to a dedicated background worker if traffic grows.

Do not make `/api/reviews/fetch` wait for all AI suggestions. That makes the fetch action slow and fragile on serverless platforms.

## API Routes

### `GET /api/health`

Deployment smoke check. Confirms whether required environment variables are configured.

### `POST /api/reviews/fetch`

Fetches latest reviews for a Place ID and saves them.

Example body:

```json
{
  "placeId": "ChIJ..."
}
```

### `POST /api/reviews/generate`

Returns cached AI suggestions for a review when available. If not available, queues a priority AI generation job.

Example body:

```json
{
  "reviewId": "review-uuid"
}
```

### `POST /api/ai-jobs/process`

Processes queued AI generation jobs and stores suggestions in `ai_suggestions`.

### `POST /api/reviews/approve`

Approves a suggestion and marks the review as resolved.

Example body:

```json
{
  "reviewId": "review-uuid",
  "suggestionId": "suggestion-uuid"
}
```

### `POST /api/reviews/create`

Creates a manual review entry. Useful for testing and demo flows.

## Scripts

```bash
npm run dev        # Start local development server
npm run typecheck  # Run TypeScript checks
npm run build      # Build production app
npm run start      # Start production server locally
```

## Production Notes

- Keep LongCat and Google API keys server-only.
- Never commit `.env.local`.
- Run `supabase/schema.sql` before first deployment.
- Use `REVIEW_SOURCE=longcat` for demo mode without Google billing.
- Use `REVIEW_SOURCE=google` only after Google Places API and billing are configured.
- Vercel serverless functions are request-scoped, so long-running AI work should be queued and processed separately.
- If LongCat response quality varies, keep strict JSON parsing and retry through the fallback model.

## Troubleshooting

### `LongCat timeout (> configured limit). Please retry.`

The provider did not return before the configured timeout. Recommended actions:

- Keep background job processing enabled.
- Use `LONGCAT_FALLBACK_MODEL=LongCat-Flash-Lite`.
- Keep `LONGCAT_PARALLEL_TONE_GENERATION=true`.
- Increase `AI_JOB_LONGCAT_TIMEOUT_MS` only if you prefer reliability over speed.

### `LongCat output did not return exactly 3 valid suggestions.`

The model returned invalid JSON or incomplete suggestions. Recommended actions:

- Use `LONGCAT_MODEL=LongCat-Flash-Chat` for better quality.
- Keep fallback model enabled.
- Regenerate the review suggestion.
- Check server logs for the raw provider failure path.

### `Generate AI` shows preparing state

The review has no cached suggestions yet. Trigger `/api/ai-jobs/process` or wait for the background processor to finish.

### Google reviews are not fetched

Check:

- `REVIEW_SOURCE=google`
- `GOOGLE_PLACES_API_KEY` is set on Vercel
- Google Places API is enabled
- Google billing is active

For demo/free mode, use:

```env
REVIEW_SOURCE=longcat
ENABLE_LONGCAT_REVIEW_FALLBACK=true
```

## Deployment Checklist

Before deploying to Vercel:

- Supabase project created
- `supabase/schema.sql` executed successfully
- Vercel environment variables added
- `LONGCAT_API_KEY` added without `NEXT_PUBLIC_`
- `npm run typecheck` passes
- `npm run build` passes
- `/api/health` returns valid JSON after deployment
- Fetch review flow works
- Generate AI flow returns cached or queued suggestions
- Approve flow changes review status to `resolved`
