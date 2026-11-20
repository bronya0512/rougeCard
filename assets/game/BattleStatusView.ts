import { Color, Graphics, Label, Layers, Node, UITransform } from 'cc';

type Bar = { node: Node; fill: Node; label: Label };

export class BattleStatusView {
    readonly health: Bar;
    readonly shield: Bar;

    constructor(parent: Node, width: number) {
        this.health = this.bar('HealthBar', parent, -108, width, new Color(172, 61, 65));
        this.shield = this.bar('ShieldBar', parent, -132, width, new Color(63, 121, 185));
    }

    private bar(name: string, parent: Node, y: number, width: number, color: Color): Bar {
        const node = new Node(name);
        node.layer = Layers.Enum.UI_2D;
        node.setParent(parent);
        node.setPosition(0, y);
        node.addComponent(UITransform).setContentSize(width, 20);
        const background = node.addComponent(Graphics);
        background.fillColor = new Color(17, 23, 34, 225);
        background.roundRect(-width / 2 - 2, -12, width + 4, 24, 5);
        background.fill();
        const fill = new Node('Fill');
        fill.layer = Layers.Enum.UI_2D;
        fill.setParent(node);
        fill.setPosition(-width / 2, 0);
        fill.addComponent(UITransform).setContentSize(width, 18);
        const graphics = fill.addComponent(Graphics);
        graphics.fillColor = color;
        graphics.rect(0, -9, width, 18);
        graphics.fill();
        const text = new Node('Value');
        text.layer = Layers.Enum.UI_2D;
        text.setParent(node);
        text.addComponent(UITransform).setContentSize(width, 22);
        const label = text.addComponent(Label);
        label.fontSize = 15;
        label.lineHeight = 18;
        label.overflow = Label.Overflow.SHRINK;
        label.color = Color.WHITE;
        return { node, fill, label };
    }

    render(hp: number, maxHp: number, block: number | null, alive = hp > 0): void {
        this.health.fill.setScale(Math.max(0, Math.min(1, hp / maxHp)), 1, 1);
        this.health.label.string = alive ? `HP ${hp}/${maxHp}` : `已阵亡 · HP ${hp}/${maxHp}`;
        this.shield.node.active = block !== null;
        if (block !== null) {
            this.shield.fill.setScale(Math.max(0, Math.min(1, block / maxHp)), 1, 1);
            this.shield.label.string = `护盾 ${block}`;
        }
    }
}
