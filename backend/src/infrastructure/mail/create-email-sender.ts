import type { EmailSender } from '../../application/email/email-sender.ts';
import type { Env } from '../../config/env.ts';
import type { Logger } from '../../shared/logger.ts';
import { ProviderConfigError } from '../providers/provider-config-error.ts';
import { LogEmailSender } from './log-email-sender.ts';
import { PostmarkEmailSender } from './postmark-email-sender.ts';
import { ResendEmailSender } from './resend-email-sender.ts';
import { SesEmailSender } from './ses-email-sender.ts';

export interface EmailSenderDeps {
  readonly env: Env;
  readonly logger: Logger;
  /** Log message bodies too (development only; production refuses). */
  readonly includeBodies: boolean;
  readonly fetchImpl?: typeof fetch;
}

/** Builds the sender chosen by `EMAIL_PROVIDER`, failing at start-up if its settings are missing. */
export function createEmailSender(deps: EmailSenderDeps): EmailSender {
  const { env } = deps;
  const missing = (names: string[]): never => {
    throw new ProviderConfigError(
      `EMAIL_PROVIDER=${env.EMAIL_PROVIDER} needs these variables: ${names.join(', ')}.`,
    );
  };
  const need = (...pairs: [string, string | undefined][]): void => {
    const absent = pairs.filter(([, v]) => !v).map(([n]) => n);
    if (absent.length > 0) missing(absent);
  };
  const common = deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {};

  switch (env.EMAIL_PROVIDER) {
    case 'log':
      return new LogEmailSender(deps.logger, { includeBodies: deps.includeBodies });
    case 'postmark':
      need(['EMAIL_FROM', env.EMAIL_FROM], ['POSTMARK_SERVER_TOKEN', env.POSTMARK_SERVER_TOKEN]);
      return new PostmarkEmailSender({
        serverToken: env.POSTMARK_SERVER_TOKEN!,
        from: env.EMAIL_FROM!,
        ...common,
      });
    case 'resend':
      need(['EMAIL_FROM', env.EMAIL_FROM], ['RESEND_API_KEY', env.RESEND_API_KEY]);
      return new ResendEmailSender({
        apiKey: env.RESEND_API_KEY!,
        from: env.EMAIL_FROM!,
        ...common,
      });
    case 'ses':
      need(
        ['EMAIL_FROM', env.EMAIL_FROM],
        ['AWS_SES_REGION', env.AWS_SES_REGION],
        ['AWS_ACCESS_KEY_ID', env.AWS_ACCESS_KEY_ID],
        ['AWS_SECRET_ACCESS_KEY', env.AWS_SECRET_ACCESS_KEY],
      );
      return new SesEmailSender({
        region: env.AWS_SES_REGION!,
        accessKeyId: env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY!,
        sessionToken: env.AWS_SESSION_TOKEN,
        from: env.EMAIL_FROM!,
        ...common,
      });
  }
}
