import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { createLogger, type Logger } from '../../src/shared/logger.ts';

export const silentLogger: Logger = createLogger({ level: 'error', write: () => {} });

export interface MockRequestInit {
  headers?: Record<string, string>;
  query?: unknown;
  params?: unknown;
  body?: unknown;
  secure?: boolean;
  method?: string;
  path?: string;
  id?: string;
  log?: Logger;
}

/** A minimal Express `Request` stand-in for middleware unit tests. */
export function mockRequest(init: MockRequestInit = {}): Request {
  const headers = new Map(
    Object.entries(init.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
  );

  return {
    id: init.id ?? 'test-request-id',
    log: init.log ?? silentLogger,
    method: init.method ?? 'GET',
    path: init.path ?? '/',
    secure: init.secure ?? false,
    query: init.query ?? {},
    params: init.params ?? {},
    body: init.body,
    get(name: string): string | undefined {
      return headers.get(name.toLowerCase());
    },
  } as unknown as Request;
}

export interface MockResponse {
  res: Response;
  readonly statusCode: number | undefined;
  readonly body: unknown;
  readonly headers: Record<string, string>;
}

export function mockResponse(req?: Request): MockResponse {
  let statusCode: number | undefined;
  let body: unknown;
  const headers: Record<string, string> = {};

  const res = {
    req,
    status(code: number): Response {
      statusCode = code;
      return res;
    },
    json(payload: unknown): Response {
      body = payload;
      return res;
    },
    setHeader(name: string, value: string | number): Response {
      headers[name] = String(value);
      return res;
    },
  } as unknown as Response;

  return {
    res,
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    },
    get headers() {
      return headers;
    },
  };
}

export interface MiddlewareRun {
  req: Request;
  response: MockResponse;
  /** The argument passed to `next`, or `undefined` if `next()` was called clean. */
  error: unknown;
  /** True if the handler wrote a response instead of calling `next`. */
  responded: boolean;
}

/** Runs one middleware/handler and resolves once it calls `next` or responds. */
export function runMiddleware(handler: RequestHandler, req: Request): Promise<MiddlewareRun> {
  const response = mockResponse(req);

  return new Promise<MiddlewareRun>((resolve, reject) => {
    const originalJson = response.res.json.bind(response.res);
    (response.res as { json: Response['json'] }).json = (payload: unknown) => {
      const result = originalJson(payload);
      resolve({ req, response, error: undefined, responded: true });
      return result;
    };

    const next: NextFunction = ((err?: unknown) => {
      resolve({ req, response, error: err, responded: false });
    }) as NextFunction;

    try {
      handler(req, response.res, next);
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
