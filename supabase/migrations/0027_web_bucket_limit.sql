-- Intake allows 12 MB because most of it is discarded by compression, but a
-- Word document passes through untouched. The bucket has to accept what the
-- API is willing to take, or those uploads fail after the applicant has waited.

update storage.buckets
   set file_size_limit = 12582912
 where id = 'resumes';
