import { isFloorCount } from './state';
import { isStartingParty } from './team';
import type { CardDef } from './types';
import type { GameState } from './state';
import { hexDistance } from './map';

export const SAVE_SCHEMA_VERSION = 2 as const;

export interface SaveData {
    readonly schemaVersion: typeof SAVE_SCHEMA_VERSION;
    readonly savedAt: number;
    readonly state: GameState;
    readonly rngState: number;
}

function object(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonnegative(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function integer(value: unknown): value is number {
    return nonnegative(value) && Number.isInteger(value);
}

function coord(value: unknown): value is { q: number; r: number } {
    return object(value) && typeof value.q === 'number' && Number.isInteger(value.q)
        && typeof value.r === 'number' && Number.isInteger(value.r);
}

function map(value: unknown, radius: number): boolean {
    if (!object(value) || value.radius !== radius || !coord(value.start) || !coord(value.boss)
        || value.start.q !== 0 || value.start.r !== 0 || hexDistance(value.start, value.boss) !== radius
        || !Array.isArray(value.nodes) || value.nodes.length !== 1 + 3 * radius * (radius + 1)) return false;
    const seen = new Set<string>();
    for (const node of value.nodes) {
        if (!object(node) || !coord(node.coord) || typeof node.visited !== 'boolean'
            || ![null, 'battle', 'rest', 'boss'].some(kind => kind === node.kind)
            || hexDistance(node.coord, value.start) > radius) return false;
        const key = `${node.coord.q},${node.coord.r}`;
        if (seen.has(key)) return false;
        seen.add(key);
    }
    const start = value.nodes.find(node => node.coord.q === 0 && node.coord.r === 0);
    const bosses = value.nodes.filter(node => node.kind === 'boss');
    return start?.kind === null && start.visited === true && bosses.length === 1
        && bosses[0].coord.q === value.boss.q && bosses[0].coord.r === value.boss.r;
}

function validState(value: unknown): value is GameState {
    if (!object(value) || value.version !== 1 || !integer(value.revision)
        || !object(value.config) || !isFloorCount(value.config.floorCount)
        || !integer(value.floor) || value.floor < 1 || value.floor > value.config.floorCount
        || !Array.isArray(value.completedMaps) || value.completedMaps.length !== value.floor - 1) return false;
    const config = value.config;
    if (typeof config.seed !== 'number' || !Number.isFinite(config.seed)
        || !integer(config.mapRadius) || config.mapRadius < 1
        || !nonnegative(config.startHp) || config.startHp === 0
        || !integer(config.energyPerTurn) || !integer(config.drawPerTurn)
        || !nonnegative(config.restHeal) || !integer(config.rewardCount) || !integer(config.restNodes)
        || !Array.isArray(config.cardDefs) || !Array.isArray(config.startingDeck)
        || !Array.isArray(config.enemies) || config.enemies.length === 0) return false;
    const defs = new Set<string>();
    for (const card of config.cardDefs) {
        if (!object(card) || typeof card.id !== 'string' || defs.has(card.id) || typeof card.name !== 'string'
            || !['red', 'green', 'blue', 'white'].some(color => color === card.color)
            || !nonnegative(card.cost) || !object(card.effect)) return false;
        if (card.effect.kind === 'attack' ? !nonnegative(card.effect.damage)
            : card.effect.kind !== 'defend' || !nonnegative(card.effect.block)) return false;
        defs.add(card.id);
    }
    if (!config.startingDeck.every(id => typeof id === 'string' && defs.has(id))
        || !config.enemies.every(enemy => object(enemy) && typeof enemy.id === 'string'
            && nonnegative(enemy.hp) && enemy.hp > 0 && nonnegative(enemy.damage))) return false;
    const radius = config.mapRadius;
    if (!map(value.map, radius) || !value.completedMaps.every(item => map(item, radius))
        || !coord(value.position) || hexDistance(value.position, { q: 0, r: 0 }) > radius) return false;
    if (!Array.isArray(value.party) || value.party.length === 0 || !value.party.every(hero => object(hero)
        && typeof hero.id === 'string' && ['red', 'green', 'blue'].some(color => color === hero.color)
        && nonnegative(hero.hp) && nonnegative(hero.maxHp) && hero.hp <= hero.maxHp
        && nonnegative(hero.block) && hero.alive === (hero.hp > 0))) return false;
    if (config.startingParty !== undefined) {
        if (!isStartingParty(config.startingParty, { cardDefs: config.cardDefs as CardDef[], startingDeck: config.startingDeck as string[] })) return false;
        const party = value.party;
        if (config.startingParty.length !== party.length
            || !config.startingParty.every((hero, i) => hero.id === party[i].id && hero.color === party[i].color)) return false;
    }
    const energy = value.energy;
    if (!object(energy) || !['red', 'green', 'blue', 'white'].every(color => nonnegative(energy[color]))
        || !object(value.deck) || !Array.isArray(value.rewardCandidates)
        || !value.rewardCandidates.every(id => typeof id === 'string' && defs.has(id))) return false;
    const uids = new Set<string>();
    for (const zone of ['drawPile', 'hand', 'discardPile', 'exhaustPile']) {
        const cards = value.deck[zone];
        if (!Array.isArray(cards)) return false;
        for (const card of cards) {
            if (!object(card) || typeof card.uid !== 'string' || uids.has(card.uid)
                || typeof card.defId !== 'string' || !defs.has(card.defId)) return false;
            uids.add(card.uid);
        }
    }
    if (!['map', 'battle', 'reward', 'victory', 'defeat'].some(phase => phase === value.phase)
        || (value.phase === 'victory' && value.floor !== config.floorCount)) return false;
    if (value.phase !== 'battle') return value.battle === null;
    if (!object(value.battle) || !integer(value.battle.turn) || value.battle.turn < 1
        || !object(value.battle.enemy)) return false;
    const enemy = value.battle.enemy;
    return typeof enemy.id === 'string' && nonnegative(enemy.hp) && enemy.hp > 0
        && nonnegative(enemy.maxHp) && enemy.hp <= enemy.maxHp && object(enemy.intent)
        && (enemy.intent.kind === 'attack' ? nonnegative(enemy.intent.damage) : enemy.intent.kind === 'none');
}

export function isSaveData(value: unknown): value is SaveData {
    return object(value) && value.schemaVersion === SAVE_SCHEMA_VERSION
        && nonnegative(value.savedAt) && integer(value.rngState) && value.rngState <= 0xffffffff
        && validState(value.state);
}

export function decodeSaveData(value: unknown): SaveData | null {
    if (isSaveData(value)) return value;
    if (!object(value) || value.schemaVersion !== 1 || !object(value.state)
        || !object(value.state.config) || value.state.floor !== undefined
        || value.state.config.floorCount !== undefined) return null;
    const migrated = {
        ...value,
        schemaVersion: SAVE_SCHEMA_VERSION,
        state: { ...value.state, config: { ...value.state.config, floorCount: 1 }, floor: 1, completedMaps: [] },
    };
    return isSaveData(migrated) ? migrated : null;
}
