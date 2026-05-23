import { AppError } from "@/lib/app-error";
import { fetchWithRetry, getExternalRetryOptions } from "@/lib/http";
import type { GooglePlaceReview } from "@/lib/google-places";
import { normalizeDemoPlaceId } from "@/lib/validation";

type LongCatResponse = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
};

const DEFAULT_LONGCAT_MODEL = "LongCat-Flash-Chat";
const DEFAULT_LONGCAT_BASE_URL = "https://api.longcat.chat/openai/v1";
const DEFAULT_REVIEW_TIMEOUT_MS = 30000;

function normalizeBaseUrl(input: string) {
  return input.endsWith("/") ? input.slice(0, -1) : input;
}

function parsePositiveIntEnv(name: string, fallback: number) {
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

function isAbortLikeError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const safeError = error as { name?: unknown; message?: unknown };
  const name = typeof safeError.name === "string" ? safeError.name : "";
  const message = typeof safeError.message === "string" ? safeError.message.toLowerCase() : "";
  return name === "AbortError" || message.includes("aborted");
}

function unwrapJsonBlock(rawText: string) {
  const trimmed = rawText.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }

  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (!fenceMatch) {
    return trimmed;
  }

  return fenceMatch[1].trim();
}

function extractLongCatContent(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }
      if (!item || typeof item !== "object") {
        return "";
      }
      const safeItem = item as { text?: unknown };
      return typeof safeItem.text === "string" ? safeItem.text : "";
    })
    .join("")
    .trim();
}

function parseUnixSeconds(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 9_999_999_999 ? Math.floor(value / 1000) : Math.floor(value);
  }

  if (typeof value === "string") {
    const maybeNum = Number(value);
    if (Number.isFinite(maybeNum)) {
      return maybeNum > 9_999_999_999 ? Math.floor(maybeNum / 1000) : Math.floor(maybeNum);
    }

    const asDate = Date.parse(value);
    if (!Number.isNaN(asDate)) {
      return Math.floor(asDate / 1000);
    }
  }

  return fallback;
}

function normalizeLongCatReviews(input: unknown): GooglePlaceReview[] {
  const now = Math.floor(Date.now() / 1000);
  const safeInput =
    input && typeof input === "object" ? (input as Record<string, unknown>) : ({} as Record<string, unknown>);
  const rawReviews = Array.isArray(safeInput.reviews)
    ? safeInput.reviews
    : Array.isArray(safeInput.items)
      ? safeInput.items
      : Array.isArray(safeInput.data)
        ? safeInput.data
        : [];

  return rawReviews
    .map((item, index) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const safeItem = item as Record<string, unknown>;
      const authorCandidate = safeItem.author_name ?? safeItem.reviewer_name ?? safeItem.author ?? safeItem.name;
      const textCandidate =
        safeItem.text ?? safeItem.review_text ?? safeItem.review ?? safeItem.comment ?? safeItem.content;
      const ratingCandidate = safeItem.rating ?? safeItem.stars ?? safeItem.score;
      const timeCandidate = safeItem.time ?? safeItem.timestamp ?? safeItem.review_time ?? safeItem.created_at;

      const authorName =
        typeof authorCandidate === "string" && authorCandidate.trim()
          ? authorCandidate.trim().slice(0, 120)
          : `Guest ${index + 1}`;
      const text = typeof textCandidate === "string" ? textCandidate.trim().slice(0, 3000) : "";
      if (!text) {
        return null;
      }

      const parsedRating =
        typeof ratingCandidate === "number"
          ? Math.round(ratingCandidate)
          : typeof ratingCandidate === "string"
            ? Math.round(Number(ratingCandidate))
            : 5;
      const rating = Number.isFinite(parsedRating) ? Math.max(1, Math.min(5, parsedRating)) : 5;
      const time = parseUnixSeconds(timeCandidate, now - index * 3600);

      return {
        author_name: authorName,
        rating,
        text,
        time,
      } as GooglePlaceReview;
    })
    .filter((review): review is GooglePlaceReview => Boolean(review))
    .slice(0, 5);
}

export async function fetchLongCatPlaceReviews(placeId: string): Promise<GooglePlaceReview[]> {
  const normalizedPlaceId = normalizeDemoPlaceId(placeId);
  if (!normalizedPlaceId) {
    throw new AppError("Enter at least 3 letters/numbers for the AI demo Place ID.", 400, "INVALID_PLACE_ID");
  }

  const apiKey = process.env.LONGCAT_API_KEY;
  if (!apiKey) {
    throw new AppError("LONGCAT_API_KEY is missing.", 500, "MISSING_LONGCAT_KEY");
  }

  const model = process.env.LONGCAT_MODEL || DEFAULT_LONGCAT_MODEL;
  const baseUrl = normalizeBaseUrl(process.env.LONGCAT_BASE_URL || DEFAULT_LONGCAT_BASE_URL);
  const endpoint = `${baseUrl}/chat/completions`;
  const now = Math.floor(Date.now() / 1000);

  let response: Response;
  try {
    const retryOptions = getExternalRetryOptions("ai");
    response = await fetchWithRetry(
      endpoint,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.7,
          max_tokens: 700,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "Return valid JSON only. Do not use markdown. Use schema: {\"reviews\":[{\"author_name\":\"...\",\"rating\":1-5,\"text\":\"...\",\"time\":unix_seconds}]}.",
            },
            {
              role: "user",
              content:
                `Create exactly 5 realistic customer reviews in Vietnamese for Google Place ID "${normalizedPlaceId}". ` +
                `Each review must be <= 40 words. Include mixed sentiment. ` +
                `Use unique author names. Use unix seconds in the last 7 days (current unix time: ${now}).`,
            },
          ],
        }),
      },
      {
        ...retryOptions,
        timeoutMs: parsePositiveIntEnv("LONGCAT_REVIEW_TIMEOUT_MS", DEFAULT_REVIEW_TIMEOUT_MS),
      },
    );
  } catch (error) {
    if (isAbortLikeError(error)) {
      throw new AppError(
        "LongCat took too long to create feedback. Please retry, or increase LONGCAT_REVIEW_TIMEOUT_MS.",
        504,
        "LONGCAT_REVIEW_TIMEOUT",
      );
    }
    throw new AppError("LongCat could not create feedback right now. Please retry.", 502, "LONGCAT_REVIEW_NETWORK_ERROR");
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new AppError("LongCat credentials are invalid or not allowed.", 502, "LONGCAT_AUTH_ERROR");
    }
    if (response.status === 429) {
      throw new AppError("LongCat rate limit reached. Please retry shortly.", 429, "LONGCAT_RATE_LIMIT");
    }
    throw new AppError(`LongCat request failed with status ${response.status}.`, 502, "LONGCAT_HTTP_ERROR");
  }

  const payload = (await response.json()) as LongCatResponse;
  const rawContent = extractLongCatContent(payload.choices?.[0]?.message?.content);
  if (!rawContent) {
    throw new AppError("LongCat returned empty content.", 502, "LONGCAT_EMPTY_CONTENT");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(unwrapJsonBlock(rawContent)) as unknown;
  } catch {
    throw new AppError("LongCat returned non-JSON output.", 502, "LONGCAT_NON_JSON_OUTPUT");
  }

  const reviews = normalizeLongCatReviews(parsed);
  if (reviews.length < 3) {
    throw new AppError("LongCat returned invalid review output.", 502, "LONGCAT_INVALID_REVIEW_OUTPUT");
  }

  return reviews;
}
