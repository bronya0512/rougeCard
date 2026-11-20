import {
    _decorator, Canvas, Color, Component, EventKeyboard, EventMouse, Graphics,
    input, Input, KeyCode, Label, Layers, Node, tween, Tween, UITransform, Vec3,
} from 'cc';
import { hexDistance } from '../core';
import type { CardDef, GameInput, HexCoord, MapNode, SaveData, Snapshot, StoragePort } from '../core';
import { BattleArtView } from './BattleArtView';
import { BattleSelection } from './BattleSelection';
import { BattleStatusView } from './BattleStatusView';
import type { BattleTarget } from './BattleSelection';
import { GameSession } from './GameSession';
import { ConfigLoader } from './ConfigLoader';
import type { ConfigPackage } from './ConfigPackage';
import { TeamSelection } from './TeamSelection';

const { ccclass } = _decorator;

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
    private session!: GameSession;
    private storage!: StoragePort;
    private readonly selection = new BattleSelection();
    private teamSelection = new TeamSelection(null);
    private readonly configLoader = new ConfigLoader();
    private configPackage: ConfigPackage | null = null;
    private configLoading = true;
    private configError = '';
    private disposed = false;
    private choosingTeam = true;
    private pendingSave: SaveData | null = null;
    private teamPage!: Node;
    private readonly rosterCards: Panel[] = [];
    private teamSummary!: Label;
    private confirmTeam!: Panel;
    private continueRun!: Panel;
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
    private battleArt!: BattleArtView;
    private readonly statusViews = new Map<Node, BattleStatusView>();
    private hoveredUid: string | null = null;
    private handSignature = '';
    private handSpacing = 96;

    onLoad(): void {
        this.buildUi();
        this.battleArt = new BattleArtView(this.battlePage, () => {}, null);
        this.configLoader.load((config, error) => {
            if (this.disposed) return;
            this.configLoading = false;
            this.configError = error;
            this.configPackage = config;
            this.teamSelection = new TeamSelection(config?.content ?? null);
            if (config !== null) {
                this.battleArt.destroy();
                this.battleArt = new BattleArtView(this.battlePage, () => {
                    if (!this.disposed && this.storage !== undefined) this.render();
                }, config.presentation);
            }
            if (this.storage !== undefined) this.render();
        });
    }

    start(): void {
        input.on(Input.EventType.MOUSE_UP, this.onMouse, this);
        input.on(Input.EventType.KEY_DOWN, this.onKey, this);
        input.on(Input.EventType.MOUSE_MOVE, this.onMouseMove, this);
        this.battlePage.on(Node.EventType.MOUSE_UP, this.onMouse, this);
        this.battlePage.on(Node.EventType.MOUSE_MOVE, this.onMouseMove, this);
        this.battlePage.on(Node.EventType.MOUSE_LEAVE, this.onMouseLeave, this);
    }

    onDestroy(): void {
        this.disposed = true;
        this.configLoader.destroy();
        input.off(Input.EventType.MOUSE_UP, this.onMouse, this);
        input.off(Input.EventType.KEY_DOWN, this.onKey, this);
        input.off(Input.EventType.MOUSE_MOVE, this.onMouseMove, this);
        this.battlePage.off(Node.EventType.MOUSE_UP, this.onMouse, this);
        this.battlePage.off(Node.EventType.MOUSE_MOVE, this.onMouseMove, this);
        this.battlePage.off(Node.EventType.MOUSE_LEAVE, this.onMouseLeave, this);
        this.clearHandHover();
        this.statusViews.clear();
        this.selection.cancel();
        this.battleArt.destroy();
        for (const node of [this.teamPage, this.mapPage, this.battlePage, this.rewardPage, this.settlementPage,
            this.headerLabel.node, this.hintLabel.node, this.node.getChildByName('GameBg')]) {
            if (node !== null) node.destroy();
        }
    }

    configure(storage: StoragePort): void {
        if (this.disposed || this.storage !== undefined) return;
        this.storage = storage;
        this.openTeam();
    }

    private openTeam(): void {
        this.pendingSave = GameSession.readSave(this.storage);
        this.teamSelection.reset();
        this.selection.cancel();
        this.choosingTeam = true;
        this.feedback = '';
        this.render();
    }

    private beginTeam(): void {
        if (this.configLoading || this.configPackage === null || !this.teamSelection.canConfirm) return;
        const config = this.teamSelection.createConfig();
        const session = new GameSession(config, { storage: this.storage });
        session.save();
        this.session = session;
        this.enterSession();
    }

    private continueSaved(): void {
        if (this.pendingSave === null) return;
        this.session = new GameSession(this.pendingSave.state.config, { storage: this.storage, restored: this.pendingSave });
        this.enterSession();
    }

    private enterSession(): void {
        this.choosingTeam = false;
        this.pendingSave = null;
        this.lastFloor = 0;
        this.lastPhase = null;
        this.selection.cancel();
        this.feedback = '';
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
        this.teamPage = this.createNode('TeamPage', this.node, 0, 0, 1280, 720);
        this.label('TeamTitle', this.teamPage, 0, 245, 1100, 48, '选择 2～3 名角色 · 组成你的队伍', 28);
        for (let i = 0; i < 3; i += 1) {
            this.rosterCards.push(this.panel(`Roster_${i}`, this.teamPage, (i - 1) * 300, 40, 260, 380, '', 14));
        }
        this.teamSummary = this.label('TeamSummary', this.teamPage, 0, -190, 1160, 60, '', 20);
        this.confirmTeam = this.panel('ConfirmTeam', this.teamPage, 190, -255, 320, 56, '确认队伍 · 进入地图', 22);
        this.continueRun = this.panel('ContinueRun', this.teamPage, -190, -255, 320, 56, '继续游戏', 22);
        this.mapBoard = this.createNode('MapBoard', this.mapPage, -190, 0, 660, 550);
        this.label('Legend', this.mapPage, -190, 260, 660, 36, '金色 · 当前位置    蓝色 · 战斗    绿色 · 休息    红色 · BOSS', 17);
        this.mapInfo = this.panel('NodeInfo', this.mapPage, 410, 60, 320, 340, '', 21);
        this.mapParty = this.panel('PartySummary', this.mapPage, 410, -215, 320, 170, '', 19);
        this.label('SideEnemy', this.battlePage, -430, 252, 180, 36, '敌 方', 22);
        this.label('SideParty', this.battlePage, 490, 252, 160, 36, '我 方', 22);
        this.enemy = this.panel('EnemyTarget', this.battlePage, -430, 40, 250, 320, '', 18);
        this.statusViews.set(this.enemy.node, new BattleStatusView(this.enemy.node, 180));
        for (let i = 0; i < 3; i += 1) {
            const hero = this.panel(`HeroTarget_${i}`, this.battlePage, 150 + i * 185, 40, 175, 320, '', 18);
            this.heroes.push(hero);
            this.statusViews.set(hero.node, new BattleStatusView(hero.node, 150));
        }
        this.energyLabel = this.label('Energy', this.battlePage, -495, -278, 240, 112, '', 19);
        this.handLabel = this.label('Hand', this.battlePage, -430, -175, 270, 26, '', 15);
        this.endTurn = this.panel('EndTurn', this.battlePage, 515, -310, 180, 46, '结束回合', 19);
        this.cancelButton = this.panel('CancelCard', this.battlePage, 515, -245, 180, 34, '取消选牌', 16);
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
            `${this.colorName(hero.color)}  ${hero.alive ? `HP ${hero.hp}/${hero.maxHp}` : '已阵亡'}`).join('\n');
    }

    private cardText(card: CardDef): string {
        const effect = card.effect.kind === 'attack' ? `造成 ${card.effect.damage} 点伤害` : `获得 ${card.effect.block} 点格挡`;
        return `${card.name}\n\n${this.colorName(card.color)}色能量  ${card.cost}\n\n${effect}`;
    }

    private colorName(color: CardDef['color']): string {
        return { red: '红', green: '绿', blue: '蓝', white: '白' }[color];
    }

    private colorTint(color: CardDef['color']): Color {
        return color === 'red' ? C.red : color === 'green' ? C.green : color === 'blue' ? C.blue : C.text;
    }

    private renderTeam(): void {
        const ids = this.teamSelection.selectedIds;
        this.headerLabel.string = '开局组队   /   TEAM';
        this.hintLabel.string = this.configLoading ? '正在加载配置 · 暂不能开始新局'
            : this.configError || '左键选择 / 取消 · 按选择顺序站位，第一位优先承受攻击';
        const roster = this.teamSelection.roster;
        const content = this.teamSelection.content;
        for (let i = 0; i < this.rosterCards.length; i += 1) {
            const panel = this.rosterCards[i]!;
            const hero = roster[i];
            panel.node.active = hero !== undefined;
            if (hero === undefined || content === null) continue;
            const index = ids.indexOf(hero.id);
            const counts = new Map<string, number>();
            for (const id of hero.startingDeck) counts.set(id, (counts.get(id) ?? 0) + 1);
            const deck = Array.from(counts).map(([id, count]) => {
                const card = content.cards.find(def => def.id === id)!;
                const effect = card.effect.kind === 'attack' ? `攻击${card.effect.damage}` : `格挡${card.effect.block}`;
                return `${card.name} ×${count}\n${effect} · 费用${card.cost}`;
            }).join('\n');
            panel.label.string = `${this.colorName(hero.color)}色角色\nHP ${content.game.startHp} · 能量 ${content.game.energyPerTurn} / 回合\n起始牌 ${hero.startingDeck.length} 张\n${deck}\n${index >= 0 ? `已选 · 站位 ${index + 1}` : '左键加入队伍'}`;
            const art = this.battleArt.target(panel.node, `hero_${hero.color}`, true, {
                height: (this.configPackage?.presentation[`hero_${hero.color}`].displayHeight ?? 245) * 0.65,
                groundY: -10,
            });
            panel.label.node.setPosition(0, art ? -90 : 0);
            panel.label.lineHeight = 17;
            panel.label.node.getComponent(UITransform)!.setContentSize(236, art ? 140 : 362);
            this.paint(panel, C.panel, index >= 0 ? C.gold : this.colorTint(hero.color), index >= 0);
        }
        const names = ids.map(id => this.colorName(roster.find(hero => hero.id === id)!.color));
        const deckCount = ids.reduce((count, id) => count + roster.find(hero => hero.id === id)!.startingDeck.length, 0);
        this.teamSummary.string = this.configPackage === null ? this.configLoading ? '正在加载配置…'
            : '配置不可用，不能新建游戏；有效旧存档仍可继续' : ids.length === 0 ? '尚未选择角色 · 至少选择 2 名'
            : `站位顺序：${names.join(' → ')}\n${ids.length} 名角色 · ${deckCount} 张起始牌${this.teamSelection.canConfirm ? '' : ' · 还需选择一名'}`;
        this.confirmTeam.label.string = this.configPackage === null ? this.configLoading ? '配置加载中' : '配置错误 · 禁止新建'
            : this.teamSelection.canConfirm ? this.pendingSave === null ? '确认队伍 · 进入地图' : '确认新局 · 替换旧存档' : '至少选择 2 名角色';
        this.paint(this.confirmTeam, this.teamSelection.canConfirm ? new Color(45, 71, 62) : C.muted,
            this.teamSelection.canConfirm ? C.green : C.line);
        this.continueRun.node.active = this.pendingSave !== null;
        if (this.pendingSave !== null) {
            this.continueRun.label.string = `继续游戏 · 第 ${this.pendingSave.state.floor} 层`;
        }
    }

    private render(): void {
        this.teamPage.active = this.choosingTeam;
        if (this.choosingTeam) {
            this.hintLabel.node.setPosition(-100, -320);
            this.hintLabel.node.getComponent(UITransform)!.setContentSize(980, 40);
            this.clearHandHover();
            for (const page of [this.mapPage, this.battlePage, this.rewardPage, this.settlementPage]) page.active = false;
            this.renderTeam();
            return;
        }
        const s = this.session.snapshot;
        if (s.floor !== this.lastFloor) {
            this.buildMap(s);
            this.infoCoord = null;
            this.selection.cancel();
            this.lastFloor = s.floor;
        }
        if (s.phase !== this.lastPhase) {
            this.clearHandHover();
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
                const art = this.battleArt.card(panel.node, card, false, true, this.colorTint(card.color));
                panel.label.node.active = !art;
                this.paint(panel, art ? new Color(28, 39, 55, 0) : C.panel, this.colorTint(card.color));
            }
        }
        if (this.settlementPage.active) {
            this.settlementLabel.string = s.phase === 'victory' ? `VICTORY\n击败最终 BOSS，完成 ${s.floorCount} 层！` : 'DEFEAT\n全队阵亡，下次再战。';
            this.settlementLabel.color = s.phase === 'victory' ? C.gold : C.red;
        }
        const help = s.phase === 'map' ? '左键节点 · 查看信息    右键节点 · 移动'
            : s.phase === 'battle' ? ''
            : s.phase === 'reward' ? '左键选择一张奖励，返回地图' : '点击「重新开始」开启新的一局';
        this.hintLabel.node.setPosition(s.phase === 'battle' ? -455 : -100, s.phase === 'battle' ? -207 : -320);
        this.hintLabel.node.getComponent(UITransform)!.setContentSize(s.phase === 'battle' ? 300 : 980, 40);
        this.hintLabel.string = this.feedback || help;
    }

    private renderBattle(s: Snapshot): void {
        const selected = s.hand.find(card => card.uid === this.selection.selectedUid);
        if (s.enemy !== null) {
            const boss = s.map.nodes.some(node => node.kind === 'boss' && hexDistance(node.coord, s.map.position) === 0);
            const art = this.battleArt.target(this.enemy.node, boss ? 'enemy_boss' : 'enemy_normal');
            this.statusViews.get(this.enemy.node)!.render(s.enemy.hp, s.enemy.maxHp, null);
            this.enemy.label.node.setPosition(0, art ? -143 : 20);
            this.enemy.label.node.getComponent(UITransform)!.setContentSize(226, art ? 44 : 200);
            this.enemy.label.string = art ? `${boss ? '魔王' : '怪物'} · 意图：攻击 ${s.enemy.intent.kind === 'attack' ? s.enemy.intent.damage : 0}`
                : `${boss ? 'BOSS' : '怪物'}\n\n意图：攻击 ${s.enemy.intent.kind === 'attack' ? s.enemy.intent.damage : 0}`;
            this.paintTarget(this.enemy, art, C.red, selected?.def.effect.kind === 'attack');
        }
        for (let i = 0; i < this.heroes.length; i += 1) {
            const hero = s.party[i];
            const panel = this.heroes[i]!;
            panel.node.active = hero !== undefined;
            if (hero === undefined) continue;
            const color = this.colorTint(hero.color);
            panel.node.setPosition(s.party.length === 2 ? 255 + i * 230 : 150 + i * 185, 40);
            const target = hero.alive && selected?.def.effect.kind === 'defend';
            const art = this.battleArt.target(panel.node, `hero_${hero.color}`, hero.alive);
            this.statusViews.get(panel.node)!.render(hero.hp, hero.maxHp, hero.block, hero.alive);
            panel.label.node.setPosition(0, art ? this.battleArt.targetHeight(panel.node) - 65 : 20);
            panel.label.node.getComponent(UITransform)!.setContentSize(151, art ? 26 : 200);
            panel.label.string = art ? `${this.colorName(hero.color)}${hero.alive ? '' : ' · 已阵亡'}`
                : `${this.colorName(hero.color)}色角色\n\n${hero.alive ? '点击可作为防御目标' : '已阵亡 · 不再产出能量'}`;
            this.paintTarget(panel, art, color, target);
        }
        const e = s.energy;
        const energyArt = this.battleArt.energy(e);
        this.energyLabel.node.setPosition(-495, -278);
        this.energyLabel.node.getComponent(UITransform)!.setContentSize(240, 112);
        this.energyLabel.node.active = !energyArt;
        this.energyLabel.string = energyArt ? '' : `可用能量\n红 ${e.red}    绿 ${e.green}\n蓝 ${e.blue}    白 ${e.white}`;
        this.handLabel.string = `手牌 ${s.hand.length}   抽牌 ${s.drawCount}   弃牌 ${s.discardCount}`;
        while (this.handCards.length < s.hand.length) {
            this.handCards.push(this.panel(`HandCard_${this.handCards.length}`, this.battlePage, 0, -253, 138, 190, '', 15));
        }
        const signature = s.hand.map(card => card.uid).join('|');
        if (signature !== this.handSignature) {
            this.clearHandHover();
            this.handSignature = signature;
        }
        this.handSpacing = Math.min(96, 750 / Math.max(s.hand.length - 1, 1));
        for (let i = 0; i < this.handCards.length; i += 1) {
            const panel = this.handCards[i]!;
            const card = s.hand[i];
            panel.node.active = card !== undefined;
            if (card === undefined) continue;
            const chosen = this.selection.selectedUid === card.uid;
            Tween.stopAllByTarget(panel.node);
            panel.node.setPosition((i - (s.hand.length - 1) / 2) * this.handSpacing, this.hoveredUid === card.uid ? -215 : chosen ? -245 : -253);
            panel.node.setScale(this.hoveredUid === card.uid ? 1.25 : 1, this.hoveredUid === card.uid ? 1.25 : 1, 1);
            panel.node.setSiblingIndex(this.battlePage.children.length - 1);
            panel.label.string = this.cardText(card.def) + `\n\n${chosen ? '已选择' : card.playable ? '' : '能量不足'}`;
            panel.label.color = card.playable ? C.text : C.dim;
            const art = this.battleArt.card(panel.node, card.def, chosen, card.playable, this.colorTint(card.def.color));
            panel.label.node.active = !art;
            this.paint(panel, art ? new Color(28, 39, 55, 0) : card.playable ? C.panel : C.muted, chosen ? C.gold
                : card.playable ? this.colorTint(card.def.color) : C.line, chosen);
        }
        const hoverIndex = s.hand.findIndex(card => card.uid === this.hoveredUid);
        if (hoverIndex >= 0) this.handCards[hoverIndex]!.node.setSiblingIndex(this.battlePage.children.length - 1);
        this.cancelButton.node.active = this.selection.selectedUid !== null;
        this.paint(this.endTurn, new Color(45, 71, 62), C.green);
    }

    private paintTarget(panel: Panel, art: boolean, tint: Color, selected: boolean): void {
        if (!art) { this.paint(panel, C.panel, selected ? C.gold : tint, selected); return; }
        const g = panel.graphics;
        g.clear();
        g.fillColor = new Color(0, 0, 0, 75);
        g.ellipse(0, -85, panel.node.getComponent(UITransform)!.width * 0.3, 10);
        g.fill();
        if (selected) {
            g.strokeColor = C.gold;
            g.lineWidth = 3;
            g.ellipse(0, -85, panel.node.getComponent(UITransform)!.width * 0.34, 13);
            g.stroke();
        }
    }

    private clearHandHover(): void {
        this.hoveredUid = null;
        this.handSignature = '';
        for (const panel of this.handCards) {
            Tween.stopAllByTarget(panel.node);
            panel.node.setScale(1, 1, 1);
        }
    }

    onDisable(): void {
        this.clearHandHover();
    }

    private onMouseLeave(): void {
        if (!this.disposed) this.setHandHover(null);
    }

    private setHandHover(uid: string | null): void {
        if (uid === this.hoveredUid || this.session === undefined || this.choosingTeam) return;
        this.hoveredUid = uid;
        const hand = this.session.snapshot.hand;
        for (let i = 0; i < hand.length; i += 1) {
            const panel = this.handCards[i]!;
            const hovered = hand[i]!.uid === uid;
            const y = hovered ? -215 : hand[i]!.uid === this.selection.selectedUid ? -245 : -253;
            Tween.stopAllByTarget(panel.node);
            panel.node.setSiblingIndex(this.battlePage.children.length - 1);
            tween(panel.node).to(0.12, { position: new Vec3((i - (hand.length - 1) / 2) * this.handSpacing, y, 0),
                scale: new Vec3(hovered ? 1.25 : 1, hovered ? 1.25 : 1, 1) }, { easing: 'quadOut' }).start();
        }
        const index = hand.findIndex(card => card.uid === uid);
        if (index >= 0) this.handCards[index]!.node.setSiblingIndex(this.battlePage.children.length - 1);
    }

    private mousePoint(event: EventMouse): Vec3 | null {
        const camera = this.node.getComponent(Canvas)?.cameraComponent;
        if (camera === null || camera === undefined) return null;
        const location = event.getLocation();
        const point = camera.screenToWorld(new Vec3(location.x, location.y, 0));
        point.z = 0;
        return point;
    }

    private baseHandHit(point: Vec3): number {
        const hand = this.session.snapshot.hand;
        const local = this.battlePage.getComponent(UITransform)!.convertToNodeSpaceAR(point);
        if (local.y < -348 || local.y > -158) return -1;
        for (let i = hand.length - 1; i >= 0; i -= 1) {
            const x = (i - (hand.length - 1) / 2) * this.handSpacing;
            if (Math.abs(local.x - x) <= 69) return i;
        }
        return -1;
    }

    private handHit(point: Vec3): number {
        const hand = this.session.snapshot.hand;
        const hover = hand.findIndex(card => card.uid === this.hoveredUid);
        if (hover >= 0 && this.hit(this.handCards[hover]!.node, point)) return hover;
        for (let i = hand.length - 1; i >= 0; i -= 1) {
            if (this.hit(this.handCards[i]!.node, point)) return i;
        }
        return -1;
    }

    private onMouseMove(event: EventMouse): void {
        if (!this.enabledInHierarchy || this.disposed) return;
        if (this.choosingTeam || this.session === undefined || this.session.snapshot.phase !== 'battle') return;
        const point = this.mousePoint(event);
        if (point === null) return;
        const base = this.baseHandHit(point);
        const index = base >= 0 ? base : this.handHit(point);
        this.setHandHover(index < 0 ? null : this.session.snapshot.hand[index]!.uid);
    }

    private dispatch(value: GameInput): void {
        this.clearHandHover();
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
        this.openTeam();
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
        if (!this.enabledInHierarchy) return;
        const point = this.mousePoint(event);
        if (point === null) return;
        if (this.choosingTeam) {
            if (event.getButton() !== EventMouse.BUTTON_LEFT) return;
            for (let i = 0; i < this.rosterCards.length; i += 1) {
                const hero = this.teamSelection.roster[i];
                if (hero !== undefined && this.hit(this.rosterCards[i]!.node, point)) {
                    this.teamSelection.toggle(hero.id); this.render(); return;
                }
            }
            if (this.hit(this.confirmTeam.node, point)) this.beginTeam();
            else if (this.hit(this.continueRun.node, point)) this.continueSaved();
            return;
        }
        if (this.session === undefined) return;
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
            const cardIndex = this.handHit(point);
            if (cardIndex >= 0) { this.selectCard(cardIndex); return; }
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
        if (this.choosingTeam || this.session === undefined) return;
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
