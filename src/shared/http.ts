import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ApiSuccess } from '@agronavis/shared-types';

/** Success envelope. Every 2xx response in the API goes through this. */
export function ok<T>(res: Response, data: T, meta?: ApiSuccess<T>['meta'], status = 200): void {
  const body: ApiSuccess<T> = meta ? { success: true, data, meta } : { success: true, data };
  res.status(status).json(body);
}

export function created<T>(res: Response, data: T): void {
  ok(res, data, undefined, 201);
}

export function noContent(res: Response): void {
  res.status(204).end();
}

/**
 * Wraps an async handler so a rejected promise reaches the error middleware
 * instead of hanging the request. Express 4 does not do this itself.
 */
export function handler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
