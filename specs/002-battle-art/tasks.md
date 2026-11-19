# Tasks 002：战斗占位美术接入

规则：一次会话只执行一条任务；全部判据满足后才勾选；Git提交和推送须用户明确授权（本轮已授权）。

## 当前任务

- [x] **T001** 接入现有战斗页的12张占位图片并验证（预计半天以内）
  - 判据：spec AC-1～AC-6全部满足；原玩法/数值/输入/存档未改；新增图片仅位于战斗页；新 Web 构建与真实鼠标回归通过；单测/分层/修改源码诊断通过；生命周期与失败回退有证据；记录检查点状态。
  - 状态（2026-11-19）：spec AC-1～AC-6实测证据通过，用户明确“我验收了，没有问题 提交并push”。T001勾选随本次Git检查点归档；不新增实现，不开始下一task。
  - 实现：新增 assets/game/BattleArtView.ts 与编辑器自动生成 .meta；GameRoot 仅战斗页接入12图，按节点识别普通怪/魔王、蓝角色/魔王图像翻转、角色生命/格挡分区、阵亡暗化、能量图与数值、窗口 Mask 后插画/上层卡框/动态名称费用效果。保持原目标与卡牌点击矩形，core/GameSession/platform/数值/存档未改；verify-web.js新增art002独立目录与只读检查，不覆盖001证据。
  - 静态/回归证据：test-core.ps1 → 74/74通过，三adapter ES2015严格类型通过（temp/art002-tests.log）；check-layering.ps1 → core/game禁用平台标识0命中，状态变更仅dispatch；Cocos内置tsc -p temp/art002-types.json → exit0，strict检查全部assets、skipLibCheck且排除extensions（temp/art002-types.log）；修改源码/脚本IDE诊断0，两个验证脚本node --check与git diff --check通过。不声称根tsc或真实三端通过。
  - 预览证据：独立Edge会话art002-preview-complete，127.0.0.1:7456/?verify=art002。verify-web.js实际122鼠标/0键盘，两人默认3层胜利REV53/HP17与30，三人绿色防御第三位、读档、10次实际endTurn致首位阵亡再读档；16次截图/资源检查确认12图加载、队伍颜色/生命/阵亡暗化、普通怪和3层魔王/朝向、攻击防御窗口Mask/底板/名称费用对应，加载不改Snapshot/存档；正常流程console/pageerror/HTTP/requestfailed错误0。BattleArtPreview-Regression.json及BattleArtPreview-*.png归档。已查看Battle/ThreeBattle/BossFloor1/DeadReloaded截图核对可读性，证据明确source=editor-preview，不能代替Web新包。
  - 生命周期证据：verify-battle-art-lifecycle.js在同一隔离会话中测试12次成功、12次有意失败与12次销毁后迟到回调，真实GameRoot渲染短暂注入失败后恢复，文字回退、引用回到基线、迟到不重绘、幂等销毁及实际GameRoot销毁后释放全部12个持有引用，Snapshot/存档不变，页面错误0；BattleArtPreview-Lifecycle.json。故障注入只改测试视图/加载回调，不改业务状态；12条失败警告为有意测试，不计作正常流程成功日志。
  - 失败尝试与修正：严格类型发现角色仅红绿蓝，删除不可能的白色比较；资源成功回调实测error为undefined而非null，修正判定后干净会话重验；生命周期脚本需在Component销毁前保存视图引用（Cocos会清空组件成员），修正后通过。最终日志temp/art002-preview-complete.log / art002-lifecycle-complete.log，失败日志仍保留于temp。
  - Web构建证据（2026-11-19）：用户在编辑器完成web-desktop Build；profiles/v2/packages/builder.json中Web任务state=success/progress=1/message="2026-11-19 16:00:42 build success in 35 s!"，构建日志末尾16:00:42 Finished，BattleArt-BuildEvidence.json归档。main/index.js更新于2026-11-19 16:00:38/52772字节，包含BattleBackground/IllustrationWindow/CardArt等新实现；本机8123服务HTTP200。日志中16:00:38有debug级SIGTERM子进程退出记录，但后续任务完成且最终state=success；不声称整个构建日志无错误文字。
  - Web实包证据：独立Edge会话art002-web-verify打开http://127.0.0.1:8123/?verify=art002；verify-web.js返回002 BATTLE ART WEB PASS/source=web-build，122鼠标/0键盘，两人默认3层胜利REV53/HP17与30、三人绿色防御第三位、战斗读档、首位实际阵亡及阵亡读档。16次截图/资源检查包括3层魔王、红绿蓝角色/能量、攻防插画与窗口Mask/底板/名称费用、朝向、阵亡暗化、加载/截图不变Snapshot和存档，全部通过。正常流程console/pageerror/HTTP/requestfailed错误0，注入前完整console查询错误0/警告0；BattleArt-WebRegression.json与BattleArt-*.png归档，已查看ThreeBattle/BossFloor1/DeadReloaded截图核对排布与可读性。该范围为Web实包，不代表微信/Windows真机或三人完整通关。
  - Web生命周期证据：同会话执行verify-battle-art-lifecycle.js返回002 ART LIFECYCLE PASS/source=web-build，成功/有意失败/销毁后迟到各12回调，引用平衡、失败文字回退、迟到不重绘、幂等销毁、实际GameRoot释放全部持有引用、Snapshot/存档不变、页面错误0；BattleArt-WebLifecycle.json。故障测试有意产生12条加载失败警告，与正常流程日志区分。
  - 本轮复验：74/74及三adapter ES2015严格类型通过（temp/art002-web-tests.log）；全部assets严格类型exit0（temp/art002-web-types.log，skipLibCheck/排除extensions）；分层0平台泄漏、修改源码/脚本IDE诊断0、两脚本node --check、git diff --check通过。原始浏览器日志temp/art002-web-regression.log / art002-web-lifecycle.log。本轮只新增验证证据/同步文档，未修改业务源码或已有玩法；根tsc与其他端未重跑。
  - 检查点：2026-11-19用户人工验收通过并授权提交/push；本次提交主题feat(P2): close art T001 - battle placeholder art，以Git提交记录定位可回滚检查点，目标origin/main，推送结果以实际Git输出为准。不强推、不改Git配置、不跳过hooks。提交包含代码、12张PNG与meta、验证脚本、002规格/计划/任务与实测证据，以及spec引用的既有世界观归档；不含temp或build产物，不实现后续叙事玩法。

## 边界

不执行地图、组队、奖励、结算美术任务；不制作新美术；不修改001历史完成状态或宪法。
