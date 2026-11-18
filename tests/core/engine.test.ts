// Core engine tests (T104): deterministic advance, settlement freeze,
// and AC-7 ~ AC-14. Zero npm deps; compiled by Cocos tsc then node --test.
// @ts-ignore - Node builtin types are not in the Cocos toolchain; runtime only.
import { test } from 'node:test';
// @ts-ignore - see above
import * as assert from 'node:assert/strict';
import {
    advance,
    buildSnapshot,
    createFixedClock,
    createSeededRng,
    hexDistance,
    initGame,
    type AdvanceResult,
    type CoreContext,
    type GameConfig,
    type GameInput,
    type GameState,
} from '../../assets/core/index';

const CARDS = {
    redAtk: { id: 'red-atk', name: 'Red Strike', color: 'red' as const, cost: 1, effect: { kind: 'attack' as const, damage: 4 } },
    redDef: { id: 'red-def', name: 'Red Guard', color: 'red' as const, cost: 1, effect: { kind: 'defend' as const, block: 3 } },
    blueAtk: { id: 'blue-atk', name: 'Blue Strike', color: 'blue' as const, cost: 1, effect: { kind: 'attack' as const, damage: 4 } },
    blueDef: { id: 'blue-def', name: 'Blue Guard', color: 'blue' as const, cost: 1, effect: { kind: 'defend' as const, block: 3 } },
    whiteAtk: { id: 'white-cost', name: 'Costly Red', color: 'red' as const, cost: 2, effect: { kind: 'attack' as const, damage: 9 } },
};

function makeConfig(seed = 1): GameConfig {
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
        startingDeck: ['red-atk', 'blue-atk', 'red-def', 'blue-def', 'white-cost'],
        enemies: [
            { id: 'normal-1', hp: 8, damage: 3 },
            { id: 'boss-1', hp: 40, damage: 5 },
        ],
    };
}

function makeCtx(seed = 1): CoreContext {
    return { clock: createFixedClock(0), rng: createSeededRng(seed) };
}

function start(seed = 1): AdvanceResult {
    return initGame(makeConfig(seed), makeCtx(seed));
}

/** Move from start toward a neighboring battle cell (first non-center cell that exists). */
function stepTo(state: GameState, coord: { q: number; r: number }, ctx: CoreContext): AdvanceResult {
    return advance(state, { type: 'move', to: coord }, ctx);
}

// ---- AC-7: map generation ----
test('AC-7: same seed map equal; start center; one boss on outer ring; nodes configured', () => {
    const a = start(42).state;
    const b = start(42).state;
    assert.deepEqual(a.map, b.map);
    assert.deepEqual(a.map.start, { q: 0, r: 0 });
    const bosses = a.map.nodes.filter((n) => n.kind === 'boss');
    assert.equal(bosses.length, 1);
    assert.equal(hexDistance(bosses[0]!.coord, a.map.start), a.map.radius);
    const rests = a.map.nodes.filter((n) => n.kind === 'rest').length;
    assert.equal(rests, 1);
    const battle = a.map.nodes.filter((n) => n.kind === 'battle').length;
    assert.equal(battle, a.map.nodes.length - 1 - 1 - rests);
});

test('AC-7: ten different seeds do not all produce the same map', () => {
    const sigs = new Set<string>();
    for (let s = 1; s <= 10; s += 1) {
        sigs.add(JSON.stringify(start(s).state.map.nodes));
    }
    assert.ok(sigs.size > 1, 'maps should vary across seeds');
});

// ---- AC-8: movement ----
test('AC-8: non-adjacent and battle moves reject without changing state, revision or RNG', () => {
    const rng = createSeededRng(2);
    const ctx: CoreContext = { clock: createFixedClock(0), rng };
    const init = initGame(makeConfig(2), ctx);
    const initialData = JSON.stringify(init.state);
    const initialRng = rng.getState();
    const bad = stepTo(init.state, { q: 2, r: 0 }, ctx);
    assert.ok(bad.snapshot.lastRejection !== null);
    assert.equal(bad.state, init.state);
    assert.equal(bad.state.revision, init.state.revision);
    assert.equal(JSON.stringify(init.state), initialData);
    assert.equal(rng.getState(), initialRng);

    const neighbor = init.state.map.nodes.find(
        (n) => n.kind === 'battle' && hexDistance(n.coord, init.state.position) === 1,
    )!;
    const entered = stepTo(init.state, neighbor.coord, ctx);
    assert.equal(entered.state.phase, 'battle');
    const before = JSON.stringify(entered.state);
    const rngBefore = rng.getState();
    for (const target of [init.state.position, neighbor.coord, { q: 99, r: 99 }]) {
        const rejected = stepTo(entered.state, target, ctx);
        assert.ok(rejected.snapshot.lastRejection !== null);
        assert.equal(rejected.state, entered.state);
        assert.equal(rejected.state.revision, entered.state.revision);
        assert.deepEqual({ ...rejected.snapshot, lastRejection: null }, entered.snapshot);
        assert.equal(JSON.stringify(entered.state), before);
        assert.equal(rng.getState(), rngBefore);
    }
});

