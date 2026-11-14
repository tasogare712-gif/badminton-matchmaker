create table if not exists public.players (
  id uuid primary key,
  name text not null check (char_length(trim(name)) between 1 and 20),
  created_at timestamptz not null default now()
);

alter table public.players enable row level security;

drop policy if exists "Anyone can view shared players" on public.players;
drop policy if exists "Anyone can add shared players" on public.players;
drop policy if exists "Anyone can remove shared players" on public.players;

create policy "Anyone can view shared players" on public.players
  for select to anon, authenticated using (true);
create policy "Anyone can add shared players" on public.players
  for insert to anon, authenticated with check (true);
create policy "Anyone can remove shared players" on public.players
  for delete to anon, authenticated using (true);

