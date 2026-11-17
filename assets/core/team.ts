import type { CharacterDef, GameConfig } from './state';
import type { Character } from './types';

export function isStartingParty(value: unknown, config: Pick<GameConfig, 'cardDefs' | 'startingDeck'>): value is readonly CharacterDef[] {
    if (!Array.isArray(value) || value.length < 2 || value.length > 3) return false;
    const ids = new Set<string>();
    const cards: string[] = [];
    for (const hero of value) {
        if (typeof hero !== 'object' || hero === null || typeof hero.id !== 'string' || hero.id.length === 0
            || ids.has(hero.id) || !['red', 'green', 'blue'].some(color => color === hero.color)
            || !Array.isArray(hero.startingDeck) || hero.startingDeck.length === 0) return false;
        ids.add(hero.id);
        for (const id of hero.startingDeck) {
            const def = config.cardDefs.find(card => card.id === id);
            if (typeof id !== 'string' || def === undefined || def.color !== hero.color) return false;
            cards.push(id);
        }
    }
    return cards.length === config.startingDeck.length && cards.every((id, i) => id === config.startingDeck[i]);
}

export function initialParty(config: GameConfig): Character[] {
    if (config.startingParty !== undefined && !isStartingParty(config.startingParty, config)) {
        throw new Error('Invalid starting party: select 2-3 unique characters with matching starting cards');
    }
    const heroes = config.startingParty ?? [
        { id: 'hero-red', color: 'red' as const }, { id: 'hero-blue', color: 'blue' as const },
    ];
    return heroes.map(hero => ({ id: hero.id, color: hero.color,
        hp: config.startHp, maxHp: config.startHp, block: 0, alive: true }));
}