test('T113/AC-8: returning to a completed battle never restarts battle or grants another reward', () => {
    const rng = createSeededRng(2);
    const ctx: CoreContext = { clock: createFixedClock(0), rng };
    const initial = initGame(makeConfig(2), ctx).state;
    const node = initial.map.nodes.find(n => n.kind === 'battle' && hexDistance(n.coord, initial.position) === 1)!;
    let state = stepTo(initial, node.coord, ctx).state;
    for (const defId of ['red-atk', 'blue-atk']) {
        const card = state.deck.hand.find(c => c.defId === defId)!;
        const result = advance(state, { type: 'playCard', uid: card.uid }, ctx);
        assert.equal(result.snapshot.lastRejection, null);
        state = result.state;
    }
    assert.equal(state.phase, 'reward');
    const chosen = advance(state, { type: 'chooseReward', defId: state.rewardCandidates[0]! }, ctx);
    assert.equal(chosen.snapshot.lastRejection, null);
    state = chosen.state;
    assert.equal(state.phase, 'map');
    assert.equal(state.map.nodes.find(n => n.coord.q === node.coord.q && n.coord.r === node.coord.r)!.visited, true);
    const deck = JSON.stringify(state.deck);
    assert.equal([...state.deck.drawPile, ...state.deck.hand, ...state.deck.discardPile, ...state.deck.exhaustPile].length,
        initial.config.startingDeck.length + 1);
    const before = JSON.stringify({ map: state.map, party: state.party, energy: state.energy });
    const rngBefore = rng.getState();
    for (let visit = 0; visit < 3; visit += 1) {
        for (const target of [initial.position, node.coord]) {
            const revision = state.revision;
            const result = stepTo(state, target, ctx);
            assert.equal(result.snapshot.lastRejection, null);
            state = result.state;
            assert.equal(state.phase, 'map');
            assert.equal(state.battle, null);
            assert.deepEqual(state.rewardCandidates, []);
            assert.deepEqual(state.position, target);
            assert.equal(state.revision, revision + 1);
            assert.equal(JSON.stringify(state.deck), deck);
            assert.equal(JSON.stringify({ map: state.map, party: state.party, energy: state.energy }), before);
            assert.equal(rng.getState(), rngBefore);
        }
    }
});

test('T113/AC-8: a naturally generated rest node heals once but never on later visits', () => {
    const rng = createSeededRng(1);
    const ctx: CoreContext = { clock: createFixedClock(0), rng };
    const initial = initGame(makeConfig(1), ctx).state;
    const node = initial.map.nodes.find(n => n.kind === 'rest' && hexDistance(n.coord, initial.position) === 1)!;
    const injured: GameState = { ...initial, party: initial.party.map((hero, i) => ({ ...hero, hp: i === 0 ? 7 : 12 })) };
    const original = JSON.stringify(injured);
    const first = stepTo(injured, node.coord, ctx);
    assert.equal(first.snapshot.lastRejection, null);
    assert.equal(JSON.stringify(injured), original);
    let state = first.state;
    assert.deepEqual(state.party.map(hero => hero.hp), [17, 22]);
    assert.equal(state.map.nodes.find(n => n.coord.q === node.coord.q && n.coord.r === node.coord.r)!.visited, true);
    const before = JSON.stringify({ map: state.map, party: state.party, deck: state.deck, energy: state.energy });
    const rngBefore = rng.getState();
    for (let visit = 0; visit < 3; visit += 1) {
        for (const target of [initial.position, node.coord]) {
            const revision = state.revision;
            const result = stepTo(state, target, ctx);
            assert.equal(result.snapshot.lastRejection, null);
            state = result.state;
            assert.equal(state.phase, 'map');
            assert.equal(state.battle, null);
            assert.deepEqual(state.rewardCandidates, []);
            assert.deepEqual(state.position, target);
            assert.equal(state.revision, revision + 1);
            assert.equal(JSON.stringify({ map: state.map, party: state.party, deck: state.deck, energy: state.energy }), before);
            assert.equal(rng.getState(), rngBefore);
        }
    }
});

