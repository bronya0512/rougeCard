async page => {
    const errors = [];
    const actions = [];
    const checks = [];
    const prefix = page.url().includes(':7456/') ? 'LayoutPreview' : 'Layout';
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const check = (value, message) => { if (!value) throw new Error(message); };
    const read = () => page.evaluate(async () => {
        const cc = await System.import('cc');
        const canvas = cc.director.getScene().getChildByName('Canvas');
        const root = canvas.components.find(component => component.teamSelection);
        const s = root.session.snapshot;
        return { snapshot: s, raw: localStorage.getItem('roguecard.save.v1'), hover: root.hoveredUid,
            selected: root.selection.selectedUid, count: root.battleArt.frames.size,
            spacing: root.handSpacing, cards: s.hand.map((card, i) => {
                const node = root.handCards[i].node;
                return { uid: card.uid, x: node.position.x, y: node.position.y, scale: node.scale.x, order: node.getSiblingIndex() };
            }), enemy: root.enemy.label.string,
            energy: { active: root.battleArt.energyNode.activeInHierarchy,
                x: root.battleArt.energyNode.position.x, y: root.battleArt.energyNode.position.y,
                icons: root.battleArt.energyIcons.map((sprite, i) => ({
                    matches: sprite.spriteFrame === root.battleArt.frames.get(`energy_${['red', 'green', 'blue', 'white'][i]}`),
                    value: root.battleArt.energyCounts[i].string })),
                fallbackActive: root.energyLabel.node.active, fallbackText: root.energyLabel.string },
            noSelectionGuide: root.hintLabel.string === root.feedback && root.handCards.filter(panel => panel.node.active).every(panel =>
                !/左键选择|点击目标/.test(panel.label.string + panel.node.getChildByName('CardArt').getChildByName('CardStatus').getComponent(cc.Label).string)),
            targetBars: s.party.map((hero, i) => {
                const view = root.statusViews.get(root.heroes[i].node);
                return { hp: view.health.label.string, hpRatio: view.health.fill.scale.x,
                    block: view.shield.label.string, blockRatio: view.shield.fill.scale.x };
            }) };
    });
    const point = (index, offsetX = -50, y = -300) => page.evaluate(async ({ index, offsetX, y }) => {
        const cc = await System.import('cc');
        const canvas = cc.director.getScene().getChildByName('Canvas');
        const root = canvas.components.find(component => component.teamSelection);
        const width = root.session.snapshot.hand.length;
        const world = root.battlePage.getComponent(cc.UITransform).convertToWorldSpaceAR(
            new cc.Vec3((index - (width - 1) / 2) * root.handSpacing + offsetX, y, 0));
        const p = canvas.getChildByName('Camera').getComponent(cc.Camera).worldToScreen(world);
        const element = document.querySelector('canvas'); const r = element.getBoundingClientRect();
        return { x: r.x + p.x / element.width * r.width, y: r.y + (element.height - p.y) / element.height * r.height };
    }, { index, offsetX, y });
    const move = async p => { await page.mouse.move(p.x, p.y); actions.push({ type: 'move', ...p }); await page.waitForTimeout(180); return read(); };
    const unchanged = (a, b, message) => check(JSON.stringify(a.snapshot) === JSON.stringify(b.snapshot) && a.raw === b.raw, message);
    let view = await read();
    check(view.snapshot.phase === 'battle' && view.count === 13 && view.cards.length >= 5, 'Requires a loaded five-card battle');
    const baseline = view;
    check(view.energy.active && view.energy.x < -350 && view.energy.y < -200
        && view.energy.icons.length === 4 && view.energy.icons.every((icon, i) => icon.matches
            && icon.value === String(view.snapshot.energy[['red', 'green', 'blue', 'white'][i]]))
        && !view.energy.fallbackActive && view.energy.fallbackText === '', 'Four-color lower-left energy mismatch');
    check(view.noSelectionGuide, 'Battle still shows selection instructions');
    checks.push({ name: 'lower-left-four-color-energy-and-no-guide', ...view.energy, noSelectionGuide: true });
    const canvasRect = await page.locator('canvas').boundingBox();
    view = await move({ x: canvasRect.x + canvasRect.width / 2, y: canvasRect.y + 50 });
    unchanged(baseline, view, 'Leaving hand mutated gameplay');
    check(view.hover === null && view.spacing < 138 && view.cards.every((card, i) => i === 0 || card.order > view.cards[i - 1].order),
        'Default hand is not right-over-left');
    checks.push({ name: 'right-over-left', cards: view.cards, spacing: view.spacing });
    for (let i = 0; i < view.cards.length; i += 1) {
        const before = view;
        view = await move(await point(i));
        check(view.hover === view.snapshot.hand[i].uid && view.cards[i].scale === 1.25 && view.cards[i].y === -215
            && view.cards[i].order === Math.max(...view.cards.map(card => card.order)), `Card ${i} did not expand/front`);
        unchanged(before, view, 'Hover changed Snapshot/save');
        checks.push({ name: `hover-${i}`, uid: view.hover, scale: view.cards[i].scale, stateUnchanged: true });
        if (i === 2) await page.screenshot({ path: `specs/004-battle-layout/${prefix}-Hover.png`, fullPage: true });
    }
    for (let round = 0; round < 3; round += 1) {
        for (let i = 0; i < view.cards.length; i++) {
            const p = await point(i);
            await page.mouse.move(p.x, p.y);
            actions.push({ type: 'quickMove', index: i });
        }
    }
    await page.waitForTimeout(200);
    view = await read();
    check(view.hover === view.cards[view.cards.length - 1].uid, 'Quick motion did not settle on final card');
    unchanged(baseline, view, 'Quick hover changed Snapshot/save');
    const settled = view;
    await page.waitForTimeout(400);
    check(JSON.stringify(settled.cards) === JSON.stringify((await read()).cards), 'Hover oscillates after settling');
    view = await move({ x: 1, y: 1 });
    check(view.hover === null && view.cards.every(card => card.scale === 1), 'Leaving canvas did not restore hand');
    unchanged(baseline, view, 'Leaving canvas changed state/save');
    checks.push({ name: 'quick-motion-and-canvas-exit', rounds: 3, stable: true });
    const unavailable = view.snapshot.hand.findIndex(card => !card.playable);
    check(unavailable >= 0, 'Requires an unavailable card after dead leader');
    view = await move(await point(unavailable));
    check(view.hover === view.snapshot.hand[unavailable].uid, 'Unavailable card cannot be inspected');
    const p = await point(unavailable);
    await page.mouse.click(p.x, p.y); actions.push({ type: 'click-unavailable', index: unavailable });
    await page.waitForTimeout(180); view = await read();
    unchanged(baseline, view, 'Unavailable card consumed energy or saved');
    check(view.selected === null, 'Unavailable card selected for play');
    checks.push({ name: 'unavailable-hover', visible: true, notPlayable: true });
    const index = view.snapshot.hand.findIndex((card, i) => i > 0 && card.playable);
    check(index >= 0, 'Requires a usable overlapping card');
    const overlap = await point(index);
    view = await move(overlap);
    await page.mouse.click(overlap.x, overlap.y); actions.push({ type: 'click-overlap', index });
    await page.waitForTimeout(180); view = await read();
    check(view.selected === view.snapshot.hand[index].uid, 'Overlap click penetrated to a left card');
    check(view.noSelectionGuide, 'Selected card restored operation instructions');
    unchanged(baseline, view, 'Selecting topmost card changed state/save');
    const selection = view.selected;
    view = await move(await point((index + 1) % view.cards.length));
    check(view.selected === selection, 'Hovering another card changed selection');
    checks.push({ name: 'overlap-hit-and-selection', selected: selection, noPenetration: true });
    const bars = await page.evaluate(async () => {
        const cc = await System.import('cc');
        const root = cc.director.getScene().getChildByName('Canvas').components.find(component => component.teamSelection);
        const s = root.session.snapshot;
        const view = root.statusViews.get(root.heroes[0].node);
        const raw = localStorage.getItem('roguecard.save.v1');
        const state = JSON.stringify(s);
        view.render(7, 30, 75, true);
        const result = { hpRatio: view.health.fill.scale.x, hp: view.health.label.string,
            blockRatio: view.shield.fill.scale.x, block: view.shield.label.string };
        root.render();
        if (localStorage.getItem('roguecard.save.v1') !== raw || JSON.stringify(root.session.snapshot) !== state)
            throw new Error('Status bar overflow sample changed gameplay');
        const background = root.battlePage.getChildByName('BattleBackground').getComponent(cc.Sprite).color;
        const feet = [root.enemy.node, ...root.heroes.filter(panel => panel.node.active).map(panel => panel.node)].map(node => {
            const image = node.getChildByName('Portrait');
            const world = image.getComponent(cc.UITransform).convertToWorldSpaceAR(new cc.Vec3(0, -image.getComponent(cc.UITransform).height / 2, 0));
            return root.battlePage.getComponent(cc.UITransform).convertToNodeSpaceAR(world).y;
        });
        return { ...result, background: [background.r, background.g, background.b, background.a], feet };
    });
    check(Math.abs(bars.hpRatio - 7 / 30) < 0.0001 && bars.hp === 'HP 7/30' && bars.blockRatio === 1 && bars.block === '护盾 75',
        'Shield visual saturation truncated numeric value');
    check(bars.background.every(channel => channel === 255) && bars.feet.every(y => Math.abs(y + 45) < 0.1),
        'Background tinted or characters not on ground baseline');
    checks.push({ name: 'bars-original-color-ground', ...bars, isolatedViewSample: true });
    view = await read();
    const destroyed = await page.evaluate(async () => {
        const cc = await System.import('cc');
        const root = cc.director.getScene().getChildByName('Canvas').components.find(component => component.teamSelection);
        const nodes = root.handCards.map(panel => panel.node);
        root.enabled = false;
        const disabled = root.hoveredUid === null && nodes.every(node => cc.Tween.getRunningCount(node) === 0);
        root.enabled = true;
        root.render();
        return { disabled };
    });
    check(destroyed.disabled, 'Disabling component leaked hover/tweens');
    unchanged(view, await read(), 'Disabling presentation changed state/save');
    checks.push({ name: 'disable-cleanup', safe: true });
    const clickNode = async path => {
        const p = await page.evaluate(async path => {
            const cc = await System.import('cc');
            const canvas = cc.director.getScene().getChildByName('Canvas');
            const node = path.split('/').reduce((parent, name) => parent.getChildByName(name), canvas);
            const screen = canvas.getChildByName('Camera').getComponent(cc.Camera).worldToScreen(node.worldPosition);
            const element = document.querySelector('canvas'); const rect = element.getBoundingClientRect();
            return { x: rect.x + screen.x / element.width * rect.width,
                y: rect.y + (element.height - screen.y) / element.height * rect.height };
        }, path);
        await page.mouse.click(p.x, p.y); actions.push({ type: 'clickNode', path });
        await page.waitForTimeout(200);
    };
    view = await move(await point(1));
    const beforeTurn = view;
    await clickNode('BattlePage/EndTurn');
    view = await read();
    check(view.snapshot.revision === beforeTurn.snapshot.revision + 1 && view.hover === null
        && view.cards.every(card => card.scale === 1), 'Hand changed but hover/tweens survived end turn');
    const savedTurn = view;
    await page.reload();
    const waitReady = async team => {
        for (let i = 0; i < 120; i++) {
            const ready = await page.evaluate(async team => {
                if (typeof System === 'undefined') return false;
                const cc = await System.import('cc');
                const canvas = cc.director.getScene()?.getChildByName('Canvas');
                if (!team) return !!canvas?.getChildByName('StartButton')?.activeInHierarchy;
                const root = canvas?.components.find(component => component.teamSelection);
                return !!root && !root.configLoading && !!root.pendingSave;
            }, team);
            if (ready) return;
            await page.waitForTimeout(250);
        }
        throw new Error(`Reload did not become ready: team=${team}`);
    };
    await waitReady(false);
    await clickNode('StartButton');
    await waitReady(true);
    await clickNode('TeamPage/ContinueRun');
    for (let i = 0; i < 120; i++) {
        view = await read();
        if (view.count === 13) break;
        await page.waitForTimeout(100);
    }
    check(view.hover === null && view.cards.every(card => card.scale === 1), 'Reload restored stale hover');
    unchanged(savedTurn, view, 'Reload changed game or saved bytes');
    checks.push({ name: 'hand-change-and-reload', newRevision: view.snapshot.revision, clean: true });
    check(errors.length === 0, errors.join('; '));
    return { result: '004 LAYOUT INTERACTION PASS', source: prefix === 'LayoutPreview' ? 'editor-preview' : 'web-build',
        checks, actions: actions.length, errors, mouseActions: actions,
        isolation: 'Shield overflow is a temporary view render; production state unchanged' };
}
