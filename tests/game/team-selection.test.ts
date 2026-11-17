// @ts-ignore
import { test } from 'node:test';
// @ts-ignore
import * as assert from 'node:assert/strict';
import { advance, createFixedClock, createSeededRng, hexDistance, initGame, isSaveData } from '../../assets/core';
import type { GameConfig, GameState, StoragePort } from '../../assets/core';
import { TeamSelection } from '../../assets/game/TeamSelection';
import { BattleSelection } from '../../assets/game/BattleSelection';
import { GameSession, SAVE_KEY } from '../../assets/game/GameSession';

function config(ids = ['hero-red', 'hero-green', 'hero-blue']): GameConfig {
    const selected = new TeamSelection();
    ids.forEach(id => selected.toggle(id));
    return selected.createConfig(20261116, 3);
}

function init(c = config()): GameState {
    return initGame(c, { clock: createFixedClock(0), rng: createSeededRng(c.seed) }).state;
}

function enter(c = config()): GameState {
    const rng = createSeededRng(c.seed);
    const ctx = { clock: createFixedClock(0), rng };
    const s = initGame(c, ctx).state;
    const node = s.map.nodes.find(n => n.kind === 'battle' && hexDistance(n.coord, s.position) === 1)!;
    return advance(s, { type: 'move', to: node.coord }, ctx).state;
}

class MemoryStorage implements StoragePort {
    private data = new Map<string, string>();
    writes = 0;
    get(key: string): string | null { return this.data.get(key) ?? null; }
    set(key: string, value: string): void { this.writes += 1; this.data.set(key, value); }
    remove(key: string): void { this.data.delete(key); }
}

test('AC-22: two or three unique roster characters can confirm, never zero or one', () => {
    const selected = new TeamSelection();
    assert.equal(selected.canConfirm, false);
    assert.throws(() => selected.createConfig(1, 3));
    assert.equal(selected.toggle('missing'), false);
    selected.toggle('hero-green');
    assert.equal(selected.canConfirm, false);
    selected.toggle('hero-blue');
    assert.equal(selected.canConfirm, true);
    selected.toggle('hero-red');
    assert.equal(selected.selectedIds.length, 3);
    selected.toggle('hero-blue');
    assert.deepEqual(selected.selectedIds, ['hero-green', 'hero-red']);
    selected.toggle('hero-blue');
    assert.deepEqual(selected.selectedIds, ['hero-green', 'hero-red', 'hero-blue']);
    const copy = selected.selectedIds as string[];
    copy.length = 0;
    assert.equal(selected.selectedIds.length, 3);
    selected.reset();
    assert.equal(selected.canConfirm, false);
});

for (const ids of [['hero-green', 'hero-blue'], ['hero-blue', 'hero-red', 'hero-green']]) {
    test(`AC-22: ordered ${ids.length}-hero party starts with two attacks and one guard per hero`, () => {
        const c = config(ids);
        const s = init(c);
        assert.deepEqual(s.party.map(hero => hero.id), ids);
        assert.ok(s.party.every(hero => hero.hp === 30 && hero.alive));
        assert.equal(s.deck.drawPile.length, ids.length * 3);
        for (const hero of s.party) {
            const cards = s.deck.drawPile.map(card => c.cardDefs.find(def => def.id === card.defId)!)
                .filter(card => card.color === hero.color);
            assert.equal(cards.filter(card => card.effect.kind === 'attack').length, 2);
            assert.equal(cards.filter(card => card.effect.kind === 'defend').length, 1);
        }
    });
}

