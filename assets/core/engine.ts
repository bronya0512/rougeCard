// Core deterministic engine (FR-1~4, FR-9~17). Pure TypeScript, no engine or
// platform imports. All state transitions are pure and produce a new state;
// all randomness/time come from the injected CoreContext (constitution §4).
import type { Advance, BuildSnapshot, InitGame } from './contract';
import { generateMap, hexDistance } from './map';
import type { CoreContext, EnemyDef, GameConfig, GameState } from './state';
import type { GameInput } from './input';
import type { Snapshot } from './snapshot';
import type {
    CardDef,
    CardInstance,
    Character,
    Enemy,
    EnergyPool,
    HexCoord,
    MapNode,
} from './types';

type MutableEnergy = { red: number; green: number; blue: number; white: number };

const zeroEnergy = (): MutableEnergy => ({ red: 0, green: 0, blue: 0, white: 0 });

function cloneEnergy(e: EnergyPool): MutableEnergy {
    return { red: e.red, green: e.green, blue: e.blue, white: e.white };
}

function defById(config: GameConfig, id: string): CardDef {
    const def = config.cardDefs.find((d) => d.id === id);
    if (def === undefined) throw new Error(`unknown card def: ${id}`);
    return def;
}

/** Can the current energy pay a card's cost? Same color first, white fills gap. */
export function canPay(energy: EnergyPool, def: CardDef): boolean {
    const own = energy[def.color];
    if (own >= def.cost) return true;
    return own + energy.white >= def.cost;
}

/** Build a render snapshot from state (pure). */
export const buildSnapshot: BuildSnapshot = (state: GameState): Snapshot => {
    const hand = state.deck.hand.map((card) => {
        const def = defById(state.config, card.defId);
        return { uid: card.uid, def, playable: canPay(state.energy, def) };
    });
    return {
        version: 1,
        phase: state.phase,
        revision: state.revision,
        map: {
            radius: state.map.radius,
            nodes: state.map.nodes,
            position: state.position,
            boss: state.map.boss,
        },
        party: state.party.map((c) => ({
            id: c.id,
            color: c.color,
            hp: c.hp,
            maxHp: c.maxHp,
            block: c.block,
            alive: c.alive,
        })),
        energy: cloneEnergy(state.energy),
        hand,
        drawCount: state.deck.drawPile.length,
        discardCount: state.deck.discardPile.length,
        enemy: state.battle === null ? null : { ...state.battle.enemy },
        turn: state.battle === null ? 0 : state.battle.turn,
        rewardCandidates: state.rewardCandidates.map((id) => defById(state.config, id)),
        lastRejection: null,
    };
};

/** Wrap a new state into a successful AdvanceResult. */
function ok(state: GameState): { state: GameState; snapshot: Snapshot } {
    return { state, snapshot: buildSnapshot(state) };
}

/** Reject an input: state reference and revision are unchanged. */
function reject(state: GameState, reason: string): { state: GameState; snapshot: Snapshot } {
    const snapshot = buildSnapshot(state);
    return {
        state,
        snapshot: { ...snapshot, lastRejection: reason },
    };
}

/** Advance to a new revision with the given partial changes. */
function commit(state: GameState, changes: Partial<GameState>): GameState {
    return { ...state, ...changes, revision: state.revision + 1 };
}

/** Draw `count` cards, reshuffling the discard pile when the draw pile empties. */
function drawCards(
    state: GameState,
    count: number,
    ctx: CoreContext,
): Pick<GameState, 'deck'> {
    let drawPile = state.deck.drawPile.slice();
    let discardPile = state.deck.discardPile.slice();
    const hand = state.deck.hand.slice();
    for (let i = 0; i < count; i += 1) {
        if (drawPile.length === 0) {
            if (discardPile.length === 0) break;
            // shuffle discard back using injected rng
            for (let j = discardPile.length - 1; j > 0; j -= 1) {
                const k = ctx.rng.int(j + 1);
                const tmp = discardPile[j]!;
                discardPile[j] = discardPile[k]!;
                discardPile[k] = tmp;
            }
            drawPile = discardPile;
            discardPile = [];
        }
        hand.push(drawPile.shift()!);
    }
    return {
        deck: {
            drawPile,
            hand,
            discardPile,
            exhaustPile: state.deck.exhaustPile,
        },
    };
}

function energyFromParty(party: readonly Character[], config: GameConfig): EnergyPool {
    const e = zeroEnergy();
    for (const c of party) {
        if (c.alive) e[c.color] += config.energyPerTurn;
    }
    return e;
}

function makeEnemy(def: EnemyDef): Enemy {
    return {
        id: def.id,
        hp: def.hp,
        maxHp: def.hp,
        intent: { kind: 'attack', damage: def.damage },
    };
}

