# Task 6 控制卡：角色库 API 与任务控制

- 日期：2026-09-02
- 当前关卡：PASS，Task 6 已封板
- 执行方式：只读契约审查后，由单一实现 subagent 执行
- 负责方：总控维护控制卡、裁决、验收和统一提交；subagent 分别承担只读审查与实现
- 设计基线：[`docs/character-library-design.md`](../character-library-design.md)
- 实施计划：[`docs/superpowers/plans/2026-09-02-character-library.md`](../superpowers/plans/2026-09-02-character-library.md)
- 上游封板：[`docs/task-controls/2026-09-02-character-library-task-5.md`](2026-09-02-character-library-task-5.md)

## 目标

通过稳定、可校验的服务 API 暴露 Task 5 当前角色库投影、角色详情、构建创建、状态事件和暂停恢复取消控制，并提供前端 URL helper

## 本期包含

- 当前角色库状态查询
- 当前角色列表与单角色详情查询
- 创建角色库构建任务
- 构建状态与事件查询
- 暂停、恢复和取消控制
- 列表查询参数白名单与安全默认值
- `src/api.js` 角色库 URL helper
- API 聚焦测试和错误语义测试

## 明确不包含

- 前端页面、路由、书籍入口和任务 UI
- Task 7 及之后内容
- Task 5 构建、投影、Dify、稳定 ID 或数据库语义修改
- 新增数据库表、迁移、历史快照或回滚 API
- 推送、PR 和合并

## 输入契约

- Task 5 已封板的构建与查询函数
- 现有 Express JSON 包络、错误处理和任务事件约定
- 书籍 ID、构建 ID、角色 ID，以及白名单列表参数

## 输出契约

- 成功响应沿用项目现有 `{ ok: true, ... }` 包络
- 不存在的书籍、构建或角色使用现有统一错误响应
- 创建构建返回 `202` 和 `character-library` task
- 暂停、恢复和取消只调用 Task 5 已封板控制接口
- 查询接口只返回当前投影，不暴露历史角色快照
- URL helper 对路径参数编码并通过现有 `buildQuery` 生成查询串

## DECISION

- DECISION: API 路径使用正式计划锁定的九个端点
- DECISION: 列表参数只接受 `search`、`filter=all|multi_stage|incomplete`、`sort=name|updated|facts`
- DECISION: 非法 filter 和 sort 回退默认值，不直接进入 SQL
- DECISION: Task 6 仅暴露 Task 5 能力，不修改其状态机和持久化语义
- DECISION: character-library 的 build ID 同时作为内存 task ID，首次执行和恢复均以同一 ID 建立任务通道
- DECISION: 数据库 build 状态与进度是事实源，SSE 只提供当前进程的最新 snapshot 和后续事件，不承诺跨进程历史事件回放

## QUESTION

- 无

## BLOCKER

- 无

## FOLLOW_UP

- FOLLOW_UP: Task 7 接入前端路由、书籍入口和全局任务 UI
- FOLLOW_UP: 历史构建详情、回滚和人工重试 API

## 文件所有权

- 契约审查 subagent 只读
- 实现阶段单一 subagent 独占 `server/index.js`、`src/api.js`、`server/workflows.js` 的任务身份绑定区域和 `test/service.test.js` 的 Task 6 区域
- `server/db.js`、`server/character-library.js` 及 `server/workflows.js` 的其他 Task 5 逻辑冻结
- 总控不与实现 subagent 并行修改热点文件

## 审查关

- 实现前公开 API 契约与不可逆设计审查
- 实现后只读规格审查
- 规格通过后只读代码质量审查

## 升级与停止条件

- 已发生 3 次修复循环
- 出现第二次用户产品裁决
- 需要修改数据库、Task 5 或稳定 ID 契约
- 需要进入 Task 7、前端页面或全局任务 UI
- 实际规模明显超过控制卡
- 发现其他 Agent 正在修改热点文件

## 完成证据

- API 聚焦测试先红后绿
- `node --test test/service.test.js` 通过
- `npm test`、`npm run lint` 和 `git diff --check` 通过
- 规格审查和代码质量审查通过
- 设计基线、实施计划和控制卡完成封板同步

## 当前授权

Task 6 已封板，立即停止修改，不得推送、创建 PR、合并或进入 Task 7

## 前置契约审查结果

- 状态：BLOCKED
- 已确认：九个 API 路径无冲突，查询包络、202 task 包络、SSE 事件类型、参数白名单和 URL 编码均可复用现有约定
- 推荐方案：先创建 build，并以 build ID 作为 character-library task ID；首次执行和恢复均用同一 ID 建立当前进程任务通道
- 恢复语义：数据库 build 状态与进度为事实源，SSE 只发送重连后的 snapshot 和后续事件，不保存或回放跨进程历史事件
- 兼容边界：需要对 Task 5 工作流入口做极窄身份绑定扩展，不改变投影、build items、状态机、数据库或历史快照语义
- 备选方案：保留双 ID并让 POST 同时返回 build 与 task，events 改用 task ID；该方案增加公开资源复杂度且不利于跨进程恢复，不推荐

## 封板记录

- 最终状态：PASS
- 实际实现：九个角色库 API、列表参数白名单、URL helpers、build/task 统一 ID、跨进程恢复、数据库事实源 snapshot 和 SSE 生命周期
- 身份契约：build ID 同时作为 task ID，首次构建和恢复均保持同一标识
- SSE 契约：live task 持续订阅，终态或无内存 task 返回数据库 snapshot 后结束，不回放跨进程历史事件
- 控制语义：pause、resume、cancel 与数据库 `control_state` 一致，pause→cancel 完成 pending item 清理后才进入终态
- 规格审查：PASS
- 代码质量审查：PASS
- Task 6 聚焦测试：4/4
- `node --test test/service.test.js`：108/108
- `npm test`：136/136
- `npm run lint` 与 `git diff --check`：PASS
- 修复循环：3/3，最终双审无阻断
- 剩余风险：跨进程历史 SSE 不回放；多进程分布式创建锁继续作为 FOLLOW_UP
