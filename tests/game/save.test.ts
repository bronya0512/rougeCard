// Save/load tests (T107): AC-3 round-trip identity, RNG-state resume
// determinism, corrupt-save fallback, and no-write on rejected input.
// Pure TS (GameSession has no `cc` import); compiled by Cocos tsc then node --test.
// @ts-ignore - Node builtin types are not in the Cocos toolchain; runtime only.
import { test } from 'node:test';
// @ts-ignore - see above
import * as assert from 'node:assert/strict';
import {
    hexDistance,
    SAVE_SCHEMA_VERSION,
    isSaveData,
    type GameConfig,
    type StoragePort,
} from '../../assets/core/index';
import { GameSession, SAVE_KEY } from '../../assets/game/GameSession';

class MemoryStorage implements StoragePort {
    readonly data = new Map<string, string>();
    writes = 0;
    get(key: string): string | null {
        return this.data.has(key) ? this.data.get(key)! : null;
    }
    set(key: string, value: string): void {
        this.writes += 1;
        this.data.set(key, value);
    }
    remove(key: string): void {
        this.data.delete(key);
    }
}

const CARDS = {
    redAtk: { id: 'red-atk', name: 'Red Strike', color: 'red' as const, cost: 1, effect: { kind: 'attack' as const, damage: 4 } },
    blueAtk: { id: 'blue-atk', name: 'Blue Strike', color: 'blue' as const, cost: 1, effect: { kind: 'attack' as const, damage: 4 } },
    redDef: { id: 'red-def', name: 'Red Guard', color: 'red' as const, cost: 1, effect: { kind: 'defend' as const, block: 3 } },
    blueDef: { id: 'blue-def', name: 'Blue Guard', color: 'blue' as const, cost: 1, effect: { kind: 'defend' as const, block: 3 } },
};

function makeConfig(seed = 20261116): GameConfig {
    return {
        seed,
        floorCount: 1,
        mapRadius: 2,
        startHp: 30,
        energyPerTurn: 1,
        drawPerTurn: 5,
        restHeal: 10,
        rewardCount: 3,
        restNodes: 1,
        cardDefs: Object.values(CARDS),
        startingDeck: ['red-atk', 'blue-atk', 'red-def', 'blue-def', 'red-atk', 'blue-atk'],
        enemies: [
            { id: 'normal', hp: 12, damage: 3 },
            { id: 'boss', hp: 24, damage: 5 },
        ],
    };
}

/** Advance a fresh session by one legal move to an adjacent battle node. */
function enterFirstBattle(s: GameSession): void {
    const snap = s.snapshot;
    const neighbor = snap.map.nodes.find(
        (n) => n.kind === 'battle' && hexDistance(n.coord, snap.map.position) === 1,
    );
    if (neighbor === undefined) throw new Error('no adjacent battle cell in generated map');
    s.dispatch({ type: 'move', to: neighbor.coord });
}

// ---- isSaveData guard (Q-3 structural validation) ----
test('Q-3: isSaveData validates schema/version/rngState and rejects malformed values', () => {
    const storage = new MemoryStorage();
    const session = new GameSession(makeConfig(), { storage, now: () => 100 });
    session.save();
    const raw = storage.get(SAVE_KEY)!;
    const parsed: unknown = JSON.parse(raw);
    assert.equal(isSaveData(parsed), true);
    assert.equal((parsed as { schemaVersion: number }).schemaVersion, SAVE_SCHEMA_VERSION);
    assert.equal(isSaveData(null), false);
    assert.equal(isSaveData({}), false);
    const bad = JSON.parse(raw) as Record<string, unknown>;
    bad['rngState'] = 'oops';
    assert.equal(isSaveData(bad), false);
    const badVer = JSON.parse(raw) as Record<string, unknown>;
    badVer['schemaVersion'] = 99;
    assert.equal(isSaveData(badVer), false);
});

// ---- AC-3: read-back equals last save ----
test('AC-3: reloaded session snapshot equals the state at last save', () => {
    const storage = new MemoryStorage();
    const session = new GameSession(makeConfig(), { storage, now: () => 100 });
    enterFirstBattle(session);
    // play a card or end turn to mutate battle state further
    session.dispatch({ type: 'endTurn' });
    const before = session.snapshot;

    const reloaded = GameSession.load(storage, makeConfig());
    assert.deepEqual(reloaded.snapshot, before);
    assert.equal(reloaded.snapshot.revision, before.revision);
});

