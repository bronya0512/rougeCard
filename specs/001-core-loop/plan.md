# Plan 001：核心循环

> 对应 CodeBuddy Plan 模式产物。技术细节只写在这里，不写进 `spec.md`。
> 状态：Confirmed —— T006 复盘完成（风险结论见 §6），M0 阻塞项按**宪法 v0.2** 判据（Web + Windows 两端打通）已全部完成。微信小游戏 T003 因版号/合规成本按用户指示延后，不计入 M0 阻塞（构建产物已在 M0 生成）。据宪法 C-7 + `spec.md` AC-6（v0.2 口径），状态由 Draft 改为 Confirmed，解锁 M1。

关联：`spec.md` FR-1 ~ FR-17 / AC-1 ~ AC-14

## 1. 技术选型

| 项 | 选择 | 备注 |
|---|---|---|
| 引擎 | Cocos Creator 3.8.8 | T001 实测回填（`C:\ProgramData\cocos\editors\Creator\3.8.8\CocosCreator.exe`） |
| 语言 | TypeScript `strict` | 宪法 C-1 |
| 核心逻辑单测 | **Node 内置 `node:test` + `node:assert/strict`，Cocos 内置 tsc 预编译** | T103 定稿：**零 npm 依赖**（不装 Vitest/tsx，不动 Cocos 管理的 `package.json`）。`build/scripts/test-core.ps1` 用 `C:\ProgramData\cocos\editors\Creator\3.8.8\...\tsc.js` 以 `--strict` 编译 `assets/core/*.ts` + `tests/core/*.test.ts` 到 `temp/test-build/`（已忽略），再 `node --test` 跑编译产物。测试源码在 `tests/core/`（入库）。兼容 Cocos：用其自带 tsc、不改 Cocos 配置 |
| 构建 | 编辑器构建面板 / 命令行构建脚本为主 | 由 T005 沉淀到 `build/`；构建参数无法由 MCP 配置，见 §4 |
| 版本控制 | Git | 构建产物、`library/`、`temp/`、`local/` 不入库 |
| 验证工具 | 浏览器 / 微信开发者工具 / Windows exe | 三端各自留验证记录；Web 预览已可由 MCP 启动 |

## 2. 架构分层

```
平台输入 ──> game/ 组件 ──> GameInput ──> core/ 状态机 ──> Snapshot ──> game/ 渲染
                                │                              │
                                └──────> PlatformAdapter <──────┘
                                  Storage / Input / Audio / Achievement / Share
                                  web/      wx/      win/
```

- `core/` 为纯函数式状态推进：`advance(state, input, ctx) -> { state, snapshot }`，`ctx` 注入 `Clock` / `Rng`。
- `game/` 不持有业务状态，只订阅 `Snapshot` 做渲染；所有输入先转成 `GameInput`。
- `PlatformAdapter` 在启动时按构建目标注入一次实现，业务层只见接口。
- **目录现状偏差（2026-11-16，T001）**：宪法 §3 将场景归 `assets/game/`，但 M0 smoke test 的两张场景实际位于 `assets/scenes/`（T001b 建立的布局，T002/T004 的构建配置已引用该路径）。为避免破坏已验证的三端构建链路，M0 阶段保留此布局；M1 正式实现（T106）时再把场景归位到 `assets/game/`，并同步更新 `builder.json` 构建任务的场景路径。四大分层 `core/`、`platform/{web,wx,win}/`、`game/`、`resources/` 已建齐（T001）。

## 3. PlatformAdapter 接口草案

| 接口 | 方法（草案） | Web | 微信小游戏 | Windows |
|---|---|---|---|---|
| `Storage` | `get/set/remove` | `localStorage` | `wx.setStorage*` | 文件 + Steam Cloud（M3） |
| `Input` | 输入事件归一化 | 触摸 + 键鼠 | 触摸 | 键鼠 |
| `Audio` | `play/stop/setVolume` | WebAudio（需处理自动播放） | `wx.createInnerAudioContext` | 原生音频 |
| `Achievement` | `unlock` | 空实现 | 空实现 | Steamworks（M3） |
| `Share` | `share` | 空实现 | `wx.shareAppMessage`（M2） | 空实现 |

