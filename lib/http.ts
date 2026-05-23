type RetryOptions = {
  timeoutMs: number;
  retries?: number;
  retryDelayMs?: number;
};

type ExternalProvider = "google" | "ai";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number) {
  return [408, 425, 429, 500, 502, 503, 504].includes(status);
}

function parseIntEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

export function getExternalRetryOptions(provider: ExternalProvider): RetryOptions {
  const fastMode = (process.env.API_FAST_MODE || "true").toLowerCase() === "true";
  const defaultTimeoutMs = provider === "google" ? (fastMode ? 2500 : 9000) : fastMode ? 2500 : 15000;
  const defaultRetries = fastMode ? 0 : 1;
  const defaultRetryDelayMs = fastMode ? 120 : 300;

  const timeoutMs = parseIntEnv(
    provider === "google" ? "GOOGLE_API_TIMEOUT_MS" : "AI_API_TIMEOUT_MS",
    parseIntEnv("EXTERNAL_API_TIMEOUT_MS", defaultTimeoutMs),
  );
  const retries = parseIntEnv("EXTERNAL_API_RETRIES", defaultRetries);
  const retryDelayMs = parseIntEnv("EXTERNAL_API_RETRY_DELAY_MS", defaultRetryDelayMs);

  return { timeoutMs, retries, retryDelayMs };
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: RetryOptions,
): Promise<Response> {
  const retries = options.retries ?? 1;
  const retryDelayMs = options.retryDelayMs ?? 300;

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (attempt < retries && isRetryableStatus(response.status)) {
        await sleep(retryDelayMs * (attempt + 1));
        continue;
      }

      return response;
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;

      if (attempt >= retries) {
        throw error;
      }
      await sleep(retryDelayMs * (attempt + 1));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Network request failed.");
}
