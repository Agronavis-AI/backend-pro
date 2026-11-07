-- CVs are compressed before storage, so record what the file cost on arrival
-- as well as what it costs at rest.

alter table public.applications add column if not exists resume_original_size integer;

-- Photographed CVs are accepted and stored as JPEG.
update storage.buckets
   set allowed_mime_types = array[
         'application/pdf',
         'application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'image/jpeg'
       ]
 where id = 'resumes';
