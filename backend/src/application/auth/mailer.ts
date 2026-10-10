/**
 * Sends transactional authentication emails.
 *
 * Implementations must never log the verification / reset URL in production
 * (it contains a single-use secret).
 */
export interface Mailer {
  sendEmailVerification(to: string, verificationUrl: string): Promise<void>;
  sendPasswordReset(to: string, resetUrl: string): Promise<void>;
  sendPasswordChangedNotice(to: string): Promise<void>;
  /**
   * Sent when someone tries to register with an address that already has an
   * account – so registration can return an identical response either way.
   */
  sendDuplicateRegistrationNotice(to: string): Promise<void>;
}

/** Emails beyond the sign-up and reset flow. */
export interface AccountMailer {
  /** A short code typed into the app. */
  sendEmailCode(to: string, code: string): Promise<void>;
  /** The outcome of the provider's identity check. */
  sendIdCheckResult(to: string, result: 'verified' | 'needs_review' | 'rejected'): Promise<void>;
}
