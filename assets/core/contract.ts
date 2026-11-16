// Core contracts (types only). Implementation lands in T104.
// The single entry point is advance(state, input, ctx) -> { state, snapshot }.
import type { CoreContext, GameConfig, GameState } from './state';
import type { GameInput } from './input';
import type { Snapshot } from './snapshot';

/** Result of a deterministic step. */
export interface AdvanceResult {
    readonly state: GameState;
    readonly snapshot: Snapshot;
}

/**
 * Pure step function. Must be deterministic given (state, input, ctx).
 * Rejected inputs leave state unchanged and report a reason in the snapshot.
 */
export type Advance = (
    state: GameState,
    input: GameInput,
    ctx: CoreContext,
) => AdvanceResult;

/** Create the initial state from config (FR-1). */
export type InitGame = (config: GameConfig, ctx: CoreContext) => AdvanceResult;

/** Build a render snapshot from state (pure). */
export type BuildSnapshot = (state: GameState) => Snapshot;
