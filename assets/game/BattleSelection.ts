import type { GameInput, Snapshot } from '../core';

export type BattleTarget = { readonly kind: 'enemy'; readonly id: string }
    | { readonly kind: 'ally'; readonly id: string };

export class BattleSelection {
    private uid: string | null = null;
    private turn = 0;

    get selectedUid(): string | null {
        return this.uid;
    }

    select(snapshot: Snapshot, uid: string): boolean {
        const card = snapshot.hand.find(item => item.uid === uid);
        if (snapshot.phase !== 'battle' || card === undefined || !card.playable) return false;
        this.uid = this.uid === uid ? null : uid;
        this.turn = snapshot.turn;
        return true;
    }

    cancel(): void {
        this.uid = null;
    }

    sync(snapshot: Snapshot): void {
        if (snapshot.phase !== 'battle' || snapshot.turn !== this.turn
            || !snapshot.hand.some(card => card.uid === this.uid && card.playable)) {
            this.cancel();
        }
    }

    resolve(snapshot: Snapshot, target: BattleTarget): GameInput | null {
        this.sync(snapshot);
        const card = snapshot.hand.find(item => item.uid === this.uid);
        if (card === undefined) return null;
        if (card.def.effect.kind === 'attack') {
            if (target.kind !== 'enemy' || snapshot.enemy === null
                || snapshot.enemy.id !== target.id || snapshot.enemy.hp <= 0) return null;
            return { type: 'playCard', uid: card.uid };
        }
        if (target.kind !== 'ally' || !snapshot.party.some(hero => hero.id === target.id && hero.alive)) {
            return null;
        }
        return { type: 'playCard', uid: card.uid, targetId: target.id };
    }
}
