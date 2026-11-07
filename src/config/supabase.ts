import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@agronavis/shared-types';
import { env } from './env';

export type Db = SupabaseClient<Database>;

/**
 * Service-role client. It bypasses Row Level Security, so every query through
 * it must scope itself to the caller — that is what `shared/ownership.ts` is
 * for.
 *
 * Node 22 has a global WebSocket, so supabase-js can build its RealtimeClient
 * unaided. On Node 20 that threw at import time and had to be handed a `ws`
 * instance — the reason this file used to carry a transport override.
 */
export const db: Db = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  global: { headers: { 'x-application-name': 'agronavis-api' } },
});

/** Auth admin surface (user lookup, deletion). Same key, narrower intent. */
export const authAdmin = db.auth.admin;
