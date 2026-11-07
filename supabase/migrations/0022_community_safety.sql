-- ═════════════════════════════════════════════════════════════════════════════
--  Reporting and blocking for the community feed.
--
--  Farmers can post and reply where other farmers see it, and until now the
--  only control anyone had was deleting their own words. Someone being
--  harassed had no way to report it and no way to stop seeing the person
--  doing it.
--
--  Google Play requires both of an app with user generated content, but the
--  requirement is downstream of the obvious: a feed people cannot moderate is
--  a feed people leave.
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.content_reports (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  reporter_id uuid        NOT NULL REFERENCES public.farmers(id) ON DELETE CASCADE,
  -- Which kind of thing was reported, and which one.
  target_type text        NOT NULL CHECK (target_type IN ('post', 'reply')),
  target_id   uuid        NOT NULL,
  -- The author at the time of reporting, kept so a report survives the post
  -- being deleted and still says who wrote it.
  author_id   uuid        REFERENCES public.farmers(id) ON DELETE SET NULL,
  reason      text        NOT NULL,
  note        text,
  status      text        NOT NULL DEFAULT 'open'
                          CHECK (status IN ('open', 'reviewed', 'actioned', 'dismissed')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_reports_pkey PRIMARY KEY (id),
  -- One report per person per item: reporting twice is not twice as serious,
  -- and letting it through turns the queue into a vote.
  CONSTRAINT content_reports_unique UNIQUE (reporter_id, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS idx_content_reports_open
  ON public.content_reports (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.community_blocks (
  blocker_id uuid        NOT NULL REFERENCES public.farmers(id) ON DELETE CASCADE,
  blocked_id uuid        NOT NULL REFERENCES public.farmers(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT community_blocks_pkey PRIMARY KEY (blocker_id, blocked_id),
  -- Blocking yourself is a mistake, not a feature.
  CONSTRAINT community_blocks_not_self CHECK (blocker_id <> blocked_id)
);

CREATE INDEX IF NOT EXISTS idx_community_blocks_blocker
  ON public.community_blocks (blocker_id);

ALTER TABLE public.content_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_blocks ENABLE ROW LEVEL SECURITY;

-- A farmer may see the reports they filed, and nobody else's.
DROP POLICY IF EXISTS "content_reports_own" ON public.content_reports;
CREATE POLICY "content_reports_own"
  ON public.content_reports FOR SELECT TO authenticated
  USING (reporter_id = auth.uid());

-- A farmer's block list is their own.
DROP POLICY IF EXISTS "community_blocks_own" ON public.community_blocks;
CREATE POLICY "community_blocks_own"
  ON public.community_blocks FOR SELECT TO authenticated
  USING (blocker_id = auth.uid());
