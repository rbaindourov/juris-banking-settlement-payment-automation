import { Agenda } from 'agenda';
import { createAgenda } from '../../src/config/agenda';
import { registerAllJobs } from '../../src/jobs';
import { getTestDbUri } from './db';

/**
 * Initializes an isolated test Agenda instance bound to a test-specific Mongo database.
 * Does NOT start the Agenda polling loop by default (preventing timer leaks in Vitest).
 */
export async function initTestAgenda(suiteName?: string): Promise<Agenda> {
  const uri = getTestDbUri(suiteName);
  const agenda = createAgenda({
    mongoUri: uri,
    collection: 'agendaJobs',
    processEvery: '1 second'
  });
  registerAllJobs(agenda);
  return agenda;
}

/**
 * Safely stops, drains, and cancels test Agenda jobs, ensuring zero active timers remain.
 */
export async function stopTestAgenda(agenda?: Agenda | null): Promise<void> {
  if (agenda) {
    try {
      await agenda.stop();
      await agenda.cancel({});
    } catch {
      // Ignored during test cleanup
    }
  }
}
