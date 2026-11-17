import {
    _decorator, Canvas, Color, Component, EventKeyboard, EventMouse, Graphics,
    input, Input, KeyCode, Label, Layers, Node, UITransform, Vec3,
} from 'cc';
import { hexDistance } from '../core';
import type { CardDef, GameConfig, GameInput, HexCoord, MapNode, Snapshot, StoragePort } from '../core';
import { BattleSelection } from './BattleSelection';
import type { BattleTarget } from './BattleSelection';
import { GameSession } from './GameSession';

const { ccclass, property } = _decorator;

function defaultConfig(seed: number, floorCount: number): GameConfig {
    if (floorCount !== 3 && floorCount !== 4 && floorCount !== 5) throw new Error('层数必须是3、4或5');
    return {
        seed, floorCount, mapRadius: 2, startHp: 30, energyPerTurn: 1, drawPerTurn: 5,
        restHeal: 10, rewardCount: 3, restNodes: 1,
        cardDefs: [
            { id: 'r-atk', name: 'Red Strike', color: 'red', cost: 1, effect: { kind: 'attack', damage: 4 } },
            { id: 'r-def', name: 'Red Guard', color: 'red', cost: 1, effect: { kind: 'defend', block: 3 } },
            { id: 'b-atk', name: 'Blue Strike', color: 'blue', cost: 1, effect: { kind: 'attack', damage: 4 } },
            { id: 'b-def', name: 'Blue Guard', color: 'blue', cost: 1, effect: { kind: 'defend', block: 3 } },
        ],
        startingDeck: ['r-atk', 'b-atk', 'r-def', 'b-def', 'r-atk', 'b-atk'],
        enemies: [{ id: 'normal', hp: 12, damage: 3 }, { id: 'boss', hp: 24, damage: 5 }],
    };
}

const C = {
    bg: new Color(17, 23, 34), panel: new Color(28, 39, 55),
    text: new Color(235, 240, 247), dim: new Color(144, 160, 181),
    red: new Color(239, 111, 109), blue: new Color(112, 171, 244),
    green: new Color(112, 210, 166), gold: new Color(246, 205, 112),
    line: new Color(63, 81, 106), muted: new Color(47, 57, 73),
};

type Panel = { node: Node; graphics: Graphics; label: Label };
type MapTile = { panel: Panel; coord: HexCoord };

@ccclass('GameRoot')
export class GameRoot extends Component {
    @property({ range: [3, 5, 1], tooltip: '新局楼层数量：3、4或5；旧存档保留原有层数' })
    floorCount = 3;

    private session!: GameSession;
    private storage!: StoragePort;
    private readonly selection = new BattleSelection();
    private mapPage!: Node;
    private battlePage!: Node;
    private rewardPage!: Node;
    private settlementPage!: Node;
    private mapBoard!: Node;
    private mapInfo!: Panel;
    private mapParty!: Panel;
    private enemy!: Panel;
    private readonly heroes: Panel[] = [];
    private readonly handCards: Panel[] = [];
    private readonly rewardCards: Panel[] = [];
    private readonly mapTiles: MapTile[] = [];
    private endTurn!: Panel;
    private cancelButton!: Panel;
    private restartButton!: Panel;
    private headerLabel!: Label;
    private hintLabel!: Label;
    private energyLabel!: Label;
    private handLabel!: Label;
    private settlementLabel!: Label;
    private infoCoord: HexCoord | null = null;
    private lastPhase: Snapshot['phase'] | null = null;
    private lastFloor = 0;
    private feedback = '';
    private readonly hexSize = 58;

    onLoad(): void {
        this.buildUi();
    }

    start(): void {
        input.on(Input.EventType.MOUSE_UP, this.onMouse, this);
        input.on(Input.EventType.KEY_DOWN, this.onKey, this);
    }

    onDestroy(): void {
        input.off(Input.EventType.MOUSE_UP, this.onMouse, this);
        input.off(Input.EventType.KEY_DOWN, this.onKey, this);
        this.selection.cancel();
        for (const node of [this.mapPage, this.battlePage, this.rewardPage, this.settlementPage,
            this.headerLabel.node, this.hintLabel.node, this.node.getChildByName('GameBg')]) {
            if (node !== null) node.destroy();
        }
    }

