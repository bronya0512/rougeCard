// First core test: initial-state contract (FR-1) + save schema guard (FR-5).
// Framework: Node built-in test runner (node:test + node:assert), no npm deps.
// Compiled by Cocos' bundled tsc to temp/test-build, then run with `node --test`.
// @ts-ignore - Node builtin types are not in the Cocos toolchain; runtime only.
import { test } from 'node:test';
// @ts-ignore - see above
import * as assert from 'node:assert/strict';
import {
    SAVE_SCHEMA_VERSION,
    isSaveData,
    initGame,
    createSeededRng,
    createFixedClock,
    hexDistance,
    type GameConfig,
    type GameState,
    type SaveData,
} from '../../assets/core/index';

function makeConfig(seed: number): GameConfig {
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
        cardDefs: [],
        startingDeck: [],
        enemies: [
            { id: 'normal-1', hp: 20, damage: 3 },
            { id: 'boss-1', hp: 40, damage: 5 },
        ],
    };
}

function makeInitialState(seed: number): GameState {
    return initGame(makeConfig(seed), { rng: createSeededRng(seed), clock: createFixedClock(0) }).state;
}

test('initial state satisfies the T102 type contract', () => {
    const state = makeInitialState(12345);
    assert.equal(state.version, 1);
    assert.equal(state.config.seed, 12345);
    assert.equal(state.phase, 'map');
    assert.equal(state.revision, 0);
    assert.equal(state.party.length, 2);
    assert.deepEqual(
        state.party.map((c) => c.color),
        ['red', 'blue'],
    );
    assert.ok(state.party.every((c) => c.alive && c.hp === c.maxHp && c.block === 0));
    assert.deepEqual(state.position, state.map.start);
    assert.equal(hexDistance(state.map.start, state.map.boss), 2);
    assert.equal(state.floor, 1);
    assert.deepEqual(state.completedMaps, []);
    assert.equal(state.battle, null);
});

test('same seed produces structurally equal initial states', () => {
    assert.deepEqual(makeInitialState(777), makeInitialState(777));
});

test('isSaveData accepts a valid save and rejects malformed input', () => {
    const save: SaveData = {
        schemaVersion: SAVE_SCHEMA_VERSION,
        savedAt: 1000,
        state: makeInitialState(9),
        rngState: 9,
    };
    assert.equal(isSaveData(save), true);
    assert.equal(isSaveData(null), false);
    assert.equal(isSaveData({}), false);
    assert.equal(isSaveData({ ...save, schemaVersion: 99 }), false);
    assert.equal(isSaveData({ ...save, state: { version: 1 } }), false);
});
