import type { Server } from 'node:http';
import { createContainer, type Container } from './container.ts';
import { registerCrashHandlers } from './process-handlers.ts';
import { createApp } from './interfaces/http/create-app.ts';

function registerShutdown(server: Server, container: Container): void {
  let shuttingDown = false;

  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    container.logger.info('server.shutdown', { signal });

    server.close(() => {
      container.shutdown().then(
        () => process.exit(0),
        () => process.exit(1),
      );
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

function main(): void {
  const container = createContainer(process.env);
  registerCrashHandlers(container);
  const app = createApp(container);

  const server = app.listen(container.config.port, () => {
    container.logger.info('server.started', {
      port: container.config.port,
      version: container.config.version,
    });
  });

  registerShutdown(server, container);
  // Webhook processing, customer notifications and the stuck-transfer poll.
  container.background.start();
}

main();
