async page => {
    const url = page.url();
    const preview = url.includes(':7456/');
    const prefix = preview ? 'FloorsPreview' : 'Floors';
    const errors = [];
    const httpErrors = [];
    const trace = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
        if (message.type() === 'error') errors.push(message.text());
    });
    page.on('response', response => {
        if (response.status() >= 400) httpErrors.push(`${response.status()} ${response.url()}`);
    });
    const check = (condition, message) => {
        if (!condition) throw new Error(message);
    };
    const read = () => page.evaluate(async () => {
        if (typeof System === 'undefined') return null;
        const cc = await System.import('cc');
        const canvas = cc.director.getScene()?.getChildByName('Canvas');
        const root = canvas?.components.find(component => component.session);
        if (!root) return null;
        const label = node => node.getChildByName('Text').getComponent(cc.Label).string;
        const ui = {
            header: canvas.getChildByName('Header').getComponent(cc.Label).string,
            map: root.mapPage.active, battle: root.battlePage.active,
            reward: root.rewardPage.active, settlement: root.settlementPage.active,
            selected: root.selection.selectedUid,
            infoActive: root.mapInfo.node.active,
            infoText: label(root.mapInfo.node),
            rewards: root.rewardCards.filter(panel => panel.node.active).map(panel => label(panel.node)),
            settlementText: root.settlementLabel.string,
            enemyX: root.enemy.node.worldPosition.x,
            heroXs: root.heroes.map(panel => panel.node.worldPosition.x),
        };
        return { snapshot: root.session.snapshot, ui,
            save: localStorage.getItem('roguecard.save.v1') };
    });
    const capture = name => page.screenshot({ path: `specs/001-core-loop/${prefix}-${name}.png`, fullPage: true });
    const click = async (path, button = 'left') => {
        const point = await page.evaluate(async path => {
            const cc = await System.import('cc');
            const canvas = cc.director.getScene().getChildByName('Canvas');
            const node = path.split('/').reduce((parent, name) => parent?.getChildByName(name), canvas);
            if (!node?.activeInHierarchy) throw new Error(`Missing visible target ${path}`);
            const camera = canvas.getChildByName('Camera').getComponent(cc.Camera);
            const screen = camera.worldToScreen(node.worldPosition);
            const element = document.querySelector('canvas');
            const rect = element.getBoundingClientRect();
            return { x: rect.x + screen.x / element.width * rect.width,
                y: rect.y + (element.height - screen.y) / element.height * rect.height };
        }, path);
        await page.mouse.click(point.x, point.y, { button });
        await page.waitForTimeout(100);
        const view = await read();
        if (view) {
            const s = view.snapshot;
            trace.push({ action: `${button}:${path}`, phase: s.phase, revision: s.revision,
                floor: s.floor, floorCount: s.floorCount, partyHp: s.party.map(hero => hero.hp),
                selected: view.ui.selected, enemyHp: s.enemy?.hp ?? null });
            check(view.ui.header.includes(s.phase.toUpperCase()), 'Rendered phase differs from Snapshot');
            check(view.ui.header.includes(`第 ${s.floor} / ${s.floorCount} 层`), 'Rendered floor differs from Snapshot');
            check([view.ui.map, view.ui.battle, view.ui.reward, view.ui.settlement].filter(Boolean).length === 1,
                'Exactly one gameplay page must be visible');
        }
        return view;
    };
    const unchanged = (before, after, message) => {
        check(JSON.stringify(before.snapshot) === JSON.stringify(after.snapshot), message);
        check(before.save === after.save, `${message}: save changed`);
    };
    const advance = async (path, button = 'left') => {
        const before = await read();
        const after = await click(path, button);
        check(after.snapshot.revision > before.snapshot.revision, `Gameplay click rejected: ${path}`);
        check(after.ui.selected === null, 'Successful action did not clear selection');
        return after;
    };
    const tile = coord => `MapPage/MapBoard/MapNode_${coord.q}_${coord.r}`;
    const distance = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.r - b.r)
        + Math.abs(a.q + a.r - b.q - b.r)) / 2;
    const fight = async () => {
        for (let step = 0; step < 100; step += 1) {
            let view = await read();
            const s = view.snapshot;
            if (s.phase !== 'battle') return view;
            let index = s.hand.findIndex(card => card.playable && card.def.effect.kind === 'attack');
            if (index < 0) index = s.hand.findIndex(card => card.playable);
            if (index < 0) await advance('BattlePage/EndTurn');
            else {
                const card = s.hand[index];
                const selected = await click(`BattlePage/HandCard_${index}`);
                unchanged(view, selected, 'Selecting a card advanced state');
                check(selected.ui.selected === card.uid, 'Card not selected');
                const target = card.def.effect.kind === 'attack' ? 'BattlePage/EnemyTarget'
                    : `BattlePage/HeroTarget_${s.party.findIndex(hero => hero.alive)}`;
                view = await advance(target);
            }
        }
        throw new Error('Battle did not finish within 100 actions');
    };
    const start = async () => {
        await page.goto(url);
        let ready = false;
        for (let attempt = 0; attempt < 120; attempt += 1) {
            ready = await page.evaluate(async () => {
                if (typeof System === 'undefined') return false;
                const cc = await System.import('cc');
                return !!cc.director.getScene()?.getChildByName('Canvas')?.getChildByName('StartButton');
            });
            if (ready) break;
            await page.waitForTimeout(250);
        }
        check(ready, 'StartMenu did not load');
        if (preview) {
            await page.locator('.view-select').click();
            await page.getByText('Design Resolution (1280X720)', { exact: true }).last().click();
            await page.waitForTimeout(200);
            const rect = await page.locator('canvas').boundingBox();
            if (rect.width < rect.height) await page.locator('#btn-rotate').click();
            const stats = await page.evaluate(async () => (await System.import('cc')).profiler.isShowingStats());
            if (stats) await page.locator('#btn-show-fps').click();
            await page.waitForTimeout(200);
        }
        return click('StartButton');
    };

    await page.setViewportSize({ width: 1280, height: 1080 });
    let view = await start();
    check(view.snapshot.floor === 1 && [3, 4, 5].includes(view.snapshot.floorCount), 'Expected a configurable multi-floor new run');
    const floorCount = view.snapshot.floorCount;
    check(view.snapshot.phase === 'map' && view.snapshot.revision === 0,
        'Use a new isolated browser session with no existing save');
    check(view.ui.map && !view.ui.battle, 'Fresh run did not show the map');
    const normal = view.snapshot.map.nodes.find(node => node.kind === 'battle'
        && distance(node.coord, view.snapshot.map.position) === 1
        && distance(node.coord, view.snapshot.map.boss) === 1);
    check(normal, 'Expected an adjacent normal battle on the route to boss');
    const inspected = await click(tile(normal.coord));
    unchanged(view, inspected, 'Map left click moved or saved');
    check(inspected.ui.infoActive && inspected.ui.infoText.includes('战斗'), 'Node information did not open');
    await capture('MapInfo');
    const far = view.snapshot.map.nodes.find(node => distance(node.coord, view.snapshot.map.position) > 1);
    const rejected = await click(tile(far.coord), 'right');
    unchanged(view, rejected, 'Non-adjacent right click moved or saved');

    await page.evaluate(() => {
        globalThis.canvasContextPrevented = false;
        addEventListener('contextmenu', event => {
            globalThis.canvasContextPrevented = event.defaultPrevented;
        }, { once: true });
    });
    view = await advance(tile(normal.coord), 'right');
    const contextPrevented = await page.evaluate(() => globalThis.canvasContextPrevented);
    check(contextPrevented, 'Canvas context menu was not suppressed');
    check(view.ui.battle && !view.ui.map && view.snapshot.enemy.id === 'normal', 'Battle page did not open');
    check(view.ui.enemyX < view.ui.heroXs[0] && view.ui.heroXs[0] < view.ui.heroXs[1],
        'Enemy must be left and allies right in original party order');
    await capture('Battle');

    const attackIndex = view.snapshot.hand.findIndex(card => card.playable && card.def.effect.kind === 'attack');
    const selected = await click(`BattlePage/HandCard_${attackIndex}`);
    unchanged(view, selected, 'Attack selection changed game state');
    const wrong = await click('BattlePage/HeroTarget_0');
    unchanged(view, wrong, 'Attack on ally changed game state');
    check(wrong.ui.selected === selected.ui.selected, 'Wrong target lost selection');
    await capture('SelectedCard');
    const cancelled = await click('BattlePage/CancelCard');
    unchanged(view, cancelled, 'Cancel advanced state');
    check(cancelled.ui.selected === null, 'Cancel did not clear selection');
    const defendIndex = view.snapshot.hand.findIndex(card => card.playable && card.def.effect.kind === 'defend');
    check(defendIndex >= 0, 'Expected a defense card in initial hand');
    await click(`BattlePage/HandCard_${defendIndex}`);
    const wrongDefense = await click('BattlePage/EnemyTarget');
    unchanged(view, wrongDefense, 'Defense on enemy changed game state');
    view = await advance('BattlePage/HeroTarget_1');
    check(view.snapshot.party[1].block === 3, 'Defense did not apply to clicked teammate');

    const beforeLoad = view;
    view = await start();
    unchanged(beforeLoad, view, 'Battle reload differs from last saved state');
    check(view.ui.battle && !view.ui.map && view.ui.selected === null, 'Loaded battle page or selection incorrect');
    view = await fight();
    check(view.snapshot.phase === 'reward' && view.snapshot.rewardCandidates.length === 3, 'Normal victory missing rewards');
    for (const card of view.snapshot.rewardCandidates) {
        check(view.ui.rewards.some(text => text.includes(card.name)), 'Reward label missing');
    }
    await capture('Reward');
    const total = view.snapshot.hand.length + view.snapshot.drawCount + view.snapshot.discardCount;
    const choice = view.snapshot.rewardCandidates.findIndex(card => card.effect.kind === 'attack');
    view = await advance(`RewardPage/RewardCard_${choice >= 0 ? choice : 0}`);
    check(view.snapshot.phase === 'map' && view.ui.map, 'Reward did not return to map');
    check(view.snapshot.hand.length + view.snapshot.drawCount + view.snapshot.discardCount === total + 1,
        'Reward not added to deck');
    const choose = async () => {
        const s = (await read()).snapshot;
        const choice = s.rewardCandidates.findIndex(card => card.effect.kind === 'attack');
        return advance(`RewardPage/RewardCard_${choice >= 0 ? choice : 0}`);
    };
    const walk = async destination => {
        for (let step = 0; step < 30; step += 1) {
            let current = await read();
            const s = current.snapshot;
            if (distance(s.map.position, destination) === 0 || s.phase !== 'map') return current;
            const queue = [{ coord: s.map.position, cost: 0, first: null }];
            const visited = new Set();
            let move = null;
            while (queue.length > 0) {
                queue.sort((a, b) => a.cost - b.cost);
                const item = queue.shift();
                const key = `${item.coord.q},${item.coord.r}`;
                if (visited.has(key)) continue;
                visited.add(key);
                if (distance(item.coord, destination) === 0) { move = item.first; break; }
                for (const node of s.map.nodes.filter(node => distance(node.coord, item.coord) === 1)) {
                    if (node.kind === 'boss' && distance(node.coord, destination) !== 0) continue;
                    const cost = item.cost + (node.visited || node.kind === 'rest' ? 1 : 10);
                    queue.push({ coord: node.coord, cost, first: item.first ?? node.coord });
                }
            }
            check(move, 'No route to destination');
            current = await advance(tile(move), 'right');
            if (current.snapshot.phase === 'battle') {
                if (current.snapshot.enemy.id === 'boss') return current;
                current = await fight();
            }
            if (current.snapshot.phase === 'reward') current = await choose();
            check(current.snapshot.phase === 'map', 'Route ended outside map');
        }
        throw new Error('Map route exceeded 30 moves');
    };
    for (let floor = 1; floor <= floorCount; floor += 1) {
        view = await read();
        check(view.snapshot.floor === floor && view.snapshot.phase === 'map', 'Floor start incorrect');
        const rest = view.snapshot.map.nodes.find(node => node.kind === 'rest' && !node.visited);
        if (rest) view = await walk(rest.coord);
        view = await walk(view.snapshot.map.boss);
        check(view.ui.battle && view.snapshot.enemy.id === 'boss', 'Boss page missing');
        view = await fight();
        if (floor < floorCount) {
            check(view.snapshot.phase === 'map' && view.snapshot.floor === floor + 1 && !view.ui.settlement,
                'Non-final boss incorrectly settled the run');
            check(view.snapshot.map.position.q === 0 && view.snapshot.map.position.r === 0,
                'Next floor did not start at center');
            check(view.snapshot.map.nodes.filter(node => node.visited).length === 1, 'Visited state leaked between floors');
            const saved = JSON.parse(view.save);
            check(saved.schemaVersion === 2 && saved.state.completedMaps.length === floor, 'Floor history was not saved');
            await capture(`Floor${floor + 1}`);
            const before = view;
            view = await start();
            unchanged(before, view, 'Floor transition reload differs from save');
            check(view.ui.map && view.ui.selected === null && !view.ui.infoActive, 'Floor UI did not reset');
        } else {
            check(view.snapshot.phase === 'victory' && view.ui.settlement && view.ui.settlementText.includes('VICTORY'),
                'Final boss did not produce rendered victory');
        }
    }
    await capture('Victory');
    const finalRevision = view.snapshot.revision;
    const finalPartyHp = view.snapshot.party.map(hero => hero.hp);
    view = await click('SettlementPage/Restart');
    check(view.snapshot.phase === 'map' && view.snapshot.revision === 0, 'Mouse restart failed');
    await page.waitForTimeout(200);
    check(errors.length === 0, `Browser errors: ${errors.join('; ')}`);
    check(httpErrors.length === 0, `HTTP errors: ${httpErrors.join('; ')}`);
    return { result: preview ? 'T111 PREVIEW PASS' : 'AC-15~21 WEB PASS', source: preview ? 'editor-preview' : 'web-build',
        url, floorCount, errors, httpErrors, contextPrevented, finalRevision, finalPartyHp, mouseActions: trace.length,
        keyboardActions: 0, trace };
}
