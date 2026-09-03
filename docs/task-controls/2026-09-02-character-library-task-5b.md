# Task 5B 控制卡：增量语义修正

- 日期：2026-09-02
- 当前关卡：PASS，Task 5B 已封板
- 执行方式：单一实现 subagent，完成后依次只读规格审查和代码质量审查
- 负责方：总控维护控制卡、裁决、验收和统一提交；原 Task 5 实现 subagent 独占热点文件
- 上级控制卡：[`docs/task-controls/2026-09-02-character-library-task-5.md`](2026-09-02-character-library-task-5.md)

## 目标

修正 Task 5 增量构建中 alias 连通分量复用过宽失效和 partial 删除判断过度保守两项已确认语义缺口

## 本期包含

- 仅重建受事实变化或 confirmed alias 连通分量影响的角色
- 事实和 confirmed alias 均未变化的角色直接复用且 Dify 调用为零
- partial 构建按上一版角色事实章节判断删除是否可确认
- 未覆盖章节仍可能支撑的旧角色以 stale fallback 保留
- 全部来源章节均新鲜且事实已消失的旧角色确认删除
- 对应的正反聚焦测试

## 明确不包含

- 数据库结构、Task 2、Task 3 或 Task 4 契约修改
- API、路由、前端和 Task 6
- 自然语言规则、正则或表达变体
- 主构建流程重构、旧库 CHECK 迁移和分布式锁

## DECISION

- DECISION: alias 的存在本身不得使全书失去复用资格，只扩展真实受影响连通分量
- DECISION: partial 状态本身不得保留全部旧角色，必须按旧角色来源章节逐角色判断
- DECISION: Task 5B 只允许一轮实现修正、一次规格审查和一次代码质量审查

## QUESTION

- 无

## BLOCKER

- 无

## FOLLOW_UP

- 旧数据库 `control_state` CHECK 约束一致性
- 主构建流程有限拆分
- 多进程 item 领取与分布式锁

## 文件所有权

- 实现 subagent 仅可修改 `server/character-library.js`、`server/workflows.js` 和 `test/service.test.js` 中 Task 5B 相关区域
- `server/db.js` 本轮冻结，不得修改
- 总控不得与实现 subagent 并行修改热点文件
- 审查 subagent 全程只读

## 审查关

- 实现后一次只读规格审查
- 规格通过后一次只读代码质量审查
- FOLLOW_UP 不阻断本期

## 停止条件

- 需要修改数据库结构、Task 2、Task 3 或 Task 4 契约
- 需要进入 API、前端或 Task 6
- 一轮修正后仍存在当前两项阻断
- 出现新的产品语义 QUESTION
- 实际修改超出本控制卡

## 完成证据

- 含 alias 的未变化角色 Dify 零调用测试通过
- alias 变化只重建其连通分量测试通过
- 非新鲜章节支撑的旧角色保留测试通过
- 全部来源章节新鲜且事实删除的旧角色删除测试通过
- Task 5 聚焦测试、service tests、全仓测试、lint 和 `git diff --check` 通过
- 规格审查和代码质量审查通过

## 当前授权

Task 5B 已完成并停止修改，不得进入 Task 6

## 封板记录

- 实现轮次：1/1
- 规格审查：PASS
- 代码质量审查：PASS
- confirmed alias 未变化分量：两阶段 Dify 调用均为零
- alias 变化：只重建对应连通分量
- partial 非新鲜来源：旧角色以 stale fallback 保留
- partial 全部来源新鲜：事实消失的旧角色确认删除
- Task 5B 指定测试：5/5
- Task 5 聚焦测试：27/27
- service tests：104/104
- 全仓测试：132/132
- lint 与 `git diff --check`：PASS