空实现是合法实现，用于保证 M1 阶段接口完整、三端可编译。具体签名由 T105 定稿。

## 4. 构建与验证流程（T005 回填）

M0 实测（2026-11-09，通过 cocos-mcp-server）：

- 服务连的是 `rougeCard`（`D:\dev\rougeCard\rougeCard`），157 个工具；asset db 与 builder 均 `ready`。
- **`project_get_build_settings` 明确返回限制**：`Full build configuration requires direct Editor UI access`。原版插件里 `start_preview_server` / `stop_preview_server` 是空 stub、`run_project` 只调 `builder:open`。**构建参数至今仍需构建面板 / 命令行配置**，T005 的脚本要覆盖这一点。
- **预览已打通（实测通过）**：编辑器内置扩展 `builtin/preview/package.json` 提供 `open-terminal`（菜单 `Project > Preview` / Ctrl+P）、`query-preview-url`、`reload-terminal`、`preview-scene-in-browser`、`change-platform` 等消息。已本地修改 `cocos-mcp-server` 的 `source/tools/project-tools.ts`，用插件自带 `node_modules/.bin/tsc.cmd -p tsconfig.json` 重编译 `dist`：
  - `run_project` / `start_preview_server` → 依次尝试 `preview:open-terminal` → `open` → `preview-scene-in-browser`，成功后调 `query-preview-url` 把地址放进 `data.url`。
  - 重启编辑器项目（PID 16796，17:37:52，晚于 dist 产物 17:36:26）后实测：`run_project` → `success:true` / `Preview started via preview:open-terminal` / `url = http://192.168.255.10:7456`；7456 端口由编辑器主进程监听；`GET http://127.0.0.1:7456/` → 200（16457 bytes）；`debug_get_console_logs` → 0 条。
  - `stop_preview_server` 仍返回 `success:false`：内置扩展**没有 stop 消息**，预览服务器由编辑器托管，只能关预览页或用 `reload-terminal` 刷新。
  - `run_project` 的 `platform` 参数目前只回显，不切换平台（切换需接 `preview:change-platform`，参数格式未验证）；`start_preview_server` 的 `port` 被忽略，端口由编辑器预览设置决定。
  - 改动范围仅 `D:\dev\rougeCard\rougeCard\extensions\cocos-mcp-server`；`C:\Users\Administrator\AnimalStore` 的原件保留为回滚备份。
- **黑屏根因与修复（实测 2026-11-09）**：MCP `node_create_node` 创建的节点 `_layer = 1073741824`（DEFAULT），而 UI 相机 `_visibility = 41943040`（UI_2D | UI_3D），UI 渲染器被相机剔除，只剩清屏色。对照 `AnimalStore/assets/scene/MainScene.scene`：Canvas 及 UI 子节点均为 `_layer = 33554432`（UI_2D），相机 `_clearFlags = 7` / `_visibility = 1108344832` / `_far = 2000`。已用 `node_set_node_property { layer: 33554432 }` 修正 Canvas、Camera、TitleLabel、StartButton 四个节点，并把相机三项调成标准值。**今后用 MCP 新建 2D UI 节点必须显式设 `layer = 33554432`**，否则必黑屏。
- **构建面板 `Run` 与编辑器预览的区别**：`Run` 跑的是 `build/web-desktop` 里的产物；场景 17:45:57 修改、构建目录却停在 17:28:50，改场景后不重新 Build 就一直看到旧包。编辑器预览（`project_run_project` / Ctrl+P）用 `settings.js?scene=current_scene` 实时加载当前场景，无需 Build，是更快的验证途径。
- `/api/tools` 返回的 `curlExample` 端口写死 8585（文档残留），实际服务端口 3000，不可照抄。
- 项目初始场景未保存为资源（`scene_get_scene_list` 返回空），须先 `scene_save_scene` 才能进 Build Settings；设计分辨率 1280×720、`fitWidth: true`（横屏），已回填 `spec.md` Q-2。
- REST 调用必须用 UTF-8 字节数组传 Body；`component_attach_script` 常返回 `success:false` 但实际已挂载，用 `component_get_components` 确认（组件类型显示为脚本 cid）。
- `component_set_component_property` **必须显式传 `propertyType`**，合法值是小驼峰白名单：`string` / `number` / `integer` / `float` / `boolean` / `color` / `vec2` / `vec3` / `size` / `node` / `component` / `spriteFrame` / `prefab` / `asset` / `nodeArray` / `colorArray` / `numberArray` / `stringArray`。不传会报 `Unsupported property type: undefined`；组件引用（`cameraComponent`）用 `propertyType: 'component'` 且 `value` 传**目标组件所在节点的 UUID**。
- `debug_validate_scene` 传 `checkMissingAssets` / `checkPerformance` 会报 `Message does not exist: scene - check-missing-assets`；**空参调用**才返回 `valid: true`。
- **MCP REST 传非 ASCII 会乱码**：中文写入 `cc.Label.string` 变成 `å¼å§æ¸¸æ`（UTF-8 字节被按单字节解码），`\uXXXX` 转义亦无效。smoke test 文案统一用 ASCII；中文文案需编辑器 UI 设置或由 TS 脚本赋值。
- `debug_execute_script` 不是自由 JS 执行（报 `Scenario scripts do not exist: console`），不要依赖它批量建节点。

