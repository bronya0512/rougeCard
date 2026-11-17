// @ts-ignore
import { test } from 'node:test';
// @ts-ignore
import * as assert from 'node:assert/strict';
import {
    advance, buildSnapshot, createFixedClock, createSeededRng, decodeSaveData,
    hexDistance, initGame, isSaveData, SAVE_SCHEMA_VERSION,
} from '../../assets/core';
import type { CoreContext, FloorCount, GameConfig, GameState, SaveData, StoragePort } from '../../assets/core';
import { GameSession, SAVE_KEY } from '../../assets/game/GameSession';

function config(floorCount: FloorCount = 3, seed = 20261116): GameConfig {
    return {
        seed, floorCount, mapRadius: 2, startHp: 200, energyPerTurn: 1,
        drawPerTurn: 5, restHeal: 10, rewardCount: 3, restNodes: 1,
        cardDefs: [
            { id: 'red', name: 'Red Strike', color: 'red', cost: 1, effect: { kind: 'attack', damage: 4 } },
            { id: 'blue', name: 'Blue Strike', color: 'blue', cost: 1, effect: { kind: 'attack', damage: 4 } },
            { id: 'guard', name: 'Blue Guard', color: 'blue', cost: 1, effect: { kind: 'defend', block: 3 } },
        ],
        startingDeck: ['red', 'blue', 'red', 'blue', 'red', 'blue'],
        enemies: [{ id: 'normal', hp: 4, damage: 1 }, { id: 'boss', hp: 8, damage: 1 }],
    };
}

function context(seed: number): CoreContext {
    return { rng: createSeededRng(seed), clock: createFixedClock(0) };
}

function fight(session: GameSession): void {
    for (let guard = 0; session.snapshot.phase === 'battle' && guard < 80; guard += 1) {
        const s = session.snapshot;
        const card = s.hand.find(c => c.playable && c.def.effect.kind === 'attack');
        session.dispatch(card === undefined ? { type: 'endTurn' } : { type: 'playCard', uid: card.uid });
    }
    assert.notEqual(session.snapshot.phase, 'battle');
}

function bossRun(session: GameSession): void {
    const floor = session.snapshot.floor;
    for (let guard = 0; session.snapshot.floor === floor && session.snapshot.phase !== 'victory' && guard < 30; guard += 1) {
        const s = session.snapshot;
        if (s.phase === 'reward') {
            session.dispatch({ type: 'chooseReward', defId: s.rewardCandidates[0]!.id });
            continue;
        }
        if (s.phase === 'battle') { fight(session); continue; }
        if (s.phase !== 'map') throw new Error(`unexpected phase ${s.phase}`);
        const next = s.map.nodes.find(n => hexDistance(n.coord, s.map.position) === 1
            && hexDistance(n.coord, s.map.boss) < hexDistance(s.map.position, s.map.boss));
        if (next === undefined) throw new Error('boss path not found');
        session.dispatch({ type: 'move', to: next.coord });
    }
    assert.ok(session.snapshot.floor > floor || session.snapshot.phase === 'victory');
}

class MemoryStorage implements StoragePort {
    private readonly values = new Map<string, string>();
    get(key: string): string | null { return this.values.get(key) ?? null; }
    set(key: string, value: string): void { this.values.set(key, value); }
    remove(key: string): void { this.values.delete(key); }
}

function lethalState(): { state: GameState; ctx: CoreContext } {
    const c = config();
    const ctx = context(c.seed);
    const initial = initGame(c, ctx).state;
    return {
        ctx,
        state: {
            ...initial, phase: 'battle', position: initial.map.boss,
            map: { ...initial.map, nodes: initial.map.nodes.map(n => ({ ...n, visited: true })) },
            party: [
                { ...initial.party[0]!, hp: 0, alive: false, block: 0 },
                { ...initial.party[1]!, hp: 17, block: 3 },
            ],
            energy: { red: 0, blue: 1, green: 0, white: 0 },
            battle: { turn: 2, enemy: { id: 'boss', hp: 4, maxHp: 8, intent: { kind: 'attack', damage: 1 } } },
            deck: {
                drawPile: [{ uid: 'draw', defId: 'red' }],
                hand: [{ uid: 'lethal', defId: 'blue' }, { uid: 'leftover', defId: 'red' }],
                discardPile: [{ uid: 'reward-from-battle', defId: 'blue' }],
                exhaustPile: [{ uid: 'exhausted', defId: 'guard' }],
            },
        },
    };
}