    configure(storage: StoragePort): void {
        this.storage = storage;
        this.session = GameSession.load(storage, defaultConfig(20261116, this.floorCount));
        this.session.save();
        this.selection.cancel();
        this.lastFloor = 0;
        this.render();
    }

    private createNode(name: string, parent: Node, x: number, y: number, width: number, height: number): Node {
        const node = new Node(name);
        node.layer = Layers.Enum.UI_2D;
        node.setPosition(x, y);
        node.addComponent(UITransform).setContentSize(width, height);
        node.setParent(parent);
        return node;
    }

    private label(name: string, parent: Node, x: number, y: number, width: number, height: number,
        text: string, size = 20): Label {
        const node = this.createNode(name, parent, x, y, width, height);
        const label = node.addComponent(Label);
        label.fontSize = size;
        label.lineHeight = size + 8;
        label.color = C.text;
        label.overflow = Label.Overflow.SHRINK;
        label.enableWrapText = true;
        label.string = text;
        return label;
    }

    private panel(name: string, parent: Node, x: number, y: number, width: number, height: number,
        text = '', size = 20): Panel {
        const node = this.createNode(name, parent, x, y, width, height);
        const graphics = node.addComponent(Graphics);
        const label = this.label('Text', node, 0, 0, width - 24, height - 18, text, size);
        const result = { node, graphics, label };
        this.paint(result, C.panel, C.line);
        return result;
    }

    private paint(panel: Panel, fill: Color, border: Color, selected = false): void {
        const size = panel.node.getComponent(UITransform)!.contentSize;
        const g = panel.graphics;
        g.clear();
        g.fillColor = fill;
        g.strokeColor = border;
        g.lineWidth = selected ? 4 : 2;
        g.roundRect(-size.width / 2, -size.height / 2, size.width, size.height, 12);
        g.fill();
        g.stroke();
    }

    private buildUi(): void {
        const bg = this.panel('GameBg', this.node, 0, 0, 1280, 720);
        this.paint(bg, C.bg, C.bg);
        this.mapPage = this.createNode('MapPage', this.node, 0, 0, 1280, 720);
        this.battlePage = this.createNode('BattlePage', this.node, 0, 0, 1280, 720);
        this.rewardPage = this.createNode('RewardPage', this.node, 0, 0, 1280, 720);
        this.settlementPage = this.createNode('SettlementPage', this.node, 0, 0, 1280, 720);
        this.headerLabel = this.label('Header', this.node, 0, 312, 1180, 42, '', 26);
        this.hintLabel = this.label('Hint', this.node, -100, -320, 980, 40, '', 17);
        this.hintLabel.color = C.gold;
        this.mapBoard = this.createNode('MapBoard', this.mapPage, -190, 0, 660, 550);
        this.label('Legend', this.mapPage, -190, 260, 660, 36, '金色 · 当前位置    蓝色 · 战斗    绿色 · 休息    红色 · BOSS', 17);
        this.mapInfo = this.panel('NodeInfo', this.mapPage, 410, 60, 320, 340, '', 21);
        this.mapParty = this.panel('PartySummary', this.mapPage, 410, -215, 320, 170, '', 19);
        this.label('SideEnemy', this.battlePage, -390, 258, 300, 40, '敌 方', 24);
        this.label('SideParty', this.battlePage, 375, 258, 420, 40, '我 方', 24);
        this.enemy = this.panel('EnemyTarget', this.battlePage, -390, 100, 250, 235, '', 24);
        for (let i = 0; i < 2; i += 1) {
            this.heroes.push(this.panel(`HeroTarget_${i}`, this.battlePage, 255 + i * 230, 100, 205, 235, '', 22));
        }
        this.energyLabel = this.label('Energy', this.battlePage, 0, -45, 1160, 36, '', 19);
        this.handLabel = this.label('Hand', this.battlePage, -400, -80, 310, 26, '', 15);
        this.endTurn = this.panel('EndTurn', this.battlePage, 515, -320, 180, 46, '结束回合', 19);
        this.cancelButton = this.panel('CancelCard', this.battlePage, 80, -80, 180, 34, '取消选牌', 16);
        this.label('RewardTitle', this.rewardPage, 0, 180, 900, 60, '战斗胜利 · 选择一张卡牌加入牌组', 30);
        for (let i = 0; i < 3; i += 1) {
            this.rewardCards.push(this.panel(`RewardCard_${i}`, this.rewardPage, (i - 1) * 290, -25, 245, 300, '', 23));
        }
        this.settlementLabel = this.label('Settlement', this.settlementPage, 0, 65, 960, 250, '', 36);
        this.restartButton = this.panel('Restart', this.settlementPage, 0, -160, 250, 60, '重新开始', 24);
    }

