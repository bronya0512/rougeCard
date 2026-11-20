async page => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const report = await page.evaluate(async () => {
        const cc = await System.import('cc');
        const canvas = cc.director.getScene().getChildByName('Canvas');
        const root = canvas.components.find(component => component.teamSelection);
        if (!root || root.choosingTeam || root.battleArt.frames.size !== 13) throw new Error('Requires a loaded battle art verification session');
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
        for (const mode of ['success', 'failure', 'white-failure', 'late']) {
            const callbacks = [];
            const parent = new cc.Node(`ArtLifecycle-${mode}`);
            parent.layer = cc.Layers.Enum.UI_2D;
            parent.addComponent(cc.UITransform).setContentSize(1280, 720);
            canvas.addChild(parent);
            let refreshes = 0;
            let view;
            try {
                cc.resources.load = (path, type, callback) => callbacks.push({
                    key: Object.keys(rootArt.presentation).find(key => rootArt.presentation[key].path === path), callback });
                const presentation = mode === 'success' ? { ...rootArt.presentation,
                    hero_blue: { path: rootArt.presentation.hero_blue.path, flip: rootArt.presentation.hero_blue.flip } } : rootArt.presentation;
                view = new Art(parent, () => refreshes++, presentation);
                check(callbacks.length === 13, 'Each resource must load once');
                if (mode === 'late') view.destroy();
                for (const { key, callback } of callbacks) {
                    const fail = mode === 'failure' || mode === 'white-failure' && key === 'energy_white';
                    callback(fail ? new Error('intentional load failure') : undefined, fail ? undefined : frames.get(key));
                }
                if (mode === 'success') {
                    check(view.frames.size === 13 && refreshes === 13, 'Successful resources were not retained/redrawn');
                    const target = new cc.Node('TestTarget');
                    target.addComponent(cc.UITransform).setContentSize(175, 235);
                    parent.addChild(target);
                    check(view.target(target, 'hero_blue'), 'Loaded portrait unavailable');
                    const frame = frames.get('hero_blue');
                    const expected = Math.min(163 / frame.rect.width, 245 / frame.rect.height) * frame.rect.height;
                    check(Math.abs(view.targetHeight(target) - expected) < 0.01, 'Missing height did not preserve legacy contain');
                    check(Math.abs(target.getChildByName('Portrait').position.y - expected / 2 + 85) < 0.01,
                        'Legacy height changed ground baseline');
                    check(view.target(target, 'hero_green') && Math.abs(view.targetHeight(target) - rootArt.presentation.hero_green.displayHeight) < 0.01,
                        'Wide knight ignored configured height');
                    check(view.card(target, root.session.snapshot.hand[0].def, false, true, cc.Color.WHITE), 'Loaded card unavailable');
                    const roster = new cc.Node('TestRoster');
                    roster.addComponent(cc.UITransform).setContentSize(260, 380);
                    parent.addChild(roster);
                    check(view.target(roster, 'hero_green', true, { height: 175.5, groundY: -10 })
                        && Math.abs(view.targetHeight(roster) - 175.5) < 0.01, 'Roster portrait layout ignored');
                    check(Math.abs(roster.getChildByName('Portrait').position.y - 175.5 / 2 + 10) < 0.01, 'Roster ground changed');
                    const reward = new cc.Node('TestReward');
                    reward.addComponent(cc.UITransform).setContentSize(245, 300);
                    parent.addChild(reward);
                    check(view.card(reward, root.session.snapshot.hand[0].def, false, true, cc.Color.WHITE)
                        && Math.abs(reward.getChildByName('CardArt').scale.x - 300 / 190) < 0.001, 'Reward card size ignored');
                    check(view.energy(root.session.snapshot.energy), 'Loaded energy unavailable');
                } else if (mode === 'failure' || mode === 'white-failure') {
                    const target = new cc.Node('FallbackTarget');
                    target.addComponent(cc.UITransform).setContentSize(175, 235);
                    parent.addChild(target);
                    const remaining = mode === 'white-failure' ? 12 : 0;
                    check(view.target(target, 'hero_red') === (mode === 'white-failure')
                        && view.card(target, root.session.snapshot.hand[0].def, false, true, cc.Color.WHITE) === (mode === 'white-failure')
                        && !view.energy(root.session.snapshot.energy), 'Missing energy art must request text fallback');
                    check(view.frames.size === remaining && refreshes === remaining, 'Failed resources were retained or successful resources lost');
                    try {
                        root.battleArt = view;
                        root.render();
                        if (mode === 'failure') {
                            check(root.handCards.filter(panel => panel.node.active).every(panel => panel.label.node.active
                                && panel.label.string.includes('能量') && !/左键选择|点击目标/.test(panel.label.string)), 'GameRoot did not restore card text fallback');
                            check(root.heroes.filter(panel => panel.node.active).every(panel => panel.label.string.includes('色角色')),
                                'GameRoot did not restore target text');
                        }
                        const energy = root.session.snapshot.energy;
                        check(root.energyLabel.node.active && !view.energyNode.active && root.energyLabel.node.position.x < -350
                            && root.energyLabel.node.position.y < -200
                            && root.energyLabel.string === `可用能量\n红 ${energy.red}    绿 ${energy.green}\n蓝 ${energy.blue}    白 ${energy.white}`,
                            'GameRoot did not restore lower-left four-color energy text');
                        check(root.hintLabel.string === root.feedback, 'Fallback restored selection instructions');
                    } finally {
                        root.battleArt = rootArt;
                        root.render();
                    }
                } else check(view.frames.size === 0 && refreshes === 0 && view.disposed, 'Late callback updated disposed view');
                const sprites = [view.background, ...view.energyIcons, ...Array.from(view.targets.values())];
                for (const card of view.cards.values()) sprites.push(card.image, card.frame, ...card.costs.map(badge => badge.icon));
                view.destroy();
                check(sprites.every(sprite => sprite.spriteFrame === null), 'Destroy did not explicitly clear every SpriteFrame');
                view.destroy();
                check(refsEqual(), 'Resource references did not return to baseline');
                scenarios.push({ mode, callbacks: callbacks.length, refreshes, referencesBalanced: true,
                    spritesClearedBeforeNodeDestruction: true, disposed: view.disposed });
            } finally {
                cc.resources.load = originalLoad;
                if (view) view.destroy();
                parent.destroy();
            }
        }
        check(JSON.stringify(root.session.snapshot) === snapshot && localStorage.getItem('roguecard.save.v1') === saved,
            'Presentation lifecycle test changed business state/save');
        const handNodes = root.handCards.map(panel => panel.node);
        if (root.setHandHover) root.setHandHover(root.session.snapshot.hand[0].uid);
        root.destroy();
        await new Promise(resolve => setTimeout(resolve, 200));
        check(handNodes.every(node => cc.Tween.getRunningCount(node) === 0), 'Destroyed root left running hand tweens');
        check(rootArt.disposed && rootArt.frames.size === 0, 'GameRoot destruction did not dispose art');
        check([...frames].every(([key, frame]) => frame.refCount === baseline.get(key) - 1), 'GameRoot ownership was not released');
        check(localStorage.getItem('roguecard.save.v1') === saved, 'Destroying rendering changed save');
        return { scenarios, rootDisposed: true, rootReferencesReleased: true, handTweensStopped: true, saveUnchanged: true,
            source: location.port === '7456' ? 'editor-preview' : 'web-build', intentionalFailures: 14 };
    });
    await page.waitForTimeout(250);
    if (errors.length) throw new Error(errors.join('; '));
    return { result: '002 ART LIFECYCLE PASS', ...report, errors };
}
