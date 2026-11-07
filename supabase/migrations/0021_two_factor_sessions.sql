-- ═════════════════════════════════════════════════════════════════════════════
--  Which sign-in sessions have actually passed the second factor.
--
--  Two-factor was enforced only by the app: the screen appeared, and the API
--  answered perfectly well to a session that had skipped it. Anyone who got
--  past that screen — a modified client, a direct call with a valid token —
--  had full access, which makes it a prompt rather than protection.
--
--  Keyed by the Supabase session rather than the farmer, so signing in on a
--  new handset asks again. Rows expire; a stale one must never keep a session
--  elevated for ever.
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.two_factor_sessions (
  session_id  text        NOT NULL,
  farmer_id   uuid        NOT NULL REFERENCES public.farmers(id) ON DELETE CASCADE,
  verified_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT two_factor_sessions_pkey PRIMARY KEY (session_id)
);

CREATE INDEX IF NOT EXISTS idx_two_factor_sessions_farmer
  ON public.two_factor_sessions (farmer_id);

-- Written and read only by the service role; a farmer must never be able to
-- mark their own session verified.
ALTER TABLE public.two_factor_sessions ENABLE ROW LEVEL SECURITY;
