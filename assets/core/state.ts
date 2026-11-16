// Core state model. Pure TypeScript, no outer-layer imports.
import type {
    CardDef,
    CardInstance,
    Character,
    EnergyPool,
    Enemy,
    GameMap,
    HexCoord,
    Phase,
} from './types';

/** Deterministic time source injected via ctx (constitution section 4). */
export interface Clock {
    /** Monotonic tick count; core must not read Date.now() directly. */
    now(): number;
}

/** Deterministic RNG injected via ctx (constitution section 4). */
export interface Rng {
    /** Returns a float in [0, 1). */
    next(): number;
    /** Integer in [0, maxExclusive). */
    int(maxExclusive: number): number;
    /** Pick one element; caller guarantees a non-empty array. */
    pick<T>(items: readonly T[]): T;
}

/** Context passed to advance(); both dependencies are injected. */
export interface CoreContext {
    readonly clock: Clock;
    readonly rng: Rng;
}

/** All tunables are configuration (spec 1.2 / FR-8~17). */
export interface GameConfig {
    readonly seed: number;
    readonly mapRadius: number;
    readonly startHp: number;
    /** Energy produced per surviving character each player turn. */
    readonly energyPerTurn: number;
    /** Cards drawn at the start of each player turn. */
    readonly drawPerTurn: number;
    /** HP restored to each character at a rest node. */
    readonly restHeal: number;
    /** Number of candidate cards offered after a battle. */
    readonly rewardCount: number;
    readonly cardDefs: readonly CardDef[];
    readonly startingDeck: readonly string[];
    readonly enemies: readonly { readonly id: string; readonly hp: number }[];
}

/** Cards in the various zones of the shared deck. */
export interface DeckState {
    readonly drawPile: readonly CardInstance[];
    readonly hand: readonly CardInstance[];
    readonly discardPile: readonly CardInstance[];
    readonly exhaustPile: readonly CardInstance[];
}

/** State local to the current battle; reset when a battle starts. */
export interface BattleState {
    readonly enemy: Enemy;
    readonly turn: number;
}

/** The complete mutable game state produced by core. */
export interface GameState {
    readonly version: 1;
    readonly config: GameConfig;
    readonly phase: Phase;
    readonly map: GameMap;
    readonly position: HexCoord;
    readonly party: readonly Character[];
    readonly energy: EnergyPool;
    readonly deck: DeckState;
    readonly battle: BattleState | null;
    /** Reward candidates offered in the reward phase. */
    readonly rewardCandidates: readonly string[];
    /** Increments on every accepted input; part of deterministic identity. */
    readonly revision: number;
}