/** Create the initial state from seed + config (FR-1 / FR-8). */
export const initGame: InitGame = (config: GameConfig, ctx: CoreContext) => {
    const map = generateMap(config, ctx.rng);
    const party: Character[] = [
        { id: 'hero-red', color: 'red', hp: config.startHp, maxHp: config.startHp, block: 0, alive: true },
        { id: 'hero-blue', color: 'blue', hp: config.startHp, maxHp: config.startHp, block: 0, alive: true },
    ];
    const instances: CardInstance[] = config.startingDeck.map((defId, i) => ({
        uid: `card-${i}`,
        defId,
    }));
    // shuffle starting deck into draw pile
    for (let i = instances.length - 1; i > 0; i -= 1) {
        const j = ctx.rng.int(i + 1);
        const tmp = instances[i]!;
        instances[i] = instances[j]!;
        instances[j] = tmp;
    }
    const state: GameState = {
        version: 1,
        config,
        phase: 'map',
        map,
        position: map.start,
        party,
        energy: zeroEnergy(),
        deck: { drawPile: instances, hand: [], discardPile: [], exhaustPile: [] },
        battle: null,
        rewardCandidates: [],
        revision: 0,
    };
    return ok(state);
};

/** Enter a battle at a node, opening the first player turn (FR-10/12/14). */
function enterBattle(state: GameState, enemyDef: EnemyDef, ctx: CoreContext): GameState {
    const battleState = {
        enemy: makeEnemy(enemyDef),
        turn: 1,
    };
    const energy = energyFromParty(state.party, state.config);
    // leftovers from a previous battle go to discard before drawing (AC-11)
    const carryDeck = {
        ...state.deck,
        discardPile: [...state.deck.discardPile, ...state.deck.hand],
        hand: [] as CardInstance[],
    };
    const drawn = drawCards({ ...state, deck: carryDeck }, state.config.drawPerTurn, ctx);
    return commit(state, {
        phase: 'battle',
        battle: battleState,
        energy,
        deck: drawn.deck,
        rewardCandidates: [],
    });
}

/** All teammates dead -> defeat (FR-4). */
function isWipe(party: readonly Character[]): boolean {
    return party.every((c) => !c.alive);
}

function applyDamage(target: Character, damage: number): Character {
    const absorbed = Math.min(target.block, damage);
    const hpLoss = damage - absorbed;
    const hp = Math.max(0, target.hp - hpLoss);
    return { ...target, block: target.block - absorbed, hp, alive: hp > 0 };
}

/** Leftmost living character takes the enemy attack (FR-14). */
function enemyAct(state: GameState): GameState {
    const battle = state.battle!;
    if (battle.enemy.intent.kind !== 'attack') return state;
    const idx = state.party.findIndex((c) => c.alive);
    if (idx < 0) return state;
    const party = state.party.slice();
    party[idx] = applyDamage(party[idx]!, battle.enemy.intent.damage);
    return { ...state, party };
}

/** Begin a new player turn after the enemy acted (FR-10/12: clear energy, draw). */
function beginPlayerTurn(state: GameState, ctx: CoreContext): GameState {
    const battle = state.battle!;
    const energy = energyFromParty(state.party, state.config);
    // clear block at the start of the player's turn (FR-15)
    const party = state.party.map((c) => ({ ...c, block: 0 }));
    const drawn = drawCards({ ...state, party, deck: { ...state.deck, hand: [], discardPile: state.deck.discardPile } }, state.config.drawPerTurn, ctx);
    return {
        ...state,
        party,
        energy,
        deck: drawn.deck,
        battle: { ...battle, turn: battle.turn + 1 },
    };
}

function neighbor(a: HexCoord, b: HexCoord): boolean {
    return hexDistance(a, b) === 1;
}

function nodeAt(state: GameState, coord: HexCoord): MapNode | undefined {
    return state.map.nodes.find((n) => n.coord.q === coord.q && n.coord.r === coord.r);
}

function markVisited(state: GameState, coord: HexCoord): GameState {
    const nodes = state.map.nodes.map((n) =>
        n.coord.q === coord.q && n.coord.r === coord.r ? { ...n, visited: true } : n,
    );
    return { ...state, map: { ...state.map, nodes } };
}

/** Three candidates drawn from red/blue card pools with injected rng (FR-17). */
function rollRewards(state: GameState, ctx: CoreContext): string[] {
    const pool = state.config.cardDefs.filter((d) => d.color === 'red' || d.color === 'blue');
    const picks: string[] = [];
    const copy = pool.slice();
    for (let i = 0; i < state.config.rewardCount && copy.length > 0; i += 1) {
        const idx = ctx.rng.int(copy.length);
        picks.push(copy[idx]!.id);
        copy.splice(idx, 1);
    }
    return picks;
}

