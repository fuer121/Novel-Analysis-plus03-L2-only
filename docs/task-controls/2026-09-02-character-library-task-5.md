# Task 5 控制卡：可恢复的角色库构建任务

- 日期：2026-09-02
- 当前关卡：Task 5A 契约已收口，等待用户批准实现关
- 执行方式：subagent
- 负责方：总控维护控制卡、裁决、验收和统一提交；只读设计 subagent 负责构建链路审查
- 设计基线：[`docs/character-library-design.md`](../character-library-design.md)
- 实施计划：[`docs/superpowers/plans/2026-09-02-character-library.md`](../superpowers/plans/2026-09-02-character-library.md)
- 契约收口：[`docs/task-controls/2026-09-02-character-library-task-5a.md`](2026-09-02-character-library-task-5a.md)

## 目标

将 Task 2 确定性投影、Task 4 Dify 档案契约和 Task 3 当前投影持久化串联为可追踪、可暂停、可恢复、可取消且失败不破坏上一版结果的角色库构建任务

## 本期包含

- 计算 L1 与角色 L2 的新鲜可用交集、来源指纹、覆盖和质量摘要
- 调用 Task 2 稳定名称、强别名、阶段与事实指纹投影
- 按角色调用 Task 4 输入 builder、Dify 分析工作流和输出归一化
- 为角色和阶段生成稳定 ID，组装 Task 3 持久化输入
- 支持部分章节构建、增量更新、进度、暂停、恢复、取消、断点和失败重试
- 在新结果可原子激活前保留上一版可用投影

## 明确不包含

- 扩展 Task 2 自然语言别名或阶段规则
- 修改 Task 3 已锁定的历史快照与当前投影语义
- 扩展 Task 4 Schema 字段、Prompt 长尾规则或设计层范围
- 角色库 API、前端入口、B 方案表格与详情抽屉
- 历史快照浏览、人工回滚、人工归并和角色图片能力

## 输入契约

- 书籍 ID、角色索引组、请求章节范围和当前 Dify 执行版本
- 已完成且新鲜的 L1 章节路标和指定索引组的 L2 `category=character` 事实
- Task 2 输入所需的结构化别名与阶段信号
- Task 4 `buildCharacterProfileInputs`、`characterProfileSchema` 和 `normalizeCharacterProfileOutput`
- Task 3 构建记录、状态更新、当前投影原子替换与查询接口

## 输出契约

- 构建记录包含请求范围、实际覆盖、来源指纹、进度、断点、质量摘要和错误摘要
- 每个已处理角色有稳定角色 ID、稳定阶段 ID、核心档案、来源事实链接和质量警告
- 构建只有在候选集合组装完整后才调用 Task 3 原子激活，失败或取消不替换上一版投影
- Dify 不可用时不伪造完整档案，构建记录失败并保留上一版可用结果

## DECISION

- DECISION: Task 5 只消费 Task 2 和 Task 4 已封板契约，不从事实正文重新推断别名或阶段语义
- DECISION: 同书不允许并发未终结构建，重复请求拒绝或显式复用现有任务
- DECISION: 新构建失败、取消或 Dify 不可用时不替换上一版当前投影
- DECISION: 规格审查和代码质量审查 subagent 默认只读，由总控裁决是否阻断
- DECISION: 允许部分构建，更新时失败角色唯一匹配上一版则沿用并标记失败或过期，首次构建失败候选进入质量摘要和待重试清单
- DECISION: 增量构建读取上一版，重建受影响闭包，复用未受影响角色，合并完整集合后原子替换
- DECISION: 稳定 ID 仅在唯一双向逻辑身份匹配时复用，歧义时生成新 ID并写质量警告
- DECISION: L2 使用稳定 keyset 分页完整读取，来源指纹包含事实、覆盖、Task 2 规则、Task 4 Schema/Prompt 和 Dify 工作流版本
- DECISION: 新增 build items 暂存表和 build `control_state` 属于兼容扩展，不改变 Task 3 当前投影与原子激活语义

## QUESTION

- 无未裁决 QUESTION

## BLOCKER

- BLOCKER: Task 5 实现关尚未获得用户批准

