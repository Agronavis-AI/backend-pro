-- Careers applications.
--
-- Every statement is guarded, so this applies cleanly whether the project is
-- empty or already carries an earlier hand-run version of this schema.

create table if not exists public.applications (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),

  name          text not null,
  email         text not null,
  phone         text,

  role          text not null,
  portfolio_url text,
  github_url    text,
  linkedin_url  text,
  message       text not null,

  resume_path   text,
  resume_name   text,
  resume_size   integer,

  status        text not null default 'new',
  source        text not null default 'website'
);

do $$
begin
  alter table public.applications
    add constraint applications_status_check
    check (status in ('new', 'reviewing', 'interviewing', 'offered', 'rejected', 'withdrawn'));
exception
  when duplicate_object then null;
end $$;

create index if not exists applications_created_at_idx on public.applications (created_at desc);
create index if not exists applications_status_idx     on public.applications (status);
create index if not exists applications_email_idx      on public.applications (email);

-- RLS on with no policies: anon and authenticated reach nothing. Only the
-- secret key touches this table, so every write passes through the API where
-- validation and rate limiting live.
alter table public.applications enable row level security;
revoke all on public.applications from anon, authenticated;
