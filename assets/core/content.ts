import type { CardDef, Color } from './types';
import type { CharacterDef, EnemyDef, GameConfig } from './state';

export type GameSettings = Omit<GameConfig, 'cardDefs' | 'startingDeck' | 'startingParty' | 'enemies'>;
export interface GameContent {
    readonly game: GameSettings;
    readonly characters: readonly CharacterDef[];
    readonly cards: readonly CardDef[];
    readonly enemies: readonly EnemyDef[];
}

export function configObject(value: unknown, path: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${path}: 必须是对象`);
    return value as Record<string, unknown>;
}

export function configString(value: unknown, path: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${path}: 必须是非空字符串`);
    return value;
}

function array(value: unknown, path: string): readonly unknown[] {
    if (!Array.isArray(value) || value.length === 0) throw new Error(`${path}: 必须是非空数组`);
    return value;
}

function number(value: unknown, path: string, minimum: number, integer = false): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum
        || (integer && !Number.isSafeInteger(value))) throw new Error(`${path}: 数值非法`);
    return value;
}

function color(value: unknown, path: string): Exclude<Color, 'white'> {
    if (value !== 'red' && value !== 'green' && value !== 'blue') throw new Error(`${path}: 只支持红绿蓝`);
    return value;
}

function unique<T extends { readonly id: string }>(items: readonly T[], path: string): void {
    const ids = new Set<string>();
    items.forEach((item, i) => {
        if (ids.has(item.id)) throw new Error(`${path}[${i}].id: 重复ID ${item.id}`);
        ids.add(item.id);
    });
}

export function parseGameContent(gameValue: unknown, characterValue: unknown, cardValue: unknown, enemyValue: unknown): GameContent {
    const g = configObject(gameValue, 'game');
    const floorCount = g.floorCount;
    if (floorCount !== 3 && floorCount !== 4 && floorCount !== 5) throw new Error('game.floorCount: 新局只支持3、4、5层');
    const game: GameSettings = {
        seed: number(g.seed, 'game.seed', -Number.MAX_VALUE), floorCount,
        mapRadius: number(g.mapRadius, 'game.mapRadius', 1, true),
        startHp: number(g.startHp, 'game.startHp', Number.MIN_VALUE),
        energyPerTurn: number(g.energyPerTurn, 'game.energyPerTurn', 0, true),
        drawPerTurn: number(g.drawPerTurn, 'game.drawPerTurn', 1, true),
        restHeal: number(g.restHeal, 'game.restHeal', 0),
        rewardCount: number(g.rewardCount, 'game.rewardCount', 1, true),
        restNodes: number(g.restNodes, 'game.restNodes', 0, true),
    };
    if (game.rewardCount > 3) throw new Error('game.rewardCount: 当前奖励界面最多3项');
    const innerCount = 3 * (game.mapRadius - 1) * game.mapRadius;
    if (game.restNodes > innerCount) throw new Error('game.restNodes: 超过内圈可用节点数量');
    const cards = array(cardValue, 'cards').map((value, i): CardDef => {
        const path = `cards[${i}]`;
        const card = configObject(value, path);
        const effect = configObject(card.effect, `${path}.effect`);
        const kind = effect.kind;
        if (kind !== 'attack' && kind !== 'defend') throw new Error(`${path}.effect.kind: 只支持attack/defend`);
        return {
            id: configString(card.id, `${path}.id`), name: configString(card.name, `${path}.name`),
            color: color(card.color, `${path}.color`), cost: number(card.cost, `${path}.cost`, 0),
            effect: kind === 'attack' ? { kind, damage: number(effect.damage, `${path}.effect.damage`, 0) }
                : { kind, block: number(effect.block, `${path}.effect.block`, 0) },
        };
    });
    unique(cards, 'cards');
    if (!cards.some(card => card.color === 'red' || card.color === 'blue')) throw new Error('cards: 现行红蓝奖励池不能为空');
    const characters = array(characterValue, 'characters').map((value, i): CharacterDef => {
        const path = `characters[${i}]`;
        const hero = configObject(value, path);
        const heroColor = color(hero.color, `${path}.color`);
        const startingDeck = array(hero.startingDeck, `${path}.startingDeck`).map((id, j) => {
            const refPath = `${path}.startingDeck[${j}]`;
            const defId = configString(id, refPath);
            const card = cards.find(def => def.id === defId);
            if (card === undefined || card.color !== heroColor) throw new Error(`${refPath}: 卡牌不存在或颜色不匹配`);
            return defId;
        });
        return { id: configString(hero.id, `${path}.id`), color: heroColor, startingDeck };
    });
    unique(characters, 'characters');
    if (characters.length !== 3 || new Set(characters.map(hero => hero.color)).size !== 3)
        throw new Error('characters: 当前名单须包含红绿蓝各一名');
    const enemies = array(enemyValue, 'enemies').map((value, i): EnemyDef => {
        const path = `enemies[${i}]`;
        const enemy = configObject(value, path);
        return { id: configString(enemy.id, `${path}.id`), hp: number(enemy.hp, `${path}.hp`, Number.MIN_VALUE),
            damage: number(enemy.damage, `${path}.damage`, 0) };
    });
    unique(enemies, 'enemies');
    if (enemies.length !== 2 || enemies[0]!.id !== 'normal' || enemies[1]!.id !== 'boss')
        throw new Error('enemies: 当前模板须依次为normal、boss');
    return { game, cards, characters, enemies };
}
