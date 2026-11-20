// @ts-ignore - Cocos工具链不含Node内置类型。
import { readFileSync } from 'node:fs';
// @ts-ignore - 同上。
import { cwd } from 'node:process';
import { parseConfigPackage } from '../assets/game/ConfigPackage';
import type { ConfigDocuments, ConfigPackage } from '../assets/game/ConfigPackage';

export function configDocuments(): ConfigDocuments {
    const read = (name: string): unknown => JSON.parse(readFileSync(`${cwd()}/assets/resources/config/${name}.json`, 'utf8'));
    return { game: read('game'), characters: read('characters'), cards: read('cards'), enemies: read('enemies'),
        presentation: read('presentation') };
}

export function defaultConfigPackage(): ConfigPackage { return parseConfigPackage(configDocuments()); }
