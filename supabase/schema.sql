-- Day 1 baseline schema for AI-Powered ORM MVP.
-- Run this in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  place_id text not null,
  review_external_id text not null,
  reviewer_name text,
  rating integer check (rating between 1 and 5),
  review_text text not null,
  review_time timestamptz,
  status text not null default 'pending' check (status in ('pending', 'resolved')),
  selected_suggestion_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (place_id, review_external_id)
);

create table if not exists public.ai_suggestions (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews(id) on delete cascade,
  tone text,
  content text not null,
  is_selected boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_reviews_place_id on public.reviews(place_id);
create index if not exists idx_reviews_status on public.reviews(status);
create index if not exists idx_reviews_review_time_created_at on public.reviews(review_time desc, created_at desc);
create index if not exists idx_reviews_place_id_review_time_created_at
  on public.reviews(place_id, review_time desc, created_at desc);
create index if not exists idx_ai_suggestions_review_id on public.ai_suggestions(review_id);
create index if not exists idx_ai_suggestions_review_id_created_at
  on public.ai_suggestions(review_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_reviews_set_updated_at on public.reviews;
create trigger trg_reviews_set_updated_at
before update on public.reviews
for each row execute function public.set_updated_at();
