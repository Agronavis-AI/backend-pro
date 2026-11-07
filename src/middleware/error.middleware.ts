import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import type { ApiFailure } from '@agronavis/shared-types';
import { logger } from '../config/logger';
import { AppError } from '../shared/errors';

function send(res: Response, status: number, body: ApiFailure): void {
  res.status(status).json(body);
}

export function notFoundMiddleware(req: Request, res: Response): void {
  send(res, 404, {
    success: false,
    error: `Route ${req.method} ${req.originalUrl} not found`,
    code: 'ROUTE_NOT_FOUND',
  });
}

export function errorMiddleware(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error(err.message, { requestId: req.id, code: err.code, stack: err.stack });
    } else {
      logger.debug(`${err.statusCode} ${err.message}`, { requestId: req.id, path: req.path });
    }
    send(res, err.statusCode, {
      success: false,
      error: err.message,
      code: err.code,
      details: err.details,
    });
    return;
  }

  if (err instanceof ZodError) {
    send(res, 400, {
      success: false,
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    return;
  }

  // Multer and other library errors that carry an HTTP-ish status.
  const maybeStatus = (err as { status?: number; statusCode?: number })?.statusCode ??
    (err as { status?: number })?.status;
  if (typeof maybeStatus === 'number' && maybeStatus >= 400 && maybeStatus < 500) {
    send(res, maybeStatus, {
      success: false,
      error: (err as Error).message || 'Request rejected',
      code: 'CLIENT_ERROR',
    });
    return;
  }

  logger.error('Unhandled error', {
    requestId: req.id,
    path: req.path,
    error: err instanceof Error ? err.stack : String(err),
  });
  // Never leak internals to the client.
  send(res, 500, { success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' });
}