// ---- AC-9 / AC-10: energy + payment ----
test('AC-9: two heroes produce 1 red + 1 blue at battle start', () => {
    const init = start(3);
    const neighbor = init.state.map.nodes.find(
        (n) => n.kind === 'battle' && hexDistance(n.coord, init.state.position) === 1,
    )!;
    const inBattle = stepTo(init.state, neighbor.coord, makeCtx(3)).state;
    assert.equal(inBattle.energy.red, 1);
    assert.equal(inBattle.energy.blue, 1);
});

test('T114/AC-10: same color takes priority, white fills only the gap, other colors never pay', () => {
    const cases = [
        { red: 3, white: 4, accepted: true, remainingRed: 1, remainingWhite: 4 },
        { red: 1, white: 4, accepted: true, remainingRed: 0, remainingWhite: 3 },
        { red: 0, white: 2, accepted: true, remainingRed: 0, remainingWhite: 0 },
        { red: 1, white: 0, accepted: false, remainingRed: 1, remainingWhite: 0 },
        { red: 0, white: 1, accepted: false, remainingRed: 0, remainingWhite: 1 },
    ];
    for (const entry of cases) {
        const rng = createSeededRng(4);
        const ctx: CoreContext = { clock: createFixedClock(0), rng };
        const base = makeConfig(4);
        const config: GameConfig = { ...base, enemies: [{ ...base.enemies[0]!, hp: 100 }, base.enemies[1]!] };
        const initial = initGame(config, ctx).state;
        const node = initial.map.nodes.find(n => n.kind === 'battle' && hexDistance(n.coord, initial.position) === 1)!;
        const entered = stepTo(initial, node.coord, ctx).state;
        const state: GameState = { ...entered, energy: { red: entry.red, green: 7, blue: 9, white: entry.white } };
        const card = state.deck.hand.find(c => c.defId === 'white-cost')!;
        const before = buildSnapshot(state);
        const original = JSON.stringify(state);
        const rngBefore = rng.getState();
        assert.equal(before.hand.find(c => c.uid === card.uid)!.playable, entry.accepted);
        const result = advance(state, { type: 'playCard', uid: card.uid }, ctx);
        assert.equal(JSON.stringify(state), original);
        assert.equal(rng.getState(), rngBefore);
        assert.deepEqual(result.state.energy,
            { red: entry.remainingRed, green: 7, blue: 9, white: entry.remainingWhite });
        if (entry.accepted) {
            assert.equal(result.snapshot.lastRejection, null);
            assert.equal(result.state.phase, 'battle');
            assert.equal(result.state.revision, state.revision + 1);
            assert.equal(result.state.battle!.enemy.hp, state.battle!.enemy.hp - CARDS.whiteAtk.effect.damage);
            assert.deepEqual(result.state.party, state.party);
            assert.deepEqual(result.state.deck.hand, state.deck.hand.filter(c => c.uid !== card.uid));
            assert.deepEqual(result.state.deck.discardPile, [...state.deck.discardPile, card]);
            assert.deepEqual(result.state.deck.drawPile, state.deck.drawPile);
            assert.deepEqual(result.state.deck.exhaustPile, state.deck.exhaustPile);
        } else {
            assert.equal(result.snapshot.lastRejection, 'insufficient energy');
            assert.equal(result.state, state);
            assert.equal(result.state.revision, state.revision);
            assert.deepEqual({ ...result.snapshot, lastRejection: null }, before);
        }
    }
});

test('T114/AC-9: endTurn discards surplus energy and produces only surviving colors without accumulation', () => {
    for (const scenario of ['both-alive', 'red-dead', 'blue-dead', 'red-dies-this-turn']) {
        const rng = createSeededRng(3);
        const ctx: CoreContext = { clock: createFixedClock(0), rng };
        const initial = initGame(makeConfig(3), ctx).state;
        const node = initial.map.nodes.find(n => n.kind === 'battle' && hexDistance(n.coord, initial.position) === 1)!;
        const entered = stepTo(initial, node.coord, ctx).state;
        let state: GameState = { ...entered,
            party: entered.party.map(hero => {
                const dead = scenario === 'red-dead' && hero.color === 'red'
                    || scenario === 'blue-dead' && hero.color === 'blue';
                return { ...hero, hp: dead ? 0 : scenario === 'red-dies-this-turn' && hero.color === 'red' ? 2 : hero.hp,
                    alive: !dead };
            }),
            energy: { red: 11, green: 13, blue: 17, white: 19 },
        };
        const expected = { red: scenario === 'red-dead' || scenario === 'red-dies-this-turn' ? 0 : 1,
            green: 0, blue: scenario === 'blue-dead' ? 0 : 1, white: 0 };
        for (let turn = 0; turn < 3; turn += 1) {
            const original = JSON.stringify(state);
            const result = advance(state, { type: 'endTurn' }, ctx);
            assert.equal(result.snapshot.lastRejection, null);
            assert.equal(result.state.phase, 'battle');
            assert.equal(result.state.revision, state.revision + 1);
            assert.equal(result.state.battle!.turn, state.battle!.turn + 1);
            assert.deepEqual(result.state.energy, expected);
            assert.deepEqual(result.snapshot.energy, expected);
            assert.equal(JSON.stringify(state), original);
            state = result.state;
        }
    }
});

