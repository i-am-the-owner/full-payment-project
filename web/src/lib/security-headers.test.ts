import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, securityHeaders } from "./security-headers";

const value = (headers: { key: string; value: string }[], key: string) =>
  headers.find((h) => h.key === key)?.value;

describe("website security headers", () => {
  it("production CSP blocks third parties, framing, plugins and base/form hijacking", () => {
    const csp = contentSecurityPolicy(true);
    for (const directive of [
      "default-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "upgrade-insecure-requests",
    ]) {
      expect(csp).toContain(directive);
    }
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toMatch(/https?:\/\//); // no third-party origin is allowed
    expect(csp).not.toContain("*");
  });

  it("only development may use eval or websockets", () => {
    expect(contentSecurityPolicy(false)).toContain("'unsafe-eval'");
    expect(contentSecurityPolicy(true)).not.toContain("ws:");
  });

  it("sends HSTS in production only, plus the other basics always", () => {
    const prod = securityHeaders(true);
    expect(value(prod, "Strict-Transport-Security")).toBe(
      "max-age=63072000; includeSubDomains",
    );
    expect(
      value(securityHeaders(false), "Strict-Transport-Security"),
    ).toBeUndefined();
    for (const headers of [prod, securityHeaders(false)]) {
      expect(value(headers, "X-Content-Type-Options")).toBe("nosniff");
      expect(value(headers, "X-Frame-Options")).toBe("DENY");
      expect(value(headers, "Referrer-Policy")).toBeDefined();
      expect(value(headers, "Content-Security-Policy")).toContain(
        "frame-ancestors 'none'",
      );
    }
  });
});
