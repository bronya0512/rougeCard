import type { CardDef, Color } from '../core';

export type CardEnergyCosts = Readonly<Partial<Record<Color, number>>>;

export function cardEnergyCosts(card: CardDef): CardEnergyCosts {
    return { [card.color]: card.cost };
}

export function layoutCardCosts(costs: CardEnergyCosts): ReadonlyArray<{
    readonly color: Color;
    readonly amount: number;
    readonly x: number;
    readonly y: number;
}> {
    const result: Array<{ color: Color; amount: number; x: number; y: number }> = [];
    for (const color of ['red', 'green', 'blue', 'white'] as const) {
        const amount = costs[color];
        if (amount === undefined) continue;
        result.push({ color, amount, x: -56, y: 78 - result.length * 28 });
    }
    return result;
}
