-- v4: community-media storage bucket for post photos & videos
-- Run this in Supabase SQL Editor

-- 1. Create bucket (public so URLs work without signed tokens)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'community-media',
  'community-media',
  true,
  52428800,  -- 50 MB limit per file
  ARRAY[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'video/mp4', 'video/quicktime', 'video/webm'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- 2. Public read (anyone can view posts)
DROP POLICY IF EXISTS "community_media_public_read" ON storage.objects;
CREATE POLICY "community_media_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'community-media');

-- 3. Authenticated upload — files stored under {user_id}/{filename}
DROP POLICY IF EXISTS "community_media_upload_own" ON storage.objects;
CREATE POLICY "community_media_upload_own"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'community-media'
    AND auth.role() = 'authenticated'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- 4. Update own files
DROP POLICY IF EXISTS "community_media_update_own" ON storage.objects;
CREATE POLICY "community_media_update_own"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'community-media'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- 5. Delete own files
DROP POLICY IF EXISTS "community_media_delete_own" ON storage.objects;
CREATE POLICY "community_media_delete_own"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'community-media'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- 6. Add media_type column to community_posts to distinguish image vs video
ALTER TABLE public.community_posts
  ADD COLUMN IF NOT EXISTS media_type text CHECK (media_type IN ('image', 'video')) DEFAULT NULL;
