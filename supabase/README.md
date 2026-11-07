# Database

These SQL files are the **only** definition of the Agronavis schema. There is no
second ORM schema to keep in sync — the API reads and writes through
`@supabase/supabase-js`, and its TypeScript types are generated from this
database into `packages/shared-types/src/database.types.ts`.

## Applying

```bash
npm run db:link      # one-time, reads SUPABASE_URL from the root .env
npm run db:push      # apply pending migrations to the linked project
npm run db:types     # regenerate database.types.ts from the live schema
```

Or paste a file into the Supabase dashboard SQL editor, in numeric order.
Every migration is idempotent, so re-running one is safe.

## Order

| File | Contents |
|---|---|
| `0001_core_schema.sql` | `farmers` / `farms` / `crops` / `sensor_readings` / `advisories`, the `auth.users` → `farmers` signup trigger, base RLS |
| `0002_avatars_bucket.sql` | `avatars` storage bucket + policies |
| `0003_extended_schema.sql` | `farm_fields`, `farm_tasks`, `crop_scans`, `soil_health_history`, `yield_history`, `crop_varieties`, `crop_diseases`, `regional_soil_data`, `farm_resources`, `community_posts`, `community_replies` |
| `0004_regional_soil_seed.sql` | District-level NPK reference data |
| `0005_community_media.sql` | `community-media` bucket + `community_posts.media_type` |
| `0006_platform_alignment.sql` | Agronomy profile and TOTP 2FA columns, farm coordinates promoted out of the `location` blob, 4-level advisory severity + de-duplication, market-price trend columns, `weather_snapshots`, the `crop-scans` bucket, RLS for the new tables |
| `0007_account_deletion_cascade.sql` | `farmers.id` → `auth.users.id` cascade, so deleting an account succeeds |

## Adding a migration

```bash
supabase db diff -f describe_your_change   # writes the next numbered file
```

Never edit an already-applied migration — add a new one.

## A note on this project's history

The live database predates these files: its schema was built by a set of
migrations recorded under timestamp versions (`20251007142940` and later) whose
SQL is not in this repository. Files `0001`–`0005` describe that same schema, so
they were marked applied rather than replayed:

```bash
supabase migration repair --status applied  0001 0002 0003 0004 0005
supabase migration repair --status reverted 20251007142940 …   # the orphaned entries
```

That edits only `supabase_migrations.schema_migrations`, never the schema
itself. `0006` was then written against the *deployed* column list — not against
an idealised one — which is why it renames rather than recreates
(`market_prices.price_date` → `arrival_date`, `notifications.is_read` → `read`)
and backfills `farms.latitude` / `longitude` out of the old `location` jsonb.

From `0006` onward, local and remote histories agree.
