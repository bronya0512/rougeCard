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

/** Enemy template. enemies[0] = normal battle, enemies[last] = boss (M1). */
export interface EnemyDef {
    readonly id: string;
    readonly hp: number;
    readonly damage: number;
}

export type FloorCount = 1 | 3 | 4 | 5;

export function isFloorCount(value: unknown): value is FloorCount {
    return value === 1 || value === 3 || value === 4 || value === 5;
}

/** All tunables are configuration. One floor is reserved for legacy saves/tests. */
export interface GameConfig {
    readonly seed: number;
    readonly floorCount: FloorCount;
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
    /** Number of rest nodes on the map (boss excluded). */
    readonly restNodes: number;
    readonly cardDefs: readonly CardDef[];
    readonly startingDeck: readonly string[];
    /** enemies[0] = normal battle enemy; enemies[last] = boss. */
    readonly enemies: readonly EnemyDef[];
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
    readonly floor: number;
    /** Completed floors only; the active floor lives exclusively in map. */
    readonly completedMaps: readonly GameMap[];
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