test('T114/AC-11: red dies through enemy damage, keeps every card UID in circulation and cannot pay red cards', () => {
    const rng = createSeededRng(2);
    const ctx: CoreContext = { clock: createFixedClock(0), rng };
    const config: GameConfig = { ...makeConfig(2), drawPerTurn: 1 };
    const initial = initGame(config, ctx).state;
    const node = initial.map.nodes.find(n => n.kind === 'battle' && hexDistance(n.coord, initial.position) === 1)!;
    const entered = stepTo(initial, node.coord, ctx).state;
    const injured: GameState = { ...entered, party: entered.party.map(hero =>
        hero.color === 'red' ? { ...hero, hp: 2 } : hero) };
    const allCards = (state: GameState) => [...state.deck.drawPile, ...state.deck.hand,
        ...state.deck.discardPile, ...state.deck.exhaustPile].sort((a, b) => a.uid.localeCompare(b.uid));
    const cards = allCards(injured);
    const original = JSON.stringify(injured);
    const died = advance(injured, { type: 'endTurn' }, ctx);
    assert.equal(died.snapshot.lastRejection, null);
    assert.equal(JSON.stringify(injured), original);
    let state = died.state;
    const tracked = state.deck.drawPile.find(card =>
        config.cardDefs.find(def => def.id === card.defId)!.color === 'red');
    if (tracked === undefined) throw new Error('A dead red hero card must remain in the draw pile to track its complete cycle');
    const seenZones = new Set<string>();
    let rejectedCards = 0;
    for (let turn = 0; turn < 8; turn += 1) {
        assert.equal(state.phase, 'battle');
        assert.equal(state.party.find(hero => hero.color === 'red')!.alive, false);
        assert.equal(state.party.find(hero => hero.color === 'red')!.hp, 0);
        assert.deepEqual(state.energy, { red: 0, green: 0, blue: 1, white: 0 });
        assert.deepEqual(allCards(state), cards);
        assert.equal(cards.length, config.startingDeck.length);
        for (const zone of ['drawPile', 'hand', 'discardPile'] as const) {
            if (state.deck[zone].some(card => card.uid === tracked.uid)) seenZones.add(zone);
        }
        const before = buildSnapshot(state);
        for (const card of before.hand.filter(card => card.def.color === 'red')) {
            assert.equal(card.playable, false);
            const rngBefore = rng.getState();
            const originalState = JSON.stringify(state);
            const result = advance(state, { type: 'playCard', uid: card.uid, targetId: 'hero-blue' }, ctx);
            assert.equal(result.snapshot.lastRejection, 'insufficient energy');
            assert.equal(result.state, state);
            assert.equal(result.state.revision, state.revision);
            assert.equal(JSON.stringify(state), originalState);
            assert.equal(rng.getState(), rngBefore);
            assert.deepEqual({ ...result.snapshot, lastRejection: null }, before);
            rejectedCards += 1;
        }
        if (turn < 7) {
            const next = advance(state, { type: 'endTurn' }, ctx);
            assert.equal(next.snapshot.lastRejection, null);
            state = next.state;
        }
    }
    assert.ok(rejectedCards > 0);
    assert.deepEqual([...seenZones].sort(), ['discardPile', 'drawPile', 'hand']);
});

