import type { Request } from 'express';
import './express-augmentation.ts';

/**
 * Typed accessors for values placed on `req.validated` by `validateRequest`.
 * Only call after the matching `validateRequest({ ... })` middleware has run.
 */
export function validatedBody<T>(req: Request): T {
  return (req.validated ?? {}).body as T;
}

export function validatedParams<T>(req: Request): T {
  return (req.validated ?? {}).params as T;
}

export function validatedQuery<T>(req: Request): T {
  return (req.validated ?? {}).query as T;
}
