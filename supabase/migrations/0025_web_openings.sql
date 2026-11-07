-- Open roles.
--
-- These live in the database rather than the website's code, so opening or
-- closing one is a row edit instead of a deploy.

create table if not exists public.openings (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),

  title       text not null,
  team        text,
  location    text    not null default 'Remote',
  commitment  text    not null default 'Internship',
  duration    text    not null default '1 to 2 months',

  stipend_min integer,
  stipend_max integer,

  summary     text,
  is_active   boolean not null default true,
  sort_order  integer not null default 100
);

-- Present separately because an earlier hand-run version of this table
-- predates the column.
alter table public.openings add column if not exists duration text not null default '1 to 2 months';

do $$
begin
  alter table public.openings
    add constraint openings_stipend_order
    check (stipend_min is null or stipend_max is null or stipend_min <= stipend_max);
exception
  when duplicate_object then null;
end $$;

create unique index if not exists openings_title_key  on public.openings (title);
create index        if not exists openings_active_idx on public.openings (is_active, sort_order);

-- The list of open roles is public, so anon may read active rows. Writes stay
-- with the secret key.
alter table public.openings enable row level security;

drop policy if exists "active openings are public" on public.openings;
create policy "active openings are public"
  on public.openings for select
  to anon, authenticated
  using (is_active = true);