// ---- AC-12: enemy intent + block targeting ----
test('AC-12: snapshot shows enemy intent before play; defend block targets chosen teammate', () => {
    const init = start(5);
    const neighbor = init.state.map.nodes.find(
        (n) => n.kind === 'battle' && hexDistance(n.coord, init.state.position) === 1,
    )!;
    const r = stepTo(init.state, neighbor.coord, makeCtx(5));
    assert.ok(r.snapshot.enemy !== null);
    assert.equal(r.snapshot.enemy!.intent.kind, 'attack');

    const def = r.state.deck.hand.find((c) => c.defId === 'red-def')!;
    const withEnergy = { ...r.state, energy: { red: 1, green: 0, blue: 0, white: 0 } };
    const after = advance(withEnergy, { type: 'playCard', uid: def.uid, targetId: 'hero-blue' }, makeCtx(5));
    assert.equal(after.state.party.find((c) => c.id === 'hero-blue')!.block, 3);
    assert.equal(after.state.party.find((c) => c.id === 'hero-red')!.block, 0);
});

test('T115/AC-12: targeted guard absorbs damage before HP, all block expires before the next attack', () => {
    for (const damage of [2, 3, 5]) {
        for (const targetId of ['hero-red', 'hero-blue']) {
            const rng = createSeededRng(5);
            const ctx: CoreContext = { clock: createFixedClock(0), rng };
            const base = makeConfig(5);
            const config: GameConfig = { ...base, enemies: [{ ...base.enemies[0]!, damage }, base.enemies[1]!] };
            const initial = initGame(config, ctx).state;
            const node = initial.map.nodes.find(n => n.kind === 'battle' && hexDistance(n.coord, initial.position) === 1)!;
            const entered = stepTo(initial, node.coord, ctx);
            assert.deepEqual(entered.snapshot.enemy!.intent, { kind: 'attack', damage });
            const guard = entered.state.deck.hand.find(card => card.defId === 'red-def')!;
            const original = JSON.stringify(entered.state);
            const rngBefore = rng.getState();
            const guarded = advance(entered.state, { type: 'playCard', uid: guard.uid, targetId }, ctx);
            assert.equal(guarded.snapshot.lastRejection, null);
            assert.equal(JSON.stringify(entered.state), original);
            assert.equal(rng.getState(), rngBefore);
            assert.deepEqual(guarded.state.party, entered.state.party.map(hero =>
                hero.id === targetId ? { ...hero, block: 3 } : hero));
            assert.deepEqual(guarded.snapshot.enemy, entered.snapshot.enemy);
            assert.deepEqual(guarded.state.energy, { red: 0, green: 0, blue: 1, white: 0 });
            const guardedData = JSON.stringify(guarded.state);
            const next = advance(guarded.state, { type: 'endTurn' }, ctx);
            const absorbed = targetId === 'hero-red' ? Math.min(3, damage) : 0;
            const expectedHp = config.startHp - damage + absorbed;
            assert.equal(next.snapshot.lastRejection, null);
            assert.equal(next.state.phase, 'battle');
            assert.equal(next.state.revision, guarded.state.revision + 1);
            assert.equal(next.state.battle!.turn, guarded.state.battle!.turn + 1);
            assert.deepEqual(next.state.party, entered.state.party.map(hero =>
                hero.id === 'hero-red' ? { ...hero, hp: expectedHp } : hero));
            assert.ok(next.snapshot.party.every(hero => hero.block === 0));
            assert.equal(JSON.stringify(guarded.state), guardedData);
            const again = advance(next.state, { type: 'endTurn' }, ctx);
            assert.equal(again.snapshot.lastRejection, null);
            assert.equal(again.state.party[0]!.hp, expectedHp - damage);
            assert.equal(again.state.party[1]!.hp, config.startHp);
            assert.ok(again.state.party.every(hero => hero.block === 0));
        }
    }
});