    private buildMap(s: Snapshot): void {
        for (const tile of this.mapTiles) {
            tile.panel.node.removeFromParent();
            tile.panel.node.destroy();
        }
        this.mapTiles.length = 0;
        for (const node of s.map.nodes) {
            const p = this.axialToPixel(node.coord);
            const panel = this.panel(`MapNode_${node.coord.q}_${node.coord.r}`, this.mapBoard,
                p.x, p.y, this.hexSize * 1.732, this.hexSize * 2, '', 15);
            this.mapTiles.push({ panel, coord: node.coord });
        }
    }

    private axialToPixel(coord: HexCoord): Vec3 {
        return new Vec3(this.hexSize * Math.sqrt(3) * (coord.q + coord.r / 2), this.hexSize * 1.5 * coord.r, 0);
    }

    private nodeName(node: MapNode): string {
        return node.kind === 'boss' ? 'BOSS' : node.kind === 'battle' ? '战斗' : node.kind === 'rest' ? '休息' : '起点';
    }

    private drawMap(s: Snapshot): void {
        for (const tile of this.mapTiles) {
            const node = s.map.nodes.find(n => n.coord.q === tile.coord.q && n.coord.r === tile.coord.r)!;
            const here = hexDistance(tile.coord, s.map.position) === 0;
            const inspecting = this.infoCoord !== null && hexDistance(tile.coord, this.infoCoord) === 0;
            const border = here ? C.gold : node.kind === 'boss' ? C.red
                : node.kind === 'rest' ? C.green : node.kind === 'battle' ? C.blue : C.line;
            const g = tile.panel.graphics;
            g.clear();
            g.lineWidth = inspecting ? 4 : 2;
            g.strokeColor = inspecting ? C.text : border;
            g.fillColor = here ? new Color(77, 65, 39) : node.visited ? C.muted : C.panel;
            const radius = this.hexSize * 0.9;
            for (let i = 0; i < 6; i += 1) {
                const angle = (60 * i - 30) * Math.PI / 180;
                const x = radius * Math.cos(angle);
                const y = radius * Math.sin(angle);
                if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
            }
            g.close();
            g.fill();
            g.stroke();
            tile.panel.label.string = `${here ? '当前位置' : this.nodeName(node)}\n${tile.coord.q}, ${tile.coord.r}${node.visited && !here ? '\n已访问' : ''}`;
            tile.panel.label.color = border;
        }
        this.mapInfo.node.active = this.infoCoord !== null;
        if (this.infoCoord !== null) {
            const node = s.map.nodes.find(n => hexDistance(n.coord, this.infoCoord!) === 0)!;
            const distance = hexDistance(node.coord, s.map.position);
            this.mapInfo.label.string = `${this.nodeName(node)}\n\n坐标  (${node.coord.q}, ${node.coord.r})\n${node.visited ? '已访问 · 不再触发' : '未访问'}\n\n${distance === 0 ? '你正在这里' : distance === 1 ? '相邻节点 · 右键移动' : '非相邻 · 无法直接移动'}`;
            this.paint(this.mapInfo, C.panel, C.gold);
        }
        this.mapParty.label.string = '队伍状态\n' + s.party.map(hero =>
            `${hero.color === 'red' ? '红' : '蓝'}  ${hero.alive ? `HP ${hero.hp}/${hero.maxHp}` : '已阵亡'}`).join('\n');
    }