> Web 已由 T002 实测回填；微信小游戏 / Windows 仍待 T003–T005 实测回填，不允许凭记忆写死。

| 端 | 构建方式 | 验证方式 | 命令 |
|---|---|---|---|
| Web / H5 | 编辑器 Build 面板：目标 `web-desktop`，初始场景 `StartMenu`，场景列表含 `StartMenu` + `Placeholder`，输出 `build/web-desktop`（MCP 无自动构建 API，T005 沉淀脚本） | 本地静态服务器 + Edge（`playwright-cli --browser=msedge`） | `C:\Python313\python.exe -m http.server 8123 --directory D:\dev\rougeCard\rougeCard\build\web-desktop`<br>`playwright-cli open --browser=msedge http://127.0.0.1:8123/`<br>`playwright-cli console` |
| 微信小游戏 | 编辑器 Build 面板 `wechatgame` 任务（输出 `build/wechatgame`）；AppID 占位 `wx6ac3f5090a6b99c5`（T003 产物核验）。**待修**：`game.json` 竖屏 `deviceOrientation: portrait`（Q-2 要求横屏）；`program.json` 尚未配置微信开发者工具路径。**T003 按宪法 v0.2 延后**（版号/合规成本），不计入 M0 阻塞；构建产物已生成 | 微信开发者工具导入 `build/wechatgame` + 真机点 START 验证（延后至发行阶段执行） | 构建：编辑器 Build 面板点 `wechatgame` 的 Build；导入：微信开发者工具打开 `build/wechatgame` 目录 |
| Windows | 编辑器 Build 面板 `windows` 任务（target `x64`，`nativeCodeBundleMode: wasm`，输出 `build/windows`）；MCP 无法配置构建参数（见 R-6）。**须把该任务启动场景设为 `StartMenu`（uuid `207c2746-...`），默认错配成空场景 `Placeholder`**（用户 2026-11-16 已改好） | **用入库脚本启动**：`powershell -File build\scripts\run-windows.ps1`（自动建 data 链接后启动 exe）；仅建链接不启动加 `-NoLaunch`。原理：exe 只读 exe 同级 `data`（junction → `build/windows/data`），不读 cmake `copy_resource` 的 `proj/Release/Resources`（陈旧副本，`launchScene` 仍为 Placeholder）。真实桌面点 START 验证跳转 | 编译 `cmake.exe --build build\windows\proj --config Release --parallel 8`；启动 `powershell -NoProfile -ExecutionPolicy Bypass -File build\scripts\run-windows.ps1` |

### 干净检出可重复构建流程（T005，2026-11-16）

构建任务配置由编辑器 Build 面板管理，存于 `profiles/v2/packages/builder.json`（`profiles/` 被 `.gitignore` 排除，属本机状态）；入库的 `settings/v2/packages/builder.json` 只是空壳。因此干净检出后**没有构建任务**，这就是"可重复构建"的障碍。T005 的处理：