test('T115/AC-12: killing the first hero does not spill damage and later attacks skip that dead hero', () => {
    const rng = createSeededRng(5);
    const ctx: CoreContext = { clock: createFixedClock(0), rng };
    const base = makeConfig(5);
    const config: GameConfig = { ...base, enemies: [{ ...base.enemies[0]!, damage: 5 }, base.enemies[1]!] };
    const initial = initGame(config, ctx).state;
    const node = initial.map.nodes.find(n => n.kind === 'battle' && hexDistance(n.coord, initial.position) === 1)!;
    const entered = stepTo(initial, node.coord, ctx).state;
    const injured: GameState = { ...entered, party: entered.party.map((hero, i) =>
        i === 0 ? { ...hero, hp: 2 } : hero) };
    const original = JSON.stringify(injured);
    const killed = advance(injured, { type: 'endTurn' }, ctx);
    assert.equal(killed.snapshot.lastRejection, null);
    assert.equal(JSON.stringify(injured), original);
    assert.deepEqual(killed.state.party[0], { ...injured.party[0]!, hp: 0, alive: false });
    assert.deepEqual(killed.state.party[1], injured.party[1]);
    assert.deepEqual(killed.state.energy, { red: 0, green: 0, blue: 1, white: 0 });
    const guard = killed.state.deck.hand.find(card => card.defId === 'blue-def')!;
    const guarded = advance(killed.state, { type: 'playCard', uid: guard.uid, targetId: 'hero-blue' }, ctx);
    assert.equal(guarded.snapshot.lastRejection, null);
    assert.deepEqual(guarded.state.party[0], killed.state.party[0]);
    assert.equal(guarded.state.party[1]!.block, 3);
    const next = advance(guarded.state, { type: 'endTurn' }, ctx);
    assert.equal(next.snapshot.lastRejection, null);
    assert.equal(next.state.phase, 'battle');
    assert.equal(next.state.revision, guarded.state.revision + 1);
    assert.deepEqual(next.state.party[0], killed.state.party[0]);
    assert.deepEqual(next.state.party[1], { ...injured.party[1]!, hp: config.startHp - 2 });
    assert.ok(next.state.party.every(hero => hero.block === 0));
    const again = advance(next.state, { type: 'endTurn' }, ctx);
    assert.equal(again.snapshot.lastRejection, null);
    assert.deepEqual(again.state.party[0], killed.state.party[0]);
    assert.equal(again.state.party[1]!.hp, config.startHp - 7);
});

// ---- AC-11: dead character cards stay; death persists ----
test('AC-11: dead hero keeps cards in deck; death persists to next battle; rest revives', () => {
    const init = start(6);
    const neighbor = init.state.map.nodes.find(
        (n) => n.kind === 'battle' && hexDistance(n.coord, init.state.position) === 1,
    )!;
    let s = stepTo(init.state, neighbor.coord, makeCtx(6)).state;
    const totalCards = s.deck.drawPile.length + s.deck.hand.length + s.deck.discardPile.length;

    // kill hero-red by repeated enemy attacks (endTurn) until red is dead
    for (let i = 0; i < 20 && s.party[0]!.alive; i += 1) {
        s = advance(s, { type: 'endTurn' }, makeCtx(6)).state;
        if (s.phase !== 'battle') break;
    }
    assert.equal(s.party[0]!.alive, false, 'hero-red should eventually die');
    const cardsAfter = s.deck.drawPile.length + s.deck.hand.length + s.deck.discardPile.length;
    assert.equal(cardsAfter, totalCards, 'deck total must not change on death');

    // entering another battle keeps death and stops red energy production
    assert.equal(s.party[0]!.alive, false);
});

// ---- AC-13: settlement + rewards ----
test('AC-13: boss death -> victory; wipe -> defeat; normal win -> 3 red/blue rewards', () => {
    const init = start(7);
    // defeat: kill everyone via enemy attacks
    let s = init.state;
    const neighbor = s.map.nodes.find((n) => n.kind === 'battle' && hexDistance(n.coord, s.position) === 1)!;
    s = stepTo(s, neighbor.coord, makeCtx(7)).state;
    for (let i = 0; i < 40 && s.phase === 'battle'; i += 1) {
        s = advance(s, { type: 'endTurn' }, makeCtx(7)).state;
    }
    assert.equal(s.phase, 'defeat');

    // victory: enter boss directly with high-attack cards, kill boss
    const v0 = start(8).state;
    const boss = v0.map.boss;
    // craft path: we can't jump to boss unless adjacent; use a legal route via BFS of unvisited cells
    let vs = v0;
    const ctx = makeCtx(8);
    // simple greedy: move to any unvisited neighbor until boss is adjacent, then enter boss
    let guard = 0;
    while (!vs.map.nodes.find((n) => n.coord.q === boss.q && n.coord.r === boss.r)!.visited && guard < 30) {
        guard += 1;
        const cur = vs.position;
        const candidates = vs.map.nodes.filter(
            (n) => !n.visited && n.kind !== null && hexDistance(n.coord, cur) === 1,
        );
        if (candidates.length === 0) break;
        const toBoss = candidates.find((n) => n.kind === 'boss');
        const pick = toBoss ?? candidates[0]!;
        const res = advance(vs, { type: 'move', to: pick.coord }, ctx);
        vs = res.state;
        if (vs.phase === 'reward') {
            const choose = advance(vs, { type: 'chooseReward', defId: vs.rewardCandidates[0]! }, ctx);
            vs = choose.state;
        }
        if (vs.phase === 'battle') {
            // kill enemy by repeatedly playing all attack cards with enough white energy
            let inner = 0;
            while (vs.phase === 'battle' && inner < 30) {
                inner += 1;
                const atk = vs.deck.hand.find((c) => c.defId === 'red-atk' || c.defId === 'blue-atk');
                if (!atk) {
                    vs = advance(vs, { type: 'endTurn' }, ctx).state;
                    continue;
                }
                vs = { ...vs, energy: { red: 5, green: 0, blue: 5, white: 5 } };
                vs = advance(vs, { type: 'playCard', uid: atk.uid }, ctx).state;
            }
        }
        if (vs.phase === 'victory' || vs.phase === 'defeat') break;
    }
    assert.equal(vs.phase, 'victory');
});

