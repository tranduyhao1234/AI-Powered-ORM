import { AppError } from "@/lib/app-error";
import { fetchWithRetry, getExternalRetryOptions } from "@/lib/http";
import { normalizeReviewText } from "@/lib/validation";

type Suggestion = {
  tone: string;
  content: string;
};

type LongCatResponse = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
};

type GenerateReplyOptions = {
  maxAttempts?: number;
  timeoutMs?: number;
};

const DEFAULT_LONGCAT_MODEL = "LongCat-Flash-Chat";
const DEFAULT_LONGCAT_FALLBACK_MODEL = "LongCat-Flash-Lite";
const DEFAULT_LONGCAT_BASE_URL = "https://api.longcat.chat/openai/v1";
const DEFAULT_TONES = ["standard", "friendly", "problem-solving"] as const;

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

function normalizeBaseUrl(input: string) {
  return input.endsWith("/") ? input.slice(0, -1) : input;
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

function tryParseJson(rawText: string): unknown | null {
  const cleaned = unwrapJsonBlock(rawText);
  try {
    return JSON.parse(cleaned) as unknown;
  } catch {
    const objectMatch = cleaned.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        return JSON.parse(objectMatch[0]) as unknown;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function tryParseUnknownAsJson(value: unknown): unknown | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) {
    return null;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

function extractSuggestionsArray(input: unknown): unknown[] {
  if (Array.isArray(input)) {
    return input;
  }
  if (!input || typeof input !== "object") {
    return [];
  }

  const safeInput = input as Record<string, unknown>;
  const keys = ["suggestions", "replies", "options", "items", "responses", "data"];
  for (const key of keys) {
    const value = safeInput[key];
    if (Array.isArray(value)) {
      return value;
    }
    const reparsed = tryParseUnknownAsJson(value);
    if (Array.isArray(reparsed)) {
      return reparsed;
    }
    if (reparsed && typeof reparsed === "object") {
      const nestedArray = extractSuggestionsArray(reparsed);
      if (nestedArray.length > 0) {
        return nestedArray;
      }
    }
  }

  return [];
}

function normalizeKeyName(key: string) {
  return key.toLowerCase().replace(/[_\s-]+/g, "");
}

function normalizeToneFromKey(key: string, index: number): string {
  const normalizedKey = normalizeKeyName(key);
  if (normalizedKey.includes("friendly") || normalizedKey.includes("thanthien")) {
    return "friendly";
  }
  if (normalizedKey.includes("problem") || normalizedKey.includes("solution") || normalizedKey.includes("khacphuc")) {
    return "problem-solving";
  }
  if (normalizedKey.includes("standard") || normalizedKey.includes("tieuchuan")) {
    return "standard";
  }
  return DEFAULT_TONES[index % DEFAULT_TONES.length];
}

function normalizeSuggestionsFromKeyedObject(input: unknown): Suggestion[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return [];
  }

  const safeInput = input as Record<string, unknown>;
  const containerKeys = ["suggestions", "replies", "options", "responses", "data"];
  for (const key of containerKeys) {
    const value = safeInput[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = normalizeSuggestionsFromKeyedObject(value);
      if (nested.length > 0) {
        return nested;
      }
    }
  }

  const preferredKeys = [
    "standard",
    "friendly",
    "problem_solving",
    "problem-solving",
    "problemSolving",
    "option1",
    "option_1",
    "reply1",
    "response1",
    "option2",
    "option_2",
    "reply2",
    "response2",
    "option3",
    "option_3",
    "reply3",
    "response3",
  ];
  const entries = [
    ...preferredKeys
      .filter((key) => Object.prototype.hasOwnProperty.call(safeInput, key))
      .map((key) => [key, safeInput[key]] as const),
    ...Object.entries(safeInput).filter(([key]) => !preferredKeys.includes(key)),
  ];

  const mapped = entries
    .map<Suggestion | null>(([key, value], index) => {
      if (typeof value === "string" && value.trim()) {
        return {
          tone: normalizeToneFromKey(key, index),
          content: value.trim(),
        };
      }
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const content = extractSuggestionContent(value as Record<string, unknown>);
        if (content) {
          return {
            tone: normalizeToneFromKey(key, index),
            content,
          };
        }
      }
      return null;
    })
    .filter((item): item is Suggestion => Boolean(item))
    .slice(0, 3);

  if (mapped.length > 0) {
    return mapped;
  }

  const anyStringValues = Object.values(safeInput)
    .filter((value): value is string => typeof value === "string" && value.trim().length >= 12)
    .slice(0, 3);
  return anyStringValues.map((content, index) => ({
    tone: DEFAULT_TONES[index % DEFAULT_TONES.length],
    content: content.trim(),
  }));
}

function extractSuggestionContent(item: Record<string, unknown>): string {
  const directKeys = ["content", "reply", "text", "message", "body"];
  for (const key of directKeys) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  const nestedKeys = ["content", "message"];
  for (const key of nestedKeys) {
    const nested = item[key];
    if (!nested || typeof nested !== "object") {
      continue;
    }
    const safeNested = nested as Record<string, unknown>;
    const nestedText = safeNested.text;
    if (typeof nestedText === "string" && nestedText.trim()) {
      return nestedText.trim();
    }
  }

  return "";
}

function normalizeSuggestionsFromJson(input: unknown): Suggestion[] {
  const fromKeyedObject = normalizeSuggestionsFromKeyedObject(input);
  if (fromKeyedObject.length > 0) {
    return fromKeyedObject;
  }

  const suggestions = extractSuggestionsArray(input);
  if (suggestions.length === 1) {
    const onlySuggestion = suggestions[0];
    const nestedCandidate =
      typeof onlySuggestion === "string"
        ? tryParseJson(onlySuggestion)
        : onlySuggestion && typeof onlySuggestion === "object"
          ? tryParseJson(extractSuggestionContent(onlySuggestion as Record<string, unknown>))
          : null;

    if (nestedCandidate) {
      const nestedSuggestions = normalizeSuggestionsFromJson(nestedCandidate);
      if (nestedSuggestions.length > 1) {
        return nestedSuggestions;
      }
    }
  }

  return suggestions
    .map((item, index) => {
      if (typeof item === "string" && item.trim()) {
        const nestedJson = tryParseJson(item);
        if (nestedJson) {
          const nestedSuggestions = normalizeSuggestionsFromJson(nestedJson);
          if (nestedSuggestions.length > 0) {
            return nestedSuggestions[0];
          }
        }
        return {
          tone: DEFAULT_TONES[index % DEFAULT_TONES.length],
          content: item.trim(),
        };
      }
      if (!item || typeof item !== "object") {
        return null;
      }

      const safeItem = item as Record<string, unknown>;
      const toneCandidate = safeItem.tone ?? safeItem.style ?? safeItem.type ?? safeItem.category;
      const tone =
        typeof toneCandidate === "string" && toneCandidate.trim()
          ? toneCandidate.trim().toLowerCase()
          : DEFAULT_TONES[index % DEFAULT_TONES.length];
      const content = extractSuggestionContent(safeItem);
      if (!content) {
        return null;
      }
      const nestedJson = tryParseJson(content);
      if (nestedJson) {
        const nestedSuggestions = normalizeSuggestionsFromJson(nestedJson);
        if (nestedSuggestions.length > 0) {
          return nestedSuggestions[index % nestedSuggestions.length];
        }
      }
      return { tone, content };
    })
    .filter((item): item is Suggestion => Boolean(item));
}

function normalizeSuggestionsFromPlainText(rawText: string): Suggestion[] {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*\d.)\s]+/, ""))
    .filter((line) => line.length >= 12)
    .filter((line) => !line.includes('{"suggestions"'))
    .filter((line) => !line.includes('"tone"'))
    .filter((line) => !line.includes('"content"'));

  const uniqueLines = Array.from(new Set(lines));
  return uniqueLines.slice(0, 3).map((content, index) => ({
    tone: DEFAULT_TONES[index % DEFAULT_TONES.length],
    content,
  }));
}

