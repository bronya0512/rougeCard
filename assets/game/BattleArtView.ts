import { Color, Graphics, Label, LabelOutline, Layers, Mask, Node, resources, Sprite, SpriteFrame, UITransform } from 'cc';
import type { CardDef, Snapshot } from '../core';

import { ART_NAMES } from './ConfigPackage';
import type { ArtName, PresentationConfig } from './ConfigPackage';
import { cardEnergyCosts, layoutCardCosts } from './CardCostLayout';
import type { CardEnergyCosts } from './CardCostLayout';
type CostBadge = { node: Node; icon: Sprite; fallback: Graphics; value: Label };
type CardArt = { node: Node; image: Sprite; frame: Sprite; title: Label; costs: CostBadge[]; effect: Label; status: Label };

export class BattleArtView {
    private readonly frames = new Map<ArtName, SpriteFrame>();
    private readonly targets = new Map<Node, Sprite>();
    private readonly cards = new Map<Node, CardArt>();
    private readonly background: Sprite;
    private readonly energyNode: Node;
    private readonly energyIcons: Sprite[] = [];
    private readonly energyCounts: Label[] = [];
    private disposed = false;

    constructor(private readonly page: Node, refresh: () => void, readonly presentation: PresentationConfig | null) {
        this.background = this.sprite('BattleBackground', page, 0, 0);
        this.background.node.setSiblingIndex(0);
        this.background.color = Color.WHITE;
        this.energyNode = this.node('EnergyArt', page, -495, -278, 240, 112);
        for (let i = 0; i < 4; i += 1) {
            const x = (i % 2) * 115 - 65;
            const y = i < 2 ? 30 : -30;
            this.energyIcons.push(this.sprite(`EnergyIcon_${i}`, this.energyNode, x, y));
            this.energyCounts.push(this.label(`EnergyCount_${i}`, this.energyNode, x + 42, y, 44, 30, 22));
        }
        this.energyNode.active = false;
        if (presentation === null) return;
        for (const name of ART_NAMES) {
            resources.load(presentation[name].path, SpriteFrame, (error, frame) => {
                if (error || frame === undefined) {
                    if (!this.disposed) console.warn(`占位美术加载失败：${name}`);
                    return;
                }
                frame.addRef();
                if (this.disposed) {
                    frame.decRef();
                    return;
                }
                this.frames.set(name, frame);
                refresh();
            });
        }
    }

    private node(name: string, parent: Node, x: number, y: number, width: number, height: number): Node {
        const node = new Node(name);
        node.layer = Layers.Enum.UI_2D;
        node.setParent(parent);
        node.setPosition(x, y);
        node.addComponent(UITransform).setContentSize(width, height);
        return node;
    }

    private sprite(name: string, parent: Node, x: number, y: number): Sprite {
        const sprite = this.node(name, parent, x, y, 1, 1).addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.node.active = false;
        return sprite;
    }

    private label(name: string, parent: Node, x: number, y: number, width: number, height: number, size: number): Label {
        const label = this.node(name, parent, x, y, width, height).addComponent(Label);
        label.fontSize = size;
        label.lineHeight = size + 3;
        label.overflow = Label.Overflow.SHRINK;
        label.enableWrapText = true;
        return label;
    }

    private show(sprite: Sprite, name: ArtName, width: number, height: number, cover = false, fitHeight = false): boolean {
        const frame = this.frames.get(name);
        sprite.node.active = frame !== undefined;
        if (frame === undefined) {
            sprite.spriteFrame = null;
            return false;
        }
        sprite.spriteFrame = frame;
        const ratio = fitHeight ? height / frame.rect.height
            : cover ? Math.max(width / frame.rect.width, height / frame.rect.height)
            : Math.min(width / frame.rect.width, height / frame.rect.height);
        sprite.node.getComponent(UITransform)!.setContentSize(frame.rect.width * ratio, frame.rect.height * ratio);
        sprite.node.setScale(this.presentation?.[name].flip ? -1 : 1, 1, 1);
        return true;
    }

    target(parent: Node, name: 'hero_red' | 'hero_green' | 'hero_blue' | 'enemy_normal' | 'enemy_boss', alive = true,
        layout?: { readonly height: number; readonly groundY: number }): boolean {
        let sprite = this.targets.get(parent);
        if (sprite === undefined) {
            sprite = this.sprite('Portrait', parent, 0, 26);
            sprite.node.setSiblingIndex(0);
            this.targets.set(parent, sprite);
        }
        const width = parent.getComponent(UITransform)!.width - 12;
        const height = layout?.height ?? this.presentation?.[name].displayHeight;
        const visible = this.show(sprite, name, width, height ?? 245, false, height !== undefined);
        if (visible) sprite.node.setPosition(0, (layout?.groundY ?? -85) + sprite.node.getComponent(UITransform)!.height / 2);
        sprite.color = alive ? Color.WHITE : new Color(110, 110, 110, 170);
        return visible;
    }

    targetHeight(parent: Node): number {
        return this.targets.get(parent)?.node.getComponent(UITransform)?.height ?? 0;
    }

