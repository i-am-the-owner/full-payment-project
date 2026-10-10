import { describe, it, expect } from "vitest";
import { primaryNav, legalNav, getStarted } from "./nav";

describe("navigation config", () => {
  it("primary nav covers the expected public pages", () => {
    const hrefs = primaryNav.map((l) => l.href);
    expect(hrefs).toEqual([
      "/",
      "/how-it-works",
      "/countries",
      "/fees",
      "/security",
      "/about",
      "/faq",
      "/contact",
    ]);
  });

  it("legal nav links to the three draft policies", () => {
    expect(legalNav.map((l) => l.href)).toEqual([
      "/privacy",
      "/terms",
      "/cookies",
    ]);
  });

  it("every link has a non-empty label and a root-relative href", () => {
    for (const link of [...primaryNav, ...legalNav, getStarted]) {
      expect(link.label.trim().length).toBeGreaterThan(0);
      expect(link.href.startsWith("/")).toBe(true);
    }
  });
});
