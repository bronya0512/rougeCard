# Plan 002：战斗占位美术接入

状态：Confirmed（2026-11-19 用户已确认会话内计划并授权执行；本文记录该方案）
关联：spec.md FR-1～FR-6
前置：001 T109 已关闭 M1；Cocos Creator 3.8.8，资源已导入 image/texture/sprite-frame。

## 1. 方案与分层

- 在 assets/game/ 增加 BattleArtView 渲染辅助类，GameRoot 持有该表现对象，仍只从 Snapshot 呈现；不改 core、GameSession 或 platform。
- 12 个稳定资源键映射到 assets/resources/ 的现有 PNG SpriteFrame 子资源；resources.load 使用无扩展名的 name/spriteFrame 路径。无需外部依赖、不引入平台分支。
- 每种图加载一次，表现组件持有 addRef，并在销毁时 decRef；Sprite 在拆除前清空 spriteFrame。迟到加载通过销毁标志忽略，不引用已销毁节点。加载失败保留原文字色块。
- 保留原 BattlePage/EnemyTarget、HeroTarget_n、HandCard_n、EndTurn、CancelCard 路径与点击矩形，保留敌左我右、队伍按 X 顺序站位。新增图片节点不注册额外输入，不改变状态。
- 人物在既有面板上部等比显示，底部放紧凑生命/格挡/意图。未知颜色/加载失败使用原面板。蓝色角色、魔王仅图像 X 翻转，不翻转文字或点击节点。
- 背景为战斗页第一子节点，降低亮度；其他页面不接入资源。
- 卡牌保留现有 176×190 点击区域；裁剪 SpriteFrame 实际 598×824，按高度 190 等比显示。窗口源图范围约 x=274～749、y=164～623；遮罩矩形略伸入不透明内框，先裁切插画再叠卡框。名称/费用与描述为独立 Label，不烘焙图片；原 Text 保留完整语义用于回退及验收读取。
- 红绿蓝能量分别显示图与数值，白色仍文本。尺寸是本切片初值，不是平台预算或终版规范。

## 2. 需求映射

| 需求 | 承接 |
|---|---|
| FR-1/FR-2 | BattleArtView 目标图片、等比缩放、朝向；GameRoot 紧凑状态文字 |
| FR-3 | 卡牌图片遮罩、底板叠加、动态文字与颜色 |
| FR-4 | 战斗背景与能量图片 |
| FR-5 | 生命周期、失败回退、只渲染 |
| FR-6 | 保留节点/输入路径；既有测试及新包鼠标回归 |

## 3. 构建与验证途径

- powershell -NoProfile -ExecutionPolicy Bypass -File build/scripts/test-core.ps1
- powershell -NoProfile -ExecutionPolicy Bypass -File build/scripts/check-layering.ps1
- 诊断检查 assets/game/ 修改文件；Cocos 编译与预览先检查表现。
- 经编辑器现有 web-desktop 设置重新 Build。MCP get_build_settings 明示完整配置受限，不臆造未验证参数；若自动构建不可用，记录阻塞并请用户在 Build 面板构建，不勾选任务。
- serve-web.ps1 启动仅127.0.0.1:8123服务；Playwright 独立 Edge 会话真实鼠标验证，证据写到 specs/002-battle-art/，不得覆盖 001 历史证据。
- verify-web.js 增加独立 ?verify=art002 分支/证据目录，原回归断言保留；补充资源映射、窗口与生命周期专项检查。浏览器评估只读运行状态，故障注入仅用于隔离验证会话。

## 4. 风险

- 全部图较大，本轮先验证实际加载与可读性，不压缩源图、不凭文件体积推断显存或跨端预算。
- 卡框自动裁边、透明窗口需使用真实 SpriteFrame 比例并观察新包截图；不可按1024方图直接拉伸。
- 根项目 tsc 既有扩展 Editor 类型错误不在本范围；不声称全根类型通过。
- 用户已于2026-11-19人工验收并授权Git提交与推送；用本次Git提交记录可回滚检查点，目标为已核对的origin/main。不强推，不改变Git配置，不跳过hooks。

## 5. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-11-19 | 落地已确认接入方案，仅战斗页与单任务验证；不新增依赖。 |
| 2026-11-19 | 按实际图与预览校正：卡牌138×190，窗口116×110位于y27，Mask裁切后叠卡框；目标图上部高165、底部状态文字；保留原点击矩形。成功加载回调error可为undefined，使用真值错误判定；addRef/decRef所有权经成功/失败/迟到/实际组件销毁验证。全部assets严格类型、74条回归、预览122鼠标与生命周期通过，具体证据见tasks。当时MCP仅打开Build面板，等待用户手动构建。 |
| 2026-11-19 | 用户手动web-desktop构建完成，编辑器最终任务state=success，16:00:42/35s；新main/index.js为16:00:38/52772字节。实际Web包122鼠标、16次美术检查、两人3层通关、三人防御/阵亡/读档及生命周期通过，正常控制台/网络错误0，静态与74条回归再验通过。证据独立写入002目录；无新增实现或参数调整、不声明真实三端/根tsc通过。当时新包阻塞已解除，仅检查点待授权。 |
| 2026-11-19 | 用户人工验收无问题并授权提交/push；以feat(P2): close art T001 - battle placeholder art为本轮Git检查点，随提交勾选T001，推送origin/main，结果以实际Git输出为准。纳入spec引用且此前已确认的世界观归档，不实施后续叙事玩法。 |
