// Web PlatformAdapter implementation (plan section 3). This is the only layer
// allowed to touch browser APIs; core/game never import these (AC-4). Cocos'
// tsconfig has no DOM lib, so the globals we need are declared minimally here.
import type {
    AchievementPort,
    AudioPort,
    InputHandler,
    InputPort,
    PlatformAdapter,
    PlatformInputEvent,
    SharePayload,
    SharePort,
    StoragePort,
} from '../../core';

declare const localStorage: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
};
declare function addEventListener(type: string, listener: (event: unknown) => void): void;
declare function removeEventListener(type: string, listener: (event: unknown) => void): void;
declare const console: { warn(...args: unknown[]): void };

export function installCanvasContextMenuGuard(): () => void {
    const handler = (event: unknown): void => {
        const e = event as { target?: { tagName?: string }; preventDefault(): void };
        if (e.target?.tagName === 'CANVAS') e.preventDefault();
    };
    addEventListener('contextmenu', handler);
    return () => removeEventListener('contextmenu', handler);
}

class WebStorage implements StoragePort {
    get(key: string): string | null {
        return localStorage.getItem(key);
    }
    set(key: string, value: string): void {
        localStorage.setItem(key, value);
    }
    remove(key: string): void {
        localStorage.removeItem(key);
    }
}

type KeyOrPointerEvent = {
    readonly key?: string;
    readonly clientX?: number;
    readonly clientY?: number;
};

class WebInput implements InputPort {
    private readonly handlers: InputHandler[] = [];
    private readonly onKey = (event: unknown): void => {
        const e = event as KeyOrPointerEvent;
        if (e.key === undefined) return;
        this.emit({ kind: 'key', key: e.key });
    };
    private readonly onPointer = (event: unknown): void => {
        const e = event as KeyOrPointerEvent;
        this.emit({ kind: 'pointer', x: e.clientX, y: e.clientY });
    };

    onEvent(handler: InputHandler): void {
        if (this.handlers.indexOf(handler) >= 0) return;
        if (this.handlers.length === 0) {
            addEventListener('keydown', this.onKey);
            addEventListener('pointerdown', this.onPointer);
        }
        this.handlers.push(handler);
    }

    offEvent(handler: InputHandler): void {
        const idx = this.handlers.indexOf(handler);
        if (idx < 0) return;
        this.handlers.splice(idx, 1);
        if (this.handlers.length === 0) {
            removeEventListener('keydown', this.onKey);
            removeEventListener('pointerdown', this.onPointer);
        }
    }

    private emit(event: PlatformInputEvent): void {
        for (const h of this.handlers.slice()) h(event);
    }
}

class WebAudio implements AudioPort {
    play(_clipId: string): void {
        // M1 ships no audio assets; no-op is a valid implementation.
    }
    stop(_clipId: string): void {
        // no-op
    }
    setVolume(_volume: number): void {
        // no-op
    }
}

class WebAchievement implements AchievementPort {
    unlock(_id: string): void {
        // no-op in M1
    }
}

class WebShare implements SharePort {
    share(_payload: SharePayload): void {
        console.warn('[web] share not implemented');
    }
}

/** Create the Web adapter. Called once at startup by the game layer. */
export function createWebAdapter(): PlatformAdapter {
    return {
        storage: new WebStorage(),
        input: new WebInput(),
        audio: new WebAudio(),
        achievement: new WebAchievement(),
        share: new WebShare(),
    };
}
