/**
 * Security response headers for the public website.
 *
 * The CSP is not nonce-based (Next's hydration scripts are inline), so it
 * allows inline scripts and styles from this site only. It still blocks every
 * third-party script, plugin, framing, base-tag injection and form post to
 * another site. A nonce-based policy is a later hardening step.
 */
export interface Header {
  key: string;
  value: string;
}

export function contentSecurityPolicy(isProduction: boolean): string {
  const directives = [
    "default-src 'self'",
    // Development needs eval for hot reload; production never does.
    `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // The contact form posts to this site's own route.
    `connect-src 'self'${isProduction ? "" : " ws: wss:"}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isProduction ? ["upgrade-insecure-requests"] : []),
  ];
  return directives.join("; ");
}

export function securityHeaders(isProduction: boolean): Header[] {
  return [
    {
      key: "Content-Security-Policy",
      value: contentSecurityPolicy(isProduction),
    },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
    },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "X-DNS-Prefetch-Control", value: "on" },
    // HTTPS only: browsers remember it for two years. Not sent in development.
    ...(isProduction
      ? [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
        ]
      : []),
  ];
}
