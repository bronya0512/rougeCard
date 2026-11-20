// @ts-ignore - Cocos工具链不含Node内置类型。
import { test } from 'node:test';
// @ts-ignore - 同上。
import * as assert from 'node:assert/strict';
import { configObject, hexDistance } from '../../assets/core';
import { parseConfigPackage, parsePresentation } from '../../assets/game/ConfigPackage';
import type { ConfigDocuments } from '../../assets/game/ConfigPackage';
import { TeamSelection } from '../../assets/game/TeamSelection';
import { GameSession, SAVE_KEY } from '../../assets/game/GameSession';
import type { StoragePort } from '../../assets/core';
import { configDocuments, defaultConfigPackage } from '../config-fixture';

function rows(value: unknown): Record<string, unknown>[] {
    if (!Array.isArray(value)) throw new Error('Expected array');
    const values: readonly unknown[] = value;
    return values.map((item, i) => ({ ...configObject(item, `rows[${i}]`) }));
}

function select(documents: ConfigDocuments, ids: readonly string[] = ['hero-red', 'hero-blue']): TeamSelection {
    const selection = new TeamSelection(parseConfigPackage(documents).content);
    ids.forEach(id => selection.toggle(id));
    return selection;
}

test('003: real five JSON files preserve golden defaults and original ordered duplicates', () => {
    const { content, presentation } = defaultConfigPackage();
    assert.deepEqual(content.game, { seed: 20261116, floorCount: 3, mapRadius: 2, startHp: 30, energyPerTurn: 1,
        drawPerTurn: 5, restHeal: 10, rewardCount: 3, restNodes: 1 });
    assert.deepEqual(content.characters, [
        { id: 'hero-red', color: 'red', startingDeck: ['r-atk', 'r-atk', 'r-def'] },
        { id: 'hero-green', color: 'green', startingDeck: ['g-atk', 'g-atk', 'g-def'] },
        { id: 'hero-blue', color: 'blue', startingDeck: ['b-atk', 'b-atk', 'b-def'] },
    ]);
    assert.deepEqual(content.cards.map(card => [card.id, card.name, card.color, card.cost, card.effect]), [
        ['r-atk', 'Red Strike', 'red', 1, { kind: 'attack', damage: 4 }], ['r-def', 'Red Guard', 'red', 1, { kind: 'defend', block: 3 }],
        ['g-atk', 'Green Strike', 'green', 1, { kind: 'attack', damage: 4 }], ['g-def', 'Green Guard', 'green', 1, { kind: 'defend', block: 3 }],
        ['b-atk', 'Blue Strike', 'blue', 1, { kind: 'attack', damage: 4 }], ['b-def', 'Blue Guard', 'blue', 1, { kind: 'defend', block: 3 }],
    ]);
    assert.deepEqual(content.enemies, [{ id: 'normal', hp: 12, damage: 3 }, { id: 'boss', hp: 24, damage: 5 }]);
    assert.equal(select(configDocuments()).createConfig().startingDeck.length, 6);
    const ordered = select(configDocuments(), ['hero-blue', 'hero-red', 'hero-green']).createConfig();
    assert.deepEqual(ordered.startingParty?.map(hero => hero.id), ['hero-blue', 'hero-red', 'hero-green']);
    assert.deepEqual(ordered.startingDeck, ['b-atk', 'b-atk', 'b-def', 'r-atk', 'r-atk', 'r-def', 'g-atk', 'g-atk', 'g-def']);
    assert.equal(Object.keys(presentation).length, 12);
    for (const [key, entry] of Object.entries(presentation)) {
        assert.equal(entry.path, `${key}/spriteFrame`);
        assert.equal(entry.flip, key === 'hero_blue' || key === 'enemy_boss');
    }
});

test('003: configuration alone changes deck copies and supported numerical parameters', () => {
    const documents = configDocuments();
    const characters = rows(documents.characters);
    characters[0]!.startingDeck = ['r-atk', 'r-atk', 'r-atk', 'r-def', 'r-def'];
    const game = { ...configObject(documents.game, 'game'), floorCount: 5, startHp: 42, seed: 17 };
    const cards = rows(documents.cards);
    cards[0]!.effect = { kind: 'attack', damage: 7 };
    const config = select({ ...documents, game, cards, characters }).createConfig();
    assert.equal(config.startingDeck.length, 8);
    assert.equal(config.startHp, 42);
    assert.equal(config.floorCount, 5);
    assert.equal(config.seed, 17);
    assert.deepEqual(config.cardDefs[0]!.effect, { kind: 'attack', damage: 7 });
    assert.equal(select(configDocuments()).createConfig().startingDeck.length, 6);
});

for (const [key, value] of [
    ['seed', Infinity], ['floorCount', 1], ['floorCount', '3'], ['mapRadius', 0], ['mapRadius', 1.5],
    ['startHp', 0], ['energyPerTurn', -1], ['drawPerTurn', 0], ['restHeal', -1], ['rewardCount', 4],
    ['rewardCount', 0], ['restNodes', 7],
] as const) {
    test(`003: invalid game.${key}=${value} gives a field error`, () => {
        const documents = configDocuments();
        assert.throws(() => parseConfigPackage({ ...documents, game: { ...configObject(documents.game, 'game'), [key]: value } }),
            new RegExp(`game\\.${key}`));
    });
}

