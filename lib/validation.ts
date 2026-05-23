const PLACE_ID_PATTERN = /^[A-Za-z0-9_\-]{10,256}$/;
const DEMO_PLACE_ID_PATTERN = /^[A-Za-z0-9_\-\s]{3,256}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizePlaceId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!PLACE_ID_PATTERN.test(normalized)) {
    return null;
  }

  return normalized;
}

export function normalizeDemoPlaceId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(/\s+/g, "-");
  if (!DEMO_PLACE_ID_PATTERN.test(value.trim()) || normalized.length < 3) {
    return null;
  }

  return normalized;
}

export function normalizeUuid(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!UUID_PATTERN.test(normalized)) {
    return null;
  }

  return normalized;
}

export function normalizeReviewText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > 3000) {
    return null;
  }

  return normalized;
}