for (const count of [3, 4, 5] as const) {
    test(`AC-19: ${count} floors advance only at boss and win only on final boss`, () => {
        const session = new GameSession(config(count));
        assert.equal(session.snapshot.floor, 1);
        assert.equal(session.snapshot.floorCount, count);
        for (let floor = 1; floor <= count; floor += 1) {
            const previousRevision = session.snapshot.revision;
            bossRun(session);
            const s = session.snapshot;
            assert.ok(s.revision > previousRevision);
            if (floor < count) {
                assert.equal(s.phase, 'map');
                assert.equal(s.floor, floor + 1);
                assert.deepEqual(s.map.position, { q: 0, r: 0 });
                assert.equal(s.map.nodes.filter(n => n.visited).length, 1);
                assert.deepEqual(s.rewardCandidates, []);
            } else {
                assert.equal(s.phase, 'victory');
                assert.equal(s.floor, count);
                const frozen = JSON.stringify(s);
                session.dispatch({ type: 'move', to: { q: 0, r: 0 } });
                assert.equal(JSON.stringify(session.snapshot), frozen);
            }
        }
    });
}

test('AC-20: transition retains HP/death/all card UIDs and independent archived map', () => {
    const { state, ctx } = lethalState();
    const beforeMap = JSON.stringify(state.map);
    const next = advance(state, { type: 'playCard', uid: 'lethal' }, ctx).state;
    assert.equal(next.floor, 2);
    assert.equal(next.phase, 'map');
    assert.deepEqual(next.party.map(h => ({ hp: h.hp, alive: h.alive })), state.party.map(h => ({ hp: h.hp, alive: h.alive })));
    assert.ok(next.party.every(hero => hero.block === 0));
    assert.deepEqual(next.energy, { red: 0, green: 0, blue: 0, white: 0 });
    assert.equal(next.battle, null);
    assert.deepEqual(next.deck.hand, []);
    assert.deepEqual(next.deck.discardPile.map(c => c.uid), ['reward-from-battle', 'lethal', 'leftover']);
    assert.deepEqual(next.deck.drawPile, state.deck.drawPile);
    assert.deepEqual(next.deck.exhaustPile, state.deck.exhaustPile);
    assert.deepEqual(next.completedMaps, [state.map]);
    assert.equal(JSON.stringify(state.map), beforeMap);
    assert.notEqual(next.map, state.map);
    assert.notEqual(next.map.nodes, state.map.nodes);
    assert.equal(next.map.nodes.filter(n => n.visited).length, 1);
    assert.equal(next.revision, state.revision + 1);
    const adjacent = next.map.nodes.find(n => n.kind === 'battle' && hexDistance(n.coord, next.position) === 1)!;
    const battle = advance(next, { type: 'move', to: adjacent.coord }, ctx).state;
    assert.equal(battle.party[0]!.alive, false);
    assert.equal(battle.energy.red, 0);
    assert.equal(battle.energy.blue, 1);
    assert.equal(JSON.stringify(battle.completedMaps[0]), beforeMap);
});

test('AC-21: same seed and complete five-floor input decisions produce equal snapshots', () => {
    const a = new GameSession(config(5, 77));
    const b = new GameSession(config(5, 77));
    for (let floor = 1; floor <= 5; floor += 1) {
        bossRun(a); bossRun(b);
        assert.deepEqual(a.snapshot, b.snapshot);
    }
});