function extractContentsByRegex(rawText: string): Suggestion[] {
  const matches = Array.from(rawText.matchAll(/"content"\s*:\s*"((?:\\.|[^"\\])*)"/g));
  if (matches.length === 0) {
    return [];
  }

  const extracted: Suggestion[] = [];
  for (let index = 0; index < matches.length; index += 1) {
    const captured = matches[index][1];
    let decoded = captured;
    try {
      decoded = JSON.parse(`"${captured}"`) as string;
    } catch {
      decoded = captured.replace(/\\"/g, '"').replace(/\\n/g, " ").replace(/\\t/g, " ");
    }

    const content = decoded.trim();
    if (!content || content.length < 8) {
      continue;
    }

    extracted.push({
      tone: DEFAULT_TONES[index % DEFAULT_TONES.length],
      content,
    });

    if (extracted.length === 3) {
      break;
    }
  }

  return extracted;
}

function extractSuggestionsFromSentences(rawText: string): Suggestion[] {
  const cleaned = rawText
    .replace(/\{[\s\S]*?\}/g, " ")
    .replace(/["\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) {
    return [];
  }

  const parts = cleaned
    .split(/[.!?]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 20);
  const unique = Array.from(new Set(parts));
  return unique.slice(0, 3).map((content, index) => ({
    tone: DEFAULT_TONES[index % DEFAULT_TONES.length],
    content,
  }));
}

function ensureExactlyThreeSuggestions(input: Suggestion[]): Suggestion[] {
  return input.slice(0, 3);
}

function parseSuggestionsFromModelContent(rawContent: string): Suggestion[] {
  let parsed = tryParseJson(rawContent);
  if (typeof parsed === "string") {
    const reparsed = tryParseUnknownAsJson(parsed);
    if (reparsed) {
      parsed = reparsed;
    }
  }
  if (parsed) {
    const fromJson = normalizeSuggestionsFromJson(parsed);
    if (fromJson.length > 0) {
      return ensureExactlyThreeSuggestions(fromJson);
    }
  }

  const fromRegex = extractContentsByRegex(rawContent);
  if (fromRegex.length > 0) {
    return ensureExactlyThreeSuggestions(fromRegex);
  }

  const fromText = normalizeSuggestionsFromPlainText(rawContent);
  if (fromText.length > 0) {
    return ensureExactlyThreeSuggestions(fromText);
  }

  const fromSentences = extractSuggestionsFromSentences(rawContent);
  return ensureExactlyThreeSuggestions(fromSentences);
}

function hasVietnameseMarkers(text: string) {
  return /[^\x00-\x7F]/.test(text);
}

function isLikelyEnglishSentence(text: string) {
  return /\b(the|and|service|food|delicious|prompt|plan|return|thanks|sorry|experience)\b/i.test(text);
}

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

function extractReviewKeywords(reviewText: string) {
  const normalized = normalizeForMatch(reviewText);
  const stopwords = new Set([
    "va",
    "voi",
    "cho",
    "nhung",
    "nhung",
    "cua",
    "toi",
    "ban",
    "minh",
    "chung",
    "toi",
    "la",
    "co",
    "rat",
    "hoi",
    "nay",
    "kia",
    "duoc",
    "khong",
    "vi",
    "khi",
    "se",
    "da",
    "an",
    "u",
    "mon",
    "quan",
  ]);
  const words = normalized.split(" ").filter((word) => word.length >= 4 && !stopwords.has(word));
  return Array.from(new Set(words)).slice(0, 8);
}

function hasKeywordOverlap(reviewKeywords: string[], suggestion: string) {
  if (reviewKeywords.length === 0) {
    return true;
  }
  const normalizedSuggestion = normalizeForMatch(suggestion);
  return reviewKeywords.some((keyword) => normalizedSuggestion.includes(keyword));
}

function isSummaryLikeReply(text: string) {
  return /\b(danh gia tong quan|nhan xet chung|tong quan|overall review|overall)\b/i.test(normalizeForMatch(text));
}

function hasReplyVoice(text: string) {
  return /\b(cam on|xin loi|chung toi|doi ngu|tui minh|mong ban|hy vong)\b/i.test(normalizeForMatch(text));
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
  const noNegativeIssue = !hasNegativeIssue(reviewText);
  return noNegativeIssue && ((typeof rating === "number" && rating >= 4) || positive);
}

function normalizeSuggestionToReply(reviewText: string, suggestion: Suggestion, rating?: number | null): Suggestion {
  return {
    tone: suggestion.tone,
    content: suggestion.content.trim(),
  };
}

function normalizeSuggestionsToReplies(reviewText: string, suggestions: Suggestion[], rating?: number | null) {
  return suggestions.map((item) => normalizeSuggestionToReply(reviewText, item, rating));
}

function containsApology(text: string) {
  return /\b(xin loi|rat tiec|sorry|apologize|apology)\b/i.test(normalizeForMatch(text));
}

function finalizeSuggestionsForReview(reviewText: string, suggestions: Suggestion[], rating?: number | null) {
  const normalized = normalizeSuggestionsToReplies(reviewText, ensureExactlyThreeSuggestions(suggestions), rating);
  if (normalized.length !== 3) {
    throw new AppError("LongCat output did not return exactly 3 valid suggestions.", 502, "LONGCAT_INVALID_OUTPUT");
  }
  if (isClearlyPositiveReview(reviewText, rating) && normalized.some((suggestion) => containsApology(suggestion.content))) {
    throw new AppError("LongCat output apologized for a positive review.", 502, "LONGCAT_LOW_QUALITY");
  }

  return normalized;
}

function isLowQualityForReview(reviewText: string, suggestions: Suggestion[]) {
  const reviewLooksVietnamese = hasVietnameseMarkers(reviewText) || /\b(quan|mon|phuc vu|cam on|xin loi)\b/i.test(reviewText);
  if (!reviewLooksVietnamese) {
    return false;
  }

  const reviewKeywords = extractReviewKeywords(reviewText);
  let englishLikeCount = 0;
  let weakVoiceCount = 0;
  let noOverlapCount = 0;
  let summaryLikeCount = 0;
  for (const suggestion of suggestions) {
    if (!hasVietnameseMarkers(suggestion.content) && isLikelyEnglishSentence(suggestion.content)) {
      englishLikeCount += 1;
    }
    if (!hasReplyVoice(suggestion.content)) {
      weakVoiceCount += 1;
    }
    if (!hasKeywordOverlap(reviewKeywords, suggestion.content)) {
      noOverlapCount += 1;
    }
    if (isSummaryLikeReply(suggestion.content)) {
      summaryLikeCount += 1;
    }
  }

  return englishLikeCount >= 1 || summaryLikeCount >= 1 || weakVoiceCount >= 2 || noOverlapCount >= 2;
}

function buildSuggestionPrompt(normalizedReviewText: string, rating?: number | null, retry = false) {
  const reviewExcerpt = normalizedReviewText.slice(0, 220);
  const ratingInstruction =
    typeof rating === "number"
      ? `Rating: ${rating}/5. If rating is 4-5 and review is positive, do not apologize.\n`
      : "";
  const retryInstruction = retry
    ? "Previous output was invalid. Return ONLY this exact JSON shape with 3 string values.\n"
    : "";
  return (
    'Return JSON only in this exact shape: {"standard":"...","friendly":"...","problem_solving":"..."}\n' +
    retryInstruction +
    "Vietnamese replies with diacritics. Mention review details. Each under 30 words. Do not summarize. Apologize only for real problems; positive reviews should be thanked, not apologized.\n\n" +
    `${ratingInstruction}Review:\n${reviewExcerpt}`
  );
}

function buildSingleSuggestionPrompt(normalizedReviewText: string, tone: string, rating?: number | null) {
  const reviewExcerpt = normalizedReviewText.slice(0, 220);
  const toneInstruction: Record<string, string> = {
    standard: "Tone: standard, concise and professional.",
    friendly: "Tone: friendly, warm and natural.",
    "problem-solving": "Tone: problem-solving, mention concrete action. Apologize only if the review reports a real problem.",
  };
  const ratingInstruction =
    typeof rating === "number"
      ? `Rating: ${rating}/5. If rating is 4-5 and review is positive, do not apologize.`
      : "";

  return (
    'Return JSON only: {"reply":"..."}\n' +
    `${toneInstruction[tone] ?? toneInstruction.standard}\n` +
    `${ratingInstruction}\n` +
    "Vietnamese with full diacritics. Direct customer-facing business reply. Mention review details. Under 35 words. Do not summarize.\n\n" +
    `Review:\n${reviewExcerpt}`
  );
}

function parseSingleReplyFromModelContent(rawContent: string) {
  const parsed = tryParseJson(rawContent);
  if (typeof parsed === "string" && parsed.trim()) {
    return parsed.trim();
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const content = extractSuggestionContent(parsed as Record<string, unknown>);
    if (content) {
      return content;
    }
    const firstString = Object.values(parsed as Record<string, unknown>).find(
      (value): value is string => typeof value === "string" && value.trim().length >= 8,
    );
    if (firstString) {
      return firstString.trim();
    }
  }
  return unwrapJsonBlock(rawContent).replace(/^["']|["']$/g, "").trim();
}

function isRetryableSuggestionError(error: unknown) {
  if (!(error instanceof AppError)) {
    return false;
  }
  return error.code === "LONGCAT_INVALID_OUTPUT" || error.code === "LONGCAT_LOW_QUALITY";
}

function isTimeoutError(error: unknown) {
  return error instanceof AppError && error.code === "LONGCAT_TIMEOUT";
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

export async function generateReplySuggestions(
  reviewText: string,
  rating?: number | null,
  options: GenerateReplyOptions = {},
): Promise<Suggestion[]> {
  const normalizedReviewText = normalizeReviewText(reviewText);
  if (!normalizedReviewText) {
    throw new AppError("Review text is invalid or too long.", 400, "INVALID_REVIEW_TEXT");
  }

  const apiKey = process.env.LONGCAT_API_KEY;
  if (!apiKey) {
    throw new AppError("LONGCAT_API_KEY is missing.", 500, "MISSING_LONGCAT_KEY");
  }

  const primaryModel = process.env.LONGCAT_MODEL || DEFAULT_LONGCAT_MODEL;
  const fallbackModel = process.env.LONGCAT_FALLBACK_MODEL || DEFAULT_LONGCAT_FALLBACK_MODEL;
  const baseUrl = normalizeBaseUrl(process.env.LONGCAT_BASE_URL || DEFAULT_LONGCAT_BASE_URL);
  const endpoint = `${baseUrl}/chat/completions`;
  const maxAttempts = options.maxAttempts ?? parsePositiveIntEnv("LONGCAT_GENERATE_ATTEMPTS", 1);
  const retryOptions = {
    ...getExternalRetryOptions("ai"),
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
  };

  async function requestLongCatRaw(prompt: string, maxTokens: number, model = primaryModel) {
    let response: Response;
    try {
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
            temperature: 0.2,
            max_tokens: maxTokens,
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content: "Write customer review replies. Strict JSON only.",
              },
              {
                role: "user",
                content: prompt,
              },
            ],
          }),
        },
        retryOptions,
      );
    } catch (error) {
      if (isAbortLikeError(error)) {
        throw new AppError("LongCat timeout (> configured limit). Please retry.", 504, "LONGCAT_TIMEOUT");
      }
      throw new AppError("LongCat network error.", 502, "LONGCAT_NETWORK_ERROR");
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

    let payload: LongCatResponse;
    try {
      payload = (await response.json()) as LongCatResponse;
    } catch {
      throw new AppError("LongCat returned an unreadable response.", 502, "LONGCAT_INVALID_RESPONSE");
    }
    const rawContent = extractLongCatContent(payload.choices?.[0]?.message?.content);
    if (!rawContent) {
      throw new AppError("LongCat returned empty content.", 502, "LONGCAT_EMPTY_CONTENT");
    }
    return rawContent;
  }

  const parallelToneGeneration = (process.env.LONGCAT_PARALLEL_TONE_GENERATION || "true").toLowerCase() === "true";
  if (parallelToneGeneration) {
    const suggestions = await Promise.all(
      DEFAULT_TONES.map(async (tone) => {
        const prompt = buildSingleSuggestionPrompt(normalizedReviewText, tone, rating);
        try {
          const rawContent = await requestLongCatRaw(prompt, 120, primaryModel);
          return {
            tone,
            content: parseSingleReplyFromModelContent(rawContent),
          };
        } catch (error) {
          if (!isTimeoutError(error)) {
            throw error;
          }
          const rawContent = await requestLongCatRaw(prompt, 120, fallbackModel);
          return {
            tone,
            content: parseSingleReplyFromModelContent(rawContent),
          };
        }
      }),
    );
    return finalizeSuggestionsForReview(normalizedReviewText, suggestions, rating);
  }

  let lastSuggestionError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let response: Response;
    try {
      response = await fetchWithRetry(
        endpoint,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: primaryModel,
            temperature: attempt === 0 ? 0.25 : 0.1,
            max_tokens: 220,
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content: "Write customer review replies. Strict JSON only.",
              },
              {
                role: "user",
                content: buildSuggestionPrompt(normalizedReviewText, rating, attempt > 0),
              },
            ],
          }),
        },
        retryOptions,
      );
    } catch (error) {
      if (isAbortLikeError(error)) {
        throw new AppError("LongCat timeout (> configured limit). Please retry.", 504, "LONGCAT_TIMEOUT");
      }
      throw new AppError("LongCat network error.", 502, "LONGCAT_NETWORK_ERROR");
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

    let payload: LongCatResponse;
    try {
      payload = (await response.json()) as LongCatResponse;
    } catch {
      throw new AppError("LongCat returned an unreadable response.", 502, "LONGCAT_INVALID_RESPONSE");
    }
    const rawContent = extractLongCatContent(payload.choices?.[0]?.message?.content);
    if (!rawContent) {
      throw new AppError("LongCat returned empty content.", 502, "LONGCAT_EMPTY_CONTENT");
    }

    const parsedSuggestions = parseSuggestionsFromModelContent(rawContent);
    try {
      return finalizeSuggestionsForReview(normalizedReviewText, parsedSuggestions, rating);
    } catch (error) {
      lastSuggestionError = error;
      if (attempt < maxAttempts - 1 && isRetryableSuggestionError(error) && !isTimeoutError(error)) {
        continue;
      }
      throw error;
    }
  }

  throw lastSuggestionError instanceof Error
    ? lastSuggestionError
    : new AppError("LongCat output did not return exactly 3 valid suggestions.", 502, "LONGCAT_INVALID_OUTPUT");
}


