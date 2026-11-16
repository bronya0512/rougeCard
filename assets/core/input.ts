// All player inputs are represented as data; game/ never mutates state directly.
// Pure TypeScript, no outer-layer imports.
import type { HexCoord } from './types';

/** Start a new run from the entry point (FR-1). */
export interface StartInput {
    readonly type: 'start';
}

/** Move to a hex cell (FR-9). Only adjacent, unvisited cells are accepted. */
export interface MoveInput {
    readonly type: 'move';
    readonly to: HexCoord;
}

/** Play a card, optionally targeting a teammate for defend (FR-11 / FR-15). */
export interface PlayCardInput {
    readonly type: 'playCard';
    /** Unique instance id of the card in hand. */
    readonly uid: string;
    /** Target character id (required for defend cards; ignored for attack). */
    readonly targetId?: string;
}

/** End the current player turn (FR-10 / FR-12). */
export interface EndTurnInput {
    readonly type: 'endTurn';
}

/** Pick one reward card (FR-17). */
export interface ChooseRewardInput {
    readonly type: 'chooseReward';
    /** Definition id of the chosen candidate. */
    readonly defId: string;
}

export type GameInput =
    | StartInput
    | MoveInput
    | PlayCardInput
    | EndTurnInput
    | ChooseRewardInput;
