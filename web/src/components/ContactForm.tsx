"use client";

import { useId, useState } from "react";
import { Button } from "./Button";
import { validateContact, type ContactErrors } from "@/lib/validation";
import { submitContactForm } from "@/lib/api";

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

const subjects = [
  "General enquiry",
  "Help with a transfer",
  "Account question",
  "Business / partnerships",
  "Press",
  "Something else",
];

export function ContactForm() {
  const baseId = useId();
  const [errors, setErrors] = useState<ContactErrors>({});
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const input = {
      name: String(data.get("name") ?? ""),
      email: String(data.get("email") ?? ""),
      subject: String(data.get("subject") ?? ""),
      message: String(data.get("message") ?? ""),
    };

    const result = validateContact(input);
    setErrors(result.errors);
    if (!result.ok) {
      setStatus({ kind: "idle" });
      const first = Object.keys(result.errors)[0];
      if (first) form.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
      return;
    }

    setStatus({ kind: "submitting" });
    try {
      const res = await submitContactForm({
        ...result.value,
        website: String(data.get("website") ?? ""),
      });
      if (res.ok) {
        form.reset();
        setStatus({ kind: "success", message: res.message });
      } else {
        setStatus({ kind: "error", message: res.message });
      }
    } catch {
      setStatus({
        kind: "error",
        message: "Could not send your message. Please try again shortly.",
      });
    }
  }

  const field = (name: keyof ContactErrors) => ({
    id: `${baseId}-${name}`,
    name,
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": errors[name] ? `${baseId}-${name}-error` : undefined,
    className:
      "mt-1.5 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white px-3.5 py-2.5 text-sm text-[var(--color-ink)] shadow-sm focus-visible:outline-2 focus-visible:outline-brand-600",
  });

  const errorText = (name: keyof ContactErrors) =>
    errors[name] ? (
      <p id={`${baseId}-${name}-error`} className="mt-1.5 text-sm text-red-600">
        {errors[name]}
      </p>
    ) : null;

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {/* Bot trap: hidden from people and screen readers; a bot that fills it is ignored. */}
      <div
        aria-hidden="true"
        className="absolute -left-[9999px] h-0 w-0 overflow-hidden"
      >
        <label>
          Leave this field empty
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <div>
        <label
          htmlFor={`${baseId}-name`}
          className="text-brand-900 text-sm font-semibold"
        >
          Name
        </label>
        <input type="text" autoComplete="name" required {...field("name")} />
        {errorText("name")}
      </div>

      <div>
        <label
          htmlFor={`${baseId}-email`}
          className="text-brand-900 text-sm font-semibold"
        >
          Email
        </label>
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          {...field("email")}
        />
        {errorText("email")}
      </div>

      <div>
        <label
          htmlFor={`${baseId}-subject`}
          className="text-brand-900 text-sm font-semibold"
        >
          Subject
        </label>
        <select required defaultValue="" {...field("subject")}>
          <option value="" disabled>
            Choose a subject
          </option>
          {subjects.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {errorText("subject")}
      </div>

      <div>
        <label
          htmlFor={`${baseId}-message`}
          className="text-brand-900 text-sm font-semibold"
        >
          Message
        </label>
        <textarea rows={6} required {...field("message")} />
        {errorText("message")}
      </div>

      <div
        aria-live="polite"
        className={
          status.kind === "success"
            ? "border-accent-500/40 bg-accent-500/10 text-accent-600 rounded-[var(--radius-md)] border px-4 py-3 text-sm"
            : status.kind === "error"
              ? "rounded-[var(--radius-md)] border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700"
              : "sr-only"
        }
      >
        {status.kind === "success" || status.kind === "error"
          ? status.message
          : ""}
      </div>

      <Button type="submit" size="lg" disabled={status.kind === "submitting"}>
        {status.kind === "submitting" ? "Sending…" : "Send message"}
      </Button>

      <p className="text-xs text-[var(--color-ink-soft)]">
        By sending this form you agree that AaminPay may use the details you
        provide to respond to your enquiry. See our{" "}
        <a href="/privacy" className="underline">
          Privacy Policy
        </a>
        .
      </p>
    </form>
  );
}
