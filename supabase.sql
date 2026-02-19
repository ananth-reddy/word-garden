-- Run this once in Supabase SQL editor
create table if not exists public.words (
  id bigserial primary key,
  word text not null unique,
  level int not null default 1,
  definition text,
  swedish text,
  sentence text,
  source text not null default 'ai',
  created_at timestamptz not null default now()
);

create index if not exists idx_words_level_created on public.words(level, created_at desc);

alter table public.words enable row level security;


-- Progress sync table (device-to-device)
create table if not exists public.progress_sync (
  sync_code text primary key,
  progress jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_progress_sync_updated_at on public.progress_sync(updated_at desc);

-- Keep RLS on (service role bypasses it). You can add policies later if you ever expose anon key.
alter table public.progress_sync enable row level security;


-- Child profiles (one code per child)
create table if not exists public.profiles (
  profile_code text primary key,
  child_name text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_profiles_created_at on public.profiles(created_at desc);

alter table public.profiles enable row level security;