// ---- RNG-state resume: save/load mid-run keeps the same future sequence ----
test('FR-5/AC-1: save+load mid-run yields identical future snapshots', () => {
    const config = makeConfig(7);
    // A: uninterrupted run
    const a = new GameSession(config);
    enterFirstBattle(a);
    a.dispatch({ type: 'endTurn' });
    a.dispatch({ type: 'endTurn' });
    const snapshotA = a.snapshot;

    // B: same seed, save+load between the two endTurns
    const storage = new MemoryStorage();
    const b = new GameSession(config, { storage, now: () => 100 });
    enterFirstBattle(b);
    b.save();
    const reloaded = GameSession.load(storage, config);
    reloaded.dispatch({ type: 'endTurn' });
    reloaded.dispatch({ type: 'endTurn' });

    assert.deepEqual(reloaded.snapshot, snapshotA);
});

// ---- Corrupt save falls back to a fresh game ----
test('T107: corrupt / version-mismatched save falls back to a fresh session', () => {
    const storage = new MemoryStorage();
    storage.set(SAVE_KEY, '{not json');
    let s = GameSession.load(storage, makeConfig());
    assert.equal(s.snapshot.phase, 'map');
    assert.equal(s.snapshot.revision, 0);

    storage.set(SAVE_KEY, JSON.stringify({ schemaVersion: 99, savedAt: 0, rngState: 1, state: {} }));
    s = GameSession.load(storage, makeConfig());
    assert.equal(s.snapshot.phase, 'map');
    assert.equal(storage.get(SAVE_KEY), null); // invalid save removed
});

// ---- Rejected input does not write a save ----
test('T107: rejected input leaves the save untouched', () => {
    const storage = new MemoryStorage();
    const s = new GameSession(makeConfig(), { storage, now: () => 100 });
    s.save();
    const writesBefore = storage.writes;
    // illegal move: non-adjacent / out-of-range target
    s.dispatch({ type: 'move', to: { q: 99, r: 99 } });
    assert.equal(storage.writes, writesBefore);
    assert.equal(s.snapshot.revision, 0);
});

test('T113/AC-8: rejected battle moves preserve the session, save bytes, writes and RNG', () => {
    const storage = new MemoryStorage();
    const config = makeConfig(2);
    const session = new GameSession(config, { storage, now: () => 100 });
    const origin = session.snapshot.map.position;
    enterFirstBattle(session);
    const before = session.snapshot;
    const saved = storage.get(SAVE_KEY);
    const writes = storage.writes;
    const data = GameSession.readSave(storage)!;
    for (const target of [origin, before.map.position, { q: 99, r: 99 }]) {
        const rejected = session.dispatch({ type: 'move', to: target });
        assert.ok(rejected.lastRejection !== null);
        assert.deepEqual({ ...rejected, lastRejection: null }, before);
        assert.deepEqual(session.snapshot, before);
        assert.equal(session.snapshot.revision, before.revision);
        assert.equal(storage.get(SAVE_KEY), saved);
        assert.equal(storage.writes, writes);
    }
    const resumed = GameSession.load(storage, config, () => 100);
    assert.deepEqual(session.dispatch({ type: 'endTurn' }), resumed.dispatch({ type: 'endTurn' }));
    assert.notEqual(GameSession.readSave(storage)!.rngState, data.rngState);
});

