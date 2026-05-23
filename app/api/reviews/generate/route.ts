import { NextResponse } from "next/server";
import { AppError, isAppError } from "@/lib/app-error";
import { createClient } from "@/utils/supabase/server";
import { generateReplySuggestions } from "@/lib/gemini";
import { buildFallbackSuggestions } from "@/lib/sample-suggestions";
import { normalizeUuid } from "@/lib/validation";

type SuggestionRow = {
  id: string;
  review_id: string;
  tone: string | null;
  content: string;
  is_selected: boolean;
  created_at: string;
};

type AiResult =
  | { source: "longcat"; suggestions: Awaited<ReturnType<typeof generateReplySuggestions>> }
  | { source: "error"; error: unknown };

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

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { reviewId?: string };
    const reviewId = normalizeUuid(body.reviewId);

    if (!reviewId) {
      throw new AppError("reviewId is required and must be a UUID.", 400, "INVALID_REVIEW_ID");
    }

    const supabase = await createClient();
    const { data: review, error: reviewError } = await supabase
      .from("reviews")
      .select("id, review_text, rating")
      .eq("id", reviewId)
      .single();

    if (reviewError || !review) {
      throw new AppError("Review not found.", 404, "REVIEW_NOT_FOUND");
    }

    let suggestions;
    let message: string | undefined;
    const allowFallback = (process.env.ALLOW_AI_FALLBACK || "true").toLowerCase() === "true";
    const instantMode = (process.env.AI_INSTANT_MODE || "false").toLowerCase() === "true";
    const aiDeadlineMs = parsePositiveIntEnv("AI_RESPONSE_DEADLINE_MS", 5000);

    if (instantMode) {
      suggestions = buildFallbackSuggestions(review.review_text);
      message = "Instant mode enabled: local suggestions returned immediately.";
    } else {
      const aiPromise: Promise<AiResult> = generateReplySuggestions(review.review_text, review.rating)
        .then((generated) => ({ source: "longcat" as const, suggestions: generated }))
        .catch((error) => ({ source: "error", error }));

      const timeoutResult = { source: "timeout" as const };
      const raceResult = await Promise.race([
        aiPromise,
        new Promise<typeof timeoutResult>((resolve) => setTimeout(() => resolve(timeoutResult), aiDeadlineMs)),
      ]);

      if (raceResult.source === "longcat") {
        suggestions = raceResult.suggestions;
      } else if (raceResult.source === "timeout") {
        if (allowFallback) {
          suggestions = buildFallbackSuggestions(review.review_text);
          message = "LongCat is slow. Instant local fallback suggestions were used.";
        } else {
          const awaitedResult = await aiPromise;
          if (awaitedResult.source === "longcat") {
            suggestions = awaitedResult.suggestions;
          } else {
            throw awaitedResult.error;
          }
        }
      } else {
        const isLongCatError = isAppError(raceResult.error) && raceResult.error.code.includes("LONGCAT");
        if (allowFallback && (isLongCatError || raceResult.error instanceof Error)) {
          suggestions = buildFallbackSuggestions(review.review_text);
          message = "LongCat unavailable. Instant local fallback suggestions were used.";
        } else {
          throw raceResult.error;
        }
      }
    }

    const { error: deleteError } = await supabase.from("ai_suggestions").delete().eq("review_id", reviewId);
    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    const insertPayload = suggestions.map((suggestion) => ({
      review_id: reviewId,
      tone: suggestion.tone,
      content: suggestion.content,
      is_selected: false,
    }));

    const { data: inserted, error: insertError } = await supabase
      .from("ai_suggestions")
      .insert(insertPayload)
      .select("id, review_id, tone, content, is_selected, created_at")
      .order("created_at", { ascending: true });

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({
      reviewId,
      suggestions: (inserted ?? []) as SuggestionRow[],
      message,
    });
  } catch (error) {
    if (isAppError(error)) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }

    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid JSON payload.", code: "INVALID_JSON" }, { status: 400 });
    }

    if (error instanceof Error) {
      return NextResponse.json({ error: error.message, code: "INTERNAL_ERROR" }, { status: 500 });
    }

    return NextResponse.json({ error: "Unexpected error", code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
