// Save schema. The Storage adapter (platform layer) persists a serialized
// SaveData; core is responsible for validating/restoring it. Pure TypeScript.
import type { GameState } from './state';

export const SAVE_SCHEMA_VERSION = 1 as const;

/** Envelope written to Storage. The payload is a full GameState plus RNG state. */
export interface SaveData {
    readonly schemaVersion: typeof SAVE_SCHEMA_VERSION;
    /** Wall-clock time at save time, supplied by the caller (not core). */
    readonly savedAt: number;
    readonly state: GameState;
    /**
     * Internal state of the injected seeded RNG at save time. Restoring from
     * this value resumes the exact draw/reward sequence, preserving determinism
     * across a save/load round trip (FR-5 / AC-3 / AC-1).
     */
    readonly rngState: number;
}

/**
 * Type guard for validating an untrusted parsed value before restore.
 * Light structural validation only (Q-3: no encryption — local offline save,
 * no sensitive data; guard against corruption/version drift, not tampering).
 */
export function isSaveData(value: unknown): value is SaveData {
    if (typeof value !== 'object' || value === null) return false;
    const obj = value as Record<string, unknown>;
    if (obj['schemaVersion'] !== SAVE_SCHEMA_VERSION) return false;
    if (typeof obj['savedAt'] !== 'number') return false;
    if (typeof obj['rngState'] !== 'number') return false;
    const state = obj['state'];
    if (typeof state !== 'object' || state === null) return false;
    const s = state as Record<string, unknown>;
    return s['version'] === 1 && typeof s['revision'] === 'number';
}
