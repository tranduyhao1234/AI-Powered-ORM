import { NextResponse } from "next/server";
import { AppError, isAppError } from "@/lib/app-error";
import { normalizeReviewText } from "@/lib/validation";
import { createClient } from "@/utils/supabase/server";

type CreatedReview = {
  id: string;
  place_id: string;
  reviewer_name: string | null;
  rating: number | null;
  review_text: string;
  review_time: string | null;
  status: "pending" | "resolved";
};

function normalizeRating(value: unknown): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5) {
    return null;
  }
  return parsed;
}

function normalizeReviewerName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized.slice(0, 120) : null;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      reviewerName?: string;
      rating?: number | string;
      reviewText?: string;
    };

    const reviewText = normalizeReviewText(body.reviewText);
    if (!reviewText) {
      throw new AppError("reviewText is required and must be <= 3000 characters.", 400, "INVALID_REVIEW_TEXT");
    }

    const rating = normalizeRating(body.rating);
    if (body.rating !== undefined && body.rating !== null && body.rating !== "" && rating === null) {
      throw new AppError("rating must be an integer from 1 to 5.", 400, "INVALID_RATING");
    }

    const reviewerName = normalizeReviewerName(body.reviewerName);
    const nowIso = new Date().toISOString();
    const reviewExternalId = `manual:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("reviews")
      .insert({
        place_id: "manual-demo",
        review_external_id: reviewExternalId,
        reviewer_name: reviewerName,
        rating,
        review_text: reviewText,
        review_time: nowIso,
        status: "pending",
      })
      .select("id, place_id, reviewer_name, rating, review_text, review_time, status")
      .single();

    if (error || !data) {
      throw new AppError(error?.message || "Failed to create review.", 500, "DB_INSERT_ERROR");
    }

    return NextResponse.json({
      review: data as CreatedReview,
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

