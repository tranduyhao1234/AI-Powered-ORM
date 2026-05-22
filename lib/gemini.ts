import { AppError } from "@/lib/app-error";
import { fetchWithRetry } from "@/lib/http";
import { normalizeReviewText } from "@/lib/validation";

type Suggestion = {
  tone: string;
  content: string;
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
};

function normalizeSuggestions(input: unknown): Suggestion[] {
  if (!input || typeof input !== "object") {
    return [];
  }

  const suggestions = (input as { suggestions?: unknown[] }).suggestions;
  if (!Array.isArray(suggestions)) {
    return [];
  }

  return suggestions
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const safeItem = item as { tone?: unknown; content?: unknown };
      const tone = typeof safeItem.tone === "string" ? safeItem.tone.trim() : "";
      const content = typeof safeItem.content === "string" ? safeItem.content.trim() : "";
      if (!tone || !content) {
        return null;
      }
      return { tone, content };
    })
    .filter((item): item is Suggestion => Boolean(item))
    .slice(0, 3);
}

export async function generateReplySuggestions(reviewText: string): Promise<Suggestion[]> {
  const normalizedReviewText = normalizeReviewText(reviewText);
  if (!normalizedReviewText) {
    throw new AppError("Review text is invalid or too long.", 400, "INVALID_REVIEW_TEXT");
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new AppError("GEMINI_API_KEY is missing.", 500, "MISSING_GEMINI_KEY");
  }

  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash-lite";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const response = await fetchWithRetry(
    endpoint,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text:
                  "Return JSON only. Create exactly 3 short business replies to this customer review. " +
                  "Use tones: standard, friendly, problem-solving. Each reply must be under 70 words.\n\n" +
                  `Review:\n${normalizedReviewText}`,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.6,
          response_mime_type: "application/json",
          response_schema: {
            type: "OBJECT",
            properties: {
              suggestions: {
                type: "ARRAY",
                minItems: 3,
                maxItems: 3,
                items: {
                  type: "OBJECT",
                  properties: {
                    tone: { type: "STRING" },
                    content: { type: "STRING" },
                  },
                  required: ["tone", "content"],
                },
              },
            },
            required: ["suggestions"],
          },
        },
      }),
    },
    { timeoutMs: 15000, retries: 1, retryDelayMs: 400 },
  );

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new AppError("Gemini credentials are invalid or not allowed.", 502, "GEMINI_AUTH_ERROR");
    }
    if (response.status === 429) {
      throw new AppError("Gemini rate limit reached. Please retry shortly.", 429, "GEMINI_RATE_LIMIT");
    }
    throw new AppError(`Gemini request failed with status ${response.status}.`, 502, "GEMINI_HTTP_ERROR");
  }

  const payload = (await response.json()) as GeminiResponse;
  const rawContent = payload.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawContent) {
    throw new AppError("Gemini returned empty content.", 502, "GEMINI_EMPTY_CONTENT");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent) as unknown;
  } catch {
    throw new AppError("Gemini returned non-JSON output.", 502, "GEMINI_NON_JSON_OUTPUT");
  }

  const suggestions = normalizeSuggestions(parsed);
  if (suggestions.length !== 3) {
    throw new AppError("Gemini output did not return exactly 3 suggestions.", 502, "GEMINI_INVALID_OUTPUT");
  }

  return suggestions;
}