    private cardText(card: CardDef): string {
        const effect = card.effect.kind === 'attack' ? `造成 ${card.effect.damage} 点伤害` : `获得 ${card.effect.block} 点格挡`;
        return `${card.name}\n\n${card.color === 'red' ? '红色' : '蓝色'}能量  ${card.cost}\n\n${effect}`;
    }

    private render(): void {
        const s = this.session.snapshot;
        if (s.floor !== this.lastFloor) {
            this.buildMap(s);
            this.infoCoord = null;
            this.selection.cancel();
            this.lastFloor = s.floor;
        }
        if (s.phase !== this.lastPhase) {
            this.selection.cancel();
            this.infoCoord = null;
            this.lastPhase = s.phase;
        }
        this.selection.sync(s);
        this.mapPage.active = s.phase === 'map';
        this.battlePage.active = s.phase === 'battle';
        this.rewardPage.active = s.phase === 'reward';
        this.settlementPage.active = s.phase === 'victory' || s.phase === 'defeat';
        const title = s.phase === 'map' ? '六边形地图' : s.phase === 'battle' ? '战斗'
            : s.phase === 'reward' ? '战利品' : s.phase === 'victory' ? '胜利' : '失败';
        this.headerLabel.string = `${title}   /   ${s.phase.toUpperCase()}   · 第 ${s.floor} / ${s.floorCount} 层   ${s.phase === 'battle' ? `· 第 ${s.turn} 回合` : ''}`;
        if (s.phase === 'map') this.drawMap(s);
        if (s.phase === 'battle') this.renderBattle(s);
        for (let i = 0; i < this.rewardCards.length; i += 1) {
            const card = s.rewardCandidates[i];
            const panel = this.rewardCards[i]!;
            panel.node.active = card !== undefined;
            if (card !== undefined) {
                panel.label.string = this.cardText(card) + '\n\n左键选择';
                this.paint(panel, C.panel, card.color === 'red' ? C.red : C.blue);
            }
        }
        if (this.settlementPage.active) {
            this.settlementLabel.string = s.phase === 'victory' ? `VICTORY\n击败最终 BOSS，完成 ${s.floorCount} 层！` : 'DEFEAT\n全队阵亡，下次再战。';
            this.settlementLabel.color = s.phase === 'victory' ? C.gold : C.red;
        }
        const selected = s.hand.find(card => card.uid === this.selection.selectedUid);
        const help = s.phase === 'map' ? '左键节点 · 查看信息    右键节点 · 移动'
            : s.phase === 'battle' ? selected === undefined ? '左键选择卡牌，再点击目标施放'
                : selected.def.effect.kind === 'attack' ? '已选攻击牌 · 左键点击左侧怪物' : '已选防御牌 · 左键点击右侧队友'
            : s.phase === 'reward' ? '左键选择一张奖励，返回地图' : '点击「重新开始」开启新的一局';
        this.hintLabel.string = this.feedback || help;
    }

