# Tasks 001：核心循环

规则：

- 一次会话只做一条 task。
- 完成判据**全部**满足才勾选，勾选时在下表「验证证据」记录命令/结果/截图路径。
- 每条 task 结束打一个检查点，便于回滚。
- 需求变更先改 `spec.md`，再级联更新 `plan.md` 与本文件，不直接改代码绕过。

状态：`[ ]` 未开始 / `[~]` 进行中 / `[x]` 完成

## M0 三平台打通（阻塞项，必须先完成）

- [ ] **T001** 创建 Cocos Creator 3.8 空工程，纳入 Git，提交初始状态
  完成判据：编辑器可打开；`assets/` 结构符合宪法 §3；记录准确版本号并回填 `plan.md` §1；构建产物已排除入库。版本号已实测为 3.8.8。
- [x] **T001b** 用 cocos-mcp-server 搭建 `StartMenu` smoke test 场景与占位场景 `Placeholder`
  完成判据：`StartMenu` 含标题 `Label` + 开始 `Button` + `StartMenu.ts`（点击跳转 `Placeholder`）；`scene_save_scene` 后出现在 `get_scene_list`；`debug_validate_scene` 无错误。**此场景是 M0 验证载体，不接 `core/`、不定义 `GameInput`、不写存档**，脚本逻辑在 T106 正式重写。文案暂用 ASCII（`ROGUE CARD` / `START`），原因见 `plan.md` §4。
- [x] **T002** Web 构建跑通并在浏览器打开
  完成判据：在编辑器构建面板手动把 `StartMenu` 设为初始场景、把 `Placeholder` 加入场景列表（MCP 无法配置，见 R-6）；同一 `StartMenu` 在浏览器显示，标题与按钮可见、可点击并跳转；控制台无报错；记录构建命令。预览可用 `project_run_project` 启动，中文文案如需调整在编辑器 UI 改 `cc.Label.string`。
- [ ] **T003** 微信小游戏构建跑通并在微信开发者工具打开
  完成判据：同一 `StartMenu` 在模拟器/真机显示且按钮可点击跳转；记录 AppID 占位方式与构建命令。
- [x] **T004** Windows 构建跑通并启动 exe
  完成判据：同一 `StartMenu` 在窗口显示且按钮可点击跳转；记录构建命令。
  排查结论（2026-11-16）：**卡 splash 根因为双因叠加**——(1) windows 构建任务 `startScene` 配成了空场景 `Placeholder`（`builder.json` task `1794222235632`，uuid `c5fa9308...`），而 Web 任务配的是 `StartMenu`（`207c2746...`）；空场景加载后一片深灰，酷似卡 splash。(2) exe 直接启动时须在 exe 同级目录有 `data` 资源链接（`build/windows/proj/Release/data` → `build/windows/data`），否则引擎读不到资源卡在 splash。对照实验（4 组）确认两因缺一不可；改用 `StartMenu` + 建链接后 `PrintWindow` 抓图可见 `ROGUE CARD`/`START` 正常渲染（证据 `WindowsBuild-StartMenu.png`）。用户 2026-11-16 在真实桌面双击 exe 验证：`ROGUE CARD`/`START` 显示正常、点击 START 跳转 Placeholder 正常、无错误。构建命令已回填 `plan.md` §4。持久化修复（避免重构建回退）转入 T004b。
- [x] **T004b** 持久化修复 Windows 资源路径（防止重新构建回退）
  背景：T004 的可用状态曾依赖两处**不入库的临时改动**（`build/`、`profiles/` 被 `.gitignore` 全忽略）——产物 `settings.json` 的 `launchScene` 改为 `StartMenu`、`proj/Release/data` junction。任何人重新 Build 或干净检出后都会退回卡 splash。
  data 链接本质（2026-11-16 查证）：exe 运行时读**exe 同级的 `build/windows/proj/Release/data`**（junction → `build/windows/data`），**不读** cmake `copy_resource` 生成的 `proj/Release/Resources`——后者是陈旧副本，其 `src/settings.json` 的 `launchScene` 仍是 `Placeholder`。删除 junction 仅留 `Resources` 时仍卡 splash，证明该链接是必需条件，`Resources` 无法替代。
  完成内容（2026-11-16）：① 用户已在编辑器 Build 面板把 windows 任务 `startScene` 正式改为 `StartMenu`（`builder.json` uuid `207c2746...`），源头配置已入库前配置（build 面板配置本身在 `profiles/`，不入库，但已在本机编辑器生效）；② 新增入库脚本 `build/scripts/run-windows.ps1`，幂等创建 data junction 后启动 exe，支持 `-NoLaunch`；③ 修正 `.gitignore`：`build/` 改为只忽略 `web-desktop/`/`wechatgame/`/`windows/` 三个产物子目录，使 `build/scripts/` 可入库（兑现宪法 §3「build/ 放构建脚本、产物不入库」）。实测：删链接后 `-NoLaunch` 自动重建、幂等复跑不报错、完整运行启动的窗口 `PrintWindow` 抓图 `ROGUE CARD`/`START` 正常。启动命令回填 `plan.md` §4。

