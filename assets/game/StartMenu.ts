import { _decorator, Component, Node } from 'cc';
import { GameRoot } from './GameRoot';
const { ccclass } = _decorator;

/** M0 entry point: START now boots the core-backed GameRoot in-place. */
@ccclass('StartMenu')
export class StartMenu extends Component {
    private started = false;

    onLoad() {
        this.node.on(Node.EventType.TOUCH_END, this.onStart, this);
    }

    onDestroy() {
        this.node.off(Node.EventType.TOUCH_END, this.onStart, this);
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
        canvas.addComponent(GameRoot);
        // Hide the menu UI so it does not overlay the game.
        const title = canvas.getChildByName('TitleLabel');
        const button = canvas.getChildByName('StartButton');
        if (title !== null) title.active = false;
        if (button !== null) button.active = false;
    }
}