- **配置模板入库**：`build/config/builder.json.template`（从实测三端任务导出，无本机绝对路径，场景用 `db://` URL + UUID）。含 web-desktop / wechatgame / windows 三任务。
- **恢复脚本**：`build/scripts/setup-build-config.ps1`，**关闭编辑器后**运行，把模板拷回 `profiles/v2/packages/builder.json`（自动备份原文件为 `.bak`，`-Force` 跳过确认）。实测：恢复后文件 hash 与模板一致；脚本会警告编辑器运行中可能被覆盖。
- **三端启动/服务脚本**：`run-windows.ps1`（data 链接 + 启动 exe，T004b）、`serve-web.ps1`（封装 T002 验证的 `C:\Python313\python.exe -m http.server 8123`，实测 HTTP 200）。微信端无脚本，按上表在微信开发者工具导入。
- **人工步骤不可消除**：构建本身仍须在编辑器 Build 面板点选（MCP 无法配置构建参数，R-6）；恢复配置后打开编辑器，确认三任务的启动场景为 `StartMenu`（windows 任务曾被错配为 `Placeholder`，见 T004）。真实"可重复"= 模板恢复配置 + 脚本启动验证 + Build 面板点 Build 三步。

T002 Web 构建产物实测补充（2026-11-09）：

- 产物 `src/settings.json`：`launchScene = db://assets/scenes/StartMenu.scene`、`designResolution = 1280×720 / policy 4`、`engine.debug = false`；`assets/main/config.json` 的 `scenes` 同时含 StartMenu 与 Placeholder，证明构建面板配置生效。
- 用户脚本以 SystemJS 模块打进 `assets/main/index.js`，`console.log` 在 `debug:false` 下**仍然保留**，可用作输入链路判据。
- `index.html` 把 `GameDiv` 写死为 1280×960，而设计分辨率是 1280×720、浏览器视口也是 1280×720，按钮屏幕坐标相对设计坐标有偏移且容器下半部分超出视口。`page.mouse.click` 扫描步长需 ≤24px；粗网格（128×77px）会整片漏掉按钮。实测命中点 `(592, 524)`。
- 判定场景跳转**不能只看截图**：`Placeholder` 是空场景，切换后 WebGL 不重绘，canvas 会残留 StartMenu 最后一帧。可靠判据是 `page.evaluate(async () => (await System.import('cc')).director.getScene().name)` 返回 `Placeholder`，或复点按钮不再产生 `[StartMenu] start clicked`。

## 5. 需求 → 实现映射

| 需求 | 落地模块 | 任务 |
|---|---|---|
| FR-1 | `core/` 初始状态 + `game/` 入口场景 | T102 / T106 |
| FR-2 | `GameInput` + `game/` 输入组件 | T102 / T106 |
| FR-3 | `core/advance` + `Snapshot` | T102 / T104 |
| FR-4 | `core/` 结算与冻结判定 | T104 |
| FR-5 | `Storage` 适配器 + 存档 schema | T102 / T105 / T107 |
| FR-6 | 确定性 `Clock`/`Rng` 注入 | T104 |
| FR-7 | 分层约束与静态检查 | T106 / T109 |
| FR-8 | `core/` 地图生成（seed → 六边形地图，AC-7） | T102 / T104 |
| FR-9 | `core/` 移动规则（相邻六边形、节点触发） | T102 / T104 |
| FR-10 | `core/` 能量产出与清空规则 | T102 / T104 |
| FR-11 | `core/` 出牌支付与拒绝规则 | T102 / T104 |
| FR-12 | `core/` 牌堆抽牌与弃牌洗回 | T102 / T104 |
| FR-13 | `core/` 阵亡状态与牌组保留 | T102 / T104 |
| FR-14 | `core/` 敌人意图与攻击目标 | T102 / T104 |
| FR-15 | `core/` 格挡与伤害顺序 | T102 / T104 |
| FR-16 | `core/` 休息节点复活与恢复 | T102 / T104 |
| FR-17 | `core/` 奖励候选与选牌 | T102 / T104 |

> FR-8 ~ FR-17 均为 `core/` 纯 TS 规则（Q-1 玩法设定，spec §1.1/§1.2），由 T102 定义类型、T104 实现确定性推进并补单测、T109 按 AC-7 ~ AC-14 验收。T106 只负责渲染 `Snapshot`，不承载规则。