- [ ] **T005** 沉淀 `build/` 构建脚本与三端命令文档，回填 `plan.md` §4
  完成判据：从干净检出可重复执行三端构建；注意 MCP 无法配置完整构建参数（`plan.md` §4）。
- [ ] **T006** M0 复盘：回填 `plan.md` §6 风险结论
  完成判据：`plan.md` 状态由 Draft 改为 Confirmed；R-1 未通过则先修订宪法，不进入 M1。

## M1 H5 Demo（依赖 M0 + Q-1 确认）

- [ ] **T101** 确认 Q-1（题材、核心操作、结束条件），写入 `spec.md` 并关闭该开放问题
  完成判据：`spec.md` §7 中 Q-1 标记已确认；`plan.md` §5 映射同步更新。设计分辨率已由 Q-2 单独确认，不在此重复。
- [ ] **T102** 定义 `core/` 状态模型、`GameInput`、`Snapshot`、存档 schema（纯 TS 类型）
  完成判据：无引擎/平台 import；类型可被单测直接引用。
- [ ] **T103** 接入 `core/` 单测框架并完成首个用例（初始状态）
  完成判据：测试命令可重复执行；框架选型回填 `plan.md` §1。
- [ ] **T104** 实现 `core/` 确定性推进与结算（FR-3 / FR-4），补齐单测
  完成判据：含「同一输入序列结果一致」与「结束后拒绝输入」用例；`Clock`/`Rng` 为注入依赖。
- [ ] **T105** 定义 `PlatformAdapter` 接口 + Web 实现（Storage / Input / Audio）
  完成判据：其余两端有可编译的空实现；接口签名回填 `plan.md` §3。
- [ ] **T106** 实现 Cocos 场景与组件：转发输入、订阅 `Snapshot` 渲染（FR-1 / FR-2）
  完成判据：`game/` 不直接修改 core 状态；AC-4 静态检查通过；沿用已确认的 Q-2（1280×720 横屏 fitWidth）。
- [ ] **T107** 存档读写接入 Web 实现（FR-5）
  完成判据：AC-3 通过；确认 Q-3 并回填结论。
- [ ] **T108** 产出 H5 demo：Web 构建 + 可访问地址，完成一局全流程
  完成判据：AC-2 通过；确认 Q-5。
- [ ] **T109** M1 验收：逐条核对 `spec.md` §5 的 AC-1 ~ AC-6，记录证据，打检查点
  完成判据：六条 AC 全部有证据；未通过项转为新 task 而非直接勾选。

## M2 / M3 / M4（backlog，M1 验收后再拆细）

- [ ] **T201** 微信小游戏 `PlatformAdapter` 实现 + 首包体积/分包达标
- [ ] **T202** 微信小游戏真机验证 + 三端一致性（AC-1）
- [ ] **T301** Windows `PlatformAdapter` 实现 + Steamworks SDK 接入
- [ ] **T302** depot 上传与 Steam 内部测试
- [ ] **T401** 内容填充、性能打磨、上架材料

## 验证证据记录

