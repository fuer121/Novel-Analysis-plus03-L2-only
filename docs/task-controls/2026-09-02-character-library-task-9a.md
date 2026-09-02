# Task 9A 控制卡：空新鲜章节集合读取保护

- 日期：2026-09-02
- 当前关卡：已封板
- 执行方式：单一实现 subagent，完成后只读双审
- 负责方：总控裁决、验收和统一提交；subagent 实现与审查
- 上游控制卡：[`docs/task-controls/2026-09-02-character-library-task-9.md`](2026-09-02-character-library-task-9.md)

## 目标

当角色库构建计算出的 L1/L2 新鲜章节交集明确为空时，读取零条角色事实、产生零个候选且不调用 Dify，避免把空集合误解为未限制范围

## 本期包含

- `loadCharacterBuildSnapshot` 对明确空新鲜章节集合的短路保护
- 覆盖零事实、零候选和零 Dify 调用的聚焦回归测试
- 既有非空新鲜集合与普通范围分页回归验证

## 明确不包含

- 修改 `listCharacterL2FactsPage` 对未提供章节集合的通用范围语义
- 修改数据库 Schema、Task 2 投影规则、Task 4 Dify 契约或 Task 5 其他构建语义
- 样板书构建、文档收口、前端或 API 修改

## 输入输出契约

- 输入：`freshChapters` 是由 L1/L2 新鲜覆盖交集得到的明确章节数组
- 输出：空数组时 snapshot facts 与 candidates 均为空，来源覆盖仍保留真实 partial 状态，不发起 Dify
- 输出：非空数组继续使用稳定 keyset 分页，只读取对应章节事实

## DECISION

- DECISION: 修复位于构建快照调用层，不改变底层分页 API 中空数组代表默认范围的既有兼容语义
- DECISION: 只修确定性空集合歧义，不扩展其他覆盖、阶段、别名或自然语言规则

## QUESTION

- 无

## BLOCKER

- BLOCKER: 修复需要改变数据库查询公共契约或 Task 2 至 Task 5 已封板语义
- BLOCKER: 非空章节分页、partial 覆盖或恢复指纹发生回归
- BLOCKER: 发现其他 Agent 修改 `server/workflows.js` 或 `test/service.test.js`

## FOLLOW_UP

- FOLLOW_UP: Task 9 在本关封板后恢复端到端与三本样板书验证

## 文件所有权

- 实现 subagent 独占 `server/workflows.js` 和 `test/service.test.js` 中 Task 9A 区域
- 规格与质量审查 subagent 只读
- 其他生产代码、文档和真实数据库冻结

## 审查与停止条件

- 实现后先只读规格审查，再只读代码质量审查
- 只允许已确认数据错误、契约不一致或测试失败阻断
- 发生 2 轮修复仍未通过时暂停，不继续扩大 Task 9A

## 完成证据

- 聚焦测试证明空交集零事实、零候选、零 Dify
- 既有角色库构建测试和全仓 `npm run verify` 通过
- 双审 PASS，独立提交后立即封板

## 当前授权

Task 9A 已完成实现、验证与双审并封板；允许恢复 Task 9，不得继续扩展本修复

## 封板记录

- 状态：PASS
- 实现：明确空新鲜章节交集时短路角色事实分页，保持零事实、零候选和零 Dify 调用
- 范围：仅修改构建快照调用层，底层分页公共语义、数据库和 Task 2 至 Task 5 契约不变
- 聚焦回归：1/1
- service tests：109/109
- 规格审查：PASS
- 代码质量审查：PASS
- 剩余风险：已有当前投影且全部章节不新鲜的显式保留测试可作为后续增强，不阻断 Task 9
