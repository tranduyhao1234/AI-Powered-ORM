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
    <main className="dashboard-shell relative mx-auto min-h-screen w-full max-w-7xl px-4 py-6 sm:px-6 md:px-8 md:py-8">
      <div className="pointer-events-none absolute -left-12 top-8 h-40 w-40 rounded-full bg-emerald-300/25 blur-3xl" />
      <div className="pointer-events-none absolute -right-10 top-24 h-44 w-44 rounded-full bg-amber-300/25 blur-3xl" />

      <header className="rise-in mb-5 rounded-3xl border border-white/50 bg-white/70 p-5 shadow-[0_16px_36px_rgba(16,33,43,0.08)] backdrop-blur-xl sm:p-6">
        <div className="mb-3 flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-800">AI Review Copilot</span>
          <span className="rounded-full bg-sky-100 px-3 py-1 text-sky-800">Realtime Dashboard</span>
        </div>
        <h1 className="text-balance text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
          AI-Powered ORM Review Studio
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">
          Fetch or AI-generate reviews, generate reply options, and approve responses from one focused workspace.
        </p>
      </header>

      <div className="rise-in mb-5">
        <PlaceReviewFetcher />
      </div>

      {error ? (
        <p className="glass-card rounded-xl border-red-200 bg-red-50/90 p-4 text-sm font-medium text-red-700">
          Could not load reviews from database: {error.message}
        </p>
      ) : (
        <ReviewDashboardList initialReviews={safeReviews} latestReviews={latestFive} />
      )}
    </main>
  );
}
