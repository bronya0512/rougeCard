# Plan 003：配置集中管理

状态：Confirmed（2026-11-19 用户确认；M0与M1已验证，开始T001）
关联：spec.md FR-1～FR-7
前置：002已人工验收并提交；本轮工作区基线1b08429。

## 1. 存储组织与默认数据

配置统一置于 assets/resources/config/，Cocos按JsonAsset读取。五个文件各有单一职责：

| 文件 | 内容及保留原值 |
|---|---|
| game.json | seed=20261116、floorCount=3、mapRadius=2、startHp=30、energyPerTurn=1、drawPerTurn=5、restHeal=10、rewardCount=3、restNodes=1 |
| characters.json | hero-red/hero-green/hero-blue按红绿蓝顺序；各自起始牌为同色atk、atk、def，重复ID保留 |
| cards.json | r-atk/r-def/g-atk/g-def/b-atk/b-def按现顺序；原英文名称；费用1，攻击4、格挡3 |
| enemies.json | normal(HP12/damage3)在前、boss(HP24/damage5)在后 |
| presentation.json | 当前12个美术键的SpriteFrame路径与flip标志；路径仍为原name/spriteFrame，蓝色角色与魔王flip=true，其余false |

本轮不把节点名、布局、Mask、装饰色或所有UI文案泛化为配置，不增加第二份生产默认值。奖励仍按既有core规则只取红/蓝。

## 2. 分层与解析

- core增加或复用纯TypeScript配置类型/守卫，输入unknown并逐项收窄，校验成功后构造类型，不使用any或as GameConfig绕过。文件I/O与cc依赖不进入core。
- game负责JsonAsset加载、五类配置组装及presentation验证；已校验的静态配置注入TeamSelection/BattleArtView与渲染，不成为game业务状态。
- 不以isSaveData充当配置解析器，不收紧旧存档守卫，不改schema/Storage键/GameSession保存格式。
- 校验全部名单和跨文件引用：定义ID唯一，起始牌重复合法且同色；效果白名单；普通/Boss两模板身份和顺序保持；资源键齐全、路径非空、flip为boolean。新局层数只接受现行3/4/5。
- 现UI只有3个奖励槽，迁移入口对rewardCount不超3给明确错误；不静默丢弃。地图休息节点数量须校验实际生成能力，不延续生成器静默截断作为新入口行为。其余合法界限以现行规则为准，不臆造跨端预算。

## 3. 消费点与启动流程（已确认）

- 新局的seed与floorCount统一来自game.json；移除StartMenu/GameRoot的Inspector层数覆盖链，避免两个数据源。
- TeamSelection显式注入已校验配置；createConfig不再生成硬编码默认卡牌/敌人。保留按点击顺序组成队伍/起始牌，不排序或去重。
- 组队面板的生命、产能、起始牌数量/概要从配置派生，删除HP30/每人3张等重复数字。保留Roster_n等既有点击路径与游戏观察入口。
- 加载入口只初始化一次；加载完成前禁用开局。五个JsonAsset按生命周期管理持有引用，解析为普通数据后释放；销毁后拒绝回调更新节点，不依赖平台API。
- 加载失败显示明确提示、不创建新局、不调用会删除坏存档的load路径。仍通过readSave只读取得有效旧存档，允许继续；配置不可用时该旧局以保存的GameConfig运行，表现降级到原文字界面。不得另写一份默认玩法数据充当兜底。
- 配置成功时继续旧局仍使用pendingSave.state.config；新配置只用于新局/选队，当前presentation用于展示。图片加载失败沿用002文字回退。
- BattleArtView通过presentation注入资源路径/flip，保持12个内部语义键和已验证资源持有/销毁机制。

## 4. 测试和构建