    energy(energy: Snapshot['energy']): boolean {
        this.show(this.background, 'battle_bg', 1280, 720, true);
        const names = ['energy_red', 'energy_green', 'energy_blue', 'energy_white'] as const;
        const values = [energy.red, energy.green, energy.blue, energy.white];
        let ready = true;
        for (let i = 0; i < names.length; i += 1) {
            ready = this.show(this.energyIcons[i]!, names[i]!, 40, 40) && ready;
            this.energyCounts[i]!.string = String(values[i]);
        }
        this.energyNode.active = ready;
        return ready;
    }

    private createCard(parent: Node): CardArt {
        const node = this.node('CardArt', parent, 0, 0, 138, 190);
        const maskNode = this.node('IllustrationWindow', node, 0, 37, 88, 74);
        maskNode.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;
        const image = this.sprite('Illustration', maskNode, 0, 0);
        const frame = this.sprite('Frame', node, 0, 0);
        const title = this.label('CardTitle', node, 0, -14, 90, 16, 14);
        title.enableWrapText = false;
        const effect = this.label('CardEffect', node, 0, -52, 110, 45, 15);
        const status = this.label('CardStatus', node, 0, -82, 120, 18, 12);
        const costs: CostBadge[] = [];
        for (let i = 0; i < 4; i += 1) {
            const badge = this.node(`CostBadge_${i}`, node, -56, 78 - i * 28, 26, 26);
            const fallback = this.node('Fallback', badge, 0, 0, 26, 26).addComponent(Graphics);
            const icon = this.sprite('Icon', badge, 0, 0);
            const value = this.label('CardCost', badge, 0, 0, 24, 22, 16);
            value.enableWrapText = false;
            value.isBold = true;
            const outline = value.node.addComponent(LabelOutline);
            outline.color = new Color(35, 30, 25);
            outline.width = 1;
            badge.active = false;
            costs.push({ node: badge, icon, fallback, value });
        }
        return { node, image, frame, title, costs, effect, status };
    }

    cardCosts(parent: Node, costs: CardEnergyCosts): void {
        const view = this.cards.get(parent);
        if (view === undefined) return;
        const entries = layoutCardCosts(costs);
        const colors = { red: new Color(175, 57, 51), green: new Color(61, 132, 80),
            blue: new Color(55, 106, 170), white: new Color(215, 212, 200) };
        for (let i = 0; i < view.costs.length; i += 1) {
            const badge = view.costs[i]!;
            const entry = entries[i];
            badge.node.active = entry !== undefined;
            if (entry === undefined) {
                badge.icon.spriteFrame = null;
                badge.value.string = '';
                continue;
            }
            badge.node.setPosition(entry.x, entry.y);
            badge.fallback.node.active = !this.show(badge.icon, `energy_${entry.color}`, 26, 26);
            badge.fallback.clear();
            if (badge.fallback.node.active) {
                badge.fallback.fillColor = colors[entry.color];
                badge.fallback.circle(0, 0, 12);
                badge.fallback.fill();
            }
            badge.value.string = String(entry.amount);
            badge.value.color = Color.WHITE;
        }
    }

    card(parent: Node, card: CardDef, chosen: boolean, playable: boolean, _tint: Color): boolean {
        let view = this.cards.get(parent);
        if (view === undefined) {
            view = this.createCard(parent);
            this.cards.set(parent, view);
        }
        const imageReady = this.show(view.image, card.effect.kind === 'attack' ? 'icon_attack' : 'icon_defend', 88, 74, true);
        const frameReady = this.show(view.frame, 'card_frame', 138, 190);
        const ready = imageReady && frameReady;
        const size = parent.getComponent(UITransform)!;
        const scale = Math.min(size.width / 138, size.height / 190);
        view.node.setScale(scale, scale, 1);
        view.node.active = ready;
        view.title.string = card.name;
        view.title.color = new Color(45, 38, 30);
        this.cardCosts(parent, cardEnergyCosts(card));
        view.effect.string = card.effect.kind === 'attack' ? `造成 ${card.effect.damage} 点伤害` : `获得 ${card.effect.block} 点格挡`;
        view.effect.color = new Color(45, 38, 30);
        view.status.string = chosen ? '已选择' : playable ? '' : '能量不足';
        view.status.color = playable ? new Color(62, 49, 31) : new Color(135, 51, 51);
        view.image.color = playable ? Color.WHITE : new Color(135, 135, 135, 255);
        view.frame.color = playable ? Color.WHITE : new Color(180, 180, 180, 255);
        return ready;
    }

    destroy(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.background.spriteFrame = null;
        for (const sprite of this.energyIcons) sprite.spriteFrame = null;
        for (const sprite of this.targets.values()) sprite.spriteFrame = null;
        for (const view of this.cards.values()) {
            view.image.spriteFrame = null;
            view.frame.spriteFrame = null;
            for (const badge of view.costs) badge.icon.spriteFrame = null;
            view.node.destroy();
        }
        for (const sprite of this.targets.values()) sprite.node.destroy();
        this.background.node.destroy();
        this.energyNode.destroy();
        this.targets.clear();
        this.cards.clear();
        for (const frame of this.frames.values()) frame.decRef();
        this.frames.clear();
    }
}
