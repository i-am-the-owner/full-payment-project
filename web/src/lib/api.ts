/**
 * Backend service abstraction.
 *
 * The public website does not currently talk to the AaminPay backend. This module
 * is the single seam where that connection will be added later. Everything here
 * either returns static, clearly-marked placeholder data or posts to a
 * first-party Next.js route handler under `/api` — it never embeds a backend
 * URL, credential, or secret in client code.
 *
 * When the backend is ready:
 *   - set BACKEND_BASE_URL (server-side env var, NOT NEXT_PUBLIC_*)
 *   - implement the fetches inside the route handlers under src/app/api/*
 *   - keep this module's function signatures stable so pages don't change.
 */

export interface CorridorPricingDisplay {
  /** e.g. "GBP" */
  sendCurrency: string;
  /** e.g. "KES" */
  receiveCurrency: string;
  /** Human-readable fee description. Placeholder until commercial pricing is set. */
  feeDisplay: string;
  /** Human-readable rate description. Never a fabricated numeric rate. */
  rateDisplay: string;
  /** Whether these are confirmed commercial figures (false = placeholder). */
  confirmed: boolean;
}

/**
 * Returns fee / exchange-rate *presentation copy* for a corridor.
 *
 * This intentionally returns descriptive placeholders, not numbers: real pricing
 * and live rates come from the backend at transfer time and are shown in the app
 * before a customer confirms. Publishing a fixed fee or a fixed rate here would
 * be misleading.
 */
export function getCorridorPricingDisplay(
  sendCurrency: string,
  receiveCurrency: string,
): CorridorPricingDisplay {
  return {
    sendCurrency,
    receiveCurrency,
    feeDisplay:
      "A transfer fee set by AaminPay, shown in full before you confirm. Commercial pricing is not yet finalised.",
    rateDisplay:
      "A live exchange rate calculated at the time of your transfer and shown before you confirm.",
    confirmed: false,
  };
}

export interface ContactSubmission {
  ok: boolean;
  message: string;
}

/** Posts the contact form to the first-party route handler. */
export async function submitContactForm(
  payload: unknown,
): Promise<ContactSubmission> {
  const res = await fetch("/api/contact", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res
    .json()
    .catch(() => ({}))) as Partial<ContactSubmission>;
  return {
    ok: res.ok && data.ok !== false,
    message:
      data.message ??
      (res.ok
        ? "Thanks — your message has been received."
        : "Something went wrong. Please try again."),
  };
}
