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
    type GameConfig,
    type GameState,
    type SaveData,
} from '../../assets/core/index';

function makeConfig(seed: number): GameConfig {
    return {
        seed,
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

/**
 * Build a minimal state fixture matching the T102 type contract.
 * T104 will replace this with the real initGame() implementation; the assertions
 * below express the initial-state invariants that implementation must satisfy.
 */
function makeInitialState(seed: number): GameState {
    const center = { q: 0, r: 0 };
    const boss = { q: 2, r: 0 };
    return {
        version: 1,
        config: makeConfig(seed),
        phase: 'map',
        position: center,
        map: {
            radius: 2,
            start: center,
            boss,
            nodes: [
                { coord: center, kind: null, visited: true },
                { coord: boss, kind: 'boss', visited: false },
            ],
        },
        party: [
            { id: 'hero-red', color: 'red', hp: 30, maxHp: 30, block: 0, alive: true },
            { id: 'hero-blue', color: 'blue', hp: 30, maxHp: 30, block: 0, alive: true },
        ],
        energy: { red: 0, green: 0, blue: 0, white: 0 },
        deck: { drawPile: [], hand: [], discardPile: [], exhaustPile: [] },
        battle: null,
        rewardCandidates: [],
        revision: 0,
    };
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
    assert.deepEqual(state.map.boss, { q: 2, r: 0 });
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