## FOLLOW_UP

- FOLLOW_UP: 历史角色快照对比、人工回滚和跨书角色身份
- FOLLOW_UP: 更细粒度的多进程任务竞争和分布式锁

## 文件所有权

- 设计审查阶段：所有 subagent 只读，不得修改任何文件
- 实现阶段：单一实现 subagent 独占 `server/character-library.js`、`server/workflows.js`、`server/db.js` 和 `test/service.test.js` 的 Task 5 区域
- 审查阶段：规格审查和代码质量审查 subagent 只读
- 总控：只维护控制卡、裁决、验收证据与统一提交，不与实现 subagent 并行修改热点文件

## 审查关

- 范围审查：Task 5A 已完成并通过
- 契约审查：Task 5A 已完成并通过
- 不可逆设计审查：已批准 build items 暂存表和 build `control_state` 的兼容迁移
- 实现后规格审查：单独只读 subagent
- 实现后代码质量审查：单独只读 subagent

## 升级条件

- 已发生 3 轮修复循环
- 已跨越 2 次用户产品裁决
- 无法在当前 Task 内封板
- 需要独立分支或 worktree
- 开放式探索成为主体工作
- 实际范围明显超过控制卡

## 完成证据

- 只读设计 subagent 按统一交接格式返回结论
- 所有 QUESTION 已裁决并回写信源
- 所有 BLOCKER 已有明确解决方案
- 实现后目标测试、`test/service.test.js`、`npm test`、`npm run lint` 和 `git diff --check` 通过
- 实现后规格审查和代码质量审查通过

## 只读设计审查结果

- 状态：NEEDS_DECISION
- 实际完成：已核对 Task 2 至 Task 4 衔接、Task 3 原子激活、增量与断点、任务控制、Dify 变量和来源指纹依赖
- 验证：Task 2 至 Task 4 聚焦测试 14/14，`git diff --check` 通过，subagent 全程只读

BLOCKER：

- 现有 build 只持久化 build 级 JSON，角色候选和已完成档案仅留在内存，无法在进程退出后按角色恢复，需新的 staging 或 checkpoint 持久化设计并重过数据模型审查
- Task 2 需要结构化别名和阶段信号，Task 4 却在单角色候选形成后才返回同类信号，预分组、Dify 语义判定、Task 2 投影和最终档案的先后顺序尚未锁定
- Task 4 输入变量与现有 analysis-summary YAML 的 `context_json` 不直接对应，必须先锁定适配映射
- `listL2Facts` 单次最多返回 2000 条，需专用完整范围读取或分页契约
- 来源指纹材料、新鲜交集参数和受影响角色闭包尚未锁定

QUESTION：

- 角色和阶段稳定 ID 在改名、别名归并、默认阶段拆分或阶段归并时如何延续，同名不同人使用什么身份种子
- 增量构建是否必须合并未受影响的当前角色后再整体原子替换，角色消失和跨角色别名归并如何处理
- 单角色 Dify 失败时是整个 build 失败并保留旧投影，还是允许激活只含成功角色的 `partial` 投影

FOLLOW_UP：

- 分布式锁、多进程同时执行和历史角色快照保持后续范围

剩余风险：

- 工作流版本变化、事实删除和别名连通分量变化可能让受影响角色范围大于事实指纹直接差集

## Task 5A 契约收口结果

- 状态：PASS，范围、契约和窄范围不可逆设计审查完成
- 数据模型：新增 build items 暂存表与 build `control_state`，不改变单一当前投影、无历史角色快照和原子激活语义
- 构建链路：采用两阶段 Task 4 调用，Task 2 只消费第一次调用产生的结构化信号，第二次调用只生成最终档案
- 增量语义：事实增删改和 alias 连通分量形成闭包，失败角色回退上一版，完整集合一次激活
- 验证：两个 subagent 全程只读，结论已写回设计基线与正式计划
- 剩余风险：大范围事实删除或 alias 重连可保守退化为全书重建，两阶段 Dify 输出不一致时以第一次投影结构为准

## 当前授权

Task 5A 已完成，Task 5 实现关仍未获用户批准，不得派发实现 subagent、修改生产代码或进入 Task 6
