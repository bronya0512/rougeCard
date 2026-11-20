// @ts-ignore
import { test } from 'node:test';
// @ts-ignore
import * as assert from 'node:assert/strict';
import { cardEnergyCosts, layoutCardCosts } from '../../assets/game/CardCostLayout';
import type { CardDef } from '../../assets/core';

const card: CardDef = { id: 'guard', name: 'Guard', color: 'green', cost: 2, effect: { kind: 'defend', block: 3 } };

test('004: card badges show the required color without inventing white surcharge', () => {
    assert.deepEqual(cardEnergyCosts(card), { green: 2 });
    assert.deepEqual(layoutCardCosts(cardEnergyCosts(card)), [{ color: 'green', amount: 2, x: -56, y: 78 }]);
});

test('004: mixed presentation costs stack red green blue white from top to bottom', () => {
    const source = Object.freeze({ white: 1, blue: 3, red: 2, green: 4 });
    const result = layoutCardCosts(source);
    assert.deepEqual(result.map(item => item.color), ['red', 'green', 'blue', 'white']);
    assert.deepEqual(result.map(item => item.amount), [2, 4, 3, 1]);
    assert.deepEqual(result.map(item => item.y), [78, 50, 22, -6]);
    assert.ok(result.every(item => item.x === -56));
    assert.deepEqual(source, { white: 1, blue: 3, red: 2, green: 4 });
});

test('004: zero and fractional costs remain visible, missing colors leave no gaps', () => {
    assert.deepEqual(layoutCardCosts({ blue: 0, white: 1.5 }), [
        { color: 'blue', amount: 0, x: -56, y: 78 },
        { color: 'white', amount: 1.5, x: -56, y: 50 },
    ]);
    assert.deepEqual(layoutCardCosts({}), []);
});
