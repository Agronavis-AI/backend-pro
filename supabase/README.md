# Database

The 28 files in `migrations/` are the only definition of the schema. One
Supabase project serves both callers: `0001`–`0022` are the app's tables,
`0023`–`0028` the website's.

## Applying

```bash
npm run db:link     # once per machine; reads the ref out of SUPABASE_URL
npm run db:push     # applies anything the remote has not seen
npm run db:list     # what is applied where
```

`db:push` compares filenames against the remote history, so **never rename an
applied migration** — it would be pushed a second time. Add a new one instead.

## A new migration

```bash
npm run db:new add_something     # writes the next file
npm run db:push
npm run db:types                 # regenerate src/types/database.generated.ts
```

Write them idempotent — `if not exists`, `drop policy if exists` — so
re-running one is safe.

## Testing against a real Postgres

Needs Docker.

```bash
npm run db:start    # local stack on :54321, applies every migration, then seeds
npm run db:reset    # wipe and replay from 0001 — the real test of ordering
npm run db:stop
```

`db:reset` is what catches a migration that only works because of the state
already in your remote.

## RLS

| Table | Who can read it |
| --- | --- |
| `applications`, `deletion_requests` | RLS on, no policies — service role only |
| `openings` | anyone, where `is_active` |
| app tables | per-farmer policies, see `0001` and `0006` |

The API holds the service-role key and bypasses all of it, which is why no
route outside `modules/web` may be mounted without `requireAuth`.
