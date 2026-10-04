import { createApp } from './app';
import { connectDb, disconnectDb } from './config/db';
import { config } from './config/env';
import { getAgenda, stopAgenda } from './config/agenda';
import { registerAllJobs, scheduleDefaultRecurringJobs } from './jobs';

async function startServer() {
  try {
    await connectDb();
    console.log(`[Database] Connected successfully to MongoDB at ${config.MONGODB_URI}`);

    // Initialize Agenda scheduler in non-test runtime
    const agenda = getAgenda();
    registerAllJobs(agenda);
    await agenda.start();
    await scheduleDefaultRecurringJobs(agenda);
    console.log('[Agenda] Scheduler started and default recurring jobs scheduled.');

    const app = createApp();
    const server = app.listen(config.PORT, () => {
      console.log(`[Juris-Banking Server] Listening on port ${config.PORT} (mode: ${config.NODE_ENV})`);
    });

    const gracefulShutdown = async (signal: string) => {
      console.log(`[Juris-Banking Server] Received ${signal}. Shutting down gracefully...`);
      server.close(async () => {
        try {
          await stopAgenda();
          console.log('[Juris-Banking Server] Agenda stopped cleanly.');
          await disconnectDb();
          console.log('[Juris-Banking Server] Database disconnected cleanly.');
          process.exit(0);
        } catch (err) {
          console.error('[Juris-Banking Server] Error during shutdown:', err);
          process.exit(1);
        }
      });
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  } catch (error) {
    console.error('[Juris-Banking Server] Fatal startup error:', error);
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test') {
  startServer();
}

export { startServer };
