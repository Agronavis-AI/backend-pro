/** An error the client is allowed to see. Anything else becomes a flat 500. */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export const badRequest = (m: string, details?: unknown) => new AppError(400, m, 'BAD_REQUEST', details);
export const unauthorized = (m = 'Authentication required') => new AppError(401, m, 'UNAUTHORIZED');
export const forbidden = (m = 'You do not have access to this resource') =>
  new AppError(403, m, 'FORBIDDEN');
export const notFound = (m = 'Not found') => new AppError(404, m, 'NOT_FOUND');
export const conflict = (m: string) => new AppError(409, m, 'CONFLICT');
export const upstreamFailure = (m: string) => new AppError(502, m, 'UPSTREAM_FAILURE');

/**
 * Turns a PostgREST error into an AppError. Supabase returns errors in the
 * result object rather than throwing, so every query result runs through here.
 */
export function fromPostgrest(error: { message: string; code?: string; details?: string } | null, context: string): AppError {
  const code = error?.code;
  if (code === '23505') return conflict(`${context}: already exists`);
  if (code === '23503') return badRequest(`${context}: referenced record does not exist`);
  if (code === '23514') return badRequest(`${context}: value violates a database constraint`);
  if (code === 'PGRST116') return notFound(context);
  return new AppError(500, `${context}: ${error?.message ?? 'database error'}`, code, error?.details);
}
