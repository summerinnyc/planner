-- Summer 플래너: Supabase 설정 (SQL Editor에 붙여넣고 Run)

create table if not exists public.items (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  id text not null,
  data jsonb not null,
  updated_at bigint not null default 0,
  server_ts timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.settings (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  data jsonb not null,
  updated_at bigint not null default 0,
  server_ts timestamptz not null default now()
);

create index if not exists items_user_server_ts on public.items (user_id, server_ts);

create or replace function public.touch_server_ts() returns trigger
language plpgsql as $$ begin new.server_ts := clock_timestamp(); return new; end $$;

drop trigger if exists items_touch on public.items;
create trigger items_touch before insert or update on public.items
  for each row execute function public.touch_server_ts();
drop trigger if exists settings_touch on public.settings;
create trigger settings_touch before insert or update on public.settings
  for each row execute function public.touch_server_ts();

alter table public.items enable row level security;
alter table public.settings enable row level security;

drop policy if exists "own items" on public.items;
create policy "own items" on public.items for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own settings" on public.settings;
create policy "own settings" on public.settings for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- live updates between devices
do $$ begin
  alter publication supabase_realtime add table public.items;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.settings;
exception when duplicate_object then null; end $$;

-- cover photos (private; each person only sees their own folder)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('covers', 'covers', false, 20971520, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do nothing;

drop policy if exists "covers read own" on storage.objects;
create policy "covers read own" on storage.objects for select to authenticated
  using (bucket_id = 'covers' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "covers add own" on storage.objects;
create policy "covers add own" on storage.objects for insert to authenticated
  with check (bucket_id = 'covers' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "covers delete own" on storage.objects;
create policy "covers delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'covers' and (storage.foldername(name))[1] = auth.uid()::text);
