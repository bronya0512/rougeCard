// Core primitive types. Pure TypeScript: no engine or platform imports.
// Constitution section 4: strict, no `any`, deterministic (Clock/Rng injected).

/** Energy / card colors. White is the universal color (pays any cost). */
export type Color = 'red' | 'green' | 'blue' | 'white';

/** Hex grid coordinate (axial q/r), local to one floor. */
export interface HexCoord {
    readonly q: number;
    readonly r: number;
}

/** Node kinds present in M1 (section 1.2): battle / rest / boss. */
export type NodeKind = 'battle' | 'rest' | 'boss';

/** A single cell on the map. Empty cells have kind null. */
export interface MapNode {
    readonly coord: HexCoord;
    readonly kind: NodeKind | null;
    readonly visited: boolean;
}

/** One floor's map, with independent nodes and a boss on its outer ring. */
export interface GameMap {
    readonly radius: number;
    readonly nodes: readonly MapNode[];
    /** Coordinate of the start node (center) and the boss node. */
    readonly start: HexCoord;
    readonly boss: HexCoord;
}

/** Per-character persistent combat state. Death persists across battles. */
export interface Character {
    readonly id: string;
    readonly color: Exclude<Color, 'white'>;
    readonly hp: number;
    readonly maxHp: number;
    readonly block: number;
    readonly alive: boolean;
}

/** Energy pool shared by the team. White is universal. */
export interface EnergyPool {
    readonly red: number;
    readonly green: number;
    readonly blue: number;
    readonly white: number;
}

/** Effect carried by a card (M1 subset; resolved in T104). */
export type CardEffect =
    | { readonly kind: 'attack'; readonly damage: number }
    | { readonly kind: 'defend'; readonly block: number };

/** A card definition. Cost is paid in the card's own color (+ white). */
export interface CardDef {
    readonly id: string;
    readonly name: string;
    readonly color: Exclude<Color, 'white'>;
    readonly cost: number;
    readonly effect: CardEffect;
}

/** A card instance in the deck (definition id + unique instance id). */
export interface CardInstance {
    readonly uid: string;
    readonly defId: string;
}

/** Enemy intent shown to the player before the enemy acts (FR-14). */
export type EnemyIntent =
    | { readonly kind: 'attack'; readonly damage: number }
    | { readonly kind: 'none' };

/** Enemy combat state. */
export interface Enemy {
    readonly id: string;
    readonly hp: number;
    readonly maxHp: number;
    readonly intent: EnemyIntent;
}

/** Where the player currently is on the map. */
export type MapPhase = 'map';
export type BattlePhase = 'battle';
export type RewardPhase = 'reward';
export type SettledPhase = 'victory' | 'defeat';

export type Phase = MapPhase | BattlePhase | RewardPhase | SettledPhase;
