import type { Container } from './container.ts';

/** An unexpected crash is logged and reported, then the process exits so the platform restarts it. */
export function registerCrashHandlers(container: Container): void {
  const crash = (kind: string) => (error: unknown) => {
    container.logger.error(kind, {
      error: error instanceof Error ? error : { value: String(error) },
    });
    container.errorReporter.capture(error, { where: kind });
    // Give the report a moment to leave, then exit.
    setTimeout(() => process.exit(1), 1500).unref();
  };
  process.on('uncaughtException', crash('process.uncaught_exception'));
  process.on('unhandledRejection', crash('process.unhandled_rejection'));
}