test('T113/AC-8: completed battle visits remain event-free after reload and save only movement', () => {
    const storage = new MemoryStorage();
    const base = makeConfig(2);
    const config: GameConfig = { ...base, enemies: [{ ...base.enemies[0]!, hp: 4 }, base.enemies[1]!] };
    let session = new GameSession(config, { storage, now: () => 100 });
    const origin = session.snapshot.map.position;
    enterFirstBattle(session);
    const target = session.snapshot.map.position;
    for (let turn = 0; session.snapshot.phase === 'battle' && turn < 10; turn += 1) {
        const card = session.snapshot.hand.find(c => c.playable && c.def.effect.kind === 'attack');
        session.dispatch(card === undefined ? { type: 'endTurn' } : { type: 'playCard', uid: card.uid });
    }
    assert.equal(session.snapshot.phase, 'reward');
    session.dispatch({ type: 'chooseReward', defId: session.snapshot.rewardCandidates[0]!.id });
    assert.equal(session.snapshot.phase, 'map');
    const completed = GameSession.readSave(storage)!;
    const deck = JSON.stringify(completed.state.deck);
    assert.equal([...completed.state.deck.drawPile, ...completed.state.deck.hand, ...completed.state.deck.discardPile,
        ...completed.state.deck.exhaustPile].length, config.startingDeck.length + 1);
    assert.equal(completed.state.map.nodes.find(n => n.coord.q === target.q && n.coord.r === target.r)!.visited, true);
    for (let visit = 0; visit < 3; visit += 1) {
        for (const to of [origin, target]) {
            const before = session.snapshot;
            const writes = storage.writes;
            session = GameSession.load(storage, config, () => 100);
            assert.deepEqual(session.snapshot, before);
            assert.equal(storage.writes, writes);
            const moved = session.dispatch({ type: 'move', to });
            assert.equal(moved.lastRejection, null);
            assert.equal(moved.phase, 'map');
            assert.equal(moved.enemy, null);
            assert.deepEqual(moved.rewardCandidates, []);
            assert.deepEqual(moved.party, before.party);
            assert.deepEqual(moved.map.position, to);
            assert.equal(moved.revision, before.revision + 1);
            assert.equal(storage.writes, writes + 1);
            const saved = GameSession.readSave(storage)!;
            assert.equal(saved.state.revision, moved.revision);
            assert.deepEqual(saved.state.position, to);
            assert.equal(JSON.stringify(saved.state.deck), deck);
            assert.equal(saved.rngState, completed.rngState);
        }
    }
});

test('T113/AC-8: used rest visits preserve injured HP and deck across reload without healing again', () => {
    const storage = new MemoryStorage();
    const config = makeConfig(1);
    const initial = new GameSession(config, { storage, now: () => 100 });
    initial.save();
    const data = GameSession.readSave(storage)!;
    const injured = { ...data, state: { ...data.state,
        party: data.state.party.map((hero, i) => ({ ...hero, hp: i === 0 ? 7 : 12 })) } };
    assert.equal(isSaveData(injured), true);
    let session = new GameSession(config, { storage, now: () => 100, restored: injured });
    const origin = session.snapshot.map.position;
    const rest = session.snapshot.map.nodes.find(n => n.kind === 'rest' && hexDistance(n.coord, origin) === 1)!;
    const first = session.dispatch({ type: 'move', to: rest.coord });
    assert.equal(first.lastRejection, null);
    assert.deepEqual(first.party.map(hero => hero.hp), [17, 22]);
    const used = GameSession.readSave(storage)!;
    const deck = JSON.stringify(used.state.deck);
    assert.equal(used.state.map.nodes.find(n => n.coord.q === rest.coord.q && n.coord.r === rest.coord.r)!.visited, true);
    for (let visit = 0; visit < 3; visit += 1) {
        for (const to of [origin, rest.coord]) {
            const before = session.snapshot;
            const writes = storage.writes;
            session = GameSession.load(storage, config, () => 100);
            assert.deepEqual(session.snapshot, before);
            assert.equal(storage.writes, writes);
            const moved = session.dispatch({ type: 'move', to });
            assert.equal(moved.lastRejection, null);
            assert.equal(moved.phase, 'map');
            assert.equal(moved.enemy, null);
            assert.deepEqual(moved.rewardCandidates, []);
            assert.deepEqual(moved.party, first.party);
            assert.deepEqual(moved.map.position, to);
            assert.equal(moved.revision, before.revision + 1);
            assert.equal(storage.writes, writes + 1);
            const saved = GameSession.readSave(storage)!;
            assert.equal(saved.state.revision, moved.revision);
            assert.deepEqual(saved.state.position, to);
            assert.equal(JSON.stringify(saved.state.deck), deck);
            assert.equal(saved.rngState, used.rngState);
        }
    }
});
