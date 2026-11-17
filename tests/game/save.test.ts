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