/** The single deterministic step function. */
export const advance: Advance = (state: GameState, input: GameInput, ctx: CoreContext) => {
    // FR-4: settled states are frozen; every further input is rejected.
    if (state.phase === 'victory' || state.phase === 'defeat') {
        return reject(state, 'game already settled');
    }

    switch (input.type) {
        case 'start':
            // A fresh run is created by initGame; start is a no-op acknowledgement.
            return ok(state);

        case 'move': {
            if (state.phase !== 'map') return reject(state, 'cannot move outside map phase');
            const target = nodeAt(state, input.to);
            if (target === undefined) return reject(state, 'target cell does not exist');
            if (!neighbor(state.position, input.to)) return reject(state, 'target is not adjacent');
            let next = markVisited(state, input.to);
            next = commit(next, { position: input.to });
            if (!target.visited && target.kind === 'battle') {
                const enemy = state.config.enemies[0]!;
                return ok(enterBattle(next, enemy, ctx));
            }
            if (!target.visited && target.kind === 'boss') {
                const enemy = state.config.enemies[state.config.enemies.length - 1]!;
                return ok(enterBattle(next, enemy, ctx));
            }
            if (!target.visited && target.kind === 'rest') {
                // FR-16: revive all fallen teammates and heal by config.
                const party = state.party.map((c) => ({
                    ...c,
                    alive: true,
                    hp: Math.min(c.maxHp, c.hp + state.config.restHeal),
                }));
                return ok(commit(next, { party }));
            }
            return ok(next);
        }

        case 'playCard': {
            if (state.phase !== 'battle') return reject(state, 'cannot play card outside battle');
            const card = state.deck.hand.find((c) => c.uid === input.uid);
            if (card === undefined) return reject(state, 'card not in hand');
            const def = defById(state.config, card.defId);
            if (!canPay(state.energy, def)) return reject(state, 'insufficient energy');

            const effect = def.effect;
            if (effect.kind === 'defend') {
                const target = state.party.find((c) => c.id === input.targetId && c.alive);
                if (target === undefined) return reject(state, 'defend target is not a living teammate');
            }

            // pay cost: same color first, white fills the gap (FR-11)
            const energy = cloneEnergy(state.energy);
            const own = energy[def.color];
            const fromOwn = Math.min(own, def.cost);
            energy[def.color] -= fromOwn;
            energy.white -= def.cost - fromOwn;

            const deck: GameState['deck'] = {
                drawPile: state.deck.drawPile,
                hand: state.deck.hand.filter((c) => c.uid !== input.uid),
                discardPile: [...state.deck.discardPile, card],
                exhaustPile: state.deck.exhaustPile,
            };

            if (effect.kind === 'defend') {
                const party = state.party.map((c) =>
                    c.id === input.targetId ? { ...c, block: c.block + effect.block } : c,
                );
                return ok(commit(state, { energy, deck, party }));
            }

            // attack: reduce enemy hp, then resolve battle outcome (FR-13/FR-4)
            const enemy: Enemy = {
                ...state.battle!.enemy,
                hp: Math.max(0, state.battle!.enemy.hp - effect.damage),
            };
            if (enemy.hp === 0) {
                const isBoss = enemy.id === state.config.enemies[state.config.enemies.length - 1]!.id;
                if (isBoss) {
                    return ok(commit(state, { energy, deck, phase: 'victory', battle: null, rewardCandidates: [] }));
                }
                const rewards = rollRewards(state, ctx);
                return ok(commit(state, { energy, deck, phase: 'reward', battle: null, rewardCandidates: rewards }));
            }
            return ok(commit(state, { energy, deck, battle: { ...state.battle!, enemy } }));
        }

        case 'endTurn': {
            if (state.phase !== 'battle') return reject(state, 'cannot end turn outside battle');
            // discard hand and clear energy
            const discardPile = [...state.deck.discardPile, ...state.deck.hand];
            const afterDiscard: GameState = {
                ...state,
                energy: zeroEnergy(),
                deck: { ...state.deck, hand: [], discardPile },
            };
            const damaged = enemyAct(afterDiscard);
            if (isWipe(damaged.party)) {
                return ok(commit(damaged, { phase: 'defeat', battle: null, rewardCandidates: [] }));
            }
            const next = beginPlayerTurn(damaged, ctx);
            return ok(commit(next, {}));
        }

        case 'chooseReward': {
            if (state.phase !== 'reward') return reject(state, 'no reward to choose');
            if (!state.rewardCandidates.includes(input.defId)) {
                return reject(state, 'card is not a reward candidate');
            }
            const newCard: CardInstance = {
                uid: `card-r-${state.revision}-${input.defId}`,
                defId: input.defId,
            };
            const deck: GameState['deck'] = {
                ...state.deck,
                discardPile: [...state.deck.discardPile, newCard],
            };
            return ok(commit(state, {
                phase: 'map',
                deck,
                rewardCandidates: [],
                battle: null,
            }));
        }

        default:
            return reject(state, 'unknown input');
    }
};
