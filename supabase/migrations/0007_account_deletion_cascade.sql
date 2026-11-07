-- ═════════════════════════════════════════════════════════════════════════════
--  0007 — Account deletion cascade
--
--  Deleting a user through Supabase Auth returned 500: the deployed
--  `farmers.id` foreign key was created without ON DELETE CASCADE, so the
--  farmer row held a reference to the auth user forever and the delete was
--  rejected. Account deletion — and GDPR-style erasure requests — could not
--  complete. Migration 0001 always declared the cascade; the live database was
--  built from an earlier lineage that did not.
--
--  Idempotent: safe to re-run.
-- ═════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  fk_name text;
BEGIN
  SELECT con.conname INTO fk_name
    FROM pg_constraint con
    JOIN pg_class rel  ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
   WHERE ns.nspname = 'public'
     AND rel.relname = 'farmers'
     AND con.contype = 'f'
     AND con.confdeltype <> 'c'
     AND con.conkey = ARRAY[
       (SELECT attnum FROM pg_attribute
         WHERE attrelid = 'public.farmers'::regclass AND attname = 'id')
     ];

  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.farmers DROP CONSTRAINT %I', fk_name);
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE public.farmers
    ADD CONSTRAINT farmers_id_fkey
    FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
