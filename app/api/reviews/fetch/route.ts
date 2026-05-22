import { NextResponse } from "next/server";
import { AppError, isAppError } from "@/lib/app-error";
import { fetchGooglePlaceReviews } from "@/lib/google-places";
import { buildSampleReviews } from "@/lib/sample-reviews";
import { normalizePlaceId } from "@/lib/validation";
import { createClient } from "@/utils/supabase/server";

type ReviewRow = {
  id: string;
  place_id: string;
  reviewer_name: string | null;
  rating: number | null;
  review_text: string;
  review_time: string | null;
  status: "pending" | "resolved";
  created_at: string;
};

function toExternalId(placeId: string, reviewerName: string, reviewTime: number, index: number): string {
  const normalizedName = reviewerName.trim().toLowerCase().slice(0, 80);
  return `${placeId}:${reviewTime}:${normalizedName}:${index}`;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { placeId?: string };
    const placeId = normalizePlaceId(body.placeId);

    if (!placeId) {
      throw new AppError("placeId is required and must be a valid Google Place ID.", 400, "INVALID_PLACE_ID");
    }

    const reviewSource = (process.env.REVIEW_SOURCE || "google").toLowerCase();
    let reviews;
    let sourceMessage: string | null = null;

    if (reviewSource === "sample") {
      reviews = buildSampleReviews(placeId);
      sourceMessage = "Using sample reviews (free mode).";
    } else {
      try {
        reviews = await fetchGooglePlaceReviews(placeId);
      } catch (error) {
        const allowFallback = (process.env.ALLOW_SAMPLE_FALLBACK || "true").toLowerCase() === "true";
        if (allowFallback && isAppError(error) && error.code.startsWith("GOOGLE_")) {
          reviews = buildSampleReviews(placeId);
          sourceMessage = "Google API unavailable; switched to sample reviews.";
        } else {
          throw error;
        }
      }
    }

    const latestFive = reviews
      .filter((review) => Boolean(review.time))
      .sort((a, b) => (b.time ?? 0) - (a.time ?? 0))
      .slice(0, 5);

    if (latestFive.length === 0) {
      return NextResponse.json({
        placeId,
        count: 0,
        reviews: [],
        message: sourceMessage ?? "No reviews found for this place.",
      });
    }

    const supabase = await createClient();
    const upsertPayload = latestFive.map((review, index) => ({
      place_id: placeId,
      review_external_id: toExternalId(placeId, review.author_name ?? "anonymous", review.time ?? 0, index),
      reviewer_name: review.author_name?.trim().slice(0, 120) ?? null,
      rating: review.rating ?? null,
      review_text: review.text?.trim().slice(0, 3000) || "(No text provided)",
      review_time: review.time ? new Date(review.time * 1000).toISOString() : null,
    }));

    const { error: upsertError } = await supabase
      .from("reviews")
      .upsert(upsertPayload, { onConflict: "place_id,review_external_id" });

    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }

    const { data: savedReviews, error: selectError } = await supabase
      .from("reviews")
      .select("id, place_id, reviewer_name, rating, review_text, review_time, status, created_at")
      .eq("place_id", placeId)
      .order("review_time", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(5);

    if (selectError) {
      return NextResponse.json({ error: selectError.message }, { status: 500 });
    }

    return NextResponse.json({
      placeId,
      count: savedReviews?.length ?? 0,
      reviews: (savedReviews ?? []) as ReviewRow[],
      message: sourceMessage ?? undefined,
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