    private renderBattle(s: Snapshot): void {
        const selected = s.hand.find(card => card.uid === this.selection.selectedUid);
        if (s.enemy !== null) {
            this.enemy.label.string = `${s.enemy.id === 'boss' ? 'BOSS' : '怪物'}\n\nHP ${s.enemy.hp}/${s.enemy.maxHp}\n\n意图：攻击 ${s.enemy.intent.kind === 'attack' ? s.enemy.intent.damage : 0}`;
            this.paint(this.enemy, new Color(52, 34, 43), selected?.def.effect.kind === 'attack' ? C.gold : C.red,
                selected?.def.effect.kind === 'attack');
        }
        for (let i = 0; i < this.heroes.length; i += 1) {
            const hero = s.party[i];
            const panel = this.heroes[i]!;
            panel.node.active = hero !== undefined;
            if (hero === undefined) continue;
            const color = hero.color === 'red' ? C.red : C.blue;
            const target = hero.alive && selected?.def.effect.kind === 'defend';
            panel.label.string = `${hero.color === 'red' ? '红色角色' : '蓝色角色'}\n\n${hero.alive ? `HP ${hero.hp}/${hero.maxHp}` : '已阵亡'}\n格挡 ${hero.block}\n\n${hero.alive ? '点击可作为防御目标' : '不再产出能量'}`;
            this.paint(panel, hero.alive ? C.panel : C.muted, target ? C.gold : color, target);
        }
        const e = s.energy;
        this.energyLabel.string = `可用能量   红 ${e.red}   蓝 ${e.blue}   白 ${e.white}     ·     选牌后点击怪物 / 队友`;
        this.handLabel.string = `手牌 ${s.hand.length}   抽牌 ${s.drawCount}   弃牌 ${s.discardCount}`;
        while (this.handCards.length < s.hand.length) {
            this.handCards.push(this.panel(`HandCard_${this.handCards.length}`, this.battlePage, 0, -198, 176, 190, '', 18));
        }
        const spacing = Math.min(205, 1060 / Math.max(s.hand.length, 1));
        for (let i = 0; i < this.handCards.length; i += 1) {
            const panel = this.handCards[i]!;
            const card = s.hand[i];
            panel.node.active = card !== undefined;
            if (card === undefined) continue;
            const chosen = this.selection.selectedUid === card.uid;
            panel.node.setPosition((i - (s.hand.length - 1) / 2) * spacing, chosen ? -188 : -198);
            panel.label.string = this.cardText(card.def) + `\n\n${chosen ? '已选择 · 点击目标' : card.playable ? '左键选择' : '能量不足'}`;
            panel.label.color = card.playable ? C.text : C.dim;
            this.paint(panel, card.playable ? C.panel : C.muted, chosen ? C.gold
                : card.playable ? card.def.color === 'red' ? C.red : C.blue : C.line, chosen);
        }
        this.cancelButton.node.active = this.selection.selectedUid !== null;
        this.paint(this.endTurn, new Color(45, 71, 62), C.green);
    }

    private dispatch(value: GameInput): void {
        const result = this.session.dispatch(value);
        this.feedback = result.lastRejection === null ? '' : value.type === 'move'
            ? '无法移动：请选择相邻的地图节点' : '操作未生效：检查费用、目标或当前阶段';
        if (result.lastRejection === null) this.selection.cancel();
        this.render();
    }

    private selectCard(index: number): void {
        const s = this.session.snapshot;
        const card = s.hand[index];
        if (card === undefined) return;
        this.feedback = this.selection.select(s, card.uid) ? '' : '能量不足，无法选择这张牌';
        this.render();
    }

    private target(value: BattleTarget): void {
        const action = this.selection.resolve(this.session.snapshot, value);
        if (action !== null) this.dispatch(action);
        else {
            this.feedback = this.selection.selectedUid === null ? '请先左键选择一张卡牌'
                : '目标不适用：攻击牌点怪物，防御牌点存活队友';
            this.render();
        }
    }

    private restart(): void {
        const phase = this.session.snapshot.phase;
        if (phase !== 'victory' && phase !== 'defeat') return;
        this.session.clearSave();
        this.session = new GameSession(defaultConfig(20261116, this.floorCount), { storage: this.storage });
        this.session.save();
        this.selection.cancel();
        this.infoCoord = null;
        this.feedback = '';
        this.buildMap(this.session.snapshot);
        this.render();
    }

    private hit(node: Node, point: Vec3): boolean {
        if (!node.activeInHierarchy) return false;
        const transform = node.getComponent(UITransform)!;
        const local = transform.convertToNodeSpaceAR(point);
        const size = transform.contentSize;
        return Math.abs(local.x) <= size.width / 2 && Math.abs(local.y) <= size.height / 2;
    }

