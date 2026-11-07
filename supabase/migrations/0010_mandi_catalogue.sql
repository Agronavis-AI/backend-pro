-- ═════════════════════════════════════════════════════════════════════════════
--  0010 — Mandi catalogue
--
--  Price lookups used to match on free text, which is why market.service.ts
--  carries a table of commodity synonyms and state aliases: Agmarknet publishes
--  "Paddy(Dhan)(Common)", "Orissa" and "Uttrakhand", so every query had to guess
--  which spelling would hit.
--
--  Agmarknet exposes its own catalogue unauthenticated, with numeric ids. Storing
--  it here gives every lookup a canonical id to key on, and gives the filter UI
--  real mandi names per district instead of the bundled state/district list,
--  which had no mandis in it at all.
--
--  Reference data: 36 states, 750 districts, 4172 mandis, 605 commodities. It
--  changes when a mandi is notified or a commodity added — a weekly refresh is
--  ample, so this is not on the daily price path.
--
--  Idempotent: safe to re-run.
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.mandi_states (
  id         integer     NOT NULL,
  name       text        NOT NULL,
  synced_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mandi_states_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.mandi_districts (
  id         integer     NOT NULL,
  state_id   integer     NOT NULL REFERENCES public.mandi_states (id) ON DELETE CASCADE,
  name       text        NOT NULL,
  synced_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mandi_districts_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.mandi_markets (
  id           integer     NOT NULL,
  state_id     integer     NOT NULL REFERENCES public.mandi_states (id)    ON DELETE CASCADE,
  district_id  integer              REFERENCES public.mandi_districts (id) ON DELETE SET NULL,
  name         text        NOT NULL,
  synced_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mandi_markets_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.mandi_commodities (
  id            integer     NOT NULL,
  name          text        NOT NULL,
  group_id      integer,
  group_name    text,
  arrival_unit  text,
  price_unit    text,
  synced_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mandi_commodities_pkey PRIMARY KEY (id)
);

-- Name lookups drive the filter UI; ids drive the price queries.
CREATE INDEX IF NOT EXISTS idx_mandi_districts_state   ON public.mandi_districts (state_id, name);
CREATE INDEX IF NOT EXISTS idx_mandi_markets_district  ON public.mandi_markets (district_id, name);
CREATE INDEX IF NOT EXISTS idx_mandi_markets_state     ON public.mandi_markets (state_id, name);
CREATE INDEX IF NOT EXISTS idx_mandi_commodities_name  ON public.mandi_commodities (lower(name));

-- ─────────────────────────────────────────────────────────────────────────────
--  Ingestion audit
--
--  One row per job run. Answers "did the catalogue refresh last night, and if
--  not, why" without reading container logs that Render's free tier discards.
--  Price ingestion writes here too, keyed by a different `source`.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ingestion_runs (
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  source        text        NOT NULL,
  status        text        NOT NULL DEFAULT 'running',
  rows_written  integer     NOT NULL DEFAULT 0,
  detail        jsonb,
  error         text,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  CONSTRAINT ingestion_runs_pkey PRIMARY KEY (id),
  CONSTRAINT ingestion_runs_status_check CHECK (status = ANY (ARRAY['running', 'ok', 'failed']))
);

CREATE INDEX IF NOT EXISTS idx_ingestion_runs_recent
  ON public.ingestion_runs (source, started_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
--  RLS — catalogue is public reference data; only the service role writes it.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.mandi_states      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mandi_districts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mandi_markets     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mandi_commodities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingestion_runs    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mandi_states_read_all"      ON public.mandi_states;
DROP POLICY IF EXISTS "mandi_districts_read_all"   ON public.mandi_districts;
DROP POLICY IF EXISTS "mandi_markets_read_all"     ON public.mandi_markets;
DROP POLICY IF EXISTS "mandi_commodities_read_all" ON public.mandi_commodities;

CREATE POLICY "mandi_states_read_all"      ON public.mandi_states      FOR SELECT TO authenticated USING (true);
CREATE POLICY "mandi_districts_read_all"   ON public.mandi_districts   FOR SELECT TO authenticated USING (true);
CREATE POLICY "mandi_markets_read_all"     ON public.mandi_markets     FOR SELECT TO authenticated USING (true);
CREATE POLICY "mandi_commodities_read_all" ON public.mandi_commodities FOR SELECT TO authenticated USING (true);

-- ingestion_runs stays service-role only: no policy, RLS on.
