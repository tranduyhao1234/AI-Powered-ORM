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

const DEFAULT_LONGCAT_MODEL = "LongCat-Flash-Chat";
const DEFAULT_LONGCAT_BASE_URL = "https://api.longcat.chat/openai/v1";
const DEFAULT_TONES = ["standard", "friendly", "problem-solving"] as const;

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
  const suggestions = extractSuggestionsArray(input);
  return suggestions
    .map((item, index) => {
      if (typeof item === "string" && item.trim()) {
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
      return { tone, content };
    })
    .filter((item): item is Suggestion => Boolean(item));
}

function normalizeSuggestionsFromPlainText(rawText: string): Suggestion[] {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*•\d.)\s]+/, ""))
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
  if (input.length === 0) {
    return [];
  }

  const suggestions = input.slice(0, 3);
  const filler: Record<(typeof DEFAULT_TONES)[number], string> = {
    standard: "Cảm ơn bạn đã chia sẻ phản hồi. Chúng tôi sẽ tiếp tục cải thiện chất lượng phục vụ.",
    friendly: "Cảm ơn bạn đã ghé quán. Tụi mình rất trân trọng góp ý và mong được phục vụ bạn tốt hơn lần tới.",
    "problem-solving":
      "Xin lỗi vì trải nghiệm chưa trọn vẹn. Chúng tôi đã ghi nhận và đang xử lý để tránh lặp lại.",
  };

  while (suggestions.length < 3) {
    const tone = DEFAULT_TONES[suggestions.length];
    suggestions.push({ tone, content: filler[tone] });
  }

  return suggestions;
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
  return /[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i.test(text);
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

function shortIssuePreview(text: string) {
  const normalized = text
    .replace(/\(sample for [^)]+\)/gi, "")
    .trim()
    .replace(/\s+/g, " ");
  if (normalized.length <= 90) {
    return normalized;
  }
  return `${normalized.slice(0, 87)}...`;
}

function hasNegativeIssue(reviewText: string) {
  return /\b(cham|lau|te|kem|ban|lanh|dat|that vong|khong hai long|phien|loi|sai|thieu|on ao|kho chiu|hoi cham|mon len cham|doi lau)\b/i.test(
    normalizeForMatch(reviewText),
  );
}

function isClearlyPositiveReview(reviewText: string, rating?: number | null) {
  const normalized = normalizeForMatch(reviewText);
  const positive = /\b(ngon|nhanh|tot|tuyet|hai long|quay lai|than thien|sach|de thuong|ung ho|thich)\b/i.test(
    normalized,
  );
  const noNegativeIssue = !hasNegativeIssue(reviewText);
  return noNegativeIssue && ((typeof rating === "number" && rating >= 4) || positive);
}

function buildReplyFromIssue(reviewText: string, tone: string, rating?: number | null) {
  const issue = shortIssuePreview(reviewText);
  const positiveReview = isClearlyPositiveReview(reviewText, rating);
  if (tone.includes("friendly")) {
    return (
      `Cảm ơn bạn đã ghé quán và chia sẻ thật lòng. Về góp ý "${issue}", ` +
      (positiveReview
        ? "tụi mình rất vui khi bạn hài lòng và mong sớm được đón bạn quay lại."
        : "tụi mình đã ghi nhận và sẽ cải thiện tốc độ phục vụ để trải nghiệm lần tới tốt hơn.")
    );
  }
  if (tone.includes("problem")) {
    if (positiveReview) {
      return (
        `Cảm ơn bạn đã đánh giá tích cực về "${issue}". ` +
        "Chúng tôi sẽ tiếp tục duy trì chất lượng món ăn và tốc độ phục vụ để mỗi lần ghé thăm đều trọn vẹn."
      );
    }
    return (
      `Xin lỗi bạn vì trải nghiệm chưa trọn vẹn, đặc biệt ở điểm "${issue}". ` +
      "Chúng tôi đã thông tin đến đội ngũ và ưu tiên xử lý ngay để tránh lặp lại."
    );
  }
  return (
    `Cảm ơn bạn đã phản hồi. Chúng tôi đã ghi nhận ý kiến "${issue}" ` +
    (positiveReview
      ? "và sẽ tiếp tục giữ vững chất lượng để phục vụ bạn tốt hơn trong những lần tới."
      : "và sẽ rà soát quy trình để phục vụ nhanh hơn trong các lần tiếp theo.")
  );
}

