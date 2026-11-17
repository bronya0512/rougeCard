// Deterministic seeded RNG (mulberry32). Pure TypeScript, no engine/platform
// imports. Used by callers to build the injected Rng; core never calls
// Math.random or reads wall-clock time directly (constitution section 4).
import type { Rng } from './state';

/** Create a reproducible Rng from a numeric seed. */
export function createSeededRng(seed: number): Rng {
    let state = seed >>> 0;
    const next = (): number => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return {
        next,
        int: (maxExclusive: number): number => Math.floor(next() * maxExclusive),
        pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!,
    };
}

/** A Clock injected from outside; core tests supply a fixed tick. */
export function createFixedClock(tick: number): { now(): number } {
    return { now: () => tick };
}
