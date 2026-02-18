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
