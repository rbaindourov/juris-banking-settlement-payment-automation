import { Agenda } from 'agenda';
import { MongoBackend } from '@agendajs/mongo-backend';
import { config } from './env';

export interface CreateAgendaOptions {
  mongoUri?: string;
  collection?: string;
  processEvery?: string;
  maxConcurrency?: number;
  defaultConcurrency?: number;
  defaultLockLifetime?: number;
}

let agendaInstance: Agenda | null = null;

/**
 * Factory function creating a new configured Agenda scheduler instance.
 * Note: agenda.start() is NEVER called here to ensure Vitest test safety.
 */
export function createAgenda(options?: CreateAgendaOptions): Agenda {
  const uri = options?.mongoUri || (config.NODE_ENV === 'test' ? config.MONGODB_URI_TEST : config.MONGODB_URI);
  const collection = options?.collection || 'agendaJobs';

  const backend = new MongoBackend({
    address: uri,
    collection
  });

  const agenda = new Agenda({
    backend,
    processEvery: options?.processEvery || '30 seconds',
    maxConcurrency: options?.maxConcurrency || 20,
    defaultConcurrency: options?.defaultConcurrency || 5,
    defaultLockLifetime: options?.defaultLockLifetime || 60000
  });

  return agenda;
}

/**
 * Returns the singleton Agenda scheduler instance.
 */
export function getAgenda(): Agenda {
  if (!agendaInstance) {
    agendaInstance = createAgenda();
  }
  return agendaInstance;
}

/**
 * Sets or overrides the singleton Agenda instance (primarily for tests).
 */
export function setAgenda(agenda: Agenda | null): void {
  agendaInstance = agenda;
}

/**
 * Gracefully stops and drains the singleton Agenda instance.
 */
export async function stopAgenda(): Promise<void> {
  if (agendaInstance) {
    try {
      await agendaInstance.stop();
      await agendaInstance.cancel({});
      if ((agendaInstance as any).backend && typeof (agendaInstance as any).backend.disconnect === 'function') {
        await (agendaInstance as any).backend.disconnect();
      }
    } catch (err: any) {
      console.warn('[Agenda] Warning during stopAgenda:', err?.message || err);
    }
    agendaInstance = null;
  }
}
