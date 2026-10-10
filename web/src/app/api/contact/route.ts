import { NextResponse } from "next/server";
import { RateLimiter } from "@/lib/rate-limit";
import { validateContact } from "@/lib/validation";

// 5 messages per client per 10 minutes.
const limiter = new RateLimiter(5, 10 * 60_000);

function clientKey(request: Request): string {
  // Behind a proxy the first X-Forwarded-For entry is the client.
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  );
}

/**
 * Contact-form handler (first-party Next.js route).
 *
 * It validates the submission with the SAME rules the client uses and returns a
 * result. It does NOT currently deliver the message anywhere.
 *
 * TO CONNECT A REAL DESTINATION:
 *   - add a server-only env var for the destination (e.g. a transactional-email
 *     API key, a helpdesk webhook, or the SomPay backend URL) — never a
 *     NEXT_PUBLIC_* var, and never commit it;
 *   - send `parsed.value` from inside this handler (server-side);
 *   - keep the response shape { ok, message } unchanged so the client and the
 *     `submitContactForm` helper do not need to change.
 *
 * There is no secret, credential, or backend URL in this file or anywhere in the
 * web project.
 */

const DELIVERY_CONFIGURED = false; // flip to true once a destination is wired up

export async function POST(request: Request) {
  if (!limiter.allow(clientKey(request))) {
    return NextResponse.json(
      { ok: false, message: "Too many messages. Please try again later." },
      { status: 429, headers: { "Retry-After": "600" } },
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: "Invalid request." },
      { status: 400 },
    );
  }

  // A hidden field real people never fill in: a bot that does is told "thanks"
  // and nothing is done, so it learns nothing about the check.
  if (
    typeof (body as Record<string, unknown> | null)?.website === "string" &&
    (body as Record<string, string>).website !== ""
  ) {
    return NextResponse.json({
      ok: true,
      message: "Thanks — your message has been sent.",
    });
  }

  const parsed = validateContact((body ?? {}) as Record<string, unknown>);
  if (!parsed.ok) {
    return NextResponse.json(
      {
        ok: false,
        message: "Please check the highlighted fields.",
        errors: parsed.errors,
      },
      { status: 422 },
    );
  }

  if (!DELIVERY_CONFIGURED) {
    // Message is accepted and validated, but not yet delivered anywhere.
    return NextResponse.json({
      ok: true,
      message:
        "Thanks — your message has been received. Our contact channels are still being set up, so please also email us directly if your enquiry is urgent.",
    });
  }

  // Placeholder for the real delivery call (see file header).
  return NextResponse.json({
    ok: true,
    message: "Thanks — your message has been sent. We'll be in touch soon.",
  });
}

export function GET() {
  return NextResponse.json(
    { ok: false, message: "Method not allowed." },
    { status: 405 },
  );
}
