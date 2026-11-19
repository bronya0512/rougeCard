async page => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const report = await page.evaluate(async () => {
        const cc = await System.import('cc');
        const canvas = cc.director.getScene().getChildByName('Canvas');
        const root = canvas.components.find(component => component.teamSelection);
        if (!root || root.choosingTeam || root.battleArt.frames.size !== 12) throw new Error('Requires a loaded battle art verification session');
        const check = (condition, message) => { if (!condition) throw new Error(message); };
        const saved = localStorage.getItem('roguecard.save.v1');
        const snapshot = JSON.stringify(root.session.snapshot);
        const originalLoad = cc.resources.load;
        const rootArt = root.battleArt;
        const Art = rootArt.constructor;
        const frames = new Map(rootArt.frames);
        const baseline = new Map([...frames].map(([key, frame]) => [key, frame.refCount]));
        const refsEqual = () => [...frames].every(([key, frame]) => frame.refCount === baseline.get(key));
        const scenarios = [];
        for (const mode of ['success', 'failure', 'late']) {
            const callbacks = [];
            const parent = new cc.Node(`ArtLifecycle-${mode}`);
            parent.layer = cc.Layers.Enum.UI_2D;
            parent.addComponent(cc.UITransform).setContentSize(1280, 720);
            canvas.addChild(parent);
            let refreshes = 0;
            let view;
            try {
                cc.resources.load = (path, type, callback) => callbacks.push({ key: path.split('/')[0], callback });
                view = new Art(parent, () => refreshes++);
                check(callbacks.length === 12, 'Each resource must load once');
                if (mode === 'late') view.destroy();
                for (const { key, callback } of callbacks) callback(mode === 'failure' ? new Error('intentional load failure') : undefined,
                    mode === 'failure' ? undefined : frames.get(key));
                if (mode === 'success') {
                    check(view.frames.size === 12 && refreshes === 12, 'Successful resources were not retained/redrawn');
                    const target = new cc.Node('TestTarget');
                    target.addComponent(cc.UITransform).setContentSize(175, 235);
                    parent.addChild(target);
                    check(view.target(target, 'hero_blue'), 'Loaded portrait unavailable');
                    check(view.card(target, root.session.snapshot.hand[0].def, false, true, cc.Color.WHITE), 'Loaded card unavailable');
                    check(view.energy(root.session.snapshot.energy), 'Loaded energy unavailable');
                } else if (mode === 'failure') {
                    const target = new cc.Node('FallbackTarget');
                    target.addComponent(cc.UITransform).setContentSize(175, 235);
                    parent.addChild(target);
                    check(!view.target(target, 'hero_red') && !view.card(target, root.session.snapshot.hand[0].def, false, true, cc.Color.WHITE)
                        && !view.energy(root.session.snapshot.energy), 'Missing art must request text fallback');
                    check(view.frames.size === 0 && refreshes === 0, 'Failure unexpectedly retained/redrew resources');
                    try {
                        root.battleArt = view;
                        root.render();
                        check(root.handCards.filter(panel => panel.node.active).every(panel => panel.label.node.active
                            && panel.label.string.includes('能量')), 'GameRoot did not restore card text fallback');
                        check(root.heroes.filter(panel => panel.node.active).every(panel => panel.label.string.includes('色角色'))
                            && root.energyLabel.string.includes('可用能量'), 'GameRoot did not restore target/energy text');
                    } finally {
                        root.battleArt = rootArt;
                        root.render();
                    }
                } else check(view.frames.size === 0 && refreshes === 0 && view.disposed, 'Late callback updated disposed view');
                view.destroy();
                view.destroy();
                check(refsEqual(), 'Resource references did not return to baseline');
                scenarios.push({ mode, callbacks: callbacks.length, refreshes, referencesBalanced: true, disposed: view.disposed });
            } finally {
                cc.resources.load = originalLoad;
                if (view) view.destroy();
                parent.destroy();
            }
        }
        check(JSON.stringify(root.session.snapshot) === snapshot && localStorage.getItem('roguecard.save.v1') === saved,
            'Presentation lifecycle test changed business state/save');
        root.destroy();
        await new Promise(resolve => setTimeout(resolve, 200));
        check(rootArt.disposed && rootArt.frames.size === 0, 'GameRoot destruction did not dispose art');
        check([...frames].every(([key, frame]) => frame.refCount === baseline.get(key) - 1), 'GameRoot ownership was not released');
        check(localStorage.getItem('roguecard.save.v1') === saved, 'Destroying rendering changed save');
        return { scenarios, rootDisposed: true, rootReferencesReleased: true, saveUnchanged: true,
            source: location.port === '7456' ? 'editor-preview' : 'web-build', intentionalFailures: 12 };
    });
    await page.waitForTimeout(250);
    if (errors.length) throw new Error(errors.join('; '));
    return { result: '002 ART LIFECYCLE PASS', ...report, errors };
}
