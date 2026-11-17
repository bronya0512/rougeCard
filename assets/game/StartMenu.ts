import { _decorator, Component, Node } from 'cc';
import { GameRoot } from './GameRoot';
import { createWebAdapter, installCanvasContextMenuGuard } from '../platform/web';
const { ccclass, property } = _decorator;

/** M0 entry point: START now boots the core-backed GameRoot in-place. */
@ccclass('StartMenu')
export class StartMenu extends Component {
    @property({ range: [3, 5, 1], tooltip: '新局地图层数：3、4或5；读取存档不会覆盖存档中的层数' })
    floorCount = 3;

    private started = false;
    private releaseContextMenu: (() => void) | null = null;

    onLoad() {
        this.releaseContextMenu = installCanvasContextMenuGuard();
        this.node.on(Node.EventType.TOUCH_END, this.onStart, this);
    }

    onDestroy() {
        this.node.off(Node.EventType.TOUCH_END, this.onStart, this);
        this.releaseContextMenu?.();
        this.releaseContextMenu = null;
    }

    private onStart() {
        if (this.started) return;
        this.started = true;
        console.log('[StartMenu] start clicked - booting core game');
        // Attach GameRoot to the Canvas (parent of this button) so it can build
        // its UI as siblings. Hooks up input -> core.advance -> Snapshot render.
        const canvas = this.node.parent;
        if (canvas === null) {
            console.warn('[StartMenu] no Canvas parent found');
            return;
        }
        // Composition root: build the Web adapter and inject its StoragePort
        // into GameRoot (T107). GameRoot/core never import platform code.
        const root = canvas.addComponent(GameRoot);
        root.floorCount = this.floorCount;
        root.configure(createWebAdapter().storage);
        // Hide the menu UI so it does not overlay the game.
        const title = canvas.getChildByName('TitleLabel');
        const button = canvas.getChildByName('StartButton');
        if (title !== null) title.active = false;
        if (button !== null) button.active = false;
    }
}