for (const file of ['game', 'characters', 'cards', 'enemies', 'presentation'] as const) {
    test(`003: missing or malformed ${file} is rejected`, () => {
        assert.throws(() => parseConfigPackage({ ...configDocuments(), [file]: null }), new RegExp(file));
    });
}

test('003: duplicate card IDs and unknown effect kinds are rejected with a field path', () => {
    const documents = configDocuments();
    const cards = rows(documents.cards);
    cards[1]!.id = cards[0]!.id;
    assert.throws(() => parseConfigPackage({ ...documents, cards }), /cards\[1\]\.id/);
    cards[1]!.id = 'r-def';
    cards[0]!.effect = { kind: 'draw', count: 1 };
    assert.throws(() => parseConfigPackage({ ...documents, cards }), /cards\[0\]\.effect.kind/);
});

test('003: validates the entire roster, references, colors and duplicate IDs', () => {
    const documents = configDocuments();
    for (const deck of [['missing'], ['b-atk']]) {
        const characters = rows(documents.characters);
        characters[0]!.startingDeck = deck;
        assert.throws(() => parseConfigPackage({ ...documents, characters }), /characters\[0\]\.startingDeck\[0\]/);
    }
    const characters = rows(documents.characters);
    characters[1]!.id = characters[0]!.id;
    assert.throws(() => parseConfigPackage({ ...documents, characters }), /characters\[1\]\.id/);
    assert.throws(() => parseConfigPackage({ ...documents, characters: characters.slice(0, 2) }), /characters/);
});

test('003: enemy identity/order, duplicate IDs and supported numerical fields are validated', () => {
    const documents = configDocuments();
    const enemies = rows(documents.enemies);
    assert.throws(() => parseConfigPackage({ ...documents, enemies: [...enemies].reverse() }), /enemies/);
    enemies[1]!.id = 'normal';
    assert.throws(() => parseConfigPackage({ ...documents, enemies }), /enemies\[1\]\.id/);
    enemies[1]!.id = 'boss';
    enemies[0]!.hp = 0;
    assert.throws(() => parseConfigPackage({ ...documents, enemies }), /enemies\[0\]\.hp/);
});

test('003: presentation is complete, typed and uses relative SpriteFrame paths', () => {
    const raw = configObject(configDocuments().presentation, 'presentation');
    const missing = { ...raw }; delete missing.hero_blue;
    assert.throws(() => parsePresentation(missing), /presentation.hero_blue/);
    assert.throws(() => parsePresentation({ ...raw, hero_blue: { path: 'hero_blue/spriteFrame', flip: 'true' } }), /flip/);
    assert.throws(() => parsePresentation({ ...raw, hero_blue: { path: '../hero_blue.png', flip: true } }), /path/);
    const parsed = parsePresentation({ ...raw, hero_blue: { path: 'other/portrait/spriteFrame', flip: false } });
    assert.deepEqual(parsed.hero_blue, { path: 'other/portrait/spriteFrame', flip: false });
});

test('003: configuration failure and selection never write saved state, changed config does not replace old run or RNG', () => {
    const values = new Map<string, string>();
    let writes = 0;
    const storage: StoragePort = { get: key => values.get(key) ?? null,
        set: (key, value) => { writes++; values.set(key, value); }, remove: key => { writes++; values.delete(key); } };
    const config = select(configDocuments()).createConfig();
    const session = new GameSession(config, { storage, now: () => 100 });
    const map = session.snapshot.map;
    const target = map.nodes.find(node => node.kind === 'battle' && hexDistance(node.coord, map.position) === 1)!;
    session.dispatch({ type: 'move', to: target.coord });
    const raw = storage.get(SAVE_KEY);
    const before = writes;
    assert.throws(() => parseConfigPackage({ ...configDocuments(), game: null }));
    const saved = GameSession.readSave(storage)!;
    assert.equal(storage.get(SAVE_KEY), raw);
    assert.equal(writes, before);
    const documents = configDocuments();
    const changed = select({ ...documents, game: { ...configObject(documents.game, 'game'), seed: 7, startHp: 99, floorCount: 5 } },
        ['hero-green', 'hero-blue']).createConfig();
    const resumed = new GameSession(changed, { storage, now: () => 100, restored: saved });
    const control = new GameSession(saved.state.config, { now: () => 100, restored: saved });
    assert.deepEqual(resumed.snapshot, session.snapshot);
    assert.deepEqual(resumed.snapshot.party.map(hero => hero.maxHp), [30, 30]);
    assert.equal(resumed.snapshot.floorCount, 3);
    assert.equal(storage.get(SAVE_KEY), raw);
    assert.equal(writes, before);
    assert.deepEqual(resumed.dispatch({ type: 'endTurn' }), control.dispatch({ type: 'endTurn' }));
});

test('003: unavailable content refuses selection and new configuration', () => {
    const selection = new TeamSelection(null);
    assert.equal(selection.toggle('hero-red'), false);
    assert.equal(selection.canConfirm, false);
    assert.deepEqual(selection.roster, []);
    assert.throws(() => selection.createConfig(), /配置/);
});
