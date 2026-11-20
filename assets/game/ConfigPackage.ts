import { configObject, configString, parseGameContent } from '../core/content';
import type { GameContent } from '../core/content';

export const ART_NAMES = [
    'battle_bg', 'hero_red', 'hero_green', 'hero_blue', 'enemy_normal', 'enemy_boss',
    'energy_red', 'energy_green', 'energy_blue', 'card_frame', 'icon_attack', 'icon_defend',
] as const;
export type ArtName = typeof ART_NAMES[number];
export type PresentationConfig = Readonly<Record<ArtName, { readonly path: string; readonly flip: boolean }>>;
export const CONFIG_NAMES = ['game', 'characters', 'cards', 'enemies', 'presentation'] as const;
export type ConfigName = typeof CONFIG_NAMES[number];
export type ConfigDocuments = Readonly<Record<ConfigName, unknown>>;
export interface ConfigPackage {
    readonly content: GameContent;
    readonly presentation: PresentationConfig;
}

export function parsePresentation(value: unknown): PresentationConfig {
    const record = configObject(value, 'presentation');
    const entries: Partial<Record<ArtName, { readonly path: string; readonly flip: boolean }>> = {};
    for (const name of ART_NAMES) {
        const path = `presentation.${name}`;
        const entry = configObject(record[name], path);
        const resourcePath = configString(entry.path, `${path}.path`);
        if (!/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\/spriteFrame$/.test(resourcePath))
            throw new Error(`${path}.path: 必须为resources相对SpriteFrame路径`);
        if (typeof entry.flip !== 'boolean') throw new Error(`${path}.flip: 必须是boolean`);
        entries[name] = { path: resourcePath, flip: entry.flip };
    }
    return {
        battle_bg: entries.battle_bg!, hero_red: entries.hero_red!, hero_green: entries.hero_green!, hero_blue: entries.hero_blue!,
        enemy_normal: entries.enemy_normal!, enemy_boss: entries.enemy_boss!, energy_red: entries.energy_red!,
        energy_green: entries.energy_green!, energy_blue: entries.energy_blue!, card_frame: entries.card_frame!,
        icon_attack: entries.icon_attack!, icon_defend: entries.icon_defend!,
    };
}

export function parseConfigPackage(documents: ConfigDocuments): ConfigPackage {
    return {
        content: parseGameContent(documents.game, documents.characters, documents.cards, documents.enemies),
        presentation: parsePresentation(documents.presentation),
    };
}
