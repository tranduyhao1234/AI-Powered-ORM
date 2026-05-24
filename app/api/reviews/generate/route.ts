import { NextResponse } from "next/server";
import { AppError, isAppError } from "@/lib/app-error";
import { createClient } from "@/utils/supabase/server";
import { normalizeUuid } from "@/lib/validation";

type SuggestionRow = {
  id: string;
  review_id: string;
  tone: string | null;
  content: string;
  is_selected: boolean;
  created_at: string;
};

function normalizeForMatch(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasNegativeIssue(reviewText: string) {
  return /\b(cham|lau|te|kem|ban|lanh|dat|that vong|khong hai long|phien|loi|sai|thieu|on ao|kho chiu|hoi cham|mon len cham|doi lau)\b/i.test(
    normalizeForMatch(reviewText),
  );
}

function isClearlyPositiveReview(reviewText: string, rating?: number | null) {
  const normalized = normalizeForMatch(reviewText);
  const positive = /\b(ngon|nhanh|tot|tuyet|hai long|quay lai|than thien|sach|de thuong|ung ho|thich|chuyen nghiep)\b/i.test(
    normalized,
  );
  return !hasNegativeIssue(reviewText) && ((typeof rating === "number" && rating >= 4) || positive);
}

function containsApology(text: string) {
  return /\b(xin loi|rat tiec|sorry|apologize|apology)\b/i.test(normalizeForMatch(text));
}

function isGenericOrMalformedSuggestion(text: string) {
  const normalized = normalizeForMatch(text);
  return (
    text.includes('{"suggestions"') ||
    text.includes('"content"') ||
    /\bsample for\b/i.test(text) ||
    normalized.includes("cam on ban da chia se phan hoi") ||
    normalized.includes("chung toi da ghi nhan y kien") ||
    normalized.includes("doi ngu se ra soat va cai thien") ||
    normalized.includes("xin loi vi trai nghiem chua tron ven") ||
    normalized.includes("instant local fallback") ||
    normalized.includes("local fallback")
  );
}

function shouldReusePersistedSuggestions(reviewText: string, rating: number | null, suggestions: SuggestionRow[]) {
  if (suggestions.length < 3) {
    return false;
  }
  if (suggestions.some((suggestion) => isGenericOrMalformedSuggestion(suggestion.content))) {
    return false;
  }
  if (isClearlyPositiveReview(reviewText, rating) && suggestions.some((suggestion) => containsApology(suggestion.content))) {
    return false;
  }
  return suggestions.slice(0, 3).every((suggestion) => suggestion.content.trim().length >= 20);
}

async function enqueuePriorityAiJob(supabase: Awaited<ReturnType<typeof createClient>>, reviewId: string) {
  const { error } = await supabase.from("ai_generation_jobs").upsert(
    {
      review_id: reviewId,
      status: "queued",
      priority: 100,
      attempts: 0,
      error_message: null,
    },
    { onConflict: "review_id" },
  );

  if (error) {
    throw new AppError(error.message, 500, "AI_JOB_ENQUEUE_ERROR");
  }
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

    const { data: existingSuggestions, error: existingSuggestionsError } = await supabase
      .from("ai_suggestions")
      .select("id, review_id, tone, content, is_selected, created_at")
      .eq("review_id", reviewId)
      .order("created_at", { ascending: true });

    if (existingSuggestionsError) {
      return NextResponse.json({ error: existingSuggestionsError.message }, { status: 500 });
    }

    if (shouldReusePersistedSuggestions(review.review_text, review.rating, (existingSuggestions ?? []) as SuggestionRow[])) {
      return NextResponse.json({
        reviewId,
        suggestions: (existingSuggestions ?? []).slice(0, 3) as SuggestionRow[],
      });
    }

    await enqueuePriorityAiJob(supabase, reviewId);

    return NextResponse.json(
      {
        reviewId,
        suggestions: [],
        pending: true,
        message: "AI replies are preparing. Please wait a moment.",
      },
      { status: 202 },
    );
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
