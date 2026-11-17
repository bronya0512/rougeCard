// GameRoot (T106): Cocos component that bridges platform input to core and
// renders Snapshot. It NEVER touches GameState directly (AC-4): all changes go
// through GameSession.dispatch -> core.advance. Only `cc` is imported here;
// browser and native globals belong only to the assets/platform layer.
import {
    _decorator,
    Component,
    Color,
    EventKeyboard,
    Graphics,
    input,
    Input,
    KeyCode,
    Label,
    Layers,
    Node,
    UITransform,
    Vec3,
} from 'cc';
import type { GameConfig, Snapshot, HexCoord, StoragePort } from '../core';
import { GameSession } from './GameSession';

const { ccclass } = _decorator;

function defaultConfig(seed: number): GameConfig {
    return {
        seed,
        mapRadius: 2,
        startHp: 30,
        energyPerTurn: 1,
        drawPerTurn: 5,
        restHeal: 10,
        rewardCount: 3,
        restNodes: 1,
        cardDefs: [
            { id: 'r-atk', name: 'Red Strike', color: 'red', cost: 1, effect: { kind: 'attack', damage: 4 } },
            { id: 'r-def', name: 'Red Guard', color: 'red', cost: 1, effect: { kind: 'defend', block: 3 } },
            { id: 'b-atk', name: 'Blue Strike', color: 'blue', cost: 1, effect: { kind: 'attack', damage: 4 } },
            { id: 'b-def', name: 'Blue Guard', color: 'blue', cost: 1, effect: { kind: 'defend', block: 3 } },
        ],
        startingDeck: ['r-atk', 'b-atk', 'r-def', 'b-def', 'r-atk', 'b-atk'],
        enemies: [
            { id: 'normal', hp: 12, damage: 3 },
            { id: 'boss', hp: 24, damage: 5 },
        ],
    };
}

const C = {
    bg: new Color(20, 22, 30, 255),
    text: new Color(235, 238, 245, 255),
    dim: new Color(150, 156, 170, 255),
    red: new Color(230, 90, 90, 255),
    blue: new Color(90, 150, 235, 255),
    green: new Color(110, 200, 130, 255),
    gold: new Color(240, 200, 90, 255),
    grid: new Color(90, 96, 120, 255),
};

@ccclass('GameRoot')
export class GameRoot extends Component {
    private session!: GameSession;
    private storage!: StoragePort;
    private readonly uiNodes: Node[] = [];
    private mapGfx!: Graphics;
    private headerLabel!: Label;
    private partyLabel!: Label;
    private enemyLabel!: Label;
    private handLabel!: Label;
    private hintLabel!: Label;
    private selectedAlly = 0;
    private readonly hexSize = 46;

    onLoad(): void {
        input.on(Input.EventType.KEY_DOWN, this.onKey, this);
        this.buildUi();
    }

    onDestroy(): void {
        input.off(Input.EventType.KEY_DOWN, this.onKey, this);
    }

    /** Composition root injects the platform StoragePort (T107 / FR-5). */
    configure(storage: StoragePort): void {
        this.storage = storage;
        this.session = GameSession.load(storage, defaultConfig(20261116));
        this.session.save(); // persist immediately: fresh run or normalized loaded run
        this.selectedAlly = 0;
        this.render();
    }

    private makeLabel(name: string, parent: Node, x: number, y: number, w: number, h: number, size = 20): Label {
        const node = new Node(name);
        node.layer = Layers.Enum.UI_2D;
        node.setParent(parent);
        node.setPosition(x, y, 0);
        const ut = node.addComponent(UITransform);
        ut.setContentSize(w, h);
        const label = node.addComponent(Label);
        label.fontSize = size;
        label.lineHeight = size + 6;
        label.color = C.text;
        label.string = '';
        this.uiNodes.push(node);
        return label;
    }

