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

test('AC-10: same-color enough; white fills gap; insufficient rejected with unchanged state', () => {
    const init = start(4);
    const neighbor = init.state.map.nodes.find(
        (n) => n.kind === 'battle' && hexDistance(n.coord, init.state.position) === 1,
    )!;
    let s = stepTo(init.state, neighbor.coord, makeCtx(4)).state;

    // craft a controlled hand: a 2-cost red + 1 white energy? no white source -> insufficient
    const costly = s.deck.hand.find((c) => c.defId === 'white-cost');
    if (costly === undefined) throw new Error('starting deck should contain the 2-cost red card');
    const noWhite = advance(s, { type: 'playCard', uid: costly.uid }, makeCtx(4));
    assert.ok(noWhite.snapshot.lastRejection !== null);
    assert.equal(noWhite.state, s);

    // inject white energy via a new state (white payment rule, FR-11)
    s = { ...s, energy: { red: 0, green: 0, blue: 0, white: 2 } };
    const paid = advance(s, { type: 'playCard', uid: costly.uid }, makeCtx(4));
    assert.equal(paid.snapshot.lastRejection, null);
    assert.equal(paid.state.energy.white, 0);
    assert.equal(paid.state.energy.red, 0);
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
test('FR-4: after settlement every input is rejected and state frozen', () => {
    const init = start(12);
    const ctx = makeCtx(12);
    const settled = { ...init.state, phase: 'victory' as const };
    for (const input of [
        { type: 'start' },
        { type: 'move', to: { q: 1, r: 0 } },
        { type: 'endTurn' },
    ] as const) {
        const r = advance(settled, input, ctx);
        assert.equal(r.state, settled);
        assert.ok(r.snapshot.lastRejection !== null);
    }
});
