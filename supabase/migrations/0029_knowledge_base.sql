-- ═════════════════════════════════════════════════════════════════════════════
--  The knowledge Sahayak answers from when the phone is online.
--
--  A model left to itself answers a farmer's question from whatever it read on
--  the internet, which for a Bengal boro farmer is mostly advice written for
--  someone else. These rows are notes that were written for them: Kisan Call
--  Centre answers by state and crop, state crop guides, and our own disease
--  library. ml/knowledge/build_knowledge_base.ipynb fills the table; the API
--  reads it through match_knowledge() below and nowhere else.
--
--  Search is by meaning and by words at once:
--    · meaning — a bge-m3 vector per note. bge-m3 is multilingual, so a
--      question in Bengali or Hindi finds a note written in English.
--    · words   — Postgres full-text search, for the names a vector blurs:
--      "Tricyclazole", "Swarna", "IR-64".
--  The two rankings are merged with reciprocal rank fusion, which needs no
--  tuning and does not let either one drown the other.
-- ═════════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.knowledge_chunks (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- 'kcc', 'pop' (package of practices), 'disease_library', …
  source      text        NOT NULL,
  -- Stable id within the source, so re-running the builder updates rather
  -- than duplicates.
  source_ref  text        NOT NULL,
  title       text,
  url         text,
  -- Lower case, e.g. 'west bengal'. NULL means it applies everywhere.
  state       text,
  crop        text,
  language    text        NOT NULL DEFAULT 'en',
  content     text        NOT NULL,
  -- bge-m3, 1024 dimensions. Half precision: half the storage, and the
  -- ranking is indistinguishable at this size.
  embedding   extensions.halfvec(1024),
  fts         tsvector    GENERATED ALWAYS AS (
                to_tsvector('english', coalesce(title, '') || ' ' || content)
              ) STORED,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_chunks_source_ref UNIQUE (source, source_ref)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_embedding
  ON public.knowledge_chunks USING hnsw (embedding extensions.halfvec_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_knowledge_fts
  ON public.knowledge_chunks USING gin (fts);
CREATE INDEX IF NOT EXISTS idx_knowledge_state
  ON public.knowledge_chunks (state);

-- Read only by the API, which uses the service role. No policies: nobody
-- else reads it directly.
ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- match_knowledge: the notes for one question.
--
-- filter_state keeps a West Bengal farmer on West Bengal answers (plus the
-- ones that apply everywhere); the API widens to the whole country itself
-- when that finds too little. query_embedding may be NULL, in which case
-- this is a word search alone.
--
-- hnsw.iterative_scan lets the vector index keep looking when the state filter
-- throws most of its first candidates away; without it a filtered search can
-- come back nearly empty.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.match_knowledge(
  query_text      text,
  query_embedding extensions.halfvec(1024) DEFAULT NULL,
  filter_state    text DEFAULT NULL,
  match_count     int  DEFAULT 5
)
RETURNS TABLE (
  id      bigint,
  source  text,
  title   text,
  url     text,
  state   text,
  crop    text,
  content text,
  score   double precision
)
LANGUAGE sql
STABLE
SET search_path = public, extensions
SET hnsw.iterative_scan = 'relaxed_order'
AS $$
  WITH semantic AS (
    SELECT k.id,
           row_number() OVER (ORDER BY k.embedding <=> query_embedding) AS rank
    FROM public.knowledge_chunks k
    WHERE query_embedding IS NOT NULL
      AND k.embedding IS NOT NULL
      AND (filter_state IS NULL OR k.state IS NULL OR k.state = filter_state)
    ORDER BY k.embedding <=> query_embedding
    LIMIT match_count * 4
  ),
  keyword AS (
    SELECT k.id,
           row_number() OVER (
             ORDER BY ts_rank_cd(k.fts, websearch_to_tsquery('english', query_text)) DESC
           ) AS rank
    FROM public.knowledge_chunks k
    WHERE k.fts @@ websearch_to_tsquery('english', query_text)
      AND (filter_state IS NULL OR k.state IS NULL OR k.state = filter_state)
    ORDER BY ts_rank_cd(k.fts, websearch_to_tsquery('english', query_text)) DESC
    LIMIT match_count * 4
  ),
  fused AS (
    SELECT coalesce(s.id, w.id) AS id,
           coalesce(1.0 / (60 + s.rank), 0.0) + coalesce(1.0 / (60 + w.rank), 0.0) AS score
    FROM semantic s
    FULL OUTER JOIN keyword w ON w.id = s.id
  )
  SELECT k.id, k.source, k.title, k.url, k.state, k.crop, k.content, f.score::double precision
  FROM fused f
  JOIN public.knowledge_chunks k ON k.id = f.id
  ORDER BY f.score DESC
  LIMIT match_count;
$$;

-- The API calls this with the service role; nobody else needs it.
REVOKE ALL ON FUNCTION public.match_knowledge(text, extensions.halfvec, text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_knowledge(text, extensions.halfvec, text, int) TO service_role;
