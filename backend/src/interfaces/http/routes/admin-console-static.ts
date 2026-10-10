import { readFileSync } from 'node:fs';
import { Router } from 'express';

const FILES: Record<string, { file: string; type: string }> = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/console.js': { file: 'console.js', type: 'text/javascript; charset=utf-8' },
  '/console.css': { file: 'console.css', type: 'text/css; charset=utf-8' },
};

// Scripts and styles only from this origin, no inline code, no framing, and the
// page may talk only to this API.
const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; " +
  "base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/**
 * Serves the static admin console. The files hold no data and no secrets: all
 * access control is on the admin API they call (admin role + 2FA + audit).
 */
export function adminConsoleStatic(): Router {
  const dir = new URL('../../../../admin-console/', import.meta.url);
  const loaded = new Map(
    Object.entries(FILES).map(([path, f]) => [path, readFileSync(new URL(f.file, dir))]),
  );
  const router = Router();
  router.get(Object.keys(FILES), (req, res) => {
    const entry = FILES[req.path];
    if (!entry) {
      res.status(404).end();
      return;
    }
    res.setHeader('Content-Type', entry.type);
    res.setHeader('Content-Security-Policy', CSP);
    res.send(loaded.get(req.path));
  });
  return router;
}
