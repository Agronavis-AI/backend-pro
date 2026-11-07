import { db } from '../../config/supabase';
import { logger } from '../../config/logger';

/**
 * The website's own tables: careers applications, the openings they apply to,
 * and account deletion requests from people who have already uninstalled.
 *
 * These were a separate Fastify service against a separate Supabase project.
 * Merged here they share one client, one deploy and one set of credentials —
 * the service-role key, so every call bypasses RLS and none of this may ever
 * be reachable from a browser without passing through a route in this module.
 */

const RESUME_BUCKET = 'resumes';
/** Long enough to read an application at leisure, short enough to expire. */
const SIGNED_URL_TTL = 60 * 60 * 24 * 14;

export type Opening = {
  title: string;
  team: string | null;
  location: string;
  commitment: string;
  duration: string;
  stipend_min: number | null;
  stipend_max: number | null;
  summary: string | null;
};

export type Resume = {
  filename: string;
  mimeType: string;
  bytes: Buffer;
  originalBytes?: number;
};

export type ApplicationRecord = {
  name: string;
  email: string;
  phone?: string;
  role: string;
  portfolio_url?: string;
  github_url?: string;
  linkedin_url?: string;
  message: string;
};

export type StoredApplication = { id: string; resumeUrl: string | null };

export type DeletionRequest = {
  email: string;
  name?: string;
  scope: 'account' | 'data';
  reason?: string;
};

/** Active openings, in display order. */
export async function listOpenings(): Promise<Opening[]> {
  const { data, error } = await db
    .from('openings')
    .select('title, team, location, commitment, duration, stipend_min, stipend_max, summary')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (error) throw new Error(`could not read openings: ${error.message}`);
  return (data ?? []) as unknown as Opening[];
}

/** Returns the request id, so the applicant can be told what to quote. */
export async function saveDeletionRequest(record: DeletionRequest): Promise<string> {
  const { data, error } = await db
    .from('deletion_requests')
    .insert(record as never)
    .select('id')
    .single();

  if (error) throw new Error(`could not record deletion request: ${error.message}`);
  return (data as { id: string }).id;
}

function safeName(filename: string): string {
  const cleaned = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  return cleaned || 'resume';
}

async function uploadResume(applicantEmail: string, resume: Resume): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const folder = applicantEmail.replace(/[^a-zA-Z0-9]/g, '_');
  const path = `${folder}/${stamp}-${safeName(resume.filename)}`;

  const { error } = await db.storage
    .from(RESUME_BUCKET)
    .upload(path, resume.bytes, { contentType: resume.mimeType, upsert: false });

  if (error) throw new Error(`resume upload failed: ${error.message}`);
  return path;
}

async function signResume(path: string): Promise<string | null> {
  const { data } = await db.storage.from(RESUME_BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
  return data?.signedUrl ?? null;
}

export async function saveApplication(
  record: ApplicationRecord,
  resume?: Resume,
): Promise<StoredApplication> {
  const resumePath = resume ? await uploadResume(record.email, resume) : null;

  const { data, error } = await db
    .from('applications')
    .insert({
      ...record,
      resume_path: resumePath,
      resume_name: resume?.filename ?? null,
      resume_size: resume?.bytes.length ?? null,
      resume_original_size: resume?.originalBytes ?? resume?.bytes.length ?? null,
    } as never)
    .select('id')
    .single();

  if (error) {
    // The row is the record of truth; an orphaned file is worse than none.
    if (resumePath) {
      await db.storage
        .from(RESUME_BUCKET)
        .remove([resumePath])
        .catch(() => undefined);
    }
    throw new Error(`could not save application: ${error.message}`);
  }

  const id = (data as { id: string }).id;
  logger.info('Application stored', { id, hasResume: Boolean(resumePath) });
  return { id, resumeUrl: resumePath ? await signResume(resumePath) : null };
}
