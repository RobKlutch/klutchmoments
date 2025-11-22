-- Run this script in the Supabase SQL editor or psql for your project.
-- It creates the highlight_jobs table used by the Klutch highlight pipeline.

create extension if not exists "pgcrypto";

-- Simple status guard instead of a custom enum for portability
create table if not exists public.highlight_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id text,
  video_url text,
  video_reference text,
  player_id text,
  model_name text,
  spotlight_type text,
  spotlight_settings jsonb,
  bounding_boxes jsonb,
  status text not null default 'queued' check (status in ('queued', 'processing', 'done', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.trigger_set_timestamp()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_timestamp on public.highlight_jobs;
create trigger set_timestamp
before update on public.highlight_jobs
for each row execute procedure public.trigger_set_timestamp();