test('AC-21: load before and after boss transition resumes floor, map and future RNG', () => {
    const { state, ctx } = lethalState();
    const rng = ctx.rng as ReturnType<typeof createSeededRng>;
    const save: SaveData = { schemaVersion: SAVE_SCHEMA_VERSION, savedAt: 0, state, rngState: rng.getState() };
    const storage = new MemoryStorage();
    const uninterrupted = new GameSession(state.config, { restored: save });
    storage.set(SAVE_KEY, JSON.stringify(save));
    const reloaded = GameSession.load(storage, state.config);
    uninterrupted.dispatch({ type: 'playCard', uid: 'lethal' });
    reloaded.dispatch({ type: 'playCard', uid: 'lethal' });
    assert.deepEqual(reloaded.snapshot, uninterrupted.snapshot);
    assert.equal(reloaded.snapshot.floor, 2);
    const afterLoad = GameSession.load(storage, state.config);
    assert.deepEqual(afterLoad.snapshot, reloaded.snapshot);
    bossRun(afterLoad); bossRun(uninterrupted);
    assert.deepEqual(afterLoad.snapshot, uninterrupted.snapshot);
});

test('AC-21: old schema1 map, battle and victory migrate as single-floor runs', () => {
    for (const phase of ['map', 'battle', 'victory'] as const) {
        const storage = new MemoryStorage();
        const c = config(1);
        const ctx = context(c.seed);
        let state = initGame(c, ctx).state;
        if (phase === 'battle') {
            const node = state.map.nodes.find(n => n.kind === 'battle' && hexDistance(n.coord, state.position) === 1)!;
            state = advance(state, { type: 'move', to: node.coord }, ctx).state;
        } else if (phase === 'victory') state = { ...state, phase: 'victory' };
        const legacy = JSON.parse(JSON.stringify({ schemaVersion: 1, savedAt: 100, state, rngState: 123 }));
        delete legacy.state.floor;
        delete legacy.state.completedMaps;
        delete legacy.state.config.floorCount;
        const original = JSON.stringify(legacy);
        const decoded = decodeSaveData(legacy);
        if (decoded === null) throw new Error('valid old save rejected');
        assert.equal(decoded.schemaVersion, 2);
        assert.equal(decoded.state.floor, 1);
        assert.equal(decoded.state.config.floorCount, 1);
        assert.equal(decoded.state.phase, phase);
        assert.equal(decoded.rngState, 123);
        assert.equal(JSON.stringify(legacy), original);
        storage.set(SAVE_KEY, original);
        const loaded = GameSession.load(storage, config(3));
        assert.deepEqual(loaded.snapshot, buildSnapshot(decoded.state));
        loaded.save();
        assert.equal(JSON.parse(storage.get(SAVE_KEY)!).schemaVersion, 2);
    }
});

test('AC-21: invalid floor metadata, RNG and nested state reject with safe fresh fallback', () => {
    const storage = new MemoryStorage();
    const session = new GameSession(config(), { storage });
    session.save();
    const valid = storage.get(SAVE_KEY)!;
    type Corruptible = { rngState: number; state: { floor: number; config: { floorCount: number };
        completedMaps: unknown[]; deck: unknown; map: { nodes: unknown[] } } };
    const corrupt: ((d: Corruptible) => void)[] = [
        d => { d.state.floor = 0; },
        d => { d.state.floor = 4; },
        d => { d.state.config.floorCount = 2; },
        d => { d.state.completedMaps = [{}]; },
        d => { d.rngState = -1; },
        d => { d.state.deck = {}; },
        d => { d.state.map.nodes = []; },
    ];
    for (const mutate of corrupt) {
        const d = JSON.parse(valid);
        mutate(d);
        assert.equal(isSaveData(d), false);
        storage.set(SAVE_KEY, JSON.stringify(d));
        const fallback = GameSession.load(storage, config());
        assert.equal(fallback.snapshot.floor, 1);
        assert.equal(fallback.snapshot.floorCount, 3);
        assert.equal(fallback.snapshot.revision, 0);
    }
});

test('AC-19: invalid new-run floor count is rejected before consuming RNG', () => {
    for (const count of [0, 2, 6, 3.5]) {
        const ctx = context(1);
        const rng = ctx.rng as ReturnType<typeof createSeededRng>;
        const before = rng.getState();
        assert.throws(() => initGame({ ...config(), floorCount: count as FloorCount }, ctx));
        assert.equal(rng.getState(), before);
    }
});
