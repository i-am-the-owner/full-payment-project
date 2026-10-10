import { describe, it, expect } from "vitest";
import { validateContact } from "./validation";

describe("validateContact", () => {
  const valid = {
    name: "Ada Lovelace",
    email: "ada@example.com",
    subject: "General enquiry",
    message: "I would like to know more about sending money to Kenya.",
  };

  it("accepts a well-formed submission and trims values", () => {
    const r = validateContact({
      ...valid,
      name: "  Ada Lovelace  ",
      email: "  ada@example.com ",
    });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual({});
    expect(r.value.name).toBe("Ada Lovelace");
    expect(r.value.email).toBe("ada@example.com");
  });

  it("rejects a missing name", () => {
    const r = validateContact({ ...valid, name: "" });
    expect(r.ok).toBe(false);
    expect(r.errors.name).toBeDefined();
  });

  it.each([
    "not-an-email",
    "missing@domain",
    "@no-local.com",
    "spaces in@email.com",
  ])("rejects invalid email %s", (email) => {
    const r = validateContact({ ...valid, email });
    expect(r.ok).toBe(false);
    expect(r.errors.email).toBeDefined();
  });

  it("rejects a too-short subject and message", () => {
    const r = validateContact({ ...valid, subject: "hi", message: "short" });
    expect(r.ok).toBe(false);
    expect(r.errors.subject).toBeDefined();
    expect(r.errors.message).toBeDefined();
  });

  it("rejects an over-long message", () => {
    const r = validateContact({ ...valid, message: "x".repeat(5001) });
    expect(r.ok).toBe(false);
    expect(r.errors.message).toBeDefined();
  });

  it("treats undefined input as empty (no throw)", () => {
    const r = validateContact({});
    expect(r.ok).toBe(false);
    expect(Object.keys(r.errors).sort()).toEqual([
      "email",
      "message",
      "name",
      "subject",
    ]);
  });
});
