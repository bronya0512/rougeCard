import { JsonAsset, resources } from 'cc';
import { CONFIG_NAMES, parseConfigPackage } from './ConfigPackage';
import type { ConfigDocuments, ConfigName, ConfigPackage } from './ConfigPackage';

export class ConfigLoader {
    private disposed = false;
    private started = false;
    private finished = false;

    load(done: (config: ConfigPackage | null, error: string) => void): void {
        if (this.started || this.disposed) return;
        this.started = true;
        const documents: Partial<Record<ConfigName, unknown>> = {};
        let remaining = CONFIG_NAMES.length;
        const finish = (config: ConfigPackage | null, error: string): void => {
            if (this.finished || this.disposed) return;
            this.finished = true;
            done(config, error);
        };
        for (const name of CONFIG_NAMES) {
            resources.load(`config/${name}`, JsonAsset, (error, asset) => {
                if (asset !== undefined && asset !== null) asset.addRef();
                try {
                    if (this.disposed || this.finished) return;
                    if (error || asset === undefined || asset === null) {
                        finish(null, `config/${name}: 加载失败${error ? ` (${error.message})` : ''}`);
                        return;
                    }
                    const value: unknown = asset.json;
                    documents[name] = value;
                    remaining -= 1;
                    if (remaining !== 0) return;
                    const input: ConfigDocuments = { game: documents.game, characters: documents.characters,
                        cards: documents.cards, enemies: documents.enemies, presentation: documents.presentation };
                    let config: ConfigPackage;
                    try {
                        config = parseConfigPackage(input);
                    } catch (reason: unknown) {
                        finish(null, reason instanceof Error ? reason.message : '配置校验失败');
                        return;
                    }
                    finish(config, '');
                } finally {
                    if (asset !== undefined && asset !== null) asset.decRef();
                }
            });
        }
    }

    destroy(): void { this.disposed = true; }
}
