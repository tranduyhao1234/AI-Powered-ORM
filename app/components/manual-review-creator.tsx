"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type CreateResponse = {
  review?: {
    id: string;
  };
  error?: string;
};

export function ManualReviewCreator() {
  const router = useRouter();
  const [reviewerName, setReviewerName] = useState("");
  const [rating, setRating] = useState("");
  const [reviewText, setReviewText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const canSubmit = useMemo(() => reviewText.trim().length > 0 && !loading, [reviewText, loading]);
  const textLength = reviewText.trim().length;

  function applyTemplate(template: string) {
    setReviewText(template);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/reviews/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reviewerName,
          rating,
          reviewText,
        }),
      });

      const payload = (await response.json()) as CreateResponse;
      if (!response.ok) {
        throw new Error(payload.error || "Failed to create review.");
      }

      setReviewerName("");
      setRating("");
      setReviewText("");
      setSuccess("Review created. You can now click Generate AI on it.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="glass-card space-y-5 rounded-2xl p-6 sm:p-7">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold text-slate-900">Create Review (Manual Mode)</h2>
        <p className="text-sm text-slate-600">
          DP-01 is skipped. Add review content directly to test Generate AI and Approve flows.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          "Quán đông nhưng nhân viên hỗ trợ ổn, món lên hơi chậm.",
          "Đồ ăn ngon, giá hợp lý, sẽ quay lại lần sau.",
          "Phục vụ chưa nhiệt tình, mong quán cải thiện.",
        ].map((template, index) => (
          <button
            key={template}
            type="button"
            onClick={() => applyTemplate(template)}
            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 transition hover:border-emerald-300 hover:text-emerald-700"
          >
            Template {index + 1}
          </button>
        ))}
      </div>

      <form className="space-y-3" onSubmit={onSubmit}>
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            value={reviewerName}
            onChange={(event) => setReviewerName(event.target.value)}
            placeholder="Reviewer name (optional)"
            className="ui-input rounded-xl px-4 py-3 text-sm outline-none"
          />
          <select
            value={rating}
            onChange={(event) => setRating(event.target.value)}
            className="ui-input rounded-xl px-4 py-3 text-sm outline-none"
          >
            <option value="">Rating (optional)</option>
            <option value="5">5 - Excellent</option>
            <option value="4">4 - Good</option>
            <option value="3">3 - Neutral</option>
            <option value="2">2 - Poor</option>
            <option value="1">1 - Bad</option>
          </select>
        </div>

        <textarea
          value={reviewText}
          onChange={(event) => setReviewText(event.target.value)}
          placeholder="Paste a customer review here..."
          rows={4}
          className="ui-input w-full rounded-xl px-4 py-3 text-sm outline-none"
        />
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-500">Best quality: 30-280 chars</span>
          <span className={`${textLength > 280 ? "text-amber-700" : "text-slate-500"}`}>{textLength}/3000</span>
        </div>

        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-5 py-3 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(19,111,99,0.35)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_26px_rgba(19,111,99,0.4)] disabled:cursor-not-allowed disabled:from-slate-400 disabled:to-slate-400 disabled:shadow-none"
        >
          {loading ? "Creating..." : "Create Review"}
        </button>
      </form>

      {error ? <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {success ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{success}</p>
      ) : null}
    </section>
  );
}