test('AC-23: green produces and spends its energy, guard can target the third ally', () => {
    const c = config();
    let s = enter(c);
    assert.deepEqual(s.energy, { red: 1, green: 1, blue: 1, white: 0 });
    const guard = { uid: 'green-test-guard', defId: 'g-def' };
    s = { ...s, deck: { ...s.deck, hand: [...s.deck.hand, guard] } };
    const ctx = { clock: createFixedClock(0), rng: createSeededRng(7) };
    const after = advance(s, { type: 'playCard', uid: guard.uid, targetId: s.party[2]!.id }, ctx);
    assert.equal(after.snapshot.party[2]!.block, 3);
    assert.equal(after.snapshot.energy.green, 0);
    const selection = new BattleSelection();
    const greenAtk = { uid: 'green-test-atk', defId: 'g-atk' };
    const ready: GameState = { ...s, deck: { ...s.deck, hand: [greenAtk] } };
    const snap = advance(ready, { type: 'playCard', uid: 'missing' }, ctx).snapshot;
    selection.select(snap, greenAtk.uid);
    assert.deepEqual(selection.resolve(snap, { kind: 'enemy', id: snap.enemy!.id }), { type: 'playCard', uid: greenAtk.uid });
    const attack = advance(ready, { type: 'playCard', uid: greenAtk.uid }, ctx).snapshot;
    assert.equal(attack.enemy!.hp, snap.enemy!.hp - 4);
    assert.equal(attack.energy.green, 0);
});

test('AC-23: enemy attacks the first selected living character and green death stops energy', () => {
    const c = config(['hero-green', 'hero-blue', 'hero-red']);
    const s = enter(c);
    const ctx = { clock: createFixedClock(0), rng: createSeededRng(1) };
    const next = advance(s, { type: 'endTurn' }, ctx).state;
    assert.equal(next.party[0]!.hp, 27);
    assert.equal(next.party[1]!.hp, 30);
    const setup = { ...s, party: s.party.map((hero, i) => i === 0 ? { ...hero, hp: 1 } : hero) };
    const dead = advance(setup, { type: 'endTurn' }, ctx).state;
    assert.equal(dead.party[0]!.alive, false);
    assert.equal(dead.energy.green, 0);
    assert.equal(dead.energy.blue, 1);
    const defend = { ...dead, deck: { ...dead.deck, hand: [{ uid: 'guard-test', defId: 'b-def' }] } };
    const invalid = advance(defend, { type: 'playCard', uid: 'guard-test', targetId: dead.party[0]!.id }, ctx);
    assert.equal(invalid.state, defend);
});

test('AC-22: core rejects wrong count, duplicate ID, wrong-color and unknown starting cards before RNG', () => {
    const base = config();
    const invalid: GameConfig[] = [
        { ...base, startingParty: [] },
        { ...base, startingParty: [base.startingParty![0]!] },
        { ...base, startingParty: [base.startingParty![0]!, base.startingParty![0]!] },
        { ...base, startingParty: base.startingParty!.map((hero, i) => i === 1 ? { ...hero, startingDeck: ['r-atk'] } : hero) },
        { ...base, startingDeck: ['missing'] },
    ];
    for (const c of invalid) {
        const rng = createSeededRng(1);
        const before = rng.getState();
        assert.throws(() => initGame(c, { rng, clock: createFixedClock(0) }));
        assert.equal(rng.getState(), before);
    }
});

test('AC-24: selection and read-only save inspection never overwrite existing progress', () => {
    const storage = new MemoryStorage();
    const c = config();
    const session = new GameSession(c, { storage });
    session.save();
    const raw = storage.get(SAVE_KEY);
    const writes = storage.writes;
    const selected = new TeamSelection();
    selected.toggle('hero-blue'); selected.toggle('hero-green');
    selected.createConfig(1, 5);
    assert.equal(GameSession.readSave(storage)!.state.party.length, 3);
    assert.equal(storage.get(SAVE_KEY), raw);
    assert.equal(storage.writes, writes);
    storage.set(SAVE_KEY, '{bad-json');
    assert.equal(GameSession.readSave(storage), null);
    assert.equal(storage.get(SAVE_KEY), '{bad-json');
});

test('AC-24: three-person battle save restores ordered party, cards and future RNG despite other config', () => {
    const storage = new MemoryStorage();
    const c = config(['hero-blue', 'hero-green', 'hero-red']);
    const session = new GameSession(c, { storage });
    const map = session.snapshot.map;
    const node = map.nodes.find(n => n.kind === 'battle' && hexDistance(n.coord, map.position) === 1)!;
    session.dispatch({ type: 'move', to: node.coord });
    const resumed = GameSession.load(storage, config(['hero-red', 'hero-blue']));
    assert.deepEqual(resumed.snapshot, session.snapshot);
    assert.deepEqual(resumed.snapshot.party.map(hero => hero.id), ['hero-blue', 'hero-green', 'hero-red']);
    session.dispatch({ type: 'endTurn' }); resumed.dispatch({ type: 'endTurn' });
    assert.deepEqual(resumed.snapshot, session.snapshot);
});

