// Windows (Steam) PlatformAdapter: empty implementation. Memory storage +
// no-op ports keep the interface complete and compilable; real filesystem /
// Steamworks bindings are M3 work.
import type {
    AchievementPort,
    AudioPort,
    InputHandler,
    InputPort,
    PlatformAdapter,
    SharePayload,
    SharePort,
    StoragePort,
} from '../../core';

class MemoryStorage implements StoragePort {
    private readonly data = new Map<string, string>();
    get(key: string): string | null {
        return this.data.has(key) ? this.data.get(key)! : null;
    }
    set(key: string, value: string): void {
        this.data.set(key, value);
    }
    remove(key: string): void {
        this.data.delete(key);
    }
}

class NoopInput implements InputPort {
    onEvent(_handler: InputHandler): void { /* no-op */ }
    offEvent(_handler: InputHandler): void { /* no-op */ }
}

class NoopAudio implements AudioPort {
    play(_clipId: string): void { /* no-op */ }
    stop(_clipId: string): void { /* no-op */ }
    setVolume(_volume: number): void { /* no-op */ }
}

class NoopAchievement implements AchievementPort {
    unlock(_id: string): void { /* Steamworks in M3 */ }
}

class NoopShare implements SharePort {
    share(_payload: SharePayload): void { /* no-op */ }
}

export function createWinAdapter(): PlatformAdapter {
    return {
        storage: new MemoryStorage(),
        input: new NoopInput(),
        audio: new NoopAudio(),
        achievement: new NoopAchievement(),
        share: new NoopShare(),
    };
}
