import { AppError } from "@/lib/app-error";
import { fetchWithRetry } from "@/lib/http";
import { normalizePlaceId } from "@/lib/validation";

export type GooglePlaceReview = {
  author_name?: string;
  rating?: number;
  text?: string;
  time?: number;
};

type PlaceDetailsResponse = {
  status: string;
  error_message?: string;
  result?: {
    name?: string;
    reviews?: GooglePlaceReview[];
  };
};

const GOOGLE_PLACE_DETAILS_URL = "https://maps.googleapis.com/maps/api/place/details/json";

export async function fetchGooglePlaceReviews(placeId: string): Promise<GooglePlaceReview[]> {
  const normalizedPlaceId = normalizePlaceId(placeId);
  if (!normalizedPlaceId) {
    throw new AppError("Invalid placeId format.", 400, "INVALID_PLACE_ID");
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    throw new AppError("GOOGLE_PLACES_API_KEY is missing.", 500, "MISSING_GOOGLE_KEY");
  }

  const query = new URLSearchParams({
    place_id: normalizedPlaceId,
    fields: "name,reviews",
    reviews_sort: "newest",
    key: apiKey,
  });

  const response = await fetchWithRetry(
    `${GOOGLE_PLACE_DETAILS_URL}?${query.toString()}`,
    {
      method: "GET",
      cache: "no-store",
    },
    { timeoutMs: 9000, retries: 1, retryDelayMs: 350 },
  );

  if (!response.ok) {
    if (response.status === 429) {
      throw new AppError("Google Places rate limit reached. Please retry shortly.", 429, "GOOGLE_RATE_LIMIT");
    }
    throw new AppError(
      `Google Places request failed with status ${response.status}.`,
      502,
      "GOOGLE_HTTP_ERROR",
    );
  }

  const payload = (await response.json()) as PlaceDetailsResponse;
  if (payload.status !== "OK") {
    if (payload.status === "OVER_QUERY_LIMIT") {
      throw new AppError("Google Places over query limit. Please retry.", 429, "GOOGLE_OVER_QUERY_LIMIT");
    }
    if (payload.status === "INVALID_REQUEST" || payload.status === "NOT_FOUND") {
      throw new AppError(payload.error_message || "Place not found.", 400, "GOOGLE_INVALID_REQUEST");
    }
    throw new AppError(
      payload.error_message || `Google Places API status: ${payload.status}`,
      502,
      "GOOGLE_API_STATUS_ERROR",
    );
  }

  return payload.result?.reviews ?? [];
}
