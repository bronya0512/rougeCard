import { _decorator, Component, director, Node } from 'cc';
const { ccclass } = _decorator;

/** M0 smoke test 专用：只验证输入链路与场景切换，不接入 core 逻辑。 */
@ccclass('StartMenu')
export class StartMenu extends Component {
    onLoad() {
        this.node.on(Node.EventType.TOUCH_END, this.onStart, this);
    }

    onDestroy() {
        this.node.off(Node.EventType.TOUCH_END, this.onStart, this);
    }

    private onStart() {
        console.log('[StartMenu] start clicked');
        director.loadScene('Placeholder', (err) => {
            if (err) {
                console.warn('[StartMenu] Placeholder 场景不可用', err);
            }
        });
    }
}