function normalizeSuggestionToReply(reviewText: string, suggestion: Suggestion, rating?: number | null): Suggestion {
  const content = suggestion.content.trim();
  const summaryLike = isSummaryLikeReply(content) || /\b(can cai thien|nen cai thien|tong quan)\b/i.test(normalizeForMatch(content));
  const missingReplyVoice = !hasReplyVoice(content);
  const apologyForPositiveReview =
    isClearlyPositiveReview(reviewText, rating) && /\b(xin loi|rat tiec|sorry|apologize)\b/i.test(normalizeForMatch(content));
  if (!summaryLike && !missingReplyVoice && !apologyForPositiveReview) {
    return suggestion;
  }

  return {
    tone: suggestion.tone,
    content: buildReplyFromIssue(reviewText, suggestion.tone.toLowerCase(), rating),
  };
}

function normalizeSuggestionsToReplies(reviewText: string, suggestions: Suggestion[], rating?: number | null) {
  return suggestions.map((item) => normalizeSuggestionToReply(reviewText, item, rating));
}

function buildContextualReplySet(reviewText: string, rating?: number | null): Suggestion[] {
  return DEFAULT_TONES.map((tone) => ({
    tone,
    content: buildReplyFromIssue(reviewText, tone, rating),
  }));
}

function finalizeSuggestionsForReview(reviewText: string, suggestions: Suggestion[], rating?: number | null) {
  if (suggestions.length === 0) {
    return buildContextualReplySet(reviewText, rating);
  }

  const normalized = normalizeSuggestionsToReplies(reviewText, ensureExactlyThreeSuggestions(suggestions), rating);
  if (normalized.length !== 3 || isLowQualityForReview(reviewText, normalized)) {
    return buildContextualReplySet(reviewText, rating);
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

function buildSuggestionPrompt(normalizedReviewText: string, rating?: number | null) {
  const reviewExcerpt = normalizedReviewText.slice(0, 400);
  const ratingInstruction =
    typeof rating === "number" ? `Customer rating: ${rating}/5. If rating is 4 or 5 and the review is positive, do not apologize.\n` : "";
  return (
    'JSON only: {"suggestions":[{"tone":"standard","content":"..."},{"tone":"friendly","content":"..."},{"tone":"problem-solving","content":"..."}]}\n' +
    "Write all replies in Vietnamese with full diacritics. Do not translate to English. These must be direct customer replies from the business to the customer, not review summaries or internal notes. Start with Cảm ơn or Xin lỗi. Mention the actual issue in the review. Return exactly 3 replies, each under 60 words.\n\n" +
    `${ratingInstruction}Review:\n${reviewExcerpt}`
  );
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

export async function generateReplySuggestions(reviewText: string, rating?: number | null): Promise<Suggestion[]> {
  const normalizedReviewText = normalizeReviewText(reviewText);
  if (!normalizedReviewText) {
    throw new AppError("Review text is invalid or too long.", 400, "INVALID_REVIEW_TEXT");
  }

  const apiKey = process.env.LONGCAT_API_KEY;
  if (!apiKey) {
    throw new AppError("LONGCAT_API_KEY is missing.", 500, "MISSING_LONGCAT_KEY");
  }

  const model = process.env.LONGCAT_MODEL || DEFAULT_LONGCAT_MODEL;
  const baseUrl = normalizeBaseUrl(process.env.LONGCAT_BASE_URL || DEFAULT_LONGCAT_BASE_URL);
  const endpoint = `${baseUrl}/chat/completions`;

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
          temperature: 0.3,
          max_tokens: 220,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "user",
              content: buildSuggestionPrompt(normalizedReviewText, rating),
            },
          ],
        }),
      },
      getExternalRetryOptions("ai"),
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
  const normalizedSuggestions = finalizeSuggestionsForReview(normalizedReviewText, parsedSuggestions, rating);

  return normalizedSuggestions;
}

