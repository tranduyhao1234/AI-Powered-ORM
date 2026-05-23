"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type ReviewItem = {
  id: string;
  place_id: string;
  reviewer_name: string | null;
  rating: number | null;
  review_text: string;
  review_time: string | null;
  status: "pending" | "resolved";
  suggestions?: unknown[];
};

type FetchResult = {
  placeId: string;
  count: number;
  reviews: ReviewItem[];
  message?: string;
  error?: string;
};

function formatRatingStars(rating: number | null) {
  if (typeof rating !== "number" || !Number.isFinite(rating)) {
    return "No rating";
  }
  const safeRating = Math.max(1, Math.min(5, Math.round(rating)));
  return `${"\u2605".repeat(safeRating)}${"\u2606".repeat(5 - safeRating)}`;
}

export function PlaceReviewFetcher() {
  const router = useRouter();
  const [placeId, setPlaceId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FetchResult | null>(null);

  const canSubmit = useMemo(() => placeId.trim().length > 0 && !loading, [placeId, loading]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/reviews/fetch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ placeId }),
      });

      const payload = (await response.json()) as FetchResult;
      if (!response.ok) {
        throw new Error(payload.error || "Failed to fetch reviews.");
      }

      setResult(payload);
      window.dispatchEvent(new CustomEvent("reviews:fetched", { detail: payload }));
      router.refresh();
      window.setTimeout(() => router.refresh(), 2500);
      window.setTimeout(() => router.refresh(), 6000);
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="glass-card space-y-4 rounded-3xl p-4 sm:p-5">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Data Pipeline</p>
          <h2 className="text-xl font-semibold text-slate-900">Fetch or Generate Feedback</h2>
          <p className="max-w-2xl text-sm text-slate-600">
            Enter a Place ID. Google reviews are used when available; LongCat creates AI demo feedback for free mode.
          </p>
        </div>
        <p className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
          Latest 5 saved to database
        </p>
      </div>

      <form className="grid gap-3 sm:grid-cols-[1fr_auto]" onSubmit={onSubmit}>
        <label className="sr-only" htmlFor="placeId">
          Place ID
        </label>
        <input
          id="placeId"
          name="placeId"
          value={placeId}
          onChange={(event) => setPlaceId(event.target.value)}
          placeholder="ChIJN1t_tDeuEmsRUsoyG83frY4"
          className="ui-input w-full rounded-xl px-4 py-3 text-sm outline-none"
        />
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-5 py-3 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(19,111,99,0.35)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_26px_rgba(19,111,99,0.4)] disabled:cursor-not-allowed disabled:from-slate-400 disabled:to-slate-400 disabled:shadow-none"
        >
          {loading ? "Fetching..." : "Fetch"}
        </button>
      </form>

      {error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">{error}</p>
      ) : null}

      {result ? (
        <div className="space-y-3">
          <div className="grid gap-2 md:grid-cols-[1fr_1fr]">
            <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              Saved <strong>{result.count}</strong> latest reviews for <strong>{result.placeId}</strong>.
            </p>
            {result.message ? (
              <p className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">{result.message}</p>
            ) : null}
          </div>

          <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
            {result.reviews.map((review) => (
              <li key={review.id} className="rounded-xl border border-slate-200/80 bg-white/90 p-3 shadow-sm">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold text-slate-900">{review.reviewer_name ?? "Anonymous"}</span>
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                    {formatRatingStars(review.rating)}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs uppercase tracking-wide text-slate-600">
                    {review.status}
                  </span>
                </div>
                <p className="line-clamp-2 text-sm leading-relaxed text-slate-700">{review.review_text}</p>
                {review.review_time ? (
                  <p className="mt-1 text-xs text-slate-500">
                    {new Date(review.review_time).toLocaleString()}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
