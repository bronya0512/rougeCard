// Platform port interfaces. Pure TypeScript contract (constitution section 3):
// core defines the ports, platform/{web,wx,win} provide implementations. This
// keeps core independent of any engine/platform API (dependency inversion).
// No platform API calls live in this file.

/** Key-value persistence used by FR-5 save/load. */
export interface StoragePort {
    get(key: string): string | null;
    set(key: string, value: string): void;
    remove(key: string): void;
}

/** A normalized input event produced by the platform input adapter. */
export interface PlatformInputEvent {
    readonly kind: 'key' | 'pointer';
    /** Key name for 'key' events (e.g. 'Enter', 'Escape'). */
    readonly key?: string;
    /** Screen coordinates for 'pointer' events. */
    readonly x?: number;
    readonly y?: number;
}

export type InputHandler = (event: PlatformInputEvent) => void;

/** Input normalization port; game/ subscribes and maps to GameInput (FR-2). */
export interface InputPort {
    onEvent(handler: InputHandler): void;
    offEvent(handler: InputHandler): void;
}

/** Audio port (M1: no-op is a valid implementation). */
export interface AudioPort {
    play(clipId: string): void;
    stop(clipId: string): void;
    setVolume(volume: number): void;
}

/** Achievement port (M1: no-op; Steamworks in M3). */
export interface AchievementPort {
    unlock(id: string): void;
}

/** Share payload and port (M1: no-op; wx.shareAppMessage in M2). */
export interface SharePayload {
    readonly title: string;
    readonly description?: string;
}
export interface SharePort {
    share(payload: SharePayload): void;
}

/** The single adapter injected once at startup (plan section 2/3). */
export interface PlatformAdapter {
    readonly storage: StoragePort;
    readonly input: InputPort;
    readonly audio: AudioPort;
    readonly achievement: AchievementPort;
    readonly share: SharePort;
}