    private buildUi(): void {
        const canvas = this.node;
        // background panel
        const bg = new Node('GameBg');
        bg.layer = Layers.Enum.UI_2D;
        bg.setParent(canvas);
        bg.setPosition(0, 0, 0);
        const bgUt = bg.addComponent(UITransform);
        bgUt.setContentSize(1280, 720);
        const bgGfx = bg.addComponent(Graphics);
        bgGfx.fillColor = C.bg;
        bgGfx.rect(-640, -360, 1280, 720);
        bgGfx.fill();
        this.uiNodes.push(bg);

        // map graphics (center-left)
        const mapNode = new Node('MapGraphics');
        mapNode.layer = Layers.Enum.UI_2D;
        mapNode.setParent(canvas);
        mapNode.setPosition(-40, 20, 0);
        mapNode.addComponent(UITransform).setContentSize(560, 520);
        this.mapGfx = mapNode.addComponent(Graphics);
        this.uiNodes.push(mapNode);

        this.headerLabel = this.makeLabel('Header', canvas, 0, 225, 1240, 40, 20);
        this.partyLabel = this.makeLabel('Party', canvas, -470, 100, 330, 270, 18);
        this.enemyLabel = this.makeLabel('Enemy', canvas, 470, 130, 330, 240, 18);
        this.handLabel = this.makeLabel('Hand', canvas, 0, -205, 1240, 90, 18);
        this.hintLabel = this.makeLabel('Hint', canvas, 0, -250, 1240, 36, 15);
        this.hintLabel.color = C.dim;
    }

    private axialToPixel(c: HexCoord): Vec3 {
        const s = this.hexSize;
        return new Vec3(s * 1.732 * (c.q + c.r / 2), s * 1.5 * c.r, 0);
    }

    private drawHex(g: Graphics, x: number, y: number, r: number): void {
        for (let i = 0; i < 6; i += 1) {
            const a = (Math.PI / 180) * (60 * i - 30);
            const px = x + r * Math.cos(a);
            const py = y + r * Math.sin(a);
            if (i === 0) g.moveTo(px, py);
            else g.lineTo(px, py);
        }
        g.close();
    }

    private drawMap(s: Snapshot): void {
        const g = this.mapGfx;
        g.clear();
        g.lineWidth = 3;
        for (const n of s.map.nodes) {
            const p = this.axialToPixel(n.coord);
            const here = n.coord.q === s.map.position.q && n.coord.r === s.map.position.r;
            let color = C.grid;
            if (n.kind === 'boss') color = C.red;
            else if (n.kind === 'rest') color = C.green;
            else if (n.kind === 'battle') color = C.blue;
            if (here) color = C.gold;
            g.strokeColor = color;
            this.drawHex(g, p.x, p.y, this.hexSize * 0.86);
            g.stroke();
        }
        // start marker text is conveyed by color/legend; boss is red, current is gold.
    }

    private render(): void {
        const s = this.session.snapshot;
        this.headerLabel.string = `ROGUE CARD  |  ${s.phase.toUpperCase()}  |  TURN ${s.turn}  |  REV ${s.revision}`;
        this.partyLabel.string = this.renderParty(s);
        this.enemyLabel.string = this.renderEnemy(s);
        this.handLabel.string = this.renderHand(s);
        this.hintLabel.string =
            s.phase === 'map'
                ? 'MOVE: arrows / Q,E   |   blue=battle green=rest red=boss gold=you'
                : s.phase === 'battle'
                  ? 'PLAY: 1-5   |   TAB target   |   SPACE end turn'
                  : s.phase === 'reward'
                    ? 'PICK REWARD: 1-3'
                    : 'RESTART: R';
        this.drawMap(s);
    }

    private renderParty(s: Snapshot): string {
        const lines = ['PARTY (' + (this.selectedAlly + 1) + '/' + s.party.length + ' selected)'];
        s.party.forEach((c, i) => {
            const mark = i === this.selectedAlly ? '>' : ' ';
            lines.push(`${mark} ${c.color.toUpperCase()} ${c.alive ? 'alive' : 'DEAD'} hp ${c.hp}/${c.maxHp} block ${c.block}`);
        });
        const e = s.energy;
        lines.push(`ENERGY r${e.red} g${e.green} b${e.blue} w${e.white}`);
        return lines.join('\n');
    }

    private renderEnemy(s: Snapshot): string {
        if (s.enemy === null) return 'ENEMY: none';
        const intent = s.enemy.intent.kind === 'attack' ? `attack ${s.enemy.intent.damage}` : 'none';
        return `ENEMY ${s.enemy.id}\nhp ${s.enemy.hp}/${s.enemy.maxHp}\nintent: ${intent}`;
    }

