import type { CharacterDef, GameConfig } from '../core';
import type { GameContent } from '../core/content';

export class TeamSelection {
    private readonly ids: string[] = [];

    constructor(readonly content: GameContent | null) {}

    get roster(): readonly CharacterDef[] { return this.content?.characters ?? []; }
    get selectedIds(): readonly string[] { return this.ids.slice(); }
    get canConfirm(): boolean { return this.ids.length >= 2 && this.ids.length <= 3; }

    toggle(id: string): boolean {
        if (!this.roster.some(hero => hero.id === id)) return false;
        const index = this.ids.indexOf(id);
        if (index >= 0) this.ids.splice(index, 1);
        else if (this.ids.length < 3) this.ids.push(id);
        return true;
    }

    reset(): void { this.ids.length = 0; }

    createConfig(seed = this.content?.game.seed, floorCount = this.content?.game.floorCount): GameConfig {
        if (this.content === null) throw new Error('配置尚未加载');
        if (!this.canConfirm) throw new Error('请选择2至3名角色');
        if (seed === undefined || !Number.isFinite(seed)) throw new Error('种子非法');
        if (floorCount !== 3 && floorCount !== 4 && floorCount !== 5) throw new Error('层数必须是3、4或5');
        const startingParty = this.ids.map(id => {
            const hero = this.roster.find(item => item.id === id)!;
            return { ...hero, startingDeck: hero.startingDeck.slice() };
        });
        return {
            ...this.content.game, seed, floorCount, startingParty,
            cardDefs: this.content.cards.map(card => ({ ...card, effect: { ...card.effect } })),
            startingDeck: startingParty.reduce<string[]>((cards, hero) => cards.concat(hero.startingDeck), []),
            enemies: this.content.enemies.map(enemy => ({ ...enemy })),
        };
    }
}