- 测试端用Node内置读取真实五JSON，调用纯校验函数，避免抄一套默认值或让测试引入cc。原core测试的特制fixture仍保持独立。
- 更新TeamSelection及adapter-contract的配置注入调用；增加默认值黄金断言、合法重复起始牌/调整数量、非法类型/数值/ID/引用/效果/资源映射测试。
- 验证新配置更改只影响新局：旧局内嵌config与后续Rng恢复保持原值，读取/选队不写存档；不修改GameSession旧局兼容路径。
- powershell -NoProfile -ExecutionPolicy Bypass -File build/scripts/test-core.ps1
- powershell -NoProfile -ExecutionPolicy Bypass -File build/scripts/check-layering.ps1
- 使用Cocos内置TypeScript严格检查全部assets，排除既有extensions错误并记录skipLibCheck，不宣称根tsc通过。
- 浏览器verify-web保持旧断言，另设config003证据目录与URL分支，不覆盖001/002。美术生命周期验证随新增构造参数小幅调整，覆盖默认映射与引用清理。
- 预览先核对五JSON加载/组队展示/失败旧局入口；用新web-desktop包做两人完整通关、三人定向防御/阵亡/读档与美术生命周期真实鼠标验证。故障注入仅隔离会话，不写生产配置。
- 已实测MCP构建入口仅打开Build面板；需要用户完成Build再验收新包，不以旧包或预览结案。

## 5. 任务边界与风险

一个半天以内任务：五JSON、纯校验、依赖注入、默认等价测试与新包验证。若出现需要新效果、存档迁移或扩展UI槽位，另起task，不在本轮实现。

主要风险为异步配置与onLoad/StartMenu.configure的顺序。入口必须容忍配置/Storage任一先到，并仅初始化一次；提前销毁和失败旧局入口分别验证。

2026-11-20用户明确授权单独提交003并push；以feat(P2): close config T001 - centralized configuration为Git检查点，普通推送origin/main，不强推、不跳过hooks。004文档不纳入此提交。

## 6. 发布编译兼容

2026-11-19新Web实包发现：发布编译把`[...Map]`降为`[].concat(map)`，不会遍历Map条目，组队卡牌查找失败；同类迭代器展开也会影响拆除目标Sprite。表现代码改用`Array.from(map)`或独立`for...of`，不改全工程构建配置、不修改生成的build文件。针对当前新包失败补充回归，修复后必须再构建新包验收，预览通过不替代。

## 7. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-11-19 | 完成只读影响分析；五文件、取消Inspector覆盖、坏配置保留旧局文字回退方案等待用户确认，未修改业务代码。 |
| 2026-11-19 | 用户确认并执行T001：core/content纯校验、game/ConfigPackage与ConfigLoader、TeamSelection/BattleArtView显式注入、GameRoot异步/失败旧局、移除Inspector重复值；五JSON原值不变。当前入口按CardDef只收红绿蓝，drawPerTurn至少1、rewardCount为1～3，restNodes不超3×(radius−1)×radius；不收紧旧存档或特制core测试。createConfig保留测试显式seed/floorCount覆盖，实际新局不传覆盖值。 |
| 2026-11-19 | test-core固定Node根目录读取实际JSON，99条回归/全部assets严格类型/分层/IDE通过；预览122鼠标、16美术检查、五JSON加载/派生展示通过。隔离配置Loader与真实GameRoot成功/失败/非法/迟到/变更新局旧局专项9鼠标、引用平衡和美术生命周期通过，证据写003。当时构建入口仅开面板，等待用户新Build；未提交/推送、不勾选。 |
| 2026-11-19 | 17:57用户Build最终success，但实包组队显示失败，发布编译的Map展开变成concat，见§6。定点修复Array.from和目标Sprite独立清空循环，强化显式清空断言；99测试、strict/分层/IDE、完整预览122鼠标与生命周期通过。配置数值、旧存档、默认美术不变；当时再次等待Build，具体失败与修复证据见tasks。 |
| 2026-11-19 | 18:15:19修复后web-desktop重建success/27s，新main/index.js为59504字节且包含Array.from修复。Web真实回归122鼠标/16美术检查、两人3层、三人防御/阵亡/读档通过；配置加载与变更新局旧局专项9鼠标、JsonAsset引用/迟到/失败回退及强化美术生命周期通过，生产默认未改，正常控制台/网络错误0。99回归、strict/分层/IDE复验通过，证据见tasks及Config-Web*.json。不声称其他端/根tsc；仅检查点未建立，未提交/推送、T001不勾选。 |