    private renderHand(s: Snapshot): string {
        if (s.phase === 'reward') {
            const choices = s.rewardCandidates.map((card, i) => {
                const effect = card.effect.kind === 'attack'
                    ? `attack ${card.effect.damage}`
                    : `block ${card.effect.block}`;
                return `${i + 1}: ${card.name} [${card.color} ${card.cost}] ${effect}`;
            });
            return 'CHOOSE ONE REWARD\n' + choices.join('   |   ');
        }
        if (s.phase === 'victory') return 'VICTORY: boss defeated. Press R to start a new run.';
        if (s.phase === 'defeat') return 'DEFEAT: no surviving teammates. Press R to try again.';
        if (s.hand.length === 0) return 'HAND: (empty)   draw:' + s.drawCount + ' discard:' + s.discardCount;
        const cards = s.hand.map((c, i) => `${i + 1}:${c.def.name}[${c.def.color} ${c.def.cost}]${c.playable ? '' : '!'}`);
        return 'HAND ' + cards.join('  ') + '   draw:' + s.drawCount + ' discard:' + s.discardCount;
    }

    private onKey(event: EventKeyboard): void {
        if (this.session === undefined) return; // ignore input before configure()
        const s = this.session.snapshot;
        let changed = true;
        switch (event.keyCode) {
            case KeyCode.ARROW_UP:
            case KeyCode.KEY_W:
                this.session.dispatch({ type: 'move', to: this.step(s.map.position, 0, -1) });
                break;
            case KeyCode.ARROW_DOWN:
            case KeyCode.KEY_S:
                this.session.dispatch({ type: 'move', to: this.step(s.map.position, 0, 1) });
                break;
            case KeyCode.ARROW_LEFT:
            case KeyCode.KEY_A:
                this.session.dispatch({ type: 'move', to: this.step(s.map.position, -1, 0) });
                break;
            case KeyCode.ARROW_RIGHT:
            case KeyCode.KEY_D:
                this.session.dispatch({ type: 'move', to: this.step(s.map.position, 1, 0) });
                break;
            case KeyCode.KEY_Q:
                this.session.dispatch({ type: 'move', to: this.step(s.map.position, 1, -1) });
                break;
            case KeyCode.KEY_E:
                this.session.dispatch({ type: 'move', to: this.step(s.map.position, -1, 1) });
                break;
            case KeyCode.TAB:
                this.selectedAlly = (this.selectedAlly + 1) % s.party.length;
                break;
            case KeyCode.SPACE:
                this.session.dispatch({ type: 'endTurn' });
                break;
            case KeyCode.KEY_R:
                if (s.phase === 'victory' || s.phase === 'defeat') {
                    this.session.clearSave();
                    this.session = new GameSession(defaultConfig(20261116), { storage: this.storage });
                    this.session.save(); // persist the fresh run as the new baseline
                    this.selectedAlly = 0;
                }
                break;
            default: {
                const digit = this.digitOf(event.keyCode);
                if (digit >= 1 && digit <= 9) {
                    const idx = digit - 1;
                    if (s.phase === 'reward' && idx < s.rewardCandidates.length) {
                        this.session.dispatch({ type: 'chooseReward', defId: s.rewardCandidates[idx]!.id });
                    } else if (s.phase === 'battle' && idx < s.hand.length) {
                        const card = s.hand[idx]!;
                        const target = s.party[this.selectedAlly]!;
                        this.session.dispatch({
                            type: 'playCard',
                            uid: card.uid,
                            targetId: card.def.effect.kind === 'defend' ? target.id : undefined,
                        });
                    } else {
                        changed = false;
                    }
                } else {
                    changed = false;
                }
                break;
            }
        }
        if (changed) this.render();
    }

    private digitOf(code: KeyCode): number {
        // KEY_0..KEY_9 are ASCII 48..57 in Cocos KeyCode.
        const n = code as number;
        return n >= 48 && n <= 57 ? n - 48 : -1;
    }

    private step(from: HexCoord, dq: number, dr: number): HexCoord {
        return { q: from.q + dq, r: from.r + dr };
    }
}
