// Game session wrapper (T106). Pure TypeScript, no `cc` import.
// Owns the core GameState but never mutates it directly: the only way to
// change state is through core's pure advance(). This is the single point that
// satisfies the "game/ must not modify core state directly" criterion (AC-4).
import {
    advance,
    buildSnapshot,
    createFixedClock,
    createSeededRng,
    initGame,
    type CoreContext,
    type GameConfig,
    type GameInput,
    type GameState,
    type Snapshot,
} from '../core';

export class GameSession {
    private state: GameState;
    private readonly ctx: CoreContext;

    constructor(config: GameConfig) {
        this.ctx = { clock: createFixedClock(0), rng: createSeededRng(config.seed) };
        this.state = initGame(config, this.ctx).state;
    }

    /** The ONLY mutation path: delegate to core's pure step function. */
    dispatch(input: GameInput): Snapshot {
        const result = advance(this.state, input, this.ctx);
        this.state = result.state;
        return result.snapshot;
    }

    /** Snapshot for rendering (never exposes the mutable state). */
    get snapshot(): Snapshot {
        return buildSnapshot(this.state);
    }
}
