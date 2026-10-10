import { createServer } from 'node:http';
import { createContainer } from './container.ts';
import { registerCrashHandlers } from './process-handlers.ts';

/**
 * The job worker as its own process: webhook processing, customer notices and
 * the stuck-transfer poll, without the HTTP API. Run it next to API processes
 * started with BACKGROUND_JOBS_ENABLED=false. Any number of workers may run:
 * jobs are claimed with SKIP LOCKED and scheduled tasks are enqueued once per period.
 *
 * It listens on WORKER_HEALTH_PORT (default 3001) for `GET /healthz`: 200 while
 * the database answers and the loop is alive, 503 otherwise. SIGTERM stops
 * claiming new jobs, lets the job in progress finish, then closes the database.
 */

const HEARTBEAT_MS = 30_000;
const STALE_AFTER_MS = 90_000;

function main(): void {
  const container = createContainer({ ...process.env, BACKGROUND_JOBS_ENABLED: 'true' });
  registerCrashHandlers(container);

  let lastOk = Date.now();
  // Not unref'd: this timer is what keeps the worker process alive.
  const heartbeat = setInterval(() => {
    container.pool.query('SELECT 1').then(
      () => {
        lastOk = Date.now();
        container.logger.info('worker.heartbeat');
      },
      (error: unknown) => container.logger.error('worker.heartbeat_failed', { error }),
    );
  }, HEARTBEAT_MS);

  const port = Number(process.env.WORKER_HEALTH_PORT ?? 3001);
  const health = createServer((req, res) => {
    const healthy = Date.now() - lastOk < STALE_AFTER_MS;
    res.statusCode = req.url === '/healthz' ? (healthy ? 200 : 503) : 404;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ status: healthy ? 'ok' : 'stale' }));
  });
  health.listen(port, () => container.logger.info('worker.started', { healthPort: port }));

  container.background.start();

  let stopping = false;
  const stop = (signal: NodeJS.Signals): void => {
    if (stopping) return;
    stopping = true;
    container.logger.info('worker.shutdown', { signal });
    clearInterval(heartbeat);
    health.close();
    // Waits for the job in progress, then closes the pool.
    container.shutdown().then(
      () => process.exit(0),
      () => process.exit(1),
    );
    setTimeout(() => process.exit(1), 25_000).unref();
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}

main();
