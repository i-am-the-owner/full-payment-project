import { describe, it, expect } from "vitest";
import {
  destinations,
  destinationCodes,
  getDestination,
  availabilityMeta,
} from "./countries";

describe("destinations data", () => {
  it("has at least one destination and Kenya is present", () => {
    expect(destinations.length).toBeGreaterThan(0);
    expect(getDestination("ke")?.name).toBe("Kenya");
  });

  it("uses lowercase 2-letter codes and unique codes", () => {
    const codes = destinationCodes();
    for (const c of codes) expect(c).toMatch(/^[a-z]{2}$/);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("every destination is well-formed", () => {
    for (const d of destinations) {
      expect(d.currency).toMatch(/^[A-Z]{3}$/);
      expect(d.name.length).toBeGreaterThan(1);
      expect(d.summary.length).toBeGreaterThan(10);
      expect(d.transferMethods.length).toBeGreaterThan(0);
      expect(d.displayInfo.length).toBeGreaterThan(0);
      expect(availabilityMeta[d.availability]).toBeDefined();
    }
  });

  it("does NOT mark any corridor as live (not confirmed yet)", () => {
    for (const d of destinations) {
      expect(d.availability).not.toBe("live");
    }
  });

  it("getDestination is case-insensitive and returns undefined for unknown", () => {
    expect(getDestination("KE")?.code).toBe("ke");
    expect(getDestination("zz")).toBeUndefined();
  });
});
