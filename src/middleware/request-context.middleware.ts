import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { logger } from '../config/logger';

/**
 * Assigns a request id, echoes it back on the response, and records how long
 * the handler took. The id appears on every log line and in error responses,
 * so a report from the field can be traced to one request.
 */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-request-id'];
  req.id = typeof incoming === 'string' && incoming.length <= 64 ? incoming : crypto.randomUUID();
  res.setHeader('x-request-id', req.id);

  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const line = `${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(0)}ms`;
    if (res.statusCode >= 500) logger.error(line, { requestId: req.id });
    else if (res.statusCode >= 400) logger.warn(line, { requestId: req.id });
    else logger.http(line, { requestId: req.id });
  });

  next();
}
