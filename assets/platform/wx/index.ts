// WeChat minigame PlatformAdapter: empty implementation (constitution v0.2 —
// release deferred). Memory storage + no-op ports keep the interface complete
// and compilable; real wx.* bindings are future work (M2/M3).
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
    onEvent(_handler: InputHandler): void { /* no platform input in M1 */ }
    offEvent(_handler: InputHandler): void { /* no-op */ }
}

class NoopAudio implements AudioPort {
    play(_clipId: string): void { /* no-op */ }
    stop(_clipId: string): void { /* no-op */ }
    setVolume(_volume: number): void { /* no-op */ }
}

class NoopAchievement implements AchievementPort {
    unlock(_id: string): void { /* no-op */ }
}

class NoopShare implements SharePort {
    share(_payload: SharePayload): void { /* wx.shareAppMessage in M2 */ }
}

export function createWxAdapter(): PlatformAdapter {
    return {
        storage: new MemoryStorage(),
        input: new NoopInput(),
        audio: new NoopAudio(),
        achievement: new NoopAchievement(),
        share: new NoopShare(),
    };
}