| Task | 完成判据核对 | 证据（命令 / 结果 / 路径） | 检查点 |
|---|---|---|---|
| M0 环境实测 | 服务连通 / 项目归属 / builder 状态 / 构建能力 | `GET /health` → `{"status":"ok","tools":157}`；`project_get_project_info` → `rougeCard @ D:\dev\rougeCard\rougeCard`，1280×720 fitWidth；`check_builder_status` → ready；`query_asset_db_ready` → ready；`get_build_settings` → 构建配置受限 | — |
| T001b | 场景资产、层级、脚本、校验 | `scene_create_scene` × 2 → `db://assets/scenes/{StartMenu,Placeholder}.scene`；层级 Canvas(Camera/TitleLabel/StartButton)；`component_get_components(StartButton)` → `cc.UITransform, cc.Label, cc.Button, 12e48TmdupHOLeksO1hRaaq`(脚本)；`cc.Label.string` → `ROGUE CARD` / `START`；`cc.Canvas.cameraComponent` 已绑定；`scene_save_scene` → success；`debug_validate_scene {}` → `valid:true, issueCount:0`；`get_console_logs` → total 0 | — |
| MCP 限制实测 | 预览 / 编码 / 参数 | 原版 `start_preview_server` → not supported；`run_project` → 仅打开构建面板；中文 `Label.string` → mojibake；`validate_scene` 带参 → 编辑器消息不存在；详见 `plan.md` §4 | — |
| 插件扩展验证 | run / 预览服务器是否可用 | 改 `cocos-mcp-server/source/tools/project-tools.ts` 并用本地 `tsc -p tsconfig.json` 重编译（EXIT=0）；重启编辑器（PID 16796 / 17:37:52，晚于 dist 17:36:26）后：`project_run_project` → `success:true, Preview started via preview:open-terminal, url=http://192.168.255.10:7456`；`start_preview_server` → 同 URL；7456 端口由编辑器主进程监听；`GET http://127.0.0.1:7456/` → 200（16457 bytes）；`stop_preview_server` → 无 stop 消息（符合预期）；console → 0 条 | — |
| T001b 画面验证 | 渲染 / 输入 / 场景切换 | 修复节点 layer 后，Playwright(msedge) 打开 `http://127.0.0.1:7456/` 截图 → `specs/001-core-loop/StartMenu-preview.png`：`ROGUE CARD` 与 `START` 正常显示，深灰背景；浏览器 console 0 error / 0 warning；扫描点击命中 START → `[LOG] [StartMenu] start clicked` → `[TIMEEND] LoadScene Placeholder: 28.89 ms`，场景切换成功 | — |
| T002 | 构建配置 / 画面 / 点击 / 跳转 / console / 构建命令 / 平台 API 静态检查 | 编辑器 Build 面板设 `web-desktop`、初始场景 `StartMenu`、场景列表含 `Placeholder` → `build/web-desktop`（17:57:58 晚于场景 17:45:57）；`src/settings.json` → `launchScene=db://assets/scenes/StartMenu.scene`、`1280×720/policy 4`；`assets/main/config.json` → `scenes` 含两场景；`C:\Python313\python.exe -m http.server 8123 --directory D:\dev\rougeCard\rougeCard\build\web-desktop` → `GET http://127.0.0.1:8123/` 200；`playwright-cli open --browser=msedge http://127.0.0.1:8123/` 截图 → `specs/001-core-loop/WebBuild-StartMenu.png`（`ROGUE CARD` 与 `START` 可见）；密集网格点击命中 `(592,524)` → `[LOG] [StartMenu] start clicked` → `[TIMEEND] LoadScene Placeholder: 28.45 ms`；`page.evaluate(async () => (await System.import('cc')).director.getScene().name)` → `Placeholder`，复点按钮无新日志；`playwright-cli console` → 3 条 / 0 error / 0 warning；`assets/**/*.ts` 静态搜索 `wx.` / `steam` / `window.` / `document.` → 0 命中；命令与实测细节见 `plan.md` §4 | — |
| 初始提交 / 检查点 | Git 纳入版本控制（T001 部分判据） | `git remote add origin https://github.com/bronya0512/rougeCard`；`git add -A` → 97 文件（`.gitignore` 已排除 `build/`、`library/`、`temp/`、`local/`、`node_modules/`，无 >1MB 文件）；`git commit` → root-commit `aeb9ed1`（37777 insertions）；`git branch -M main`；首次 `git push -u origin main` 因无 GitHub 凭据失败（`could not read Username`，SSH 亦 `Permission denied (publickey)`），用户在本地终端完成认证后推送成功；复核 `git ls-remote --heads origin` → `aeb9ed1 refs/heads/main`、`git status -sb` → `## main...origin/main`，upstream = `origin/main`，本地与远端一致。T001 仍未勾选（`assets/core/`、`assets/platform/` 分层目录尚未建立） | `aeb9ed1` |
| T003/T004 构建产物核验 | 构建任务 / 产物完整性 / 场景列表 / 运行前置 | 用户在 Build 面板用 `New Build Task` 新建两个任务并构建成功：`wechatgame` 19:04:59 success（1 min 48 s）、`windows` 19:06:46 success（1 min 46 s）；`profiles/v2/packages/builder.json` → 3 个 task（`web-desktop` / `wechatgame` / `windows`），新增 `wechatgame.json`、`windows.json`、`native.json`；`build/wechatgame/` 含 `game.js`、`game.json`、`project.config.json`、`assets/`、`cocos-js/`、`src/`，`assets/main/config.json` 的 `scenes` 含 StartMenu + Placeholder，`appid=wx6ac3f5090a6b99c5`；**待修**：`game.json` 为 `deviceOrientation: portrait` 竖屏（Q-2 要求横屏），`project.config.json` 的 `description` 中文乱码；`build/windows/` 仅 `proj/rougeCard.sln` + `.vcxproj` + `data/`，日志止于 CMake `Generating done` / `Build files have been written to`，**未做 C++ 编译、无游戏 exe**（只有 CMake 的 `CompilerIdC.exe`）；`profiles/v2/packages/program.json` 仍未配置微信开发者工具路径。T003 / T004 均未勾选：模拟器/窗口运行与按钮跳转尚未验证 | — |
| T003 暂缓 | 执行顺序调整（非需求变更） | 用户 2026-11-09 指示「微信小程序这步先跳过」：T003 保持 `[ ]`，不删除、不修改 `spec.md` 需求。按宪法 C-7 与 `spec.md` AC-6，T003 未完成前 M0 不算打通、`plan.md` 不得由 Draft 改为 Confirmed、M1 不得开始。暂缓期间先推进 T004（Windows） | — |
| T004 Windows 编译与启动 | 编译 / exe / 窗口 | 首次编译因**误启动第二条 `cmake --build`** 与编辑器原生编译并发，产生文件锁冲突：`MSB6003 ... CL.read.1.tlog 正由另一进程使用`，编辑器 make 阶段 19:17:19 失败（`Run build stage[make] ... failed`）；用 `taskkill /PID 25308 /T /F` 停掉重复链后，单条重跑 `cmake.exe --build D:\dev\rougeCard\rougeCard\build\windows\proj --config Release --parallel 8` 成功（日志 `rougeCard.vcxproj -> ...\proj\Release\rougeCard.exe`，stderr 0 字节），exe 8911872 bytes；`Start-Process` 启动 → PID 72696 / `MainWindowTitle=rougeCard` / `Responding=True`，依赖 DLL 齐全。窗口截图（816×639）显示**停在 Cocos 启动画面**，7 秒后两次截图字节数均为 17508、像素无变化；改用 `-WorkingDirectory D:\dev\rougeCard\rougeCard\build\windows`（`cocos.compile.config.json` 的 `dest` 为 `build\windows\data\assets`，该目录下还有 `assets` 符号链接）重启后仍是启动画面，未进入 StartMenu；证据 `specs/001-core-loop/WindowsBuild-splash.png`。**T004 未勾选**：窗口画面与按钮跳转均未通过，待下一轮排查（建议从构建面板 Run 启动，或重定向 exe stdout 抓 JS 加载错误） | — |
| T004 splash 根因排查 | 启动场景 / 资源路径 / 画面渲染 | 交叉对照实验（4 组，均用 `Start-Process` 启 exe + `PrintWindow` 抓窗口自身像素）：①原始（launchScene=Placeholder + 无 data 链接）→ splash；②仅建 `proj/Release/data` junction（Placeholder）→ 仍 splash；③改产物 `build/windows/data/src/settings.json` 的 `launchScene` 为 `StartMenu.scene` + data junction → `ROGUE CARD`/`START` 正常显示；④删 junction 后（StartMenu）→ 退回 splash。结论：**两因叠加**，缺一不可。源头：`builder.json` windows 任务（id `1794222235632`）`startScene=c5fa9308...`(Placeholder)，Web 任务为 `207c2746...`(StartMenu)。`PrintWindow` 证据图 `specs/001-core-loop/WindowsBuild-StartMenu.png`；splash 图 `specs/001-core-loop/WindowsBuild-splash.png`。产物临时改动（不入库）：`settings.json` 已改为 StartMenu、`proj/Release/data` junction 已建 | — |
| T004 用户验收 | 画面 / 点击跳转 / 构建命令 | 用户 2026-11-16 在真实桌面双击 `build/windows/proj/Release/rougeCard.exe`（exe 同级 data 链接存在）：`ROGUE CARD` 与 `START` 正常显示、点击 START 跳转到 Placeholder 正常、无错误。构建命令 `cmake.exe --build build\windows\proj --config Release --parallel 8` + `Start-Process ...rougeCard.exe` 已回填 `plan.md` §4。T004 三项判据（显示/跳转/构建命令）全部满足，**已勾选**。持久化修复转入 T004b | — |
| T004b 持久化脚本 | data 链接 / .gitignore / 幂等验证 | 用户 2026-11-16 在 Build 面板把 windows `startScene` 改为 StartMenu（源头）。查证 exe 只读 `proj/Release/data`、不读 cmake `Resources`（后者 launchScene 仍是 Placeholder，删链接仅留它仍卡 splash）。新增 `build/scripts/run-windows.ps1`（纯 ASCII 规避 PS5.1 中文 GBK 解析错误）：幂等建 data junction 后启动 exe，`-NoLaunch` 只建链。实测：删链后 `-NoLaunch` 自动重建→target 正确、幂等复跑提示 skip、完整运行启动 PID 61352 Responding=True、`PrintWindow` 抓图 `ROGUE CARD`/`START` 正常。修正 `.gitignore`：`build/` → 仅忽略 `web-desktop/`/`wechatgame/`/`windows/`，`build/scripts/` 可入库（`git check-ignore` 确认脚本未被忽略、产物仍被忽略）。T004b **已勾选** | — |
