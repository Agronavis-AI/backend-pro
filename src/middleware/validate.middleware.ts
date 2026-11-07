import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodTypeAny, z } from 'zod';

type Target = 'body' | 'query' | 'params';

/**
 * Parses and replaces the given request part with the schema's output, so
 * handlers receive coerced, defaulted, typed values rather than raw strings.
 */
export function validate<S extends ZodTypeAny>(schema: S, target: Target = 'body'): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[target]);
    if (!result.success) return next(result.error);
    // req.query/params are getter-only in Express 5; assign through defineProperty.
    Object.defineProperty(req, target, { value: result.data, writable: true, configurable: true });
    next();
  };
}

export type Validated<S extends ZodTypeAny> = z.infer<S>;
