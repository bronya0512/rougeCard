// Hex map generation (FR-8 / AC-7). Pure TypeScript.
// M1: single layer, radius 2, start at center, one boss on the outer ring,
// configured number of rest nodes, all other cells are battle nodes.
import type { GameConfig, Rng } from './state';
import type { GameMap, HexCoord, MapNode, NodeKind } from './types';

/** Hex distance in axial coordinates. */
export function hexDistance(a: HexCoord, b: HexCoord): number {
    const dq = a.q - b.q;
    const dr = a.r - b.r;
    return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** All axial coordinates within radius (center included). */
function coordsWithin(radius: number): HexCoord[] {
    const out: HexCoord[] = [];
    for (let q = -radius; q <= radius; q += 1) {
        for (let r = -radius; r <= radius; r += 1) {
            if (Math.abs(q + r) <= radius) out.push({ q, r });
        }
    }
    return out;
}

/** Fisher-Yates using the injected Rng (deterministic for a given seed). */
function shuffle<T>(items: readonly T[], rng: Rng): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i -= 1) {
        const j = rng.int(i + 1);
        const tmp = out[i]!;
        out[i] = out[j]!;
        out[j] = tmp;
    }
    return out;
}

/**
 * Generate the M1 map. The center is the start (no node kind, already visited);
 * exactly one boss sits on the outer ring; `restNodes` cells become rest;
 * every other non-center cell becomes a battle node.
 */
export function generateMap(config: GameConfig, rng: Rng): GameMap {
    const start: HexCoord = { q: 0, r: 0 };
    const all = coordsWithin(config.mapRadius);
    const outer = all.filter((c) => hexDistance(c, start) === config.mapRadius);
    const inner = all.filter((c) => hexDistance(c, start) > 0 && hexDistance(c, start) < config.mapRadius);

    const boss = shuffle(outer, rng)[0]!;
    const restCells = new Set(
        shuffle(inner, rng)
            .slice(0, Math.min(config.restNodes, inner.length))
            .map((c) => `${c.q},${c.r}`),
    );

    const nodes: MapNode[] = all.map((coord) => {
        let kind: NodeKind | null;
        let visited = false;
        if (coord.q === start.q && coord.r === start.r) {
            kind = null;
            visited = true;
        } else if (coord.q === boss.q && coord.r === boss.r) {
            kind = 'boss';
        } else {
            kind = restCells.has(`${coord.q},${coord.r}`) ? 'rest' : 'battle';
        }
        return { coord, kind, visited };
    });

    return { radius: config.mapRadius, nodes, start, boss };
}
