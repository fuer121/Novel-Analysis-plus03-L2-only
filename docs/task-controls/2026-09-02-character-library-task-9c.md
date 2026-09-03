# Task 9C 控制卡：终态 build item 状态闭合

- 日期：2026-09-02
- 当前关卡：双审通过，待独立提交
- 执行方式：单一实现 subagent 实现，完成后依次进行只读规格审查与代码质量审查
- 负责方：总控维护范围、裁决、验收和统一提交；实现 subagent 独占热点文件；审查 subagent 只读
- 上游控制卡：[`2026-09-02-character-library-task-9.md`](2026-09-02-character-library-task-9.md)

## 目标

让 completed、partial 和 cancelled 终态构建的 build item 状态可闭合核验，避免已被最终候选消费的分类 checkpoint 永久停留在 pending，同时保留分类结果和归并审计链

## 本期包含

- 确定性建立来源分类 checkpoint 到最终候选、最终角色、失败项或复用项的消费映射
- 在原子激活前将已完整消费的分类 checkpoint 标记为 succeeded
- 写入 completed_at，并在 identity_match 记录 absorbed 及可验证的最终关联
- 无法唯一映射的 pending 阻止激活
- 终态进度满足 completed、failed 与 cancelled 数量之和等于 total
- 聚焦测试覆盖 alias 归并、fingerprint 改变后复用、partial 失败、运行中恢复和取消语义

## 明确不包含

- 新增 superseded 状态或修改数据库 Schema、CHECK、迁移和公开 API
- 删除暂存项或改写既有真实 build 记录
- 修改 Task 2、Task 4、Dify Schema/Prompt、自然语言规则、角色投影或稳定 ID 语义
- Task 10、推送、PR 或合并

## 输入契约

- 第一次 Task 4 分类成功后，以来源 candidate fingerprint 保存 pending checkpoint 和 classification_output
- 最终候选由既有分类信号、确定性投影、alias 归并、闭包和稳定身份流程产生
- 运行中的未消费 checkpoint 继续保持 pending，用于同 build 恢复

## 输出契约

- 已被最终候选或投影唯一消费的来源 checkpoint 使用现有 succeeded 状态终结
- absorbed checkpoint 保留 classification_output，写入 completed_at 和确定性 identity_match 关联
- failed item 与 quality.retry_list 一致，不把 absorbed checkpoint 放入重试清单
- terminal build 不得残留 pending 或 running item
- 无法唯一映射的 checkpoint 必须阻止激活，不得按名称猜测或静默成功
- 当前投影、角色详情、全量事实、alias 归并和稳定 ID 保持不变

## DECISION

- DECISION: 不新增 superseded 状态，避免数据库与状态机扩张
- DECISION: succeeded 同时允许表示最终档案成功和分类 checkpoint 已被最终输出消费，后者由 identity_match.absorbed 区分
- DECISION: 终结发生在完整输出组装完成且原子激活之前
- DECISION: 历史真实 build 的 5 个 pending 保留为已知审计瑕疵，不直接改写
- DECISION: Task 9C 封板前暂停 `1836527` 和 `222767` 真实样板构建

## QUESTION

- 无

## BLOCKER

- 来源 checkpoint 无法唯一映射到最终候选、复用项、失败项或最终角色
- 修复需要数据库迁移、新状态、Task 2/4 契约、Dify、API 或投影语义修改
- terminal build 仍可能留下 pending 或 running item
- 发现其他 Agent 正在修改热点文件

## FOLLOW_UP

- FOLLOW_UP: 独立重构 build item 状态机时可评估 superseded 状态
- FOLLOW_UP: 历史异常 build 只在 runs 证据中注明，不做数据回写
- FOLLOW_UP: 仅在真实性能证据出现后，考虑用事实指纹反向索引替代 checkpoint 与目标集合的乘积扫描

## 文件所有权

- 实现 subagent 独占 `server/workflows.js` 和 `test/service.test.js` 中 Task 9C 相关区域
- 总控不与实现 subagent 并行修改热点文件
- 规格和质量审查 subagent 只读
- 数据库、Task 2/4、Dify 文件、API、页面和真实数据冻结

## 审查关

- 实现完成并停止修改后进行只读规格审查
- 规格通过后进行只读代码质量审查
- 只有状态未闭合、映射不确定、恢复或取消破坏、投影变化、契约不一致或测试失败可以阻断
- 新状态与状态机重构建议一律记为 FOLLOW_UP

## 升级与停止条件

- 已发生 3 次修复循环
- 需要新数据库状态、迁移、API 或跨 Task 契约变化
- 无法用确定性映射闭合来源 checkpoint
- 实际修改超出两个热点文件和聚焦测试边界

## 完成证据

- confirmed alias 归并后 terminal build 的 pending 数为 0
- 分类信号改变 fingerprint 并复用上一版时原始 checkpoint 被终结且分类输出保留
- terminal build 的 completed、failed 与 cancelled 数量之和等于 total
- partial 的 failed 数与 retry_list 数量一致
- 运行中 pending 恢复与取消语义保持通过
- 聚焦测试、service tests、`npm run verify` 和 `git diff --check` 通过
- 规格审查与代码质量审查通过
- Task 9C 形成独立提交

## 当前授权

用户已授权推进 Task 9；允许在本控制卡内完成 Task 9C 实现、测试、双审、独立提交和后续真实样板验证，不得进入 Task 10、推送、创建 PR 或合并

## 封板记录

- 实现：激活前确定性闭合已消费的分类 checkpoint，保留 classification_output 并写入 absorbed 关联审计
- 失败保护：零映射、多映射或残留 running 阻止激活，并将未闭合 item 终结为 failed；取消路径保持 cancelled
- 实现补充：真实样板证明不同主体可能共享不含 entity 的稳定事实指纹，lineage 因此固定先校验 Task 2 confirmed identity set，再校验事实指纹子集
- 失败保护补充：零 identity、真正多 identity 或事实不一致继续阻止激活，跨主体单纯指纹碰撞不得制造伪歧义
- 测试：Task 9C 聚焦测试 8/8，`node --test test/service.test.js` 120/120，`npm run verify` 156/156
- 验证：Lint、生产构建与 `git diff --check` 通过
- 审查：最终规格审查 PASS，最终代码质量审查 PASS
- 修复循环：2 轮，未触发 3 轮复杂度暂停阈值
- BLOCKER: 无
- QUESTION: 无