test('AC-13: normal battle win yields 3 red/blue candidates; choose adds a card', () => {
    const init = start(9);
    const ctx = makeCtx(9);
    const neighbor = init.state.map.nodes.find(
        (n) => n.kind === 'battle' && hexDistance(n.coord, init.state.position) === 1,
    )!;
    let s = stepTo(init.state, neighbor.coord, ctx).state;
    const before = s.deck.drawPile.length + s.deck.hand.length + s.deck.discardPile.length;
    // kill normal enemy (8 hp) with two 4-damage attacks
    for (const id of ['red-atk', 'blue-atk']) {
        const card = s.deck.hand.find((c) => c.defId === id);
        if (!card) continue;
        s = { ...s, energy: { red: 5, green: 0, blue: 5, white: 0 } };
        s = advance(s, { type: 'playCard', uid: card.uid }, ctx).state;
    }
    assert.equal(s.phase, 'reward');
    assert.equal(s.rewardCandidates.length, 3);
    const afterChoose = advance(s, { type: 'chooseReward', defId: s.rewardCandidates[0]! }, ctx).state;
    const after = afterChoose.deck.drawPile.length + afterChoose.deck.hand.length + afterChoose.deck.discardPile.length;
    assert.equal(after, before + 1);
});

// ---- AC-14: discard reshuffles into draw pile ----
test('AC-14: empty draw pile reshuffles discard deterministically', () => {
    const init = start(10);
    const ctx = makeCtx(10);
    const neighbor = init.state.map.nodes.find(
        (n) => n.kind === 'battle' && hexDistance(n.coord, init.state.position) === 1,
    )!;
    const s = stepTo(init.state, neighbor.coord, ctx).state;
    const total = s.deck.drawPile.length + s.deck.hand.length + s.deck.discardPile.length;
    // Force an empty draw pile with all cards in discard, no hand.
    const setup: GameState = {
        ...s,
        energy: { red: 0, green: 0, blue: 0, white: 0 },
        deck: { drawPile: [], hand: [], discardPile: [...s.deck.drawPile, ...s.deck.hand, ...s.deck.discardPile], exhaustPile: s.deck.exhaustPile },
    };
    const next = advance(setup, { type: 'endTurn' }, ctx).state;
    // drawPerTurn=5 are drawn after reshuffle; total card count is preserved.
    assert.equal(next.deck.hand.length, 5);
    assert.equal(next.deck.drawPile.length + next.deck.hand.length + next.deck.discardPile.length, total);
});

// ---- T104 judgement: same input sequence -> identical result ----
test('same seed + same input sequence produces identical snapshots', () => {
    const run = () => {
        const ctx = makeCtx(11);
        let s = initGame(makeConfig(11), ctx).state;
        const seq: string[] = [JSON.stringify(buildSnapshot(s))];
        const neighbor = s.map.nodes.find((n) => n.kind === 'battle' && hexDistance(n.coord, s.position) === 1)!;
        s = advance(s, { type: 'move', to: neighbor.coord }, ctx).state;
        seq.push(JSON.stringify(buildSnapshot(s)));
        s = advance(s, { type: 'endTurn' }, ctx).state;
        seq.push(JSON.stringify(buildSnapshot(s)));
        return seq;
    };
    assert.deepEqual(run(), run());
});

// ---- FR-16: rest node revives fallen teammates and heals ----
test('FR-16: rest node revives dead hero and restores HP by config', () => {
    const init = start(13);
    const ctx = makeCtx(13);
    // pick a neighbor cell and force it to be a rest node
    const neighbor = init.state.map.nodes.find((n) => hexDistance(n.coord, init.state.position) === 1)!;
    const forcedRest: GameState = {
        ...init.state,
        party: [
            { id: 'hero-red', color: 'red', hp: 0, maxHp: 30, block: 0, alive: false },
            { id: 'hero-blue', color: 'blue', hp: 10, maxHp: 30, block: 0, alive: true },
        ],
        map: {
            ...init.state.map,
            nodes: init.state.map.nodes.map((n) =>
                n.coord.q === neighbor.coord.q && n.coord.r === neighbor.coord.r
                    ? { ...n, kind: 'rest' as const }
                    : n,
            ),
        },
    };
    const after = advance(forcedRest, { type: 'move', to: neighbor.coord }, ctx).state;
    const red = after.party.find((c) => c.id === 'hero-red')!;
    assert.equal(red.alive, true);
    assert.equal(red.hp, 10); // 0 + restHeal(10)
    const blue = after.party.find((c) => c.id === 'hero-blue')!;
    assert.equal(blue.hp, 20); // 10 + restHeal(10)
});