test('AC-24: save rejects duplicate or reordered party and mismatched starting role cards', () => {
    const storage = new MemoryStorage();
    new GameSession(config(), { storage }).save();
    const raw = storage.get(SAVE_KEY)!;
    const duplicate = JSON.parse(raw);
    duplicate.state.config.startingParty[1].id = duplicate.state.config.startingParty[0].id;
    assert.equal(isSaveData(duplicate), false);
    const reversed = JSON.parse(raw);
    reversed.state.party.reverse();
    assert.equal(isSaveData(reversed), false);
    const broken = JSON.parse(raw);
    broken.state.config.startingParty[0].startingDeck[0] = 'g-atk';
    assert.equal(isSaveData(broken), false);
});

test('AC-24: old config and save without character definitions stay red/blue', () => {
    const c = config();
    const legacy: GameConfig = { ...c, startingParty: undefined, startingDeck: ['r-atk', 'b-atk'] };
    const storage = new MemoryStorage();
    const session = new GameSession(legacy, { storage });
    session.save();
    const restored = GameSession.load(storage, c);
    assert.deepEqual(restored.snapshot.party.map(hero => hero.color), ['red', 'blue']);
    assert.deepEqual(restored.snapshot, session.snapshot);
});

test('AC-24: selected green/red party keeps deterministic maps and cards', () => {
    const a = new GameSession(config(['hero-green', 'hero-red']));
    const b = new GameSession(config(['hero-green', 'hero-red']));
    const node = a.snapshot.map.nodes.find(n => n.kind === 'battle' && hexDistance(n.coord, a.snapshot.map.position) === 1)!;
    for (const session of [a, b]) {
        session.dispatch({ type: 'move', to: node.coord });
        session.dispatch({ type: 'endTurn' });
    }
    assert.deepEqual(a.snapshot, b.snapshot);
});

test('AC-24: three selected roles and their deck survive floor transition and save restore', () => {
    const c = config(['hero-green', 'hero-blue', 'hero-red']);
    const rng = createSeededRng(c.seed);
    const ctx = { rng, clock: createFixedClock(0) };
    const initial = initGame(c, ctx).state;
    const cards = initial.deck.drawPile;
    const lethal = cards.find(card => card.defId === 'b-atk')!;
    const setup: GameState = { ...initial, phase: 'battle', position: initial.map.boss,
        party: initial.party.map((hero, i) => i === 0 ? { ...hero, hp: 0, alive: false } : { ...hero, hp: 19 }),
        energy: { red: 0, green: 0, blue: 1, white: 0 },
        deck: { ...initial.deck, hand: [lethal], drawPile: cards.filter(card => card.uid !== lethal.uid) },
        battle: { turn: 1, enemy: { id: 'boss', hp: 4, maxHp: 24, intent: { kind: 'attack', damage: 5 } } },
    };
    const after = advance(setup, { type: 'playCard', uid: lethal.uid }, ctx).state;
    assert.equal(after.floor, 2);
    assert.equal(after.phase, 'map');
    assert.deepEqual(after.party.map(hero => ({ id: hero.id, hp: hero.hp, alive: hero.alive })),
        setup.party.map(hero => ({ id: hero.id, hp: hero.hp, alive: hero.alive })));
    assert.equal(after.deck.drawPile.length + after.deck.discardPile.length, 9);
    const storage = new MemoryStorage();
    new GameSession(c, { storage, restored: { schemaVersion: 2, savedAt: 0, state: after, rngState: rng.getState() } }).save();
    const loaded = GameSession.load(storage, config(['hero-red', 'hero-blue']));
    assert.equal(loaded.snapshot.floor, 2);
    assert.deepEqual(loaded.snapshot.party.map(hero => hero.color), ['green', 'blue', 'red']);
    assert.equal(loaded.snapshot.party[0]!.alive, false);
});
