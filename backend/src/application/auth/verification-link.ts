/**
 * Builds the URLs placed in verification / reset emails. These point at the
 * client app, which posts the token back to the API.
 */
export function buildVerificationLink(publicAppUrl: string, path: string, token: string): string {
  const url = new URL(path.replace(/^\/+/, ''), ensureTrailingSlash(publicAppUrl));
  url.searchParams.set('token', token);
  return url.toString();
}

function ensureTrailingSlash(base: string): string {
  return base.endsWith('/') ? base : `${base}/`;
}
