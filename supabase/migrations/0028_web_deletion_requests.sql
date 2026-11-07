-- Account deletion requests submitted from the website.
--
-- Google Play requires a publicly reachable deletion route that works without
-- the app installed, so someone who has already uninstalled still has a way
-- through. Requests are recorded here so each one can be shown to have been
-- actioned inside the promised window.

create table if not exists public.deletion_requests (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),

  email        text not null,
  name         text,
  scope        text not null default 'account',
  reason       text,

  status       text not null default 'received',
  actioned_at  timestamptz,
  note         text,

  source       text not null default 'website'
);

do $$
begin
  alter table public.deletion_requests
    add constraint deletion_requests_status_check
    check (status in ('received', 'verifying', 'completed', 'rejected'));
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.deletion_requests
    add constraint deletion_requests_scope_check
    check (scope in ('account', 'data'));
exception
  when duplicate_object then null;
end $$;

create index if not exists deletion_requests_created_at_idx on public.deletion_requests (created_at desc);
create index if not exists deletion_requests_status_idx     on public.deletion_requests (status);

-- Same posture as applications: no anon access at all, so a request can only
-- arrive through the API where it is validated and rate limited.
alter table public.deletion_requests enable row level security;
revoke all on public.deletion_requests from anon, authenticated;
