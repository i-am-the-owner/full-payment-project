import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';
import { ValidationError, type FieldError } from '../../../shared/errors.ts';
import '../express-augmentation.ts';

export interface RequestSchemas {
  readonly body?: ZodType;
  readonly query?: ZodType;
  readonly params?: ZodType;
}

const PARTS = ['body', 'query', 'params'] as const;

/**
 * Validates the request against per-part Zod schemas. On success the parsed,
 * typed values are placed on `req.validated`. On failure a single
 * `ValidationError` (HTTP 400) carrying every field problem is raised.
 *
 * A route declares its full input contract here; unknown fields are rejected
 * when the schema is strict.
 */
export function validateRequest(schemas: RequestSchemas): RequestHandler {
  return (req, _res, next) => {
    const fieldErrors: FieldError[] = [];
    const validated: { body?: unknown; query?: unknown; params?: unknown } = {};

    for (const part of PARTS) {
      const schema = schemas[part];
      if (!schema) {
        continue;
      }

      const result = schema.safeParse(req[part]);
      if (result.success) {
        validated[part] = result.data;
      } else {
        for (const issue of result.error.issues) {
          const path = issue.path.map((segment) => String(segment)).join('.');
          fieldErrors.push({
            field: path ? `${part}.${path}` : part,
            message: issue.message,
          });
        }
      }
    }

    if (fieldErrors.length > 0) {
      next(new ValidationError('The request did not pass validation.', fieldErrors));
      return;
    }

    req.validated = validated;
    next();
  };
}
