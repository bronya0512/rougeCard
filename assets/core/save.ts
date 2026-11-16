// Save schema. The Storage adapter (platform layer) persists a serialized
// SaveData; core is responsible for validating/restoring it. Pure TypeScript.
import type { GameState } from './state';

export const SAVE_SCHEMA_VERSION = 1 as const;

/** Envelope written to Storage. The payload is a full GameState. */
export interface SaveData {
    readonly schemaVersion: typeof SAVE_SCHEMA_VERSION;
    /** Wall-clock time at save time, supplied by the caller (not core). */
    readonly savedAt: number;
    readonly state: GameState;
}

/** Type guard for validating an untrusted parsed value before restore. */
export function isSaveData(value: unknown): value is SaveData {
    if (typeof value !== 'object' || value === null) return false;
    const obj = value as Record<string, unknown>;
    if (obj['schemaVersion'] !== SAVE_SCHEMA_VERSION) return false;
    if (typeof obj['savedAt'] !== 'number') return false;
    const state = obj['state'];
    if (typeof state !== 'object' || state === null) return false;
    const s = state as Record<string, unknown>;
    return s['version'] === 1 && typeof s['revision'] === 'number';
}
