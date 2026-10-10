import { describe, it, expect } from "vitest";
import { POST, GET } from "./route";

function post(body: unknown): Request {
  return new Request("http://localhost/api/contact", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/contact", () => {
  it("accepts a valid submission", async () => {
    const res = await POST(
      post({
        name: "Ada Lovelace",
        email: "ada@example.com",
        subject: "General enquiry",
        message: "Please tell me more about AaminPay.",
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  it("rejects an invalid submission with 422 and field errors", async () => {
    const res = await POST(
      post({ name: "", email: "nope", subject: "", message: "" }),
    );
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.errors).toBeTruthy();
  });

  it("rejects a non-JSON body with 400", async () => {
    const res = await POST(
      new Request("http://localhost/api/contact", {
        method: "POST",
        body: "not json",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("does not accept GET", async () => {
    const res = GET();
    expect(res.status).toBe(405);
  });
});
