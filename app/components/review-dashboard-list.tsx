"use client";

import { useEffect, useMemo, useState } from "react";

type SuggestionItem = {
  id: string;
  review_id: string;
  tone: string | null;
  content: string;
  is_selected: boolean;
  created_at: string;
};

type ReviewItem = {
  id: string;
  place_id: string;
  reviewer_name: string | null;
  rating: number | null;
  review_text: string;
  review_time: string | null;
  status: "pending" | "resolved";
  suggestions: SuggestionItem[];
};

type GenerateResult = {
  reviewId: string;
  suggestions: SuggestionItem[];
  message?: string;
  error?: string;
};

type ApproveResult = {
  reviewId: string;
  suggestionId: string;
  status: "resolved";
  error?: string;
};

type FetchReviewsEvent = {
  placeId: string;
  reviews: ReviewItem[];
};

const PAGE_SIZE = 5;

function formatRatingStars(rating: number | null) {
  if (typeof rating !== "number" || !Number.isFinite(rating)) {
    return "No rating";
  }
  const safeRating = Math.max(1, Math.min(5, Math.round(rating)));
  return `${"\u2605".repeat(safeRating)}${"\u2606".repeat(5 - safeRating)}`;
}

export function ReviewDashboardList({
  initialReviews,
  latestReviews,
}: {
  initialReviews: ReviewItem[];
  latestReviews: ReviewItem[];
}) {
  const [reviews, setReviews] = useState(initialReviews);
  const [loadingByReview, setLoadingByReview] = useState<Record<string, boolean>>({});
  const [approvingBySuggestion, setApprovingBySuggestion] = useState<Record<string, boolean>>({});
  const [errorByReview, setErrorByReview] = useState<Record<string, string>>({});
  const [infoByReview, setInfoByReview] = useState<Record<string, string>>({});
  const [activeSuggestionByReview, setActiveSuggestionByReview] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "resolved">("all");
  const [sortBy, setSortBy] = useState<"newest" | "oldest">("newest");
  const [currentPage, setCurrentPage] = useState(1);
  const [fetchedReviewIds, setFetchedReviewIds] = useState<string[]>([]);
  const [activeFetchPlaceId, setActiveFetchPlaceId] = useState<string | null>(null);
  const [sideTab, setSideTab] = useState<"old" | "latest">("old");

  const pendingCount = useMemo(
    () => reviews.filter((review) => review.status === "pending").length,
    [reviews],
  );
  const resolvedCount = useMemo(
    () => reviews.filter((review) => review.status === "resolved").length,
    [reviews],
  );
  const resolveRate = useMemo(
    () => (reviews.length === 0 ? 0 : Math.round((resolvedCount / reviews.length) * 100)),
    [resolvedCount, reviews.length],
  );
  const activeFetchedReviews = useMemo(() => {
    if (fetchedReviewIds.length === 0) {
      return [];
    }
    const byId = new Map(reviews.map((review) => [review.id, review]));
    return fetchedReviewIds.map((id) => byId.get(id)).filter((review): review is ReviewItem => Boolean(review));
  }, [fetchedReviewIds, reviews]);
  const workQueueSource = activeFetchedReviews.length > 0 ? activeFetchedReviews : reviews;
  const archivedReviews = useMemo(() => {
    if (fetchedReviewIds.length === 0) {
      return reviews.slice(5);
    }
    const fetchedIds = new Set(fetchedReviewIds);
    return reviews.filter((review) => !fetchedIds.has(review.id));
  }, [fetchedReviewIds, reviews]);
  const sideReviews = sideTab === "old" ? archivedReviews : latestReviews;

  const filteredReviews = useMemo(() => {
    const lowered = query.trim().toLowerCase();
    const filtered = workQueueSource.filter((review) => {
      const matchStatus = statusFilter === "all" ? true : review.status === statusFilter;
      if (!matchStatus) {
        return false;
      }

      if (!lowered) {
        return true;
      }

      return (
        (review.reviewer_name ?? "").toLowerCase().includes(lowered) ||
        review.review_text.toLowerCase().includes(lowered) ||
        review.place_id.toLowerCase().includes(lowered)
      );
    });

    return filtered.sort((a, b) => {
      const aTime = a.review_time ? new Date(a.review_time).getTime() : 0;
      const bTime = b.review_time ? new Date(b.review_time).getTime() : 0;
      return sortBy === "newest" ? bTime - aTime : aTime - bTime;
    });
  }, [query, sortBy, statusFilter, workQueueSource]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredReviews.length / PAGE_SIZE)),
    [filteredReviews.length],
  );
  const paginatedReviews = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredReviews.slice(start, start + PAGE_SIZE);
  }, [currentPage, filteredReviews]);

  useEffect(() => {
    setCurrentPage(1);
  }, [query, sortBy, statusFilter]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  useEffect(() => {
    setReviews(initialReviews);
  }, [initialReviews]);

  useEffect(() => {
    function onReviewsFetched(event: Event) {
      const payload = (event as CustomEvent<FetchReviewsEvent>).detail;
      if (!payload?.reviews?.length) {
        return;
      }
      setReviews((prev) => {
        const incoming = payload.reviews.map((review) => ({
          ...review,
          suggestions: review.suggestions ?? [],
        }));
        const incomingIds = new Set(incoming.map((review) => review.id));
        return [...incoming, ...prev.filter((review) => !incomingIds.has(review.id))];
      });
      setFetchedReviewIds(payload.reviews.map((review) => review.id));
      setActiveFetchPlaceId(payload.placeId);
      setSideTab("old");
      setQuery("");
      setStatusFilter("all");
      setSortBy("newest");
      setCurrentPage(1);
    }

    window.addEventListener("reviews:fetched", onReviewsFetched);
    return () => window.removeEventListener("reviews:fetched", onReviewsFetched);
  }, []);

  async function onGenerate(reviewId: string) {
    setLoadingByReview((prev) => ({ ...prev, [reviewId]: true }));
    setErrorByReview((prev) => ({ ...prev, [reviewId]: "" }));
    setInfoByReview((prev) => ({ ...prev, [reviewId]: "" }));

    try {
      const response = await fetch("/api/reviews/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ reviewId }),
      });

      const payload = (await response.json()) as GenerateResult;
      if (!response.ok) {
        throw new Error(payload.error || "Failed to generate AI replies.");
      }

      setReviews((prev) =>
        prev.map((review) =>
          review.id === reviewId ? { ...review, suggestions: payload.suggestions ?? [] } : review,
        ),
      );
      const firstSuggestionId = payload.suggestions?.[0]?.id;
      if (firstSuggestionId) {
        setActiveSuggestionByReview((prev) => ({ ...prev, [reviewId]: firstSuggestionId }));
      }
      if (payload.message) {
        setInfoByReview((prev) => ({ ...prev, [reviewId]: payload.message! }));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      setErrorByReview((prev) => ({ ...prev, [reviewId]: message }));
    } finally {
      setLoadingByReview((prev) => ({ ...prev, [reviewId]: false }));
    }
  }

  async function onApprove(reviewId: string, suggestionId: string) {
    setApprovingBySuggestion((prev) => ({ ...prev, [suggestionId]: true }));
    setErrorByReview((prev) => ({ ...prev, [reviewId]: "" }));

    try {
      const response = await fetch("/api/reviews/approve", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ reviewId, suggestionId }),
      });

      const payload = (await response.json()) as ApproveResult;
      if (!response.ok) {
        throw new Error(payload.error || "Failed to approve suggestion.");
      }

      setReviews((prev) =>
        prev.map((review) => {
          if (review.id !== reviewId) {
            return review;
          }

          return {
            ...review,
            status: "resolved",
            suggestions: review.suggestions.map((suggestion) => ({
              ...suggestion,
              is_selected: suggestion.id === suggestionId,
            })),
          };
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      setErrorByReview((prev) => ({ ...prev, [reviewId]: message }));
    } finally {
      setApprovingBySuggestion((prev) => ({ ...prev, [suggestionId]: false }));
    }
  }

  function getActiveSuggestion(review: ReviewItem): SuggestionItem | null {
    const orderedSuggestions = getOrderedSuggestions(review);
    if (orderedSuggestions.length === 0) {
      return null;
    }

    const fromState = activeSuggestionByReview[review.id];
    if (fromState) {
      const matched = orderedSuggestions.find((suggestion) => suggestion.id === fromState);
      if (matched) {
        return matched;
      }
    }

    return orderedSuggestions[0];
  }

  function getOrderedSuggestions(review: ReviewItem): SuggestionItem[] {
    const selected = review.suggestions.find((suggestion) => suggestion.is_selected);
    if (!selected) {
      return review.suggestions;
    }

    return [selected, ...review.suggestions.filter((suggestion) => suggestion.id !== selected.id)];
  }

  return (
    <>
      <section className="rise-in mb-4 grid gap-3 sm:grid-cols-3">
        <div className="glass-card rounded-2xl p-4 shadow-sm">
          <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Total Reviews</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{reviews.length}</p>
          <p className="mt-2 text-xs text-slate-500">Resolve rate: {resolveRate}%</p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${resolveRate}%` }} />
          </div>
        </div>
        <div className="rounded-2xl border border-amber-300/70 bg-gradient-to-br from-amber-50 to-orange-50 p-4 shadow-sm">
          <p className="text-xs uppercase tracking-[0.12em] text-amber-700">Pending</p>
          <p className="mt-2 text-3xl font-semibold text-amber-900">{pendingCount}</p>
        </div>
        <div className="rounded-2xl border border-emerald-300/70 bg-gradient-to-br from-emerald-50 to-teal-50 p-4 shadow-sm">
          <p className="text-xs uppercase tracking-[0.12em] text-emerald-700">Resolved</p>
          <p className="mt-2 text-3xl font-semibold text-emerald-900">{resolvedCount}</p>
        </div>
      </section>

      <div className="rise-in mb-4 grid gap-3 rounded-2xl border border-slate-200 bg-white/80 p-3 shadow-sm md:grid-cols-[1fr_auto_auto]">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search reviewer, source, review content..."
          className="ui-input rounded-xl px-3 py-2 text-sm outline-none"
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setStatusFilter("all")}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              statusFilter === "all" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
            }`}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("pending")}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              statusFilter === "pending" ? "bg-amber-500 text-white" : "bg-amber-100 text-amber-700"
            }`}
          >
            Pending
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("resolved")}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              statusFilter === "resolved" ? "bg-emerald-600 text-white" : "bg-emerald-100 text-emerald-700"
            }`}
          >
            Resolved
          </button>
        </div>
        <select
          value={sortBy}
          onChange={(event) => setSortBy(event.target.value as "newest" | "oldest")}
          className="ui-input rounded-xl px-3 py-2 text-sm outline-none"
        >
          <option value="newest">Sort: Newest</option>
          <option value="oldest">Sort: Oldest</option>
        </select>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_290px]">
        <section className="glass-card rise-in rounded-3xl p-4 sm:p-5">
          <div className="mb-5 flex items-end justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Work Queue</p>
              <h2 className="text-2xl font-semibold text-slate-900">
                {activeFetchedReviews.length > 0 ? "Fetched Feedback" : "Latest Reviews"}
              </h2>
              {activeFetchPlaceId ? (
                <p className="mt-1 text-xs text-slate-500">Showing latest fetch for {activeFetchPlaceId}</p>
              ) : null}
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
              Live Queue
            </span>
          </div>

          <p className="mb-3 text-xs text-slate-500">
            {filteredReviews.length} review(s) shown - page {currentPage}/{totalPages}
          </p>

          {reviews.length === 0 ? (
            <p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
              No reviews yet. Create a manual review above to start AI generation.
            </p>
          ) : filteredReviews.length === 0 ? (
            <p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
              No results match your current filter/search.
            </p>
          ) : (
            <ul className="space-y-3">
              {paginatedReviews.map((review) => (
                <li
                  key={review.id}
                  className="rounded-2xl border border-slate-200/80 bg-white/95 p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-[0_14px_30px_rgba(16,33,43,0.08)] sm:p-5"
                >
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-900">{review.reviewer_name ?? "Anonymous"}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                    Source: {review.place_id === "manual-demo" ? "Manual Input" : review.place_id}
                  </span>
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                    {formatRatingStars(review.rating)}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold uppercase ${
                      review.status === "resolved"
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {review.status}
                  </span>
                </div>

                <p className="text-sm leading-relaxed text-slate-700">{review.review_text}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {review.review_time ? new Date(review.review_time).toLocaleString() : "No timestamp"}
                </p>

                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => onGenerate(review.id)}
                    disabled={Boolean(loadingByReview[review.id])}
                    className="rounded-xl bg-gradient-to-r from-sky-600 to-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-[0_8px_18px_rgba(37,99,235,0.35)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_24px_rgba(37,99,235,0.38)] disabled:cursor-not-allowed disabled:from-slate-400 disabled:to-slate-400 disabled:shadow-none"
                  >
                    {loadingByReview[review.id] ? "Generating..." : "Generate AI"}
                  </button>
                </div>

                {errorByReview[review.id] ? (
                  <p className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                    {errorByReview[review.id]}
                  </p>
                ) : null}
                {infoByReview[review.id] ? (
                  <p className="mt-3 rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-sky-700">
                    {infoByReview[review.id]}
                  </p>
                ) : null}

                {review.suggestions.length > 0 ? (
                  <div className="mt-4 space-y-2 rounded-2xl border border-indigo-100 bg-indigo-50/80 p-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-indigo-800">AI Suggestions</p>

                    {(() => {
                      const selectedSuggestion = review.suggestions.find((suggestion) => suggestion.is_selected) ?? null;
                      const orderedSuggestions = getOrderedSuggestions(review);
                      const activeSuggestion = getActiveSuggestion(review);
                      if (!activeSuggestion) {
                        return null;
                      }

                      const activeIndex = review.suggestions.findIndex(
                        (suggestion) => suggestion.id === activeSuggestion.id,
                      );

                      return (
                        <div className="space-y-2">
                          {selectedSuggestion ? (
                            <div className="flex flex-wrap gap-2">
                              <span className="rounded-full bg-indigo-600 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-white shadow-[0_8px_16px_rgba(79,70,229,0.35)]">
                                Approved
                              </span>
                            </div>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              {orderedSuggestions.map((suggestion, index) => {
                                const activeId = activeSuggestion.id;
                                const isActive = activeId === suggestion.id;
                                return (
                                  <button
                                    key={suggestion.id}
                                    type="button"
                                    onClick={() =>
                                      setActiveSuggestionByReview((prev) => ({ ...prev, [review.id]: suggestion.id }))
                                    }
                                    className={`rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.1em] transition ${
                                      isActive
                                        ? "bg-indigo-600 text-white shadow-[0_8px_16px_rgba(79,70,229,0.35)]"
                                        : "bg-white text-indigo-700 hover:bg-indigo-100"
                                    }`}
                                  >
                                    {`Option ${index + 1}`}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                          <div className="rounded-xl bg-white p-3 text-sm text-slate-700 shadow-sm">
                            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.1em] text-indigo-700">
                              {selectedSuggestion ? "Approved Reply" : `Option ${activeIndex + 1}`} -{" "}
                              {activeSuggestion.tone ?? "reply"}
                            </p>
                          <p className="leading-relaxed">{activeSuggestion.content}</p>
                          <div className="mt-2">
                            {selectedSuggestion ? (
                              <span className="inline-flex rounded-xl bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white shadow-[0_6px_16px_rgba(16,185,129,0.35)]">
                                Approved
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => onApprove(review.id, activeSuggestion.id)}
                                disabled={Boolean(approvingBySuggestion[activeSuggestion.id])}
                                className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-[0_6px_16px_rgba(16,185,129,0.35)] transition hover:-translate-y-0.5 hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-400 disabled:shadow-none"
                              >
                                {approvingBySuggestion[activeSuggestion.id] ? "Approving..." : "Approve"}
                              </button>
                            )}
                          </div>
                        </div>
                        </div>
                      );
                    })()}
                  </div>
                ) : null}
                </li>
              ))}
            </ul>
          )}

          {filteredReviews.length > PAGE_SIZE ? (
            <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3">
              <p className="text-xs text-slate-600">
                Showing {(currentPage - 1) * PAGE_SIZE + 1}-{Math.min(currentPage * PAGE_SIZE, filteredReviews.length)}{" "}
                of {filteredReviews.length}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                >Previous</button>
                <span className="text-xs font-semibold text-slate-600">
                  {currentPage} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                >Next</button>
              </div>
            </div>
          ) : null}
        </section>

        <aside className="glass-card rise-in h-fit rounded-3xl p-4 xl:sticky xl:top-4">
          <div className="mb-3 space-y-3">
            <div className="flex items-end justify-between gap-2">
              <h3 className="text-lg font-semibold text-slate-900">Review Archive</h3>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.11em] text-slate-600">
                Side Tab
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setSideTab("old")}
                className={`rounded-xl px-3 py-2 text-xs font-semibold transition ${
                  sideTab === "old" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Old Reviews
              </button>
              <button
                type="button"
                onClick={() => setSideTab("latest")}
                className={`rounded-xl px-3 py-2 text-xs font-semibold transition ${
                  sideTab === "latest" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Latest 5
              </button>
            </div>
          </div>

          {sideReviews.length === 0 ? (
            <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
              {sideTab === "old"
                ? "No old reviews outside the current fetched batch."
                : "No reviews found. Enter Place ID above and click Fetch."}
            </p>
          ) : (
            <ul className="soft-scroll max-h-[70vh] space-y-2 overflow-auto pr-1">
              {sideReviews.map((review) => (
                <li key={review.id} className="rounded-xl border border-slate-200/80 bg-white/95 p-3 shadow-sm">
                  <div className="mb-1 flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-semibold text-slate-900">{review.reviewer_name ?? "Anonymous"}</span>
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                      {formatRatingStars(review.rating)}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                        review.status === "resolved"
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {review.status}
                    </span>
                  </div>
                  <p className="line-clamp-2 text-xs leading-relaxed text-slate-700">{review.review_text}</p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {review.review_time ? new Date(review.review_time).toLocaleString() : "No timestamp"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </>
  );
}
