async page => {
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
        const cc = await System.import('cc');
        const canvas = cc.director.getScene().getChildByName('Canvas');
        const root = canvas.components.find(component => component.session);
        if (!root) return null;
        return {
            snapshot: root.session.snapshot,
            header: canvas.getChildByName('Header').getComponent(cc.Label).string,
            handText: canvas.getChildByName('Hand').getComponent(cc.Label).string,
        };
    });
    const record = (key, view) => {
        const s = view.snapshot;
        trace.push({ key, phase: s.phase, revision: s.revision, turn: s.turn,
            position: s.map.position, enemyHp: s.enemy?.hp ?? null,
            partyHp: s.party.map(hero => hero.hp) });
        check(view.header.includes(s.phase.toUpperCase()), 'Rendered phase differs from Snapshot');
    };
    const press = async key => {
        const before = await read();
        await page.keyboard.press(key);
        await page.waitForTimeout(80);
        const after = await read();
        check(after.snapshot.revision > before.snapshot.revision, `Rejected gameplay key: ${key}`);
        record(key, after);
        return after;
    };
    const capture = name => page.screenshot({
        path: `specs/001-core-loop/H5-${name}.png`, fullPage: true,
    });
    const distance = (a, b) =>
        (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
    const moves = [
        { dq: 0, dr: -1, key: 'ArrowUp' }, { dq: 0, dr: 1, key: 'ArrowDown' },
        { dq: -1, dr: 0, key: 'ArrowLeft' }, { dq: 1, dr: 0, key: 'ArrowRight' },
        { dq: 1, dr: -1, key: 'q' }, { dq: -1, dr: 1, key: 'e' },
    ];
    const fight = async () => {
        for (let step = 0; step < 80; step += 1) {
            const view = await read();
            const s = view.snapshot;
            if (s.phase !== 'battle') return view;
            let index = s.hand.findIndex(card => card.playable && card.def.effect.kind === 'attack');
            if (index < 0) index = s.hand.findIndex(card => card.playable);
            await press(index >= 0 ? String(index + 1) : 'Space');
        }
        throw new Error('Battle did not finish within 80 legal inputs');
    };

    await page.setViewportSize({ width: 1280, height: 1080 });
    await page.goto('http://127.0.0.1:8123/');
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
    check(ready, 'StartMenu did not load within 30 seconds');
    await capture('StartMenu');
    const point = await page.evaluate(async () => {
        const cc = await System.import('cc');
        const canvas = cc.director.getScene().getChildByName('Canvas');
        const button = canvas.getChildByName('StartButton');
        const camera = canvas.getChildByName('Camera').getComponent(cc.Camera);
        const screen = camera.worldToScreen(button.worldPosition);
        const element = document.querySelector('canvas');
        const rect = element.getBoundingClientRect();
        return { x: rect.x + screen.x / element.width * rect.width,
            y: rect.y + (element.height - screen.y) / element.height * rect.height };
    });
    await page.mouse.click(point.x, point.y);
    let view = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
        view = await read();
        if (view) break;
        await page.waitForTimeout(100);
    }
    check(view, 'START click did not initialize GameRoot');
    check(view.snapshot.phase === 'map' && view.snapshot.revision === 0,
        'Use an isolated fresh browser session without an existing run');
    record('START', view);

    const normal = view.snapshot.map.nodes.find(node => node.kind === 'battle'
        && distance(node.coord, view.snapshot.map.position) === 1
        && distance(node.coord, view.snapshot.map.boss) === 1);
    check(normal, 'Expected a normal battle between the start and boss for the demo seed');
    let delta = moves.find(move => view.snapshot.map.position.q + move.dq === normal.coord.q
        && view.snapshot.map.position.r + move.dr === normal.coord.r);
    view = await press(delta.key);
    check(view.snapshot.phase === 'battle' && view.snapshot.enemy.id === 'normal', 'Normal battle not reached');
    await capture('NormalBattle');
    view = await fight();
    check(view.snapshot.phase === 'reward', 'Normal battle did not yield a reward');
    check(view.snapshot.rewardCandidates.length === 3, 'Expected three reward choices');
    for (const card of view.snapshot.rewardCandidates) {
        check(view.handText.includes(card.name), 'Reward is missing from rendered UI');
    }
    await capture('Reward');
    const beforeTotal = view.snapshot.hand.length + view.snapshot.drawCount + view.snapshot.discardCount;
    const choice = view.snapshot.rewardCandidates.findIndex(card => card.effect.kind === 'attack');
    view = await press(String((choice >= 0 ? choice : 0) + 1));
    check(view.snapshot.phase === 'map', 'Reward choice did not return to map');
    check(view.snapshot.hand.length + view.snapshot.drawCount + view.snapshot.discardCount === beforeTotal + 1,
        'Reward card was not added to the deck');
    delta = moves.find(move => view.snapshot.map.position.q + move.dq === view.snapshot.map.boss.q
        && view.snapshot.map.position.r + move.dr === view.snapshot.map.boss.r);
    check(delta, 'Boss is not adjacent after the normal battle');
    view = await press(delta.key);
    check(view.snapshot.phase === 'battle' && view.snapshot.enemy.id === 'boss', 'Boss battle not reached');
    await capture('BossBattle');
    view = await fight();
    check(view.snapshot.phase === 'victory', 'Boss fight did not end in victory');
    check(view.handText.includes('VICTORY: boss defeated'), 'Victory message is missing');
    await capture('Victory');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('roguecard.save.v1')));
    check(saved.state.phase === 'victory', 'Victory was not saved');
    await page.waitForTimeout(200);
    check(errors.length === 0, `Browser errors: ${errors.join('; ')}`);
    check(httpErrors.length === 0, `HTTP errors: ${httpErrors.join('; ')}`);
    return { result: 'AC-2 PASS', url: page.url(), viewport: { width: 1280, height: 1080 },
        inputCount: trace.length - 1, errors, httpErrors, finalPhase: view.snapshot.phase,
        finalRevision: view.snapshot.revision, trace };
}
