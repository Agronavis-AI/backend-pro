-- ═════════════════════════════════════════════════════════════════════════════
--  Notifications: record what was sent, how urgent it was, and whether it
--  actually arrived.
--
--  The table held a title, a body and a read flag. Everything else about a
--  delivery was lost the moment it happened: nothing recorded whether the push
--  reached the handset, nothing said why it failed, and nothing carried the
--  severity the alert was raised at — so the list could not rank a "do not
--  spray tomorrow" above a "check your soil moisture".
--
--  `read` becomes generated from `read_at`. The timestamp is the fact; the
--  boolean is kept because the API and the app already read it, and deriving
--  it means the two can never disagree.
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS severity text NOT NULL DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS read_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_error text;

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_severity_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_severity_check
  CHECK (severity IN ('low', 'medium', 'high', 'critical'));

-- pending  — stored, not yet attempted
-- sent     — Expo accepted it for delivery
-- failed   — Expo refused it or the request errored; delivery_error says why
-- skipped  — deliberately in-app only, or the farmer has no device registered
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_delivery_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_delivery_check
  CHECK (delivery IN ('pending', 'sent', 'failed', 'skipped'));

-- Carry the existing read flags across before the column becomes derived.
-- created_at is the best available stand-in for when it was read; the only
-- alternative is discarding the fact that it was.
UPDATE public.notifications SET read_at = created_at WHERE read IS TRUE AND read_at IS NULL;

ALTER TABLE public.notifications DROP COLUMN IF EXISTS read;
ALTER TABLE public.notifications
  ADD COLUMN read boolean GENERATED ALWAYS AS (read_at IS NOT NULL) STORED;

-- The list is always "this farmer's, newest first", and the badge is a count
-- of the unread. A partial index keeps the second cheap as history grows.
DROP INDEX IF EXISTS idx_notifications_farmer_unread;
CREATE INDEX IF NOT EXISTS idx_notifications_farmer_recent
  ON public.notifications (farmer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_farmer_unread
  ON public.notifications (farmer_id, created_at DESC)
  WHERE read_at IS NULL;
