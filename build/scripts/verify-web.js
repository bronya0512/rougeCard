async page => {
    const url = page.url();
    const preview = url.includes(':7456/');
    const mapRevisit = !preview && /[?&]verify=t113(?:&|$)/.test(url);
    const blockTarget = !preview && /[?&]verify=t115(?:&|$)/.test(url);
    const settlementFreeze = !preview && /[?&]verify=t116(?:&|$)/.test(url);
    const legacyDefeat = !preview && /[?&]verify=t117(?:&|$)/.test(url);
    const adapterRegression = !preview && /[?&]verify=t118(?:&|$)/.test(url);
    const finalAcceptance = !preview && /[?&]verify=t109(?:&|$)/.test(url);
    const centralConfig = /[?&]verify=config003(?:&|$)/.test(url);
    const battleArt = centralConfig || /[?&]verify=art002(?:&|$)/.test(url);
    const prefix = centralConfig ? preview ? 'ConfigPreview' : 'Config' : battleArt ? preview ? 'BattleArtPreview' : 'BattleArt' : finalAcceptance ? 'M1Final'
        : adapterRegression ? 'AdapterRegression' : legacyDefeat ? 'LegacyDefeat'
        : settlementFreeze ? 'SettlementFreeze' : blockTarget ? 'BlockTarget'
        : mapRevisit ? 'MapRevisit' : preview ? 'TeamPreview' : 'Team';
    const evidenceDir = centralConfig ? 'specs/003-central-config' : battleArt ? 'specs/002-battle-art' : 'specs/001-core-loop';
    const artChecks = [];
    const errors = [];
    const httpErrors = [];
    const trace = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('requestfailed', request => httpErrors.push(`${request.failure()?.errorText} ${request.url()}`));
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
        const root = canvas?.components.find(component => component.teamSelection);
        if (!root) return null;
        if (root.choosingTeam) return { snapshot: null, ui: { team: true,
            ids: root.teamSelection.selectedIds, canConfirm: root.teamSelection.canConfirm,
            canContinue: root.continueRun.node.active, configLoading: root.configLoading,
            configError: root.configError }, save: localStorage.getItem('roguecard.save.v1') };
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
    const capture = async name => {
        if (battleArt) {
            const before = await read();
            for (let attempt = 0; attempt < 120; attempt += 1) {
                const loaded = await page.evaluate(async () => {
                    const cc = await System.import('cc');
                    const canvas = cc.director.getScene()?.getChildByName('Canvas');
                    return canvas?.components.find(component => component.teamSelection)?.battleArt?.frames.size === 12;
                });
                if (loaded) break;
                await page.waitForTimeout(250);
            }
            const report = await page.evaluate(async () => {
                const cc = await System.import('cc');
                const canvas = cc.director.getScene().getChildByName('Canvas');
                const root = canvas.components.find(component => component.teamSelection);
                const art = root.battleArt;
                if (root.choosingTeam || root.session.snapshot.phase !== 'battle') return { count: art.frames.size, battle: false };
                const s = root.session.snapshot;
                const boss = s.map.nodes.some(node => node.kind === 'boss' && node.coord.q === s.map.position.q && node.coord.r === s.map.position.r);
                const matches = (node, key, flip) => {
                    const sprite = node.getComponent(cc.Sprite);
                    return node.activeInHierarchy && sprite.spriteFrame === art.frames.get(key) && (node.scale.x < 0) === flip;
                };
                const heroes = s.party.map((hero, i) => {
                    const panel = root.heroes[i];
                    const portrait = panel.node.getChildByName('Portrait');
                    return matches(portrait, `hero_${hero.color}`, hero.color === 'blue')
                        && portrait.getComponent(cc.Sprite).color.a === (hero.alive ? 255 : 170)
                        && panel.label.string.includes(hero.alive ? `HP ${hero.hp}/${hero.maxHp}` : '已阵亡');
                });
                const enemy = matches(root.enemy.node.getChildByName('Portrait'), boss ? 'enemy_boss' : 'enemy_normal', boss);
                const cards = s.hand.map((card, i) => {
                    const node = root.handCards[i].node.getChildByName('CardArt');
                    const window = node.getChildByName('IllustrationWindow');
                    const image = window.getChildByName('Illustration');
                    const frame = node.getChildByName('Frame');
                    return matches(image, card.def.effect.kind === 'attack' ? 'icon_attack' : 'icon_defend', false)
                        && matches(frame, 'card_frame', false) && window.getComponent(cc.Mask).type === cc.Mask.Type.GRAPHICS_RECT
                        && node.getChildByName('CardTitle').getComponent(cc.Label).string === card.def.name
                        && node.getChildByName('CardCost').getComponent(cc.Label).string === String(card.def.cost);
                });
                return { count: art.frames.size, battle: true, party: s.party.map(hero => hero.color), heroes, enemy, boss, cards,
                    background: matches(root.battlePage.getChildByName('BattleBackground'), 'battle_bg', false),
                    energy: root.battlePage.getChildByName('EnergyArt').activeInHierarchy };
            });
            check(report.count === 12, 'Not all twelve battle art resources loaded');
            if (report.battle) check(report.heroes.every(Boolean) && report.enemy && report.cards.every(Boolean)
                && report.background && report.energy, `Battle art mismatch at ${name}`);
            const after = await read();
            check(JSON.stringify(before.snapshot) === JSON.stringify(after.snapshot) && before.save === after.save,
                'Loading or capturing art changed gameplay/save');
            artChecks.push({ name, ...report });
        }
        return page.screenshot({ path: `${evidenceDir}/${prefix}-${name}.png`, fullPage: true });
    };
    const clickPoints = new Map();
    const click = async (path, button = 'left', allowInactive = false) => {
        const point = await page.evaluate(async ({ path, allowInactive, previousPoint }) => {
            const cc = await System.import('cc');
            const canvas = cc.director.getScene().getChildByName('Canvas');
            const node = path.split('/').reduce((parent, name) => parent?.getChildByName(name), canvas);
            if (!node && allowInactive && previousPoint) return previousPoint;
            if (!node || (!allowInactive && !node.activeInHierarchy)) throw new Error(`Missing visible target ${path}`);
            const camera = canvas.getChildByName('Camera').getComponent(cc.Camera);
            const screen = camera.worldToScreen(node.worldPosition);
            const element = document.querySelector('canvas');
            const rect = element.getBoundingClientRect();
            return { x: rect.x + screen.x / element.width * rect.width,
                y: rect.y + (element.height - screen.y) / element.height * rect.height };
        }, { path, allowInactive, previousPoint: clickPoints.get(path) ?? null });
        clickPoints.set(path, point);
        await page.mouse.click(point.x, point.y, { button });
        await page.waitForTimeout(100);
        const view = await read();
        if (view?.ui.team) {
            trace.push({ action: `${button}:${path}`, phase: 'team', ids: view.ui.ids });
        } else if (view) {
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
        let team = await click('StartButton');
        check(team.ui.team && team.snapshot === null, 'START did not show pre-session team selection');
        const originalSave = team.save;
        for (let attempt = 0; team.ui.configLoading && attempt < 120; attempt += 1) {
            await page.waitForTimeout(250);
            team = await read();
        }
        check(!team.ui.configLoading && !team.ui.configError, `Configuration failed: ${team.ui.configError}`);
        check(team.save === originalSave && team.snapshot === null, 'Configuration loading changed save/state');
        if (centralConfig) {
            const report = await page.evaluate(async () => {
                const cc = await System.import('cc');
                const root = cc.director.getScene().getChildByName('Canvas').components.find(component => component.teamSelection);
                const { content, presentation } = root.configPackage;
                const labels = root.rosterCards.map(panel => panel.label.string);
                return { ready: content.characters.length === 3 && Object.keys(presentation).length === 12,
                    displayed: content.characters.every((hero, i) => labels[i].includes(`HP ${content.game.startHp}`)
                        && labels[i].includes(`能量 ${content.game.energyPerTurn} / 回合`)
                        && labels[i].includes(`起始牌 ${hero.startingDeck.length} 张`)
                        && hero.startingDeck.every(id => labels[i].includes(content.cards.find(card => card.id === id).name))),
                    game: content.game, characters: content.characters };
            });
            check(report.ready && report.displayed, 'Team display differs from validated JSON');
            await page.screenshot({ path: `${evidenceDir}/${prefix}-Team.png`, fullPage: true });
        }
        return team;
    };
    const resume = async () => {
        const team = await start();
        check(team.ui.canContinue, 'Existing save cannot continue');
        const before = team.save;
        await click('TeamPage/Roster_1');
        const after = await click('TeamPage/Roster_2');
        check(after.save === before, 'Unconfirmed selection overwrote save');
        return click('TeamPage/ContinueRun');
    };

    await page.setViewportSize({ width: 1280, height: 1080 });
    if (legacyDefeat) {
        let view = await start();
        check(view.ui.canContinue && view.save !== null, 'Seed a legacy defeat in the isolated test storage before T117');
        const original = view.save;
        const old = JSON.parse(original);
        check(old.schemaVersion === 1 && old.state.phase === 'defeat' && old.state.floor === undefined
            && old.state.completedMaps === undefined && old.state.config.floorCount === undefined
            && old.state.config.startingParty === undefined, 'Fixture must be a complete old single-floor red/blue defeat');
        await click('TeamPage/Roster_1');
        view = await click('TeamPage/Roster_0');
        check(view.save === original, 'Choosing another roster overwrote legacy defeat');
        view = await click('TeamPage/ContinueRun');
        const expected = view.snapshot;
        check(view.ui.settlement && view.ui.settlementText.includes('DEFEAT') && expected.phase === 'defeat'
            && expected.floor === 1 && expected.floorCount === 1, 'Old defeat was reset or expanded to multiple floors');
        check(expected.revision === old.state.revision && JSON.stringify(expected.party) === JSON.stringify(old.state.party),
            'Old party, death or revision changed during migration');
        check(JSON.stringify(expected.hand.map(card => ({ uid: card.uid, defId: card.def.id })))
            === JSON.stringify(old.state.deck.hand) && expected.drawCount === old.state.deck.drawPile.length
            && expected.discardCount === old.state.deck.discardPile.length, 'Old card instances changed during migration');
        check(JSON.stringify(expected.energy) === JSON.stringify(old.state.energy), 'Old energy changed during migration');
        check(view.save === original, 'Continuing a valid legacy defeat must not rewrite storage');
        await capture('Loaded');
        const before = view;
        view = await resume();
        unchanged(before, view, 'Legacy defeat did not survive a second read-only load');
        check(view.ui.settlement && view.snapshot.floorCount === 1, 'Reload showed the wrong page or floor count');
        await capture('Reloaded');
        view = await click('SettlementPage/Restart');
        check(view.ui.team && view.save === original, 'Restart must preserve legacy save until confirmation');
        await click('TeamPage/Roster_0');
        await click('TeamPage/Roster_2');
        view = await click('TeamPage/ConfirmTeam');
        const fresh = JSON.parse(view.save);
        check(view.ui.map && view.snapshot.revision === 0 && view.snapshot.floorCount === 3
            && fresh.schemaVersion === 2 && view.save !== original, 'Confirmation must replace legacy save with a new schema2 run');
        await capture('NewRun');
        await page.waitForTimeout(200);
        check(errors.length === 0 && httpErrors.length === 0, 'T117 browser or network errors detected');
        return { result: 'T117 AC-21 WEB PASS', source: 'web-build', url, errors, httpErrors,
            legacySchema: old.schemaVersion, legacyRngState: old.rngState, legacyRevision: expected.revision,
            legacyPartyHp: expected.party.map(hero => hero.hp), legacyFloorCount: expected.floorCount,
            legacyDeckCount: old.state.deck.drawPile.length + old.state.deck.hand.length
                + old.state.deck.discardPile.length + old.state.deck.exhaustPile.length,
            migratedLoadCount: 2, newSchema: fresh.schemaVersion, newFloorCount: view.snapshot.floorCount,
            mouseActions: trace.length, keyboardActions: 0,
            scope: 'Legacy schema1 fixture generated offline through actual GameSession enemy attacks, installed only into isolated browser storage; app state is not modified by page.evaluate.', trace };
    }
    if (blockTarget) {
        let view = await start();
        check(view.save === null, 'Use an isolated browser session for T115');
        await click('TeamPage/Roster_0');
        await click('TeamPage/Roster_2');
        view = await click('TeamPage/ConfirmTeam');
        const normal = view.snapshot.map.nodes.find(node => node.kind === 'battle'
            && distance(node.coord, view.snapshot.map.position) === 1
            && distance(node.coord, view.snapshot.map.boss) === 1);
        check(normal, 'Expected an adjacent normal battle on the route to boss');
        await advance(tile(normal.coord), 'right');
        view = await fight();
        check(view.snapshot.phase === 'reward', 'Normal battle must finish before boss');
        view = await advance('RewardPage/RewardCard_0');
        view = await advance(tile(view.snapshot.map.boss), 'right');
        check(view.ui.battle && view.snapshot.enemy.intent.damage === 5, 'Expected boss damage five');
        const checkedEndTurn = async () => {
            const before = await read();
            const s = before.snapshot;
            const target = s.party.findIndex(hero => hero.alive);
            const after = await advance('BattlePage/EndTurn');
            check(after.snapshot.phase === 'battle', 'T115 must remain in battle with a survivor');
            check(after.snapshot.revision === s.revision + 1 && after.snapshot.turn === s.turn + 1,
                'End turn must advance exactly once');
            for (let i = 0; i < s.party.length; i += 1) {
                const hp = i === target ? Math.max(0, s.party[i].hp - Math.max(0, s.enemy.intent.damage - s.party[i].block))
                    : s.party[i].hp;
                check(after.snapshot.party[i].hp === hp && after.snapshot.party[i].alive === (hp > 0)
                    && after.snapshot.party[i].block === 0, 'Enemy hit wrong target, bypassed block or retained block');
            }
            check(JSON.stringify(JSON.parse(after.save).state.party) === JSON.stringify(after.snapshot.party),
                'Damage or block reset was not saved');
            return after;
        };
        let defense = -1;
        for (let turn = 0; turn < 4; turn += 1) {
            defense = view.snapshot.hand.findIndex(card => card.playable && card.def.effect.kind === 'defend');
            if (defense >= 0) break;
            view = await checkedEndTurn();
        }
        check(defense >= 0 && view.snapshot.party[0].hp > 2, 'Expected a usable guard before lethal boss damage');
        const selected = await click(`BattlePage/HandCard_${defense}`);
        unchanged(view, selected, 'Selecting guard changed state');
        view = await advance('BattlePage/HeroTarget_0');
        check(view.snapshot.party[0].block === 3 && view.snapshot.party[1].block === 0, 'Guard must target only the first hero');
        const hpBefore = view.snapshot.party[0].hp;
        await capture('Guarded');
        const guarded = view;
        view = await resume();
        unchanged(guarded, view, 'Guard did not survive reload');
        view = await checkedEndTurn();
        const hpAfter = view.snapshot.party[0].hp;
        check(hpBefore - hpAfter === 2 && view.snapshot.party[1].hp === 30, 'Block three must absorb three of damage five');
        await capture('Absorbed');
        for (let turn = 0; view.snapshot.party[0].alive && turn < 10; turn += 1) view = await checkedEndTurn();
        check(!view.snapshot.party[0].alive && view.snapshot.party[1].hp === 30, 'First-hero death must not spill damage');
        await capture('LeaderDead');
        const dead = view;
        view = await resume();
        unchanged(dead, view, 'Dead leader did not survive reload');
        view = await checkedEndTurn();
        check(view.snapshot.party[0].hp === 0 && view.snapshot.party[1].hp === 25, 'Next attack must skip dead leader and hit second hero');
        await capture('NextTarget');
        await page.waitForTimeout(200);
        check(errors.length === 0 && httpErrors.length === 0, 'T115 browser or network errors detected');
        return { result: 'T115 AC-12 WEB PASS', source: 'web-build', url, errors, httpErrors,
            block: 3, damage: 5, hpBefore, hpAfter, reloads: 2,
            finalRevision: view.snapshot.revision, finalPartyHp: view.snapshot.party.map(hero => hero.hp),
            mouseActions: trace.length, keyboardActions: 0, trace };
    }
    if (mapRevisit) {
        let view = await start();
        check(view.save === null, 'Use an isolated browser session for T113');
        await click('TeamPage/Roster_0');
        await click('TeamPage/Roster_2');
        view = await click('TeamPage/ConfirmTeam');
        const origin = view.snapshot.map.position;
        const rest = view.snapshot.map.nodes.find(node => node.kind === 'rest' && distance(node.coord, origin) === 1);
        check(rest, 'Expected an adjacent rest node');
        const battle = view.snapshot.map.nodes.find(node => node.kind === 'battle'
            && distance(node.coord, origin) === 1 && distance(node.coord, rest.coord) === 1);
        check(battle, 'Expected a battle adjacent to both center and rest');
        view = await advance(tile(rest.coord), 'right');
        check(view.snapshot.map.nodes.find(node => distance(node.coord, rest.coord) === 0).visited,
            'First rest visit was not recorded');
        await capture('RestUsed');
        await advance(tile(origin), 'right');
        await advance(tile(battle.coord), 'right');
        view = await fight();
        check(view.snapshot.phase === 'reward', 'Normal battle did not finish with rewards');
        const total = view.snapshot.hand.length + view.snapshot.drawCount + view.snapshot.discardCount;
        view = await advance('RewardPage/RewardCard_0');
        check(view.snapshot.phase === 'map'
            && view.snapshot.hand.length + view.snapshot.drawCount + view.snapshot.discardCount === total + 1,
            'Expected exactly one reward after completing the battle');
        check(view.snapshot.party.some(hero => hero.hp < hero.maxHp), 'Rest regression needs actual battle damage');
        const injuredHp = view.snapshot.party.map(hero => hero.hp);
        const moveVisited = async coord => {
            const before = await read();
            check(before.snapshot.map.nodes.find(node => distance(node.coord, coord) === 0)?.visited,
                'Revisit target must already be visited');
            const savedBefore = JSON.parse(before.save);
            view = await advance(tile(coord), 'right');
            const savedAfter = JSON.parse(view.save);
            check(view.ui.map && view.snapshot.phase === 'map' && view.snapshot.enemy === null
                && view.snapshot.rewardCandidates.length === 0, 'Visited node retriggered an event');
            check(view.snapshot.revision === before.snapshot.revision + 1, 'Revisit must save only one movement revision');
            check(distance(view.snapshot.map.position, coord) === 0, 'Revisit position was not saved');
            check(JSON.stringify({ ...savedBefore.state, revision: 0, position: null })
                === JSON.stringify({ ...savedAfter.state, revision: 0, position: null }),
                'Revisit changed state beyond position and revision');
            check(savedAfter.rngState === savedBefore.rngState, 'Revisit consumed RNG');
            check(view.save !== before.save && savedAfter.state.revision === view.snapshot.revision,
                'Accepted revisit did not save movement');
        };
        for (let visit = 0; visit < 3; visit += 1) {
            await moveVisited(origin);
            const beforeLoad = view;
            view = await resume();
            unchanged(beforeLoad, view, 'Battle visit reload differs from last save');
            await moveVisited(battle.coord);
        }
        await capture('BattleRevisited');
        await moveVisited(rest.coord);
        for (let visit = 0; visit < 3; visit += 1) {
            await moveVisited(origin);
            const beforeLoad = view;
            view = await resume();
            unchanged(beforeLoad, view, 'Rest visit reload differs from last save');
            await moveVisited(rest.coord);
        }
        check(JSON.stringify(view.snapshot.party.map(hero => hero.hp)) === JSON.stringify(injuredHp),
            'Used rest node healed battle damage on revisit');
        await capture('RestRevisited');
        await page.waitForTimeout(200);
        check(errors.length === 0 && httpErrors.length === 0, 'T113 browser or HTTP errors detected');
        return { result: 'T113 AC-8 WEB PASS', source: 'web-build', url, errors, httpErrors,
            battleRevisits: 3, restRevisits: 4, reloads: 6, finalRevision: view.snapshot.revision,
            finalPartyHp: injuredHp, mouseActions: trace.length, keyboardActions: 0, trace };
    }
    let view = await start();
    check(view.save === null, 'Use a new isolated browser session with no existing save');
    await capture('Selection');
    view = await click('TeamPage/ConfirmTeam');
    check(view.ui.team && view.save === null, 'Empty party started or saved');
    await click('TeamPage/Roster_0');
    view = await click('TeamPage/ConfirmTeam');
    check(view.ui.team && view.save === null, 'One-person party started or saved');
    await click('TeamPage/Roster_0');
    view = await click('TeamPage/Roster_2');
    check(view.ui.ids.length === 1, 'Repeated role click did not toggle');
    await click('TeamPage/Roster_0');
    view = await click('TeamPage/ConfirmTeam');
    check(view.snapshot.party.map(hero => hero.id).join(',') === 'hero-blue,hero-red', 'Two-person order incorrect');
    check(view.snapshot.drawCount === 6, 'Expected six starting cards');
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
    view = await resume();
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
        if (battleArt) await capture(`BossFloor${floor}`);
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
            view = await resume();
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
    const settledSave = view.save;
    if (settlementFreeze) {
        const keyboardTrace = [];
        const frozenUI = async outcome => {
            const before = await read();
            check(before.snapshot.phase === outcome && before.ui.settlement
                && before.ui.settlementText.includes(outcome.toUpperCase()), 'Settlement page missing');
            for (const path of ['BattlePage/EndTurn', 'BattlePage/HandCard_0', 'BattlePage/EnemyTarget',
                'BattlePage/HeroTarget_0', 'RewardPage/RewardCard_0']) {
                const after = await click(path, 'left', true);
                unchanged(before, after, `${outcome}: inactive control changed settled state`);
                check(after.ui.settlement && !after.ui.team && after.ui.selected === null, 'Inactive control opened another page');
            }
            const afterMove = await click(tile(before.snapshot.map.position), 'right', true);
            unchanged(before, afterMove, `${outcome}: map right click changed settled state`);
            for (const key of ['ArrowUp', 'ArrowRight', 'q', 'e', 'Space', '1', '3', 'Escape']) {
                await page.keyboard.press(key);
                await page.waitForTimeout(80);
                const after = await read();
                keyboardTrace.push({ outcome, key, revision: after.snapshot.revision });
                unchanged(before, after, `${outcome}: keyboard ${key} changed settled state`);
                check(after.ui.settlement && !after.ui.team && after.ui.selected === null, 'Keyboard opened another page');
            }
            return read();
        };
        view = await frozenUI('victory');
        await capture('VictoryFrozen');
        const victory = view;
        view = await resume();
        unchanged(victory, view, 'Victory reload differs from settlement save');
        view = await frozenUI('victory');
        await capture('VictoryReloaded');
        view = await click('SettlementPage/Restart');
        check(view.ui.team && view.save === victory.save, 'Restart must preserve frozen victory until confirmation');
        await click('TeamPage/Roster_0');
        await click('TeamPage/Roster_2');
        view = await click('TeamPage/ConfirmTeam');
        check(view.snapshot.revision === 0 && view.snapshot.phase === 'map' && view.save !== victory.save,
            'Confirmation must create a different session, not unfreeze the old one');
        const node = view.snapshot.map.nodes.find(n => n.kind === 'battle'
            && distance(n.coord, view.snapshot.map.position) === 1);
        check(node, 'Expected an adjacent normal battle for actual defeat');
        view = await advance(tile(node.coord), 'right');
        for (let turn = 0; view.snapshot.phase === 'battle' && turn < 40; turn += 1) {
            view = await advance('BattlePage/EndTurn');
        }
        check(view.snapshot.phase === 'defeat' && view.snapshot.party.every(hero => !hero.alive && hero.hp === 0),
            'Repeated enemy attacks must produce actual defeat');
        view = await frozenUI('defeat');
        await capture('DefeatFrozen');
        const defeat = view;
        view = await resume();
        unchanged(defeat, view, 'Defeat reload differs from settlement save');
        view = await frozenUI('defeat');
        await capture('DefeatReloaded');
        const defeatRevision = view.snapshot.revision;
        view = await click('SettlementPage/Restart');
        check(view.ui.team && view.save === defeat.save, 'Restart must preserve frozen defeat before confirmation');
        await page.waitForTimeout(200);
        check(errors.length === 0 && httpErrors.length === 0, 'T116 browser or network errors detected');
        return { result: 'T116 FR-4 WEB PASS', source: 'web-build', url, floorCount, errors, httpErrors,
            contextPrevented, victoryRevision: finalRevision, victoryPartyHp: finalPartyHp,
            defeatRevision, defeatPartyHp: defeat.snapshot.party.map(hero => hero.hp),
            settlementReloads: 2, frozenMouseAttempts: 24, frozenKeyboardAttempts: keyboardTrace.length,
            mouseActions: trace.length, keyboardActions: keyboardTrace.length, keyboardTrace,
            scope: 'Actual three-floor victory and actual defeat; UI controls and keyboard frozen before/after reload. All core GameInput types are covered by unit tests, not directly injected in the browser.', trace };
    }
    view = await click('SettlementPage/Restart');
    check(view.ui.team && view.save === settledSave, 'Restart must return to team page without erasing settled save');
    for (const index of [1, 0, 2]) await click(`TeamPage/Roster_${index}`);
    await capture('ThreeSelected');
    view = await click('TeamPage/ConfirmTeam');
    check(view.snapshot.revision === 0 && view.snapshot.drawCount === 9
        && view.snapshot.party.map(hero => hero.color).join(',') === 'green,red,blue', 'Three-role composition incorrect');
    const neighbor = view.snapshot.map.nodes.find(node => node.kind === 'battle' && distance(node.coord, view.snapshot.map.position) === 1);
    view = await advance(tile(neighbor.coord), 'right');
    check(view.ui.heroXs.length === 3 && view.ui.heroXs.every((x, i, all) => i === 0 || x > all[i - 1]),
        'Three allies not ordered on screen');
    check(view.snapshot.energy.green === 1, 'Green energy missing');
    let guardIndex = -1;
    for (let attempt = 0; attempt < 4; attempt += 1) {
        guardIndex = view.snapshot.hand.findIndex(card => card.playable && card.def.color === 'green' && card.def.effect.kind === 'defend');
        if (guardIndex >= 0) break;
        view = await advance('BattlePage/EndTurn');
    }
    check(guardIndex >= 0, 'No playable green guard after drawing');
    await click(`BattlePage/HandCard_${guardIndex}`);
    view = await advance('BattlePage/HeroTarget_2');
    check(view.snapshot.party[2].block === 3 && view.snapshot.energy.green === 0, 'Green defense failed on third ally');
    await capture('ThreeBattle');
    const beforeResume = view;
    view = await resume();
    unchanged(beforeResume, view, 'Three-person battle reload changed party/order/cards');
    if (battleArt) {
        await capture('ThreeReloaded');
        for (let attempt = 0; view.snapshot.party[0].alive && attempt < 20; attempt += 1) {
            view = await advance('BattlePage/EndTurn');
        }
        check(!view.snapshot.party[0].alive && view.snapshot.phase === 'battle', 'Expected actual leader death in three-person battle');
        await capture('LeaderDead');
        const dead = view;
        view = await resume();
        unchanged(dead, view, 'Dead leader art reload changed state/save');
        await capture('DeadReloaded');
    }
    await page.waitForTimeout(200);
    check(errors.length === 0, `Browser errors: ${errors.join('; ')}`);
    check(httpErrors.length === 0, `HTTP errors: ${httpErrors.join('; ')}`);
    return { result: centralConfig ? preview ? '003 CONFIG PREVIEW PASS' : '003 CONFIG WEB PASS'
        : battleArt ? preview ? '002 BATTLE ART PREVIEW PASS' : '002 BATTLE ART WEB PASS'
        : preview ? 'T112 PREVIEW PASS' : 'AC-15~24 WEB PASS', source: preview ? 'editor-preview' : 'web-build',
        url, floorCount, errors, httpErrors, contextPrevented, finalRevision, finalPartyHp, mouseActions: trace.length,
        keyboardActions: 0, ...(battleArt ? { artChecks } : {}), trace };
}