## 6. 风险与验证项

| 编号 | 风险 | 验证时机 | 结论 |
|---|---|---|---|
| R-1 | 构建链路跑不通，架构假设不成立 | M0（T002–T004） | **通过（宪法 v0.2 口径）**：M0 阻塞判据为 Web + Windows 两端——Web 实包构建 + 浏览器运行 + 输入与场景切换通过（T002）；Windows 构建 + exe 启动 + StartMenu 显示与点击跳转通过（T004，用户真实桌面验收）。微信小游戏构建产物已生成（验证单一工程多端打包可行），真机/上架验证因版号合规延后（T003，不计入 M0 阻塞）。宪法 C-2/C-3 未被证伪 |
| R-2 | 纯 TS `core/` 与 Cocos `tsconfig` / 打包器冲突 | M0（T001）/ M1（T102/T104） | **逻辑层已验证，打包器兼容仍待 T106**：T102 写入 7 个纯 TS 类型模块、T104 实现完整推进引擎（共 10 个 core 模块，无 `cc`/平台 import），Cocos 内置 tsc `--strict` 编译 exit=0、CJS 编译后 node 可引用、16/16 单测通过 → 类型与逻辑层完全兼容 TS 工具链。但尚未参与真实 Cocos 游戏构建/打包（game/ 组件订阅 Snapshot 在 T106），打包器兼容性待 T106 接入后验证。根 `tsconfig.json` 的 `strict: false` 已改回 `true`（对齐宪法 C-1） |
| R-3 | 微信小游戏首包体积与分包策略 | M2 | `[待回填]` |
| R-4 | Windows 包与 Steamworks SDK 的集成方式 | M3 | `[待回填]` |
| R-5 | task 粒度过大，无法独立验证导致 spec 流程失效 | 全程 | 约束：单 task 估时 ≤ 半天 |
| R-6 | MCP 能否替代三端构建与预览 | M0（实测） | 构建配置仍需编辑器 UI / 命令行；**预览已通过本地改插件打通**（`preview:open-terminal` + `query-preview-url`），重启后实测 200。MCP 稳定支持场景搭建、资源刷新、静态校验、日志读取、启动预览；无 stop 能力 |

R-1 未通过时，不得进入 M1 实现任务，先修订宪法 C-2 / C-3。**本次 R-1 已通过（v0.2 口径），已解锁 M1**；微信小游戏端风险转由发行阶段处理，不在此阻塞。

## 7. 里程碑

| 里程碑 | 目标 | 任务范围 |
|---|---|---|
| M0 | Web + Windows 打通并沉淀构建脚本（宪法 v0.2；微信端 T003 延后至发行阶段） | T001–T006（含 T001b；T003 延后不计入阻塞） |
| M1 | H5 demo 可玩通一局，core 可测 | T101–T109 |
| M2 | 微信小游戏适配与真机验收 | T201–T202 |
| M3 | Windows + Steamworks 内部测试 | T301–T302 |
| M4 | 内容、打磨、上架材料 | T401 |

