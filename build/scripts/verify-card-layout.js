async page => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const evidenceDir = 'specs/004-battle-layout';
    const check = (value, message) => { if (!value) throw new Error(message); };
    const normal = await page.evaluate(async () => {
        const cc = await System.import('cc');
        const root = cc.director.getScene().getChildByName('Canvas').components.find(component => component.teamSelection);
        if (!root || root.choosingTeam || root.session.snapshot.phase !== 'battle') throw new Error('Requires loaded battle');
        const cards = root.session.snapshot.hand.map((card, i) => {
            const node = root.handCards[i].node.getChildByName('CardArt');
            const title = node.getChildByName('CardTitle');
            const frame = node.getChildByName('Frame');
            const frameSize = frame.getComponent(cc.UITransform);
            const sprite = frame.getComponent(cc.Sprite).spriteFrame;
            const scale = frameSize.width / sprite.rect.width;
            const titleSize = title.getComponent(cc.UITransform);
            const titleFits = title.position.x - titleSize.width / 2 >= (310 - sprite.rect.x - sprite.rect.width / 2) * scale
                && title.position.x + titleSize.width / 2 <= (715 - sprite.rect.x - sprite.rect.width / 2) * scale
                && title.position.y - titleSize.height / 2 >= (sprite.rect.y + sprite.rect.height / 2 - 609) * scale
                && title.position.y + titleSize.height / 2 <= (sprite.rect.y + sprite.rect.height / 2 - 535) * scale;
            const badges = node.children.filter(child => child.name.startsWith('CostBadge_') && child.active);
            const badge = badges[0];
            return { name: title.getComponent(cc.Label).string, expectedName: card.def.name, titleFits,
                singleLine: !title.getComponent(cc.Label).enableWrapText,
                count: badges.length, x: badge.position.x, y: badge.position.y,
                colorMatches: badge.getChildByName('Icon').getComponent(cc.Sprite).spriteFrame === root.battleArt.frames.get(`energy_${card.def.color}`),
                cost: badge.getChildByName('CardCost').getComponent(cc.Label).string, expectedCost: String(card.def.cost),
                centered: badge.getChildByName('CardCost').position.x === 0 && badge.getChildByName('CardCost').position.y === 0 };
        });
        return { cards };
    });
    check(normal.cards.every(card => card.name === card.expectedName && card.titleFits && card.singleLine
        && card.count === 1 && card.colorMatches && card.cost === card.expectedCost && card.centered
        && card.x === -56 && card.y === 78), 'Normal card nameplate or colored cost mismatch');
    const mixed = await page.evaluate(async () => {
        const cc = await System.import('cc');
        const root = cc.director.getScene().getChildByName('Canvas').components.find(component => component.teamSelection);
        const saved = localStorage.getItem('roguecard.save.v1');
        const snapshot = JSON.stringify(root.session.snapshot);
        root.setHandHover(root.session.snapshot.hand[0].uid);
        root.battleArt.cardCosts(root.handCards[0].node, { white: 1.5, green: 2, red: 0, blue: 3 });
        const node = root.handCards[0].node.getChildByName('CardArt');
        const rows = node.children.filter(child => child.name.startsWith('CostBadge_') && child.active).map((badge, i) => ({
            color: ['red', 'green', 'blue', 'white'][i], x: badge.position.x, y: badge.position.y,
            value: badge.getChildByName('CardCost').getComponent(cc.Label).string,
            iconMatches: badge.getChildByName('Icon').getComponent(cc.Sprite).spriteFrame
                === root.battleArt.frames.get(`energy_${['red', 'green', 'blue', 'white'][i]}`),
            centered: badge.getChildByName('CardCost').position.x === 0 && badge.getChildByName('CardCost').position.y === 0,
        }));
        return { rows, saveUnchanged: saved === localStorage.getItem('roguecard.save.v1'),
            snapshotUnchanged: snapshot === JSON.stringify(root.session.snapshot) };
    });
    check(mixed.rows.length === 4 && mixed.rows.every((row, i) => row.x === -56 && row.y === 78 - i * 28
        && row.value === ['0', '2', '3', '1.5'][i] && row.iconMatches && row.centered)
        && mixed.saveUnchanged && mixed.snapshotUnchanged, 'Mixed presentation-only cost stack mismatch');
    await page.waitForTimeout(180);
    await page.screenshot({ path: `${evidenceDir}/CardLayout-Mixed-${page.url().includes(':7456/') ? 'Preview' : 'Web'}.png`, fullPage: true });
    const fallback = await page.evaluate(async () => {
        const cc = await System.import('cc');
        const root = cc.director.getScene().getChildByName('Canvas').components.find(component => component.teamSelection);
        const art = root.battleArt;
        const frame = art.frames.get('energy_blue');
        const refs = frame.refCount;
        const before = JSON.stringify(root.session.snapshot);
        const saved = localStorage.getItem('roguecard.save.v1');
        try {
            art.frames.delete('energy_blue');
            art.cardCosts(root.handCards[0].node, { blue: 2 });
            const node = root.handCards[0].node.getChildByName('CardArt');
            const badge = node.getChildByName('CostBadge_0');
            const value = { artVisible: node.active, colorBadge: badge.getChildByName('Fallback').active,
                number: badge.getChildByName('CardCost').getComponent(cc.Label).string,
                iconCleared: badge.getChildByName('Icon').getComponent(cc.Sprite).spriteFrame === null,
                staleRowsCleared: [1, 2, 3].every(i => !node.getChildByName(`CostBadge_${i}`).active
                    && node.getChildByName(`CostBadge_${i}`).getChildByName('Icon').getComponent(cc.Sprite).spriteFrame === null) };
            return { ...value, saveUnchanged: saved === localStorage.getItem('roguecard.save.v1'),
                snapshotUnchanged: before === JSON.stringify(root.session.snapshot), referenceUnchanged: frame.refCount === refs };
        } finally {
            art.frames.set('energy_blue', frame);
            root.clearHandHover();
            root.render();
        }
    });
    check(fallback.artVisible && fallback.colorBadge && fallback.number === '2' && fallback.iconCleared
        && fallback.staleRowsCleared && fallback.saveUnchanged && fallback.snapshotUnchanged && fallback.referenceUnchanged,
        'Missing energy icon lost cost, card or state');
    const restored = await page.evaluate(async () => {
        const cc = await System.import('cc');
        const root = cc.director.getScene().getChildByName('Canvas').components.find(component => component.teamSelection);
        return root.handCards.filter(panel => panel.node.active).every(panel => panel.node.getChildByName('CardArt').children
            .filter(child => child.name.startsWith('CostBadge_') && child.active).length === 1);
    });
    check(restored, 'Mixed sample left stale rows after real card render');
    await page.screenshot({ path: `${evidenceDir}/CardLayout-Normal-${page.url().includes(':7456/') ? 'Preview' : 'Web'}.png`, fullPage: true });
    check(errors.length === 0, errors.join('; '));
    return { result: '004 CARD LAYOUT PASS', source: page.url().includes(':7456/') ? 'editor-preview' : 'web-build',
        normal, mixed, fallback, restored, errors, mixedIsPresentationOnly: true };
}
