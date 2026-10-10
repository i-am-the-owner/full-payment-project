/**
 * Small dependency-free validators shared by the contact form (client) and the
 * contact API route (server). Keeping the rules in one place means the two
 * cannot drift apart.
 */

export interface ContactInput {
  name: string;
  email: string;
  subject: string;
  message: string;
}

export type ContactErrors = Partial<Record<keyof ContactInput, string>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateContact(input: Partial<ContactInput>): {
  ok: boolean;
  errors: ContactErrors;
  value: ContactInput;
} {
  const value: ContactInput = {
    name: (input.name ?? "").trim(),
    email: (input.email ?? "").trim(),
    subject: (input.subject ?? "").trim(),
    message: (input.message ?? "").trim(),
  };

  const errors: ContactErrors = {};

  if (value.name.length < 2) {
    errors.name = "Please enter your name.";
  } else if (value.name.length > 100) {
    errors.name = "Name must be 100 characters or fewer.";
  }

  if (!EMAIL_RE.test(value.email)) {
    errors.email = "Please enter a valid email address.";
  } else if (value.email.length > 254) {
    errors.email = "Email address is too long.";
  }

  if (value.subject.length < 3) {
    errors.subject = "Please add a short subject.";
  } else if (value.subject.length > 150) {
    errors.subject = "Subject must be 150 characters or fewer.";
  }

  if (value.message.length < 10) {
    errors.message =
      "Please add a little more detail (at least 10 characters).";
  } else if (value.message.length > 5000) {
    errors.message = "Message must be 5000 characters or fewer.";
  }

  return { ok: Object.keys(errors).length === 0, errors, value };
}
