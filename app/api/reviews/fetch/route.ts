import { NextResponse } from "next/server";
import { AppError, isAppError } from "@/lib/app-error";
import { generateReplySuggestions } from "@/lib/gemini";
import { fetchGooglePlaceReviews } from "@/lib/google-places";
import { fetchLongCatPlaceReviews } from "@/lib/longcat-reviews";
import { buildSampleReviews } from "@/lib/sample-reviews";
import { normalizeDemoPlaceId, normalizePlaceId } from "@/lib/validation";
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

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

type SuggestionRow = {
  id: string;
  review_id: string;
  tone: string | null;
  content: string;
  is_selected: boolean;
  created_at: string;
};

function toExternalId(placeId: string, reviewerName: string, reviewTime: number, index: number): string {
  const normalizedName = reviewerName.trim().toLowerCase().slice(0, 80);
  return `${placeId}:${reviewTime}:${normalizedName}:${index}`;
}

function isGoogleRelatedErrorCode(code: string) {
  return code.includes("GOOGLE");
}

function isLongCatRelatedErrorCode(code: string) {
  return code.includes("LONGCAT");
}

async function generateAndSaveAiSuggestions(supabase: SupabaseClient, review: ReviewRow) {
  const suggestions = await generateReplySuggestions(review.review_text, review.rating);

  const { error: deleteError } = await supabase.from("ai_suggestions").delete().eq("review_id", review.id);
  if (deleteError) {
    throw new AppError(deleteError.message, 500, "AI_SUGGESTION_DELETE_ERROR");
  }

  const insertPayload = suggestions.map((suggestion) => ({
    review_id: review.id,
    tone: suggestion.tone,
    content: suggestion.content,
    is_selected: false,
  }));

  const { error: insertError } = await supabase.from("ai_suggestions").insert(insertPayload);
  if (insertError) {
    throw new AppError(insertError.message, 500, "AI_SUGGESTION_INSERT_ERROR");
  }
}

function runAutoGenerateInBackground(supabase: SupabaseClient, reviews: ReviewRow[]) {
  void Promise.allSettled(reviews.map((review) => generateAndSaveAiSuggestions(supabase, review))).then((results) => {
    const generatedCount = results.filter((result) => result.status === "fulfilled").length;
    if (generatedCount !== reviews.length) {
      console.warn(`Auto-generate AI replies completed for ${generatedCount}/${reviews.length} reviews.`);
    }
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { placeId?: string };
    const reviewSource = (process.env.REVIEW_SOURCE || "longcat").toLowerCase();
    const placeId = reviewSource === "longcat" ? normalizeDemoPlaceId(body.placeId) : normalizePlaceId(body.placeId);

    if (!placeId) {
      throw new AppError(
        reviewSource === "longcat"
          ? "Enter at least 3 letters/numbers for the AI demo Place ID."
          : "placeId is required and must be a valid Google Place ID.",
        400,
        "INVALID_PLACE_ID",
      );
    }

    const allowSampleFallback = (process.env.ALLOW_SAMPLE_FALLBACK || "true").toLowerCase() === "true";
    const allowLongCatReviewFallback =
      (process.env.ENABLE_LONGCAT_REVIEW_FALLBACK || "true").toLowerCase() === "true";
    let reviews;
    let sourceMessage: string | null = null;

    if (reviewSource === "sample") {
      reviews = buildSampleReviews(placeId);
      sourceMessage = "Using sample reviews (free mode).";
    } else if (reviewSource === "longcat") {
      try {
        reviews = await fetchLongCatPlaceReviews(placeId);
        sourceMessage = "Using AI-generated feedback from LongCat.";
      } catch (error) {
        if (allowSampleFallback && isAppError(error) && isLongCatRelatedErrorCode(error.code)) {
          reviews = buildSampleReviews(placeId);
          sourceMessage = "LongCat unavailable; switched to sample reviews.";
        } else {
          throw error;
        }
      }
    } else {
      try {
        reviews = await fetchGooglePlaceReviews(placeId);
      } catch (error) {
        if (allowLongCatReviewFallback && isAppError(error) && isGoogleRelatedErrorCode(error.code)) {
          try {
            reviews = await fetchLongCatPlaceReviews(placeId);
            sourceMessage = "Google API unavailable; switched to AI-generated feedback from LongCat.";
          } catch (longCatError) {
            if (allowSampleFallback && isAppError(longCatError) && isLongCatRelatedErrorCode(longCatError.code)) {
              reviews = buildSampleReviews(placeId);
              sourceMessage = "Google + LongCat unavailable; switched to sample reviews.";
            } else {
              throw longCatError;
            }
          }
        } else if (allowSampleFallback && isAppError(error) && isGoogleRelatedErrorCode(error.code)) {
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

    const { data: upsertedReviews, error: upsertError } = await supabase
      .from("reviews")
      .upsert(upsertPayload, { onConflict: "place_id,review_external_id" })
      .select("id, place_id, reviewer_name, rating, review_text, review_time, status, created_at");

    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }

    const savedReviews = ((upsertedReviews ?? []) as ReviewRow[]).sort((a, b) => {
      const aReviewTime = a.review_time ? new Date(a.review_time).getTime() : 0;
      const bReviewTime = b.review_time ? new Date(b.review_time).getTime() : 0;
      if (bReviewTime !== aReviewTime) {
        return bReviewTime - aReviewTime;
      }
      const aCreatedTime = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bCreatedTime = b.created_at ? new Date(b.created_at).getTime() : 0;
      return bCreatedTime - aCreatedTime;
    });
    const visibleReviews = savedReviews.slice(0, 5);
    const autoGenerateAiOnFetch = (process.env.AUTO_GENERATE_AI_ON_FETCH || "true").toLowerCase() === "true";
    let aiMessage: string | null = null;

    if (autoGenerateAiOnFetch && visibleReviews.length > 0) {
      runAutoGenerateInBackground(supabase, visibleReviews);
      aiMessage = `AI replies are generating in the background for ${visibleReviews.length} reviews.`;
    }

    const { data: refreshedReviews, error: refreshedError } = await supabase
      .from("reviews")
      .select(
        "id, place_id, reviewer_name, rating, review_text, review_time, status, created_at, ai_suggestions(id, review_id, tone, content, is_selected, created_at)",
      )
      .in(
        "id",
        visibleReviews.map((review) => review.id),
      );

    if (refreshedError) {
      return NextResponse.json({ error: refreshedError.message }, { status: 500 });
    }

    const responseReviews = ((refreshedReviews ?? []) as Array<ReviewRow & { ai_suggestions?: SuggestionRow[] | null }>)
      .sort((a, b) => {
        const aReviewTime = a.review_time ? new Date(a.review_time).getTime() : 0;
        const bReviewTime = b.review_time ? new Date(b.review_time).getTime() : 0;
        return bReviewTime - aReviewTime;
      })
      .map((review) => ({
        ...review,
        suggestions: review.ai_suggestions ?? [],
      }));

    return NextResponse.json({
      placeId,
      count: savedReviews.length,
      reviews: responseReviews,
      message: [sourceMessage, aiMessage].filter(Boolean).join(" "),
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

    return NextResponse.json({ error: "Unexpected server error while fetching reviews.", code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
