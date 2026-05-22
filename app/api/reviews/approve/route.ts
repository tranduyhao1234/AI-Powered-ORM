import { NextResponse } from "next/server";
import { AppError, isAppError } from "@/lib/app-error";
import { createClient } from "@/utils/supabase/server";
import { normalizeUuid } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { reviewId?: string; suggestionId?: string };
    const reviewId = normalizeUuid(body.reviewId);
    const suggestionId = normalizeUuid(body.suggestionId);

    if (!reviewId || !suggestionId) {
      throw new AppError(
        "reviewId and suggestionId are required and must be UUIDs.",
        400,
        "INVALID_APPROVE_INPUT",
      );
    }

    const supabase = await createClient();

    const { data: suggestion, error: suggestionError } = await supabase
      .from("ai_suggestions")
      .select("id, review_id")
      .eq("id", suggestionId)
      .single();

    if (suggestionError || !suggestion || suggestion.review_id !== reviewId) {
      throw new AppError("Suggestion does not belong to review.", 400, "SUGGESTION_REVIEW_MISMATCH");
    }

    const { error: clearError } = await supabase
      .from("ai_suggestions")
      .update({ is_selected: false })
      .eq("review_id", reviewId);

    if (clearError) {
      return NextResponse.json({ error: clearError.message }, { status: 500 });
    }

    const { error: selectError } = await supabase
      .from("ai_suggestions")
      .update({ is_selected: true })
      .eq("id", suggestionId)
      .eq("review_id", reviewId);

    if (selectError) {
      return NextResponse.json({ error: selectError.message }, { status: 500 });
    }

    const { error: reviewUpdateError } = await supabase
      .from("reviews")
      .update({ status: "resolved", selected_suggestion_id: suggestionId })
      .eq("id", reviewId);

    if (reviewUpdateError) {
      return NextResponse.json({ error: reviewUpdateError.message }, { status: 500 });
    }

    return NextResponse.json({
      reviewId,
      suggestionId,
      status: "resolved",
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
