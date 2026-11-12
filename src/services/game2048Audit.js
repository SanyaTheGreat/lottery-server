import { randomUUID } from 'node:crypto';
import { GAME2048_ENGINE_VERSION } from './game2048Engine.js';

// Persisted in the same game_runs write; the database trigger appends the journal.
export function makeAuditAction(type, details = {}) {
  return { ...details, type, engine_version: GAME2048_ENGINE_VERSION, request_id: randomUUID() };
}
