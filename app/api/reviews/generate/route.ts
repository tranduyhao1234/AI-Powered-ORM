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
      .select("id, review_text")
      .eq("id", reviewId)
      .single();

    if (reviewError || !review) {
      throw new AppError("Review not found.", 404, "REVIEW_NOT_FOUND");
    }

    let suggestions;
    let message: string | undefined;
    try {
      suggestions = await generateReplySuggestions(review.review_text);
    } catch (error) {
      const allowFallback = (process.env.ALLOW_AI_FALLBACK || "true").toLowerCase() === "true";
      if (
        allowFallback &&
        isAppError(error) &&
        (error.code === "GEMINI_RATE_LIMIT" || error.code === "MISSING_GEMINI_KEY")
      ) {
        suggestions = buildFallbackSuggestions(review.review_text);
        message = "Gemini unavailable/rate-limited. Local fallback suggestions were used.";
      } else {
        throw error;
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

    return NextResponse.json({ error: "Unexpected error", code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