    private mapHit(point: Vec3): HexCoord | null {
        for (const tile of this.mapTiles) {
            const local = tile.panel.node.getComponent(UITransform)!.convertToNodeSpaceAR(point);
            const x = Math.abs(local.x);
            const y = Math.abs(local.y);
            const radius = this.hexSize * 0.9;
            if (x <= Math.sqrt(3) * radius / 2 && y <= radius && x + Math.sqrt(3) * y <= Math.sqrt(3) * radius) {
                return tile.coord;
            }
        }
        return null;
    }

    private onMouse(event: EventMouse): void {
        if (this.session === undefined || !this.enabledInHierarchy) return;
        const location = event.getLocation();
        const camera = this.node.getComponent(Canvas)?.cameraComponent;
        if (camera === null || camera === undefined) return;
        const point = camera.screenToWorld(new Vec3(location.x, location.y, 0));
        point.z = 0;
        const s = this.session.snapshot;
        if (s.phase === 'map') {
            const coord = this.mapHit(point);
            if (coord === null) return;
            if (event.getButton() === EventMouse.BUTTON_RIGHT) this.dispatch({ type: 'move', to: coord });
            else if (event.getButton() === EventMouse.BUTTON_LEFT) {
                this.infoCoord = coord;
                this.feedback = '';
                this.render();
            }
            return;
        }
        if (event.getButton() !== EventMouse.BUTTON_LEFT) return;
        if (s.phase === 'battle') {
            if (this.hit(this.endTurn.node, point)) { this.dispatch({ type: 'endTurn' }); return; }
            if (this.hit(this.cancelButton.node, point)) {
                this.selection.cancel(); this.feedback = ''; this.render(); return;
            }
            for (let i = 0; i < s.hand.length; i += 1) {
                if (this.hit(this.handCards[i]!.node, point)) { this.selectCard(i); return; }
            }
            if (this.hit(this.enemy.node, point) && s.enemy !== null) {
                this.target({ kind: 'enemy', id: s.enemy.id }); return;
            }
            for (let i = 0; i < s.party.length; i += 1) {
                if (this.hit(this.heroes[i]!.node, point)) { this.target({ kind: 'ally', id: s.party[i]!.id }); return; }
            }
        } else if (s.phase === 'reward') {
            for (let i = 0; i < s.rewardCandidates.length; i += 1) {
                if (this.hit(this.rewardCards[i]!.node, point)) {
                    this.dispatch({ type: 'chooseReward', defId: s.rewardCandidates[i]!.id }); return;
                }
            }
        } else if (this.hit(this.restartButton.node, point)) this.restart();
    }

    private onKey(event: EventKeyboard): void {
        if (this.session === undefined) return;
        const s = this.session.snapshot;
        const directions: { [key: number]: HexCoord } = {
            [KeyCode.ARROW_UP]: { q: 0, r: -1 }, [KeyCode.ARROW_DOWN]: { q: 0, r: 1 },
            [KeyCode.ARROW_LEFT]: { q: -1, r: 0 }, [KeyCode.ARROW_RIGHT]: { q: 1, r: 0 },
            [KeyCode.KEY_Q]: { q: 1, r: -1 }, [KeyCode.KEY_E]: { q: -1, r: 1 },
        };
        const delta = directions[event.keyCode];
        if (delta !== undefined && s.phase === 'map') {
            this.dispatch({ type: 'move', to: { q: s.map.position.q + delta.q, r: s.map.position.r + delta.r } });
        } else if (event.keyCode === KeyCode.SPACE && s.phase === 'battle') this.dispatch({ type: 'endTurn' });
        else if (event.keyCode === KeyCode.ESCAPE) {
            this.selection.cancel(); this.infoCoord = null; this.feedback = ''; this.render();
        } else if (event.keyCode === KeyCode.KEY_R) this.restart();
        else if (event.keyCode >= 49 && event.keyCode <= 57) {
            const index = event.keyCode - 49;
            if (s.phase === 'battle') this.selectCard(index);
            else if (s.phase === 'reward' && s.rewardCandidates[index] !== undefined) {
                this.dispatch({ type: 'chooseReward', defId: s.rewardCandidates[index]!.id });
            }
        }
    }
}
