import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { site } from "./site";

const source = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("legal placeholders", () => {
  it("every legal page carries a TODO-LEGAL marker for the lawyer's final text", () => {
    for (const page of ["terms", "privacy", "cookies"]) {
      expect(source(`app/${page}/page.tsx`)).toContain("TODO-LEGAL");
    }
    expect(source("components/DraftNotice.tsx")).toContain("TODO-LEGAL");
  });

  it("the footer says who provides payments and that AaminPay holds no customer funds", () => {
    expect(site.paymentStatement).toContain("Payments are provided by");
    expect(site.paymentStatement).toContain("[provider name]");
    expect(site.paymentStatement).toContain("does not hold customer funds");
    expect(site.paymentStatement).toContain("TODO-LEGAL");
    expect(source("components/Footer.tsx")).toContain("site.paymentStatement");
  });

  it("company details are marked, not invented", () => {
    expect(site.company.legalNameNote).toContain("TODO-LEGAL");
    expect(site.contact.addressLines.join(" ")).toContain("TODO-LEGAL");
  });
});
