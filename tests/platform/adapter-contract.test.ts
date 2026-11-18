// @ts-ignore - Cocos 工具链不含 Node 内置类型，运行时使用 node:test。
import { test } from 'node:test';
// @ts-ignore - 同上。
import * as assert from 'node:assert/strict';
import {
    advance, buildSnapshot, createFixedClock, createSeededRng, hexDistance, initGame, SAVE_SCHEMA_VERSION,
} from '../../assets/core';
import type { GameConfig, GameInput, PlatformAdapter, SaveData, Snapshot } from '../../assets/core';
import { GameSession, SAVE_KEY } from '../../assets/game/GameSession';
import { TeamSelection } from '../../assets/game/TeamSelection';
import { createWebAdapter } from '../../assets/platform/web';
import { createWxAdapter } from '../../assets/platform/wx';
import { createWinAdapter } from '../../assets/platform/win';

const factories = [
    { name: 'web', create: createWebAdapter },
    { name: 'wx', create: createWxAdapter },
    { name: 'win', create: createWinAdapter },
] as const;
const savedAt = 1234;

function withWebStorage(run: () => void): void {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const values = new Map<string, string>();
    const browserStorage = {
        getItem: (key: string): string | null => values.get(key) ?? null,
        setItem: (key: string, value: string): void => { values.set(key, value); },
        removeItem: (key: string): void => { values.delete(key); },
    };
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: browserStorage });
    try { run(); }
    finally {
        if (original !== undefined) Object.defineProperty(globalThis, 'localStorage', original);
        else Reflect.deleteProperty(globalThis, 'localStorage');
    }
    assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), original);
}

interface Frame {
    readonly result: Snapshot;
    readonly save: SaveData;
}

function recordRun(c: GameConfig, outcome: 'victory' | 'defeat') {
    const rng = createSeededRng(c.seed);
    const ctx = { clock: createFixedClock(0), rng };
    let state = initGame(c, ctx).state;
    const inputs: GameInput[] = [];
    const frames: Frame[] = [];
    let reshuffles = 0;
    const frame = (result: Snapshot): Frame => ({ result,
        save: { schemaVersion: SAVE_SCHEMA_VERSION, savedAt, state, rngState: rng.getState() } });
    frames.push(frame(buildSnapshot(state)));
    const step = (input: GameInput): void => {
        const before = state;
        const result = advance(state, input, ctx);
        state = result.state;
        if (input.type === 'endTurn' && state.phase === 'battle' && before.deck.drawPile.length < c.drawPerTurn) {
            reshuffles += 1;
        }
        inputs.push(input);
        frames.push(frame(result.snapshot));
    };
    step({ type: 'start' });
    step({ type: 'move', to: { q: 99, r: 99 } });
    for (let guard = 0; state.phase !== outcome && guard < 500; guard += 1) {
        const s = buildSnapshot(state);
        let input: GameInput;
        if (s.phase === 'map') {
            const next = s.map.nodes.find(node => hexDistance(node.coord, s.map.position) === 1
                && (outcome === 'defeat' ? node.kind === 'battle'
                    : hexDistance(node.coord, s.map.boss) < hexDistance(s.map.position, s.map.boss)));
            if (next === undefined) throw new Error('No route in contract fixture');
            input = { type: 'move', to: next.coord };
        } else if (s.phase === 'battle') {
            const card = s.hand.find(item => item.playable && item.def.effect.kind === 'attack');
            input = outcome === 'defeat' || card === undefined ? { type: 'endTurn' }
                : { type: 'playCard', uid: card.uid };
        } else if (s.phase === 'reward') {
            input = { type: 'chooseReward', defId: s.rewardCandidates[0]!.id };
        } else { throw new Error(`Unexpected contract phase ${s.phase}`); }
        step(input);
        assert.equal(frames[frames.length - 1]!.result.lastRejection, null);
    }
    assert.equal(state.phase, outcome);
    if (outcome === 'victory') {
        assert.equal(state.floor, c.floorCount);
        assert.ok(reshuffles > 0);
        assert.ok(inputs.some(input => input.type === 'chooseReward'));
    } else { assert.ok(state.party.every(hero => !hero.alive && hero.hp === 0)); }
    const settledIndex = frames.length - 1;
    for (const input of [
        { type: 'start' }, { type: 'move', to: { q: 0, r: 0 } },
        { type: 'playCard', uid: 'missing-card' }, { type: 'endTurn' },
        { type: 'chooseReward', defId: 'missing-reward' },
    ] as const) step(input);
    const checkpoints = [0,
        frames.findIndex(item => item.save.state.phase === 'battle' && (item.save.state.battle?.turn ?? 0) >= 2),
        frames.findIndex(item => item.save.state.phase === 'reward'),
        frames.findIndex(item => item.save.state.floor === 2 && item.save.state.phase === 'map'),
        frames.findIndex(item => item.save.state.phase === 'battle'
            && hexDistance(item.save.state.position, item.save.state.map.boss) === 0),
        settledIndex,
    ].filter(index => index >= 0);
    return { inputs, frames, checkpoints: [...new Set(checkpoints)], reshuffles };
}

function verifyStored(session: GameSession, adapter: PlatformAdapter, frame: Frame): void {
    assert.equal(JSON.stringify(session.snapshot), JSON.stringify(buildSnapshot(frame.save.state)));
    assert.deepEqual(GameSession.readSave(adapter.storage), frame.save);
    assert.equal(GameSession.readSave(adapter.storage)!.rngState, frame.save.rngState);
    assert.equal(adapter.storage.get('unrelated'), 'keep');
}

