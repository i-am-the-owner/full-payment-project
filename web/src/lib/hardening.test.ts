import { describe, it, expect } from "vitest";
import { safeJsonLd } from "./json-ld";
import { RateLimiter } from "./rate-limit";

describe("safeJsonLd", () => {
  it("cannot end the script tag, and still parses back to the same value", () => {
    const value = { answer: "</script><script>alert(1)</script>   ok" };
    const out = safeJsonLd(value);
    expect(out).not.toContain("</script>");
    expect(out).not.toContain("<");
    expect(JSON.parse(out)).toEqual(value);
  });
});

describe("RateLimiter", () => {
  it("allows up to the limit per key inside the window, then refuses", () => {
    const limiter = new RateLimiter(3, 1000);
    expect([1, 2, 3, 4].map(() => limiter.allow("a", 0))).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(limiter.allow("b", 0)).toBe(true);
  });

  it("forgets hits once the window has passed", () => {
    const limiter = new RateLimiter(1, 1000);
    expect(limiter.allow("a", 0)).toBe(true);
    expect(limiter.allow("a", 500)).toBe(false);
    expect(limiter.allow("a", 1500)).toBe(true);
  });
});