## 8. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-11-09 | 创建骨架，状态 Draft |
| 2026-11-09 | 回填 M0 实测：引擎版本 3.8.8、MCP 构建配置受限、R-1 部分结论、1280×720 横屏；状态仍为 Draft |
| 2026-11-09 | T001b 实测回填：预览不可用、`propertyType` 白名单与组件引用规则、`validate_scene` 空参、`attach_script` 假失败、非 ASCII 乱码；状态仍为 Draft |
| 2026-11-09 | 本地扩展 `cocos-mcp-server` 打通预览，重启编辑器后实测通过；更新 §4 与 R-6 结论；状态仍为 Draft（T002–T004 未完成） |
| 2026-11-09 | 定位并修复黑屏：MCP 新建 UI 节点 layer 为 DEFAULT 导致被相机剔除；补 layer=UI_2D 与相机标准参数后，浏览器实测画面、点击、场景切换全部通过；证据 `specs/001-core-loop/StartMenu-preview.png` |
| 2026-11-09 | T002 Web 构建产物实测回填：构建面板配置、静态服务器 + Edge 验证命令、SystemJS 读取当前场景名的判定方法；证据 `specs/001-core-loop/WebBuild-StartMenu.png`；状态仍为 Draft（T003–T006 未完成） |
| 2026-11-16 | T004 splash 根因排查：双因叠加（windows 构建任务启动场景错配空场景 Placeholder + exe 同级缺 data 资源链接），交叉对照实验确认；回填 §4 Windows 行与 tasks.md 证据表，新增 T004b 持久修复 |
| 2026-11-16 | T004 用户真实桌面验收通过，已勾选；截图 `WindowsBuild-StartMenu.png` 入库。用户已在 Build 面板把 windows 启动场景改为 StartMenu（源头已修）。T004b 查证 data 链接本质：exe 只读 `proj/Release/data`（junction → `build/windows/data`），不读 cmake `Resources`（陈旧副本 launchScene=Placeholder），删链接仅留 Resources 仍卡 splash——链接为必需条件 |
| 2026-11-16 | T004b 完成并勾选：新增入库脚本 `build/scripts/run-windows.ps1`（幂等建 data 链接 + 启动，`-NoLaunch` 只建链），实测通过；修正 `.gitignore` 使 `build/scripts/` 入库、三个产物子目录仍忽略（兑现宪法 §3）。`build-templates/`（native/wechatgame 构建模板）纳入版本控制。§4 Windows 启动命令改为该脚本 |
| 2026-11-16 | T001 完成并勾选：补齐宪法 §3 四大分层目录 `assets/core/`、`platform/{web,wx,win}/`、`resources/`（MCP 建目录 + `.meta` 入库）；引擎版本 3.8.8 双确认并回填 §1；§2 记录场景留在 `assets/scenes/` 的偏差与 M1 归位计划 |
| 2026-11-16 | T005 完成并勾选：构建任务配置模板 `build/config/builder.json.template` 入库 + `setup-build-config.ps1` 恢复脚本（解决 profiles 不入库导致干净检出无构建任务）；`serve-web.ps1`（实测 HTTP 200）；§4 回填微信行 + 干净检出可重复构建流程 |
| 2026-11-16 | T006 复盘：回填 §6 风险结论（R-1 通过、R-2 未实际验证待 M1 T102 实测）。初按三端口径保持 Draft；后应用户「版号太麻烦、提前进 M1」要求，经宪法 v0.2 变更收窄 M0 判据为 Web + Windows 两端，状态改为 **Confirmed**、T006 勾选，M1 解锁 |
| 2026-11-16 | **宪法 v0.2 变更**：微信小游戏因版号/类目/合规成本延后真机/上架验证，不计入 M0 阻塞（构建产物仍在 M0 生成）。级联更新：宪法 §1/C-7/§8、spec AC-6/§6、plan 状态与 R-1、tasks T003 转延后 / T006 收尾 |
| 2026-11-16 | T101 完成并勾选：Q-1 已确认关闭；`plan.md` §5 映射同步——补 FR-8~FR-17 共 10 条 core 规则映射、头部关联扩到 FR-1~17/AC-1~14、T109 验收范围同步 |
| 2026-11-16 | T102 完成并勾选：`assets/core/` 新增 7 个纯 TS 类型模块（GameState/GameInput/Snapshot/SaveData/契约签名），无引擎/平台 import；Cocos tsc `--strict` 检查 exit=0、CJS 编译后 node 可引用；根 `tsconfig.json` `strict:false`→`true` 对齐宪法 C-1；§6 R-2 更新为部分验证、风险降低待 T106 打包验证 |
| 2026-11-16 | T103 完成并勾选：单测框架定稿为零依赖 `node:test` + Cocos 内置 tsc 预编译（回填 §1）；新增 `build/scripts/test-core.ps1` 可重复命令与 `tests/core/init.test.ts` 首个用例（3 用例全过） |
| 2026-11-16 | T104 完成并勾选：`assets/core/` 新增 rng/map/engine 三个实现模块，落地 initGame/advance/buildSnapshot 全部 FR 规则；GameConfig 扩展 restNodes+EnemyDef；`tests/core/engine.test.ts` 13 用例覆盖 AC-7~14/FR-4/FR-16 + 判据两条；strict 编译 12 TS 通过、16/16 全过；§6 R-2 更新为逻辑层已验证、打包器待 T106 |
