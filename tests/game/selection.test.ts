// @ts-ignore
import { test } from 'node:test';
// @ts-ignore
import * as assert from 'node:assert/strict';
import { hexDistance } from '../../assets/core';
import type { GameConfig, Snapshot, StoragePort } from '../../assets/core';
import { BattleSelection } from '../../assets/game/BattleSelection';
import { GameSession, SAVE_KEY } from '../../assets/game/GameSession';

const config: GameConfig = {
    seed: 20261116, floorCount: 1, mapRadius: 2, startHp: 30, energyPerTurn: 1,
    drawPerTurn: 5, restHeal: 10, rewardCount: 3, restNodes: 1,
    cardDefs: [
        { id: 'attack', name: 'Strike', color: 'red', cost: 1, effect: { kind: 'attack', damage: 4 } },
        { id: 'defend', name: 'Guard', color: 'blue', cost: 1, effect: { kind: 'defend', block: 3 } },
    ],
    startingDeck: ['attack', 'attack', 'defend', 'defend', 'attack'],
    enemies: [{ id: 'normal', hp: 12, damage: 3 }, { id: 'boss', hp: 24, damage: 5 }],
};

function battle(storage?: StoragePort): GameSession {
    const session = new GameSession(config, { storage });
    const s = session.snapshot;
    const node = s.map.nodes.find(n => n.kind === 'battle' && hexDistance(n.coord, s.map.position) === 1)!;
    session.dispatch({ type: 'move', to: node.coord });
    return session;
}

function find(s: Snapshot, effect: 'attack' | 'defend'): string {
    return s.hand.find(card => card.def.effect.kind === effect)!.uid;
}

test('AC-16: selection toggles, switches and cancels without changing Snapshot or save', () => {
    const data = new Map<string, string>();
    let writes = 0;
    const storage: StoragePort = {
        get: key => data.get(key) ?? null,
        set: (key, value) => { data.set(key, value); writes += 1; },
        remove: key => { data.delete(key); },
    };
    const session = battle(storage);
    const s = session.snapshot;
    const before = JSON.stringify(s);
    const saved = storage.get(SAVE_KEY);
    const initialWrites = writes;
    const selection = new BattleSelection();
    assert.equal(selection.select(s, find(s, 'attack')), true);
    assert.equal(selection.selectedUid, find(s, 'attack'));
    selection.select(s, find(s, 'defend'));
    assert.equal(selection.selectedUid, find(s, 'defend'));
    selection.select(s, find(s, 'defend'));
    assert.equal(selection.selectedUid, null);
    selection.select(s, find(s, 'attack'));
    selection.cancel();
    assert.equal(selection.selectedUid, null);
    assert.equal(JSON.stringify(session.snapshot), before);
    assert.equal(storage.get(SAVE_KEY), saved);
    assert.equal(writes, initialWrites);
});

test('AC-16: attack resolves only to the living current enemy', () => {
    const s = battle().snapshot;
    const selection = new BattleSelection();
    assert.equal(selection.resolve(s, { kind: 'enemy', id: s.enemy!.id }), null);
    selection.select(s, find(s, 'attack'));
    assert.equal(selection.resolve(s, { kind: 'ally', id: s.party[0]!.id }), null);
    assert.equal(selection.resolve(s, { kind: 'enemy', id: 'other' }), null);
    assert.deepEqual(selection.resolve(s, { kind: 'enemy', id: s.enemy!.id }), {
        type: 'playCard', uid: find(s, 'attack'),
    });
    assert.equal(selection.resolve({ ...s, enemy: { ...s.enemy!, hp: 0 } }, { kind: 'enemy', id: s.enemy!.id }), null);
});

test('AC-16: defend resolves only to a living teammate', () => {
    const s = battle().snapshot;
    const selection = new BattleSelection();
    selection.select(s, find(s, 'defend'));
    assert.equal(selection.resolve(s, { kind: 'enemy', id: s.enemy!.id }), null);
    assert.equal(selection.resolve(s, { kind: 'ally', id: 'unknown' }), null);
    assert.deepEqual(selection.resolve(s, { kind: 'ally', id: s.party[1]!.id }), {
        type: 'playCard', uid: find(s, 'defend'), targetId: s.party[1]!.id,
    });
    const dead: Snapshot = { ...s, party: s.party.map((hero, i) => i === 1 ? { ...hero, hp: 0, alive: false } : hero) };
    assert.equal(selection.resolve(dead, { kind: 'ally', id: s.party[1]!.id }), null);
});

test('AC-16: unavailable and missing cards cannot be selected', () => {
    const s = battle().snapshot;
    const selection = new BattleSelection();
    const uid = find(s, 'attack');
    const blocked: Snapshot = { ...s, hand: s.hand.map(card => ({ ...card, playable: false })) };
    assert.equal(selection.select(blocked, uid), false);
    assert.equal(selection.select(s, 'missing'), false);
    assert.equal(selection.select({ ...s, phase: 'map' }, uid), false);
    assert.equal(selection.selectedUid, null);
});

test('AC-16: turn, phase, removed card or lost affordability clears selection', () => {
    const s = battle().snapshot;
    for (const changed of [
        { ...s, turn: s.turn + 1 }, { ...s, phase: 'reward' as const },
        { ...s, hand: [] }, { ...s, hand: s.hand.map(card => ({ ...card, playable: false })) },
    ]) {
        const selection = new BattleSelection();
        selection.select(s, find(s, 'attack'));
        selection.sync(changed);
        assert.equal(selection.selectedUid, null);
    }
});

test('AC-16: valid target dispatch consumes energy, removes the card and clears selection', () => {
    const session = battle();
    const before = session.snapshot;
    const selection = new BattleSelection();
    const uid = find(before, 'attack');
    selection.select(before, uid);
    const action = selection.resolve(before, { kind: 'enemy', id: before.enemy!.id });
    if (action === null) throw new Error('valid attack not resolved');
    const after = session.dispatch(action);
    selection.sync(after);
    assert.equal(after.enemy!.hp, before.enemy!.hp - 4);
    assert.equal(after.energy.red, before.energy.red - 1);
    assert.equal(after.hand.length, before.hand.length - 1);
    assert.equal(selection.selectedUid, null);
});

test('AC-16: wrong target retains choice and does not advance the session', () => {
    const session = battle();
    const s = session.snapshot;
    const selection = new BattleSelection();
    const uid = find(s, 'attack');
    selection.select(s, uid);
    assert.equal(selection.resolve(s, { kind: 'ally', id: s.party[0]!.id }), null);
    assert.equal(selection.selectedUid, uid);
    assert.deepEqual(session.snapshot, s);
});
