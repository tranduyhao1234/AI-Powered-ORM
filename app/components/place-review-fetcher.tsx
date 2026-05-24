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

export function PlaceReviewFetcher() {
  const router = useRouter();
  const [placeId, setPlaceId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FetchResult | null>(null);

  const canSubmit = useMemo(() => placeId.trim().length > 0 && !loading, [placeId, loading]);

  async function warmAiJobs(reviewIds: string[]) {
    for (let index = 0; index < reviewIds.length; index += 1) {
      try {
        const response = await fetch("/api/ai-jobs/process", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ reviewIds, limit: 1 }),
        });
        if (response.ok) {
          router.refresh();
        }
      } catch {
        // Job processing is best-effort; the Generate AI button can re-enqueue later.
      }
    }
  }

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
      void warmAiJobs(payload.reviews.map((review) => review.id));
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
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-600">Input & Actions</p>
          <h2 className="text-xl font-semibold text-slate-950">Fetch Reviews</h2>
          <p className="max-w-2xl text-sm leading-6 text-slate-600">
            Enter a Google Place ID. In free/demo mode, LongCat generates realistic feedback and pre-generates AI replies.
          </p>
        </div>
        <p className="inline-flex w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
          Latest 5 reviews sync into the Work Queue
        </p>
      </div>

      <form className="mt-5 grid gap-3 md:grid-cols-[1fr_auto]" onSubmit={onSubmit}>
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
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {loading ? (
            <>
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              Fetching...
            </>
          ) : (
            "Fetch Reviews"
          )}
        </button>
      </form>

      {error ? (
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">{error}</p>
      ) : null}

      {result ? (
        <div className="mt-4 grid gap-3 md:grid-cols-[0.9fr_1.1fr]">
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            Saved <strong>{result.count}</strong> reviews for <strong>{result.placeId}</strong>. Work Queue updated.
          </p>
          {result.message ? (
            <p className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-800">{result.message}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
