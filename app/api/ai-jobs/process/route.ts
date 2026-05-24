import { NextResponse } from "next/server";
import { AppError, isAppError } from "@/lib/app-error";
import { generateReplySuggestions } from "@/lib/gemini";
import { normalizeUuid } from "@/lib/validation";
import { createClient } from "@/utils/supabase/server";

type JobRow = {
  id: string;
  review_id: string;
  status: "queued" | "processing" | "completed" | "failed";
  attempts: number;
  reviews?:
    | {
    id: string;
    review_text: string;
    rating: number | null;
  }
    | Array<{
        id: string;
        review_text: string;
        rating: number | null;
      }>
    | null;
};

type Suggestion = Awaited<ReturnType<typeof generateReplySuggestions>>[number];

type SuggestionRow = {
  id: string;
  review_id: string;
  tone: string | null;
  content: string;
  is_selected: boolean;
  created_at: string;
};

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function normalizeReviewIds(input: unknown) {
  if (!Array.isArray(input)) {
    return [];
  }
  return input.map((item) => (typeof item === "string" ? normalizeUuid(item) : null)).filter((id): id is string => Boolean(id));
}

async function saveSuggestions(
  supabase: Awaited<ReturnType<typeof createClient>>,
  reviewId: string,
  suggestions: Suggestion[],
): Promise<SuggestionRow[]> {
  const insertPayload = suggestions.map((suggestion) => ({
    review_id: reviewId,
    tone: suggestion.tone,
    content: suggestion.content,
    is_selected: false,
  }));

  const { error: deleteError } = await supabase.from("ai_suggestions").delete().eq("review_id", reviewId);
  if (deleteError) {
    throw new AppError(deleteError.message, 500, "AI_SUGGESTION_DELETE_ERROR");
  }

  const { data: inserted, error: insertError } = await supabase
    .from("ai_suggestions")
    .insert(insertPayload)
    .select("id, review_id, tone, content, is_selected, created_at")
    .order("created_at", { ascending: true });
  if (insertError) {
    throw new AppError(insertError.message, 500, "AI_SUGGESTION_INSERT_ERROR");
  }

  return (inserted ?? []) as SuggestionRow[];
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { reviewIds?: unknown; limit?: number };
    const reviewIds = normalizeReviewIds(body.reviewIds);
    const limit = Math.min(
      Math.max(1, typeof body.limit === "number" && Number.isFinite(body.limit) ? Math.floor(body.limit) : 1),
      parsePositiveIntEnv("AI_JOB_PROCESS_LIMIT", 2),
    );
    const maxAttempts = parsePositiveIntEnv("AI_JOB_MAX_ATTEMPTS", 3);

    const supabase = await createClient();
    let query = supabase
      .from("ai_generation_jobs")
      .select("id, review_id, status, attempts, reviews(id, review_text, rating)")
      .in("status", ["queued", "failed"])
      .lt("attempts", maxAttempts)
      .order("priority", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(limit);

    if (reviewIds.length > 0) {
      query = query.in("review_id", reviewIds);
    }

    const { data: jobs, error: jobsError } = await query;
    if (jobsError) {
      throw new AppError(jobsError.message, 500, "AI_JOB_SELECT_ERROR");
    }

    const selectedJobs = ((jobs ?? []) as unknown as JobRow[]).filter((job) => {
      const review = Array.isArray(job.reviews) ? job.reviews[0] : job.reviews;
      return Boolean(review?.review_text);
    });
    let completed = 0;
    let failed = 0;
    const processedSuggestions: Record<string, SuggestionRow[]> = {};
    const errors: Record<string, string> = {};

    for (const job of selectedJobs) {
      const nextAttempt = job.attempts + 1;
      const { error: claimError } = await supabase
        .from("ai_generation_jobs")
        .update({ status: "processing", attempts: nextAttempt, error_message: null })
        .eq("id", job.id)
        .neq("status", "completed");

      if (claimError) {
        failed += 1;
        continue;
      }

      try {
        const review = Array.isArray(job.reviews) ? job.reviews[0] : job.reviews!;
        const suggestions = await generateReplySuggestions(review.review_text, review.rating, {
          maxAttempts: parsePositiveIntEnv("AI_JOB_LONGCAT_ATTEMPTS", 2),
          timeoutMs: parsePositiveIntEnv("AI_JOB_LONGCAT_TIMEOUT_MS", 20000),
        });
        const savedSuggestions = await saveSuggestions(supabase, job.review_id, suggestions);
        const { error: completeError } = await supabase
          .from("ai_generation_jobs")
          .update({ status: "completed", error_message: null })
          .eq("id", job.id);
        if (completeError) {
          throw new AppError(completeError.message, 500, "AI_JOB_COMPLETE_ERROR");
        }
        processedSuggestions[job.review_id] = savedSuggestions;
        completed += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown AI generation error";
        const status = nextAttempt >= maxAttempts ? "failed" : "queued";
        await supabase.from("ai_generation_jobs").update({ status, error_message: message }).eq("id", job.id);
        errors[job.review_id] = message;
        failed += 1;
      }
    }

    return NextResponse.json({ selected: selectedJobs.length, completed, failed, suggestions: processedSuggestions, errors });
  } catch (error) {
    if (isAppError(error)) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: "Unexpected AI job processor error", code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
