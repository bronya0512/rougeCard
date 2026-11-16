// Render-facing snapshot. game/ subscribes to this and renders only.
// Pure TypeScript, no outer-layer imports. Flat and fully serializable so the
// three platforms can compare snapshots field-by-field (AC-1).
import type {
    CardDef,
    CardInstance,
    Color,
    EnemyIntent,
    HexCoord,
    MapNode,
    NodeKind,
    Phase,
} from './types';

export interface CharacterView {
    readonly id: string;
    readonly color: Exclude<Color, 'white'>;
    readonly hp: number;
    readonly maxHp: number;
    readonly block: number;
    readonly alive: boolean;
}

export interface EnergyView {
    readonly red: number;
    readonly green: number;
    readonly blue: number;
    readonly white: number;
}

export interface EnemyView {
    readonly id: string;
    readonly hp: number;
    readonly maxHp: number;
    readonly intent: EnemyIntent;
}

export interface HandCardView {
    readonly uid: string;
    readonly def: CardDef;
    /** Whether the current energy can pay this card. */
    readonly playable: boolean;
}

export interface MapView {
    readonly radius: number;
    readonly nodes: readonly MapNode[];
    readonly position: HexCoord;
    readonly boss: HexCoord;
}

/** A complete, immutable view of the game for rendering and verification. */
export interface Snapshot {
    readonly version: 1;
    readonly phase: Phase;
    readonly revision: number;
    readonly map: MapView;
    readonly party: readonly CharacterView[];
    readonly energy: EnergyView;
    readonly hand: readonly HandCardView[];
    readonly drawCount: number;
    readonly discardCount: number;
    readonly enemy: EnemyView | null;
    readonly turn: number;
    readonly rewardCandidates: readonly CardDef[];
    /** Human-readable reason the last input was rejected, if any. */
    readonly lastRejection: string | null;
}
