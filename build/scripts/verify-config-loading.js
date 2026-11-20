async page => {
    const errors = [];
    const trace = [];
    const evidenceDir = /[?&]verify=layout004(?:&|$)/.test(page.url()) ? 'specs/004-battle-layout' : 'specs/003-central-config';
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const check = (value, message) => { if (!value) throw new Error(message); };
    const setup = await page.evaluate(async () => {
        const cc = await System.import('cc');
        const canvas = cc.director.getScene().getChildByName('Canvas');
        const root = canvas.components.find(component => component.teamSelection);
        if (!root || root.choosingTeam || !root.configPackage || root.battleArt.frames.size !== 13) throw new Error('Requires a loaded config003 battle session');
        const check = (condition, message) => { if (!condition) throw new Error(message); };
        const content = root.configPackage.content;
        const documents = { game: content.game, characters: content.characters, cards: content.cards,
            enemies: content.enemies, presentation: root.configPackage.presentation };
        const raw = localStorage.getItem('roguecard.save.v1');
        const snapshot = JSON.stringify(root.session.snapshot);
        const Loader = root.configLoader.constructor;
        const originalLoad = cc.resources.load;
        const scenarios = [];
        for (const mode of ['success', 'failure', 'invalid', 'late']) {
            const pending = [];
            const assets = [];
            const loader = new Loader();
            let calls = 0;
            let result;
            try {
                cc.resources.load = (path, type, callback) => {
                    if (type !== cc.JsonAsset) throw new Error('Config loader must request JsonAsset');
                    pending.push({ key: path.split('/')[1], callback });
                };
                loader.load((config, error) => { calls++; result = { config, error }; });
                loader.load(() => { throw new Error('Duplicate initialization'); });
                check(pending.length === 5, 'Expected one request per config file');
                if (mode === 'late') loader.destroy();
                for (const { key, callback } of pending) {
                    const asset = new cc.JsonAsset();
                    asset.json = mode === 'invalid' && key === 'game' ? { ...documents.game, floorCount: 1 } : documents[key];
                    asset.addRef();
                    assets.push(asset);
                    callback(mode === 'failure' && key === 'game' ? new Error('intentional config failure') : undefined, asset);
                }
                check(assets.every(asset => asset.refCount === 1), 'JSON references did not return to baseline');
                if (mode === 'success') check(calls === 1 && result.config && result.error === '', 'Successful package not assembled');
                if (mode === 'failure' || mode === 'invalid') check(calls === 1 && result.config === null && result.error.length > 0,
                    'Invalid or unavailable config was accepted');
                if (mode === 'invalid') check(result.error.includes('game.floorCount'), 'Field error lost');
                if (mode === 'late') check(calls === 0, 'Destroyed loader invoked callback');
                scenarios.push({ mode, requests: pending.length, callbacks: calls, referencesBalanced: true,
                    error: result?.error ?? '', initializedOnce: true });
                loader.destroy(); loader.destroy();
            } finally {
                cc.resources.load = originalLoad;
                loader.destroy();
                assets.forEach(asset => asset.decRef());
            }
        }
        check(localStorage.getItem('roguecard.save.v1') === raw && JSON.stringify(root.session.snapshot) === snapshot,
            'Configuration lifecycle changed live business state');
        return { documents, snapshot, raw, scenarios };
    });
    const spawn = mode => page.evaluate(async ({ mode, documents }) => {
        const cc = await System.import('cc');
        const canvas = cc.director.getScene().getChildByName('Canvas');
        const previous = canvas.components.find(component => component.teamSelection);
        const Root = previous.constructor;
        const storage = previous.storage;
        previous.destroy();
        await new Promise(resolve => setTimeout(resolve, 150));
        const callbacks = [];
        const originalLoad = cc.resources.load;
        const source = JSON.parse(JSON.stringify(documents));
        if (mode === 'changed') {
            source.game.startHp = 42; source.game.floorCount = 5; source.game.seed = 17;
            source.characters[0].startingDeck = ['r-atk', 'r-atk', 'r-atk', 'r-def', 'r-def'];
            source.cards[0].effect.damage = 7;
            source.presentation.hero_blue.flip = true;
            source.presentation.hero_blue.displayHeight = 285.5;
            source.presentation.enemy_normal.displayHeight = 180.5;
        }
        if (mode === 'invalid') source.game.floorCount = 1;
        try {
            cc.resources.load = (path, type, callback) => {
                if (path.startsWith('config/')) callbacks.push({ key: path.split('/')[1], callback });
                else originalLoad.call(cc.resources, path, type, callback);
            };
            const root = canvas.addComponent(Root);
            const saveBefore = storage.get('roguecard.save.v1');
            root.configure(storage);
            root.configure(storage);
            if (!root.configLoading || root.teamSelection.canConfirm || root.teamSelection.toggle('hero-red'))
                throw new Error('New run/roster available before configuration loaded');
            if (callbacks.length !== 5) throw new Error('GameRoot initialized config more than once');
            if (mode === 'late') {
                root.destroy();
                await new Promise(resolve => setTimeout(resolve, 150));
            }
            for (const { key, callback } of callbacks) {
                const asset = new cc.JsonAsset();
                asset.json = source[key]; asset.addRef();
                try {
                    callback(mode === 'failure' && key === 'game' ? new Error('intentional config failure') : undefined, asset);
                    if (asset.refCount !== 1) throw new Error('GameRoot JSON callback leaked a reference');
                } finally { asset.decRef(); }
            }
            if (storage.get('roguecard.save.v1') !== saveBefore) throw new Error('Loading config or destruction changed save');
            if (mode === 'late') return { mode, requests: callbacks.length, callbacksAfterDestroySafe: true, saveUnchanged: true };
            return { mode, loading: root.configLoading, error: root.configError,
                choosingTeam: root.choosingTeam, canContinue: root.continueRun.node.active,
                newRunBlocked: !root.teamSelection.canConfirm, summary: root.teamSummary.string,
                labels: root.rosterCards.map(panel => panel.label.string), requests: callbacks.length, saveUnchanged: true };
        } finally { cc.resources.load = originalLoad; }
    }, { mode, documents: setup.documents });
    const read = () => page.evaluate(async () => {
        const cc = await System.import('cc');
        const root = cc.director.getScene().getChildByName('Canvas').components.find(component => component.teamSelection);
        return { snapshot: root.choosingTeam ? null : root.session.snapshot,
            choosingTeam: root.choosingTeam, raw: localStorage.getItem('roguecard.save.v1'),
            frames: root.battleArt.frames.size, summary: root.teamSummary.string,
            heroes: root.heroes.filter(panel => panel.node.active).map(panel => panel.label.string),
            fallbackCards: root.handCards.filter(panel => panel.node.active).every(panel => panel.label.node.active),
            config: root.configPackage?.content.game ?? null, error: root.configError,
            cards: root.configPackage?.content.cards ?? null, presentation: root.battleArt.presentation };
    });
    const click = async path => {
        const point = await page.evaluate(async path => {
            const cc = await System.import('cc');
            const canvas = cc.director.getScene().getChildByName('Canvas');
            const node = path.split('/').reduce((parent, name) => parent?.getChildByName(name), canvas);
            if (!node?.activeInHierarchy) throw new Error(`Missing ${path}`);
            const camera = canvas.getChildByName('Camera').getComponent(cc.Camera);
            const position = camera.worldToScreen(node.worldPosition);
            const element = document.querySelector('canvas');
            const rect = element.getBoundingClientRect();
            return { x: rect.x + position.x / element.width * rect.width,
                y: rect.y + (element.height - position.y) / element.height * rect.height };
        }, path);
        await page.mouse.move(1, 1);
        await page.mouse.move(point.x, point.y);
        await page.waitForTimeout(160);
        await page.mouse.click(point.x, point.y);
        await page.waitForTimeout(120);
        const view = await read();
        trace.push({ path, choosingTeam: view.choosingTeam, revision: view.snapshot?.revision ?? null });
        return view;
    };
    const integration = [];
    for (const mode of ['failure', 'invalid']) {
        const report = await spawn(mode);
        check(!report.loading && report.error && report.canContinue && report.newRunBlocked && report.saveUnchanged,
            `Bad config did not retain old-run entry: ${mode}`);
        let view = await click('TeamPage/ConfirmTeam');
        check(view.choosingTeam && view.raw === setup.raw, 'Bad config created or overwrote a run');
        view = await click('TeamPage/ContinueRun');
        check(JSON.stringify(view.snapshot) === setup.snapshot && view.raw === setup.raw, 'Bad config altered restored state');
        check(view.frames === 0 && view.fallbackCards && view.heroes.every(text => text.includes('色角色')),
            'Old run did not use text fallback');
        await page.screenshot({ path: `${evidenceDir}/ConfigLoading-${mode}-${page.url().includes(':7456/') ? 'Preview' : 'Web'}.png`, fullPage: true });
        integration.push({ ...report, oldRunRestored: true, textFallback: true, savedStateUnchanged: true });
    }
    let report = await spawn('changed');
    check(report.labels[0].includes('HP 42') && report.labels[0].includes('起始牌 5 张') && report.labels[0].includes('攻击7'),
        'Changed configuration did not update roster display');
    let view = await click('TeamPage/ContinueRun');
    check(JSON.stringify(view.snapshot) === setup.snapshot && view.raw === setup.raw, 'New configuration replaced old values');
    integration.push({ mode: 'changed-old', oldRunRestored: true, oldHP: view.snapshot.party.map(hero => hero.maxHp),
        oldFloorCount: view.snapshot.floorCount, saveUnchanged: true });
    report = await spawn('changed');
    await click('TeamPage/Roster_0');
    view = await click('TeamPage/Roster_2');
    check(view.summary.includes('8 张起始牌') && view.raw === setup.raw, 'Changed deck count display or selection writes incorrect');
    await page.screenshot({ path: `${evidenceDir}/ConfigLoading-ChangedTeam-${page.url().includes(':7456/') ? 'Preview' : 'Web'}.png`, fullPage: true });
    view = await click('TeamPage/ConfirmTeam');
    const saved = JSON.parse(view.raw);
    check(view.snapshot.floorCount === 5 && view.snapshot.party.every(hero => hero.maxHp === 42)
        && saved.state.config.startingDeck.length === 8 && saved.state.config.seed === 17
        && saved.state.config.cardDefs[0].effect.damage === 7, 'New run did not use changed JSON');
    const map = view.snapshot.map;
    const adjacent = map.nodes.find(node => node.kind === 'battle'
        && (Math.abs(node.coord.q) + Math.abs(node.coord.r) + Math.abs(node.coord.q + node.coord.r)) / 2 === 1);
    const path = `MapPage/MapBoard/MapNode_${adjacent.coord.q}_${adjacent.coord.r}`;
    const position = await page.evaluate(async path => {
        const cc = await System.import('cc');
        const canvas = cc.director.getScene().getChildByName('Canvas');
        const node = path.split('/').reduce((parent, name) => parent.getChildByName(name), canvas);
        const p = canvas.getChildByName('Camera').getComponent(cc.Camera).worldToScreen(node.worldPosition);
        const element = document.querySelector('canvas'); const r = element.getBoundingClientRect();
        return { x: r.x + p.x / element.width * r.width, y: r.y + (element.height - p.y) / element.height * r.height };
    }, path);
    await page.mouse.click(position.x, position.y, { button: 'right' });
    trace.push({ path, button: 'right' });
    for (let i = 0; i < 120; i++) {
        view = await read();
        if (view.frames === 13) break;
        await page.waitForTimeout(100);
    }
    check(view.snapshot.phase === 'battle' && view.frames === 13 && view.presentation.hero_blue.flip === true,
        'Changed presentation not loaded');
    const sizing = await page.evaluate(async () => {
        const cc = await System.import('cc');
        const root = cc.director.getScene().getChildByName('Canvas').components.find(component => component.teamSelection);
        return { flip: root.heroes[1].node.getChildByName('Portrait').scale.x,
            blueHeight: root.battleArt.targetHeight(root.heroes[1].node),
            redHeight: root.battleArt.targetHeight(root.heroes[0].node),
            enemyHeight: root.battleArt.targetHeight(root.enemy.node) };
    });
    check(sizing.flip === -1, 'Blue portrait ignored configured flip=true');
    check(Math.abs(sizing.blueHeight - 285.5) < 0.01 && Math.abs(sizing.enemyHeight - 180.5) < 0.01
        && sizing.redHeight === 245, 'Independent height configuration not honored');
    await page.screenshot({ path: `${evidenceDir}/ConfigLoading-ChangedBattle-${page.url().includes(':7456/') ? 'Preview' : 'Web'}.png`, fullPage: true });
    integration.push({ mode: 'changed-new', newHP: 42, floorCount: 5, seed: 17, startingDeckCount: 8,
        attack: 7, blueFlip: true, sizing, onlyExplicitConfirmReplacedSave: true });
    const late = await spawn('late');
    integration.push(late);
    await page.waitForTimeout(200);
    check(errors.length === 0, `Browser errors: ${errors.join('; ')}`);
    return { result: '003 CONFIG LOADING PASS', source: page.url().includes(':7456/') ? 'editor-preview' : 'web-build',
        scenarios: setup.scenarios, integration, mouseActions: trace.length, errors, trace,
        faultInjection: 'Isolated JsonAsset callbacks only; production JSON unchanged' };
}
