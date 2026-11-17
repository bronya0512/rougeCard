import type { CardDef, CharacterDef, GameConfig } from '../core';

export const TEAM_ROSTER: readonly CharacterDef[] = [
    { id: 'hero-red', color: 'red', startingDeck: ['r-atk', 'r-atk', 'r-def'] },
    { id: 'hero-green', color: 'green', startingDeck: ['g-atk', 'g-atk', 'g-def'] },
    { id: 'hero-blue', color: 'blue', startingDeck: ['b-atk', 'b-atk', 'b-def'] },
];

export class TeamSelection {
    private readonly ids: string[] = [];

    get selectedIds(): readonly string[] { return this.ids.slice(); }
    get canConfirm(): boolean { return this.ids.length >= 2 && this.ids.length <= 3; }

    toggle(id: string): boolean {
        if (!TEAM_ROSTER.some(hero => hero.id === id)) return false;
        const index = this.ids.indexOf(id);
        if (index >= 0) this.ids.splice(index, 1);
        else if (this.ids.length < 3) this.ids.push(id);
        return true;
    }

    reset(): void { this.ids.length = 0; }

    createConfig(seed: number, floorCount: number): GameConfig {
        if (!this.canConfirm) throw new Error('请选择2至3名角色');
        if (floorCount !== 3 && floorCount !== 4 && floorCount !== 5) throw new Error('层数必须是3、4或5');
        const startingParty = this.ids.map(id => {
            const hero = TEAM_ROSTER.find(item => item.id === id)!;
            return { ...hero, startingDeck: hero.startingDeck.slice() };
        });
        const cardDefs: CardDef[] = [];
        for (const hero of TEAM_ROSTER) {
            const prefix = hero.color[0];
            const name = hero.color[0].toUpperCase() + hero.color.slice(1);
            cardDefs.push(
                { id: `${prefix}-atk`, name: `${name} Strike`, color: hero.color, cost: 1, effect: { kind: 'attack', damage: 4 } },
                { id: `${prefix}-def`, name: `${name} Guard`, color: hero.color, cost: 1, effect: { kind: 'defend', block: 3 } },
            );
        }
        return {
            seed, floorCount, mapRadius: 2, startHp: 30, energyPerTurn: 1, drawPerTurn: 5,
            restHeal: 10, rewardCount: 3, restNodes: 1, cardDefs, startingParty,
            startingDeck: startingParty.reduce<string[]>((cards, hero) => cards.concat(hero.startingDeck), []),
            enemies: [{ id: 'normal', hp: 12, damage: 3 }, { id: 'boss', hp: 24, damage: 5 }],
        };
    }
}
