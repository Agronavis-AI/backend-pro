# Agronavis API

One service, two callers:

| Caller | Paths |
| --- | --- |
| **The app** (Play Store) | `/api/v1/farmers`, `/farms`, `/soil`, `/weather`, `/fires`, `/satellite`, `/market`, `/community`, `/notifications`, `/sahayak`, … |
| **The website** (agronavis.in) | `/api/contact`, `/demo`, `/newsletter`, `/careers`, `/account-deletion`, `/openings` |

Website routes are also mounted at `/api/v1/web/*`. The bare `/api/*` paths are
what the site calls today and keep working.

## Run it

```bash
cp .env.example .env     # fill in Supabase at minimum
npm install
npm run dev              # :3001
npm run verify           # typecheck + lint + 280 tests
```

## Two things to know

**App routes require auth.** Every router mounts `requireAuth` and
`requireTwoFactor`. The website router deliberately does not — nobody signs in
to send a contact form — so those are the only unauthenticated writes here,
rate limited to 5 per 10 minutes per address with the CV upload capped at
12 MB before it reaches memory.

**Website mail is optional.** Without `RESEND_API_KEY`, `CONTACT_TO` and
`CONTACT_FROM`, the form routes answer 503 with an address to write to. The
farm API boots and serves normally — a phone in a field must not depend on a
careers form having a mail provider.

## Sahayak and the scanner

`/api/v1/sahayak/chat` answers farmers' questions with free open-weight models
(Groq `gpt-oss`, then Cloudflare Workers AI Gemma), grounded in Kisan Call
Centre answers and state crop guides searched in Supabase (`knowledge_chunks`,
pgvector + full-text). Without `GROQ_API_KEY` or the `CLOUDFLARE_*` keys,
`/sahayak/status` reports offline and phones use their own model.

`/api/v1/crops/diagnose` takes an optional `crop` and ranks only that crop's
diseases. It loads `model/v2/` (field-trained, from `ml/disease/`) when present
and falls back to the v1 model.

Setup, datasets and the release checklist: [docs/AI_SETUP.md](docs/AI_SETUP.md).

## Types

`src/types/` is the shared contract, reached through a tsconfig path. Import
types from it, never values: it is TypeScript source the compiler resolves and
Node does not, so a runtime import builds fine and fails to boot. A test
enforces this.

## Database

29 migrations in `supabase/migrations`: `0001`–`0022` for the app,
`0023`–`0028` for the website and `0029` for Sahayak's knowledge base. Apply
with `npm run db:push`.

`applications` and `deletion_requests` have RLS on with no policies — reachable
by the service role only. `openings` is public read where `is_active`.