test('T118/AC-1: real adapter factories implement get/set/remove and keep their stores separate', () => {
    withWebStorage(() => {
        const adapters = factories.map(factory => ({ name: factory.name, adapter: factory.create() }));
        assert.notEqual(adapters[0]!.adapter.storage, adapters[1]!.adapter.storage);
        assert.notEqual(adapters[1]!.adapter.storage, adapters[2]!.adapter.storage);
        for (const { name, adapter } of adapters) {
            assert.equal(adapter.storage.get('missing'), null);
            adapter.storage.set('same-key', name);
            adapter.storage.set('other-key', '保留内容');
        }
        for (const { name, adapter } of adapters) {
            assert.equal(adapter.storage.get('same-key'), name);
            adapter.storage.set('same-key', `${name}-updated`);
            assert.equal(adapter.storage.get('same-key'), `${name}-updated`);
            adapter.storage.remove('same-key');
            adapter.storage.remove('missing');
            assert.equal(adapter.storage.get('same-key'), null);
            assert.equal(adapter.storage.get('other-key'), '保留内容');
        }
    });
});

const cases = [
    { name: 'two-three-floors', ids: ['hero-red', 'hero-blue'], floors: 3, seed: 20261116, outcome: 'victory' },
    { name: 'three-three-floors', ids: ['hero-green', 'hero-red', 'hero-blue'], floors: 3, seed: 17, outcome: 'victory' },
    { name: 'three-five-floors', ids: ['hero-blue', 'hero-green', 'hero-red'], floors: 5, seed: 23, outcome: 'victory' },
    { name: 'two-defeat', ids: ['hero-red', 'hero-blue'], floors: 3, seed: 2, outcome: 'defeat' },
] as const;

for (const item of cases) {
    test(`T118/AC-1: ${item.name} S1 and resumed suffixes match across web/wx/win factories`, () => {
        withWebStorage(() => {
            const selection = new TeamSelection();
            for (const id of item.ids) assert.equal(selection.toggle(id), true);
            const base = selection.createConfig(item.seed, item.floors);
            const c: GameConfig = { ...base, drawPerTurn: 2, startHp: item.outcome === 'victory' ? 1000 : 5,
                enemies: [{ id: 'normal', hp: item.outcome === 'victory' ? 8 : 1000,
                    damage: item.outcome === 'victory' ? 1 : 5 }, { id: 'boss', hp: 12, damage: 1 }] };
            const reference = recordRun(c, item.outcome);
            const repeated = recordRun(c, item.outcome);
            assert.deepEqual(repeated.inputs, reference.inputs);
            assert.deepEqual(repeated.frames, reference.frames);
            const runs = factories.map(factory => {
                const adapter = factory.create();
                adapter.storage.remove(SAVE_KEY);
                adapter.storage.set('unrelated', 'keep');
                const session = new GameSession(c, { storage: adapter.storage, now: () => savedAt });
                session.save();
                verifyStored(session, adapter, reference.frames[0]!);
                return { name: factory.name, adapter, session,
                    snapshots: [JSON.stringify(session.snapshot)], saves: [adapter.storage.get(SAVE_KEY)!] };
            });
            for (let index = 0; index < reference.inputs.length; index += 1) {
                const frame = reference.frames[index + 1]!;
                for (const run of runs) {
                    const before = run.adapter.storage.get(SAVE_KEY);
                    const result = run.session.dispatch(reference.inputs[index]!);
                    assert.equal(JSON.stringify(result), JSON.stringify(frame.result));
                    verifyStored(run.session, run.adapter, frame);
                    if (result.lastRejection !== null) assert.equal(run.adapter.storage.get(SAVE_KEY), before);
                    run.snapshots.push(JSON.stringify(result));
                    run.saves.push(run.adapter.storage.get(SAVE_KEY)!);
                }
                assert.deepEqual(runs[0]!.snapshots, runs[1]!.snapshots);
                assert.deepEqual(runs[1]!.snapshots, runs[2]!.snapshots);
                assert.deepEqual(runs[0]!.saves, runs[1]!.saves);
                assert.deepEqual(runs[1]!.saves, runs[2]!.saves);
            }
            for (const run of runs) {
                for (const checkpoint of reference.checkpoints) {
                    const saved = run.saves[checkpoint]!;
                    run.adapter.storage.set(SAVE_KEY, saved);
                    const resumed = GameSession.load(run.adapter.storage, c, () => savedAt);
                    assert.equal(run.adapter.storage.get(SAVE_KEY), saved);
                    verifyStored(resumed, run.adapter, reference.frames[checkpoint]!);
                    for (let index = checkpoint; index < reference.inputs.length; index += 1) {
                        const result = resumed.dispatch(reference.inputs[index]!);
                        assert.equal(JSON.stringify(result), run.snapshots[index + 1]);
                        verifyStored(resumed, run.adapter, reference.frames[index + 1]!);
                    }
                    assert.equal(run.adapter.storage.get(SAVE_KEY), run.saves[run.saves.length - 1]);
                }
            }
            const last = reference.frames[reference.frames.length - 1]!.save;
            console.log(`ADAPTER_CONTRACT_RESULT ${JSON.stringify({
                case: item.name, source: 'node-process-contract', factories: factories.map(factory => factory.name),
                seed: c.seed, clock: 0, savedAt, party: item.ids, floorCount: c.floorCount,
                inputs: reference.inputs.length, snapshots: reference.frames.length,
                checkpoints: reference.checkpoints.map(index => ({ index, phase: reference.frames[index]!.save.state.phase,
                    floor: reference.frames[index]!.save.state.floor })),
                restoredSuffixes: reference.checkpoints.length * factories.length, reshuffles: reference.reshuffles,
                finalPhase: last.state.phase, finalFloor: last.state.floor, finalRevision: last.state.revision,
                finalRngState: last.rngState, realPlatformValidation: false,
            })}`);
        });
    });
}
