import { PlaceReviewFetcher } from "@/app/components/place-review-fetcher";
import { ReviewDashboardList } from "@/app/components/review-dashboard-list";
import { createClient } from "@/utils/supabase/server";

type SuggestionRow = {
  id: string;
  review_id: string;
  tone: string | null;
  content: string;
  is_selected: boolean;
  created_at: string;
};

type ReviewRow = {
  id: string;
  place_id: string;
  reviewer_name: string | null;
  rating: number | null;
  review_text: string;
  review_time: string | null;
  status: "pending" | "resolved";
  suggestions: SuggestionRow[];
};

export default async function Page() {
  const supabase = await createClient();
  const { data: reviews, error } = await supabase
    .from("reviews")
    .select(
      "id, place_id, reviewer_name, rating, review_text, review_time, status, ai_suggestions(id, review_id, tone, content, is_selected, created_at)",
    )
    .order("review_time", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(30);

  const safeReviews = ((reviews ?? []) as Array<
    Omit<ReviewRow, "suggestions"> & { ai_suggestions?: SuggestionRow[] | null }
  >).map((review) => ({
    ...review,
    suggestions: (review.ai_suggestions ?? []).sort((a, b) => {
      const aTime = new Date(a.created_at).getTime();
      const bTime = new Date(b.created_at).getTime();
      return aTime - bTime;
    }),
  }));

  const latestFive = safeReviews.slice(0, 5);

  return (
    <main className="dashboard-shell relative mx-auto min-h-screen w-full max-w-6xl px-4 py-8 sm:px-6 md:px-8 md:py-10">
      <div className="pointer-events-none absolute -left-12 top-8 h-40 w-40 rounded-full bg-emerald-300/25 blur-3xl" />
      <div className="pointer-events-none absolute -right-10 top-24 h-44 w-44 rounded-full bg-amber-300/25 blur-3xl" />

      <header className="rise-in mb-7 rounded-2xl border border-white/40 bg-white/65 p-6 shadow-[0_16px_36px_rgba(16,33,43,0.08)] backdrop-blur-xl">
        <div className="mb-4 flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-800">AI Review Copilot</span>
          <span className="rounded-full bg-sky-100 px-3 py-1 text-sky-800">Realtime Dashboard</span>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-800">DP-01 Data Pipeline</span>
          <span className="rounded-full bg-indigo-100 px-3 py-1 text-indigo-800">AI-01 / UI-01 / UI-02</span>
        </div>
        <h1 className="text-balance text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
          AI-Powered ORM Review Studio
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600 sm:text-base">
          Enter a Google Place ID, fetch reviews, store them in database, and display the latest 5 records.
        </p>
      </header>

      <div className="rise-in mb-6">
        <PlaceReviewFetcher />
      </div>

      {error ? (
        <p className="glass-card rounded-xl border-red-200 bg-red-50/90 p-4 text-sm font-medium text-red-700">
          Could not load reviews from database: {error.message}
        </p>
      ) : (
        <>
          <section className="glass-card rise-in mb-6 rounded-2xl p-6 sm:p-7">
            <div className="mb-4 flex items-end justify-between gap-3">
              <h2 className="text-2xl font-semibold text-slate-900">Latest 5 Reviews</h2>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
                Database View
              </span>
            </div>

            {latestFive.length === 0 ? (
              <p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                No reviews found. Enter Place ID above and click Fetch.
              </p>
            ) : (
              <ul className="space-y-3">
                {latestFive.map((review) => (
                  <li
                    key={review.id}
                    className="rounded-2xl border border-slate-200/80 bg-white/90 p-4 shadow-[0_8px_20px_rgba(16,33,43,0.06)]"
                  >
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-900">{review.reviewer_name ?? "Anonymous"}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                        Place: {review.place_id}
                      </span>
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                        {review.rating ? `Rating ${review.rating}` : "No rating"}
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
                  </li>
                ))}
              </ul>
            )}
          </section>

          <ReviewDashboardList initialReviews={safeReviews} />
        </>
      )}
    </main>
  );
}
