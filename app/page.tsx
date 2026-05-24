import { PlaceReviewFetcher } from "@/app/components/place-review-fetcher";
import { ReviewDashboardList } from "@/app/components/review-dashboard-list";
import { createClient } from "@/utils/supabase/server";

export const dynamic = "force-dynamic";

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

const navItems = [
  { label: "Dashboard", icon: "M3 13h8V3H3v10Zm0 8h8v-6H3v6Zm10 0h8V11h-8v10Zm0-18v6h8V3h-8Z", active: true },
  
];

function OutlineIcon({ path }: { path: string }) {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24">
      <path d={path} />
    </svg>
  );
}

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
    <main className="dashboard-shell min-h-screen bg-slate-50 text-slate-950 lg:grid lg:grid-cols-[264px_minmax(0,1fr)]">
      <aside className="border-b border-slate-200 bg-white/95 px-4 py-4 backdrop-blur lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r lg:px-5">
        <div className="flex items-center justify-between lg:block">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-indigo-600 text-sm font-bold text-white shadow-lg shadow-indigo-600/20">
              AI
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-950">ReviewAI</p>
              <p className="text-xs text-slate-500">AI ORM Console</p>
            </div>
          </div>
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 lg:hidden">
            Online
          </span>
        </div>

        <nav className="mt-4 flex gap-2 overflow-auto lg:mt-8 lg:block lg:space-y-1 lg:overflow-visible">
          {navItems.map((item) => (
            <button
              key={item.label}
              type="button"
              className={`flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition lg:w-full ${
                item.active
                  ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
              }`}
            >
              <OutlineIcon path={item.icon} />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="mt-8 hidden rounded-2xl border border-slate-200 bg-slate-50 p-4 lg:block">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Workflow</p>
          <p className="mt-2 text-sm font-medium text-slate-900">Fetch reviews, review AI replies, approve in one pass.</p>
        </div>
      </aside>

      <section className="min-w-0">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/85 px-4 py-3 backdrop-blur-xl sm:px-6 lg:px-8">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-600">Dashboard</p>
              <h1 className="text-xl font-semibold tracking-tight text-slate-950 sm:text-2xl">Review Management</h1>
            </div>
            <div className="flex items-center gap-3">
              <span className="hidden rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 sm:inline-flex">
                AI online
              </span>
              <div className="grid h-9 w-9 place-items-center rounded-full bg-slate-900 text-xs font-semibold text-white">TM</div>
            </div>
          </div>
        </header>
        <div className="mx-auto max-w-7xl space-y-5 px-4 py-5 sm:px-6 lg:px-8">
          <PlaceReviewFetcher />
          {error ? (
            <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">
              Could not load reviews from database: {error.message}
            </p>
          ) : (
            <ReviewDashboardList initialReviews={safeReviews} latestReviews={latestFive} />
          )}
        </div>
      </section>
    </main>
  );
}
