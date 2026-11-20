import { Color, Label, Layers, Mask, Node, resources, Sprite, SpriteFrame, UITransform } from 'cc';
import type { CardDef, Snapshot } from '../core';

import { ART_NAMES } from './ConfigPackage';
import type { ArtName, PresentationConfig } from './ConfigPackage';
type CardArt = { node: Node; image: Sprite; frame: Sprite; title: Label; cost: Label; effect: Label; status: Label };

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
        this.background.color = new Color(100, 105, 118, 255);
        this.energyNode = this.node('EnergyArt', page, -260, -45, 480, 34);
        for (let i = 0; i < 3; i += 1) {
            this.energyIcons.push(this.sprite(`EnergyIcon_${i}`, this.energyNode, i * 150, 0));
            this.energyCounts.push(this.label(`EnergyCount_${i}`, this.energyNode, i * 150 + 50, 0, 64, 30, 20));
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

    private show(sprite: Sprite, name: ArtName, width: number, height: number, cover = false): boolean {
        const frame = this.frames.get(name);
        sprite.node.active = frame !== undefined;
        if (frame === undefined) {
            sprite.spriteFrame = null;
            return false;
        }
        sprite.spriteFrame = frame;
        const ratio = cover ? Math.max(width / frame.rect.width, height / frame.rect.height)
            : Math.min(width / frame.rect.width, height / frame.rect.height);
        sprite.node.getComponent(UITransform)!.setContentSize(frame.rect.width * ratio, frame.rect.height * ratio);
        sprite.node.setScale(this.presentation?.[name].flip ? -1 : 1, 1, 1);
        return true;
    }

    target(parent: Node, name: 'hero_red' | 'hero_green' | 'hero_blue' | 'enemy_normal' | 'enemy_boss', alive = true): boolean {
        let sprite = this.targets.get(parent);
        if (sprite === undefined) {
            sprite = this.sprite('Portrait', parent, 0, 26);
            sprite.node.setSiblingIndex(0);
            this.targets.set(parent, sprite);
        }
        const width = parent.getComponent(UITransform)!.width - 12;
        const visible = this.show(sprite, name, width, 165);
        sprite.color = alive ? Color.WHITE : new Color(110, 110, 110, 170);
        return visible;
    }

    energy(energy: Snapshot['energy']): boolean {
        this.show(this.background, 'battle_bg', 1280, 720, true);
        const names = ['energy_red', 'energy_green', 'energy_blue'] as const;
        const values = [energy.red, energy.green, energy.blue];
        let ready = true;
        for (let i = 0; i < names.length; i += 1) {
            ready = this.show(this.energyIcons[i]!, names[i]!, 30, 30) && ready;
            this.energyCounts[i]!.string = String(values[i]);
        }
        this.energyNode.active = ready;
        return ready;
    }

    private createCard(parent: Node): CardArt {
        const node = this.node('CardArt', parent, 0, 0, 138, 190);
        const maskNode = this.node('IllustrationWindow', node, 0, 27, 116, 110);
        maskNode.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;
        const image = this.sprite('Illustration', maskNode, 0, 0);
        const frame = this.sprite('Frame', node, 0, 0);
        const title = this.label('CardTitle', node, 10, 82, 106, 18, 14);
        const cost = this.label('CardCost', node, -55, 81, 24, 22, 16);
        const effect = this.label('CardEffect', node, 0, -52, 110, 45, 15);
        const status = this.label('CardStatus', node, 0, -82, 120, 18, 12);
        return { node, image, frame, title, cost, effect, status };
    }

    card(parent: Node, card: CardDef, chosen: boolean, playable: boolean, tint: Color): boolean {
        let view = this.cards.get(parent);
        if (view === undefined) {
            view = this.createCard(parent);
            this.cards.set(parent, view);
        }
        const imageReady = this.show(view.image, card.effect.kind === 'attack' ? 'icon_attack' : 'icon_defend', 116, 110, true);
        const frameReady = this.show(view.frame, 'card_frame', 138, 190);
        const ready = imageReady && frameReady;
        view.node.active = ready;
        view.title.string = card.name;
        view.title.color = new Color(45, 38, 30);
        view.cost.string = String(card.cost);
        view.cost.color = tint;
        view.effect.string = card.effect.kind === 'attack' ? `造成 ${card.effect.damage} 点伤害` : `获得 ${card.effect.block} 点格挡`;
        view.effect.color = new Color(45, 38, 30);
        view.status.string = chosen ? '已选择 · 点击目标' : playable ? '左键选择' : '能量不足';
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
