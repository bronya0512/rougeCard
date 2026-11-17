// Game session wrapper (T106/T107). Pure TypeScript, no `cc` import.
// Owns the core GameState but never mutates it directly: the only way to
// change state is through core's pure advance(). This is the single point that
// satisfies the "game/ must not modify core state directly" criterion (AC-4).
// T107: persists the full state + injected RNG state to a StoragePort so a
// reload resumes the exact same session (FR-5 / AC-3).
import {
    advance,
    buildSnapshot,
    createFixedClock,
    createSeededRng,
    initGame,
    isSaveData,
    SAVE_SCHEMA_VERSION,
    type CoreContext,
    type GameConfig,
    type GameInput,
    type GameState,
    type SaveData,
    type Snapshot,
    type StatefulRng,
    type StoragePort,
} from '../core';

export const SAVE_KEY = 'roguecard.save.v1';

export interface GameSessionOptions {
    /** Storage adapter injected by the composition root (platform layer). */
    readonly storage?: StoragePort;
    /** A previously persisted save to restore; validated before use. */
    readonly restored?: SaveData | null;
    /** Supplies savedAt metadata; core never reads wall-clock time. */
    readonly now?: () => number;
}

export class GameSession {
    private state: GameState;
    private readonly rng: StatefulRng;
    private readonly ctx: CoreContext;
    private readonly storage: StoragePort | null;
    private readonly now: () => number;

    constructor(config: GameConfig, options: GameSessionOptions = {}) {
        this.storage = options.storage ?? null;
        this.now = options.now ?? (() => 0);
        const restored = options.restored !== undefined ? options.restored : null;
        const valid = restored !== null && isSaveData(restored) ? restored : null;
        // Resume RNG from the persisted internal state; a fresh game starts
        // from config.seed. This keeps draws/rewards deterministic across load.
        this.rng = createSeededRng(valid !== null ? valid.rngState : config.seed);
        this.ctx = { clock: createFixedClock(0), rng: this.rng };
        this.state = valid !== null ? valid.state : initGame(config, this.ctx).state;
    }

    /**
     * Read + validate a save from storage; fall back to a fresh game on
     * missing, malformed, or version-mismatched data (Q-3: no encryption,
     * structural guard only).
     */
    static load(storage: StoragePort, config: GameConfig, now?: () => number): GameSession {
        const raw = storage.get(SAVE_KEY);
        if (raw !== null) {
            try {
                const parsed: unknown = JSON.parse(raw);
                if (isSaveData(parsed)) {
                    return new GameSession(config, { storage, restored: parsed, now });
                }
            } catch {
                // corrupted JSON: discard below
            }
            storage.remove(SAVE_KEY);
        }
        return new GameSession(config, { storage, now });
    }

    /** Serialize current state + RNG state into storage (Q-8: save on every op). */
    save(): void {
        if (this.storage === null) return;
        const data: SaveData = {
            schemaVersion: SAVE_SCHEMA_VERSION,
            savedAt: this.now(),
            state: this.state,
            rngState: this.rng.getState(),
        };
        this.storage.set(SAVE_KEY, JSON.stringify(data));
    }

    clearSave(): void {
        if (this.storage !== null) this.storage.remove(SAVE_KEY);
    }

    /** The ONLY mutation path: delegate to core's pure step function. */
    dispatch(input: GameInput): Snapshot {
        const before = this.state.revision;
        const result = advance(this.state, input, this.ctx);
        this.state = result.state;
        // Persist only on accepted inputs (rejections keep revision unchanged).
        if (this.state.revision !== before) this.save();
        return result.snapshot;
    }

    /** Snapshot for rendering (never exposes the mutable state). */
    get snapshot(): Snapshot {
        return buildSnapshot(this.state);
    }
}
