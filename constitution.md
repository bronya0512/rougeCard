# 项目宪法（Constitution）

> 项目最高约束。所有 `spec.md` / `plan.md` / `tasks.md` 与代码实现都不得违反。
> 变更须写入本文末「变更记录」，并同步更新受影响的 `plan.md`；只增补，不静默改写。

版本：v0.1（骨架）
日期：2026-11-09
项目：单机多端游戏（暂定名 Untitled，题材与玩法 [待定]）

## 1. 目标与范围

- 单机游戏，一次开发，覆盖 **H5（Web）、微信小游戏、Steam（Windows）** 三端。
- 采用 **方案 A**：H5 demo 与正式项目是同一个 Cocos 工程，Web 构建产物即 demo，**不存在"移植"阶段**。
- 本项目同时用于验证 **spec 驱动开发工作流**，因此流程产物（spec/plan/tasks）与代码同等重要，都是交付物。
- 非目标：联网、服务端、账号体系、内购、热更新、终版美术。非目标未经宪法变更不得引入。

## 2. 不可协商的技术决策

| 编号 | 决策 | 理由 |
|---|---|---|
| C-1 | Cocos Creator 3.8 LTS，仅 TypeScript | 3.x 不支持 JavaScript；LTS 便于多端长期维护 |
| C-2 | 单一工程，按构建目标出多端包 | 官方支持 Web / 微信小游戏 / Windows，避免重写两套代码 |
| C-3 | `assets/core/` 为纯 TypeScript，**禁止 import `cc` 或任何引擎/平台 API** | 玩法逻辑可单测、可复用、不被平台绑死 |
| C-4 | 一切平台差异必须经 `PlatformAdapter` | `wx.*`、Steamworks、浏览器 API 不得散落业务代码 |
| C-5 | 存档是平台无关的数据结构，由 `Storage` 适配器持久化 | 本地存档与 Steam 云存档可对齐 |
| C-6 | 每个任务必须能独立构建并验证 | spec 驱动的可验证性基础 |
| C-7 | 先做 M0 三平台打通，再写实现级 spec | 架构决策必须建立在实测构建链路上 |

## 3. 目录约定

```
assets/
  core/        纯 TS：状态模型、GameInput、Snapshot、规则、状态机、存档 schema
  platform/    PlatformAdapter 接口 + 各端实现
    web/  wx/  win/
  game/        Cocos 场景与组件：只转发输入、订阅 Snapshot 并渲染
  resources/   美术 / 音频 / 配置
specs/
  001-core-loop/   spec.md / plan.md / tasks.md（按 feature 递增编号）
build/          构建脚本；构建产物不入库
.codebuddy/rules/  项目规则，每条规则一个 <名称>/RULE.mdc 目录
constitution.md
```

依赖方向单向：`game/ → core/`、`game/ → platform/`、`platform/ → core/`。**`core/` 不依赖任何外层。**

## 4. 编码规范

- TypeScript `strict`，禁止 `any`（用 `unknown` + 类型守卫）。
- `core/` 必须是确定性逻辑：时间与随机数通过注入的 `Clock` / `Rng` 获取，不直接读 `Date.now()` / `Math.random()`，否则无法做三端一致性验证。
- `core/` 每个模块配套单元测试。
- 命名 camelCase，组件类 PascalCase，注释使用中文。
- 禁止在 `assets/core/`、`assets/game/` 出现 `wx.`、`steam`、`window.`、`document.` 等平台标识（白名单需写入 `plan.md` 并说明理由）。
- 平台能力一律通过 `PlatformAdapter` 获取，禁止运行时 `if (平台)` 分支散落业务代码。

## 5. 平台约束速查

| 项 | Web / H5 | 微信小游戏 | Windows（Steam） |
|---|---|---|---|
| Cocos 构建目标 | 发布 Web（移动/桌面） | 发布微信小游戏 | 发布 Windows 应用 |
| 存储 | `localStorage` | `wx.setStorage*` | 本地文件 + Steam Cloud |
| 输入 | 触摸 + 键鼠 | 触摸 | 键鼠为主 |
| 主要限制 | 音频自动播放策略 | 首包体积限制、分包、无 DOM/BOM、开放数据域 | 无官方"发布到 Steam"选项 |
| 上架依赖 | 静态托管 | 小游戏账号、类目与合规 | Steamworks SDK + depot 上传 |

体积上限、具体构建参数、Steamworks 集成方式均以 **M0 / M2 / M3 实测结果**为准，回填 `plan.md`，不凭记忆写死。

## 6. 完成定义（Definition of Done）

任一 task 勾选前必须全部满足：

1. 符合 §2、§3、§4 的分层与编码约束。
2. Web 构建通过且浏览器可运行。
3. 涉及平台差异时，对应端构建通过。
4. `core/` 改动有单元测试且通过。
5. `tasks.md` 勾选并记录验证证据（命令 / 结果 / 截图路径）。
6. 打一个 CodeBuddy 检查点，便于回滚。

## 7. 工作流约定

- `spec.md` 只写「做什么 + 验收标准」，不写技术方案；`plan.md` 只写「怎么做」；`tasks.md` 只写「可执行、可验证的小步骤」。
- 需求变更先改 `spec.md`，再级联更新 `plan.md` / `tasks.md`，禁止直接改代码绕过。
- 一次会话只做一条 task。
- 与宪法冲突时停下来说明，不擅自破例；确需破例走变更流程。

## 8. 变更记录

| 日期 | 版本 | 变更 | 影响 |
|---|---|---|---|
| 2026-11-09 | v0.1 | 创建骨架 | 全部 spec |