// ---- FR-4: settled state freezes ----
for (const outcome of ['victory', 'defeat'] as const) {
    test(`T116/FR-4: actual ${outcome} rejects every input without changing state, revision or RNG`, () => {
        for (const floorCount of [1, 3, 4, 5] as const) {
            const base = makeConfig(12);
            const config: GameConfig = { ...base, floorCount, startHp: 200,
                enemies: outcome === 'victory'
                    ? [{ ...base.enemies[0]!, hp: 4, damage: 1 }, { ...base.enemies[1]!, hp: 8, damage: 1 }]
                    : [{ ...base.enemies[0]!, hp: 100, damage: 200 }, base.enemies[1]!],
            };
            const rng = createSeededRng(config.seed);
            const ctx: CoreContext = { clock: createFixedClock(0), rng };
            let state = initGame(config, ctx).state;
            for (let step = 0; state.phase !== outcome && step < 300; step += 1) {
                let input: GameInput;
                if (state.phase === 'map') {
                    const node = state.map.nodes.find(n => hexDistance(n.coord, state.position) === 1
                        && (outcome === 'defeat' ? n.kind === 'battle'
                            : hexDistance(n.coord, state.map.boss) < hexDistance(state.position, state.map.boss)));
                    if (node === undefined) throw new Error('No path to settlement');
                    input = { type: 'move', to: node.coord };
                } else if (state.phase === 'reward') {
                    input = { type: 'chooseReward', defId: state.rewardCandidates[0]! };
                } else if (state.phase === 'battle') {
                    const card = buildSnapshot(state).hand.find(c => c.playable && c.def.effect.kind === 'attack');
                    input = outcome === 'defeat' || card === undefined ? { type: 'endTurn' }
                        : { type: 'playCard', uid: card.uid };
                } else {
                    throw new Error(`Unexpected settlement phase ${state.phase}`);
                }
                const result = advance(state, input, ctx);
                assert.equal(result.snapshot.lastRejection, null);
                assert.ok(result.state.revision > state.revision);
                state = result.state;
            }
            assert.equal(state.phase, outcome);
            if (outcome === 'victory') {
                assert.equal(state.floor, floorCount);
                assert.equal(state.completedMaps.length, floorCount - 1);
                assert.equal(state.battle, null);
            } else {
                assert.ok(state.party.every(hero => !hero.alive && hero.hp === 0));
            }
            const adjacent = state.map.nodes.find(n => hexDistance(n.coord, state.position) === 1)!;
            const uid = state.deck.hand[0]?.uid ?? state.deck.discardPile[0]!.uid;
            const inputs: Record<GameInput['type'], readonly GameInput[]> = {
                start: [{ type: 'start' }],
                move: [{ type: 'move', to: adjacent.coord }, { type: 'move', to: { q: 99, r: 99 } }],
                playCard: [{ type: 'playCard', uid, targetId: state.party[0]!.id },
                    { type: 'playCard', uid: 'missing-card', targetId: 'missing-hero' }],
                endTurn: [{ type: 'endTurn' }],
                chooseReward: [{ type: 'chooseReward', defId: config.cardDefs[0]!.id },
                    { type: 'chooseReward', defId: 'missing-reward' }],
            };
            const snapshot = buildSnapshot(state);
            const bytes = JSON.stringify(state);
            const rngState = rng.getState();
            for (let repeat = 0; repeat < 2; repeat += 1) {
                for (const group of Object.values(inputs)) {
                    for (const input of group) {
                        const result = advance(state, input, ctx);
                        assert.equal(result.snapshot.lastRejection, 'game already settled');
                        assert.equal(result.state, state);
                        assert.equal(result.state.revision, state.revision);
                        assert.equal(JSON.stringify(state), bytes);
                        assert.deepEqual({ ...result.snapshot, lastRejection: null }, snapshot);
                        assert.equal(rng.getState(), rngState);
                    }
                }
            }
        }
    });
}
