# Task 9B 控制卡：Dify 角色档案输入预算修复

- 日期：2026-09-02
- 当前关卡：双审通过，待独立提交
- 执行方式：单一实现 subagent 实现，完成后依次进行只读规格审查与代码质量审查
- 负责方：总控维护范围、裁决、验收和统一提交；实现 subagent 独占热点文件；审查 subagent 只读
- 上游控制卡：[`2026-09-02-character-library-task-9.md`](2026-09-02-character-library-task-9.md)

## 目标

将两阶段角色档案 Dify 调用的 `context_json` 稳定控制在服务限制以内，消除结构重复与存储元数据膨胀，同时保持全量事实投影、证据追溯、来源指纹和稳定身份语义不变

## 本期包含

- 在 `callCharacterProfile` 调用前生成确定性预算输入视图
- 顶层 `{ book, character, stages }` 契约保持不变
- `character` 仅发送身份摘要，不携带完整 facts 或重复的阶段 facts
- 事实仅在顶层 `stages[].facts` 中出现一次，并按 `characterFactFingerprint` 去重
- 只保留 Task 4 判断需要的语义字段，删除输入视图中的存储与构建元数据
- 结构化 alias 和 stage 信号优先，剩余事实按稳定章节轮转选取
- 两阶段输入硬预算为 180000 个 JavaScript 字符
- 聚焦测试覆盖预算、去重、输入乱序稳定性、信号优先、章节覆盖和全量事实持久化

## 明确不包含

- 修改 Task 2 投影规则、事实集合、事实指纹或闭包语义
- 修改 Task 4 Schema、Prompt、输出校验或空 stages 失败语义
- 修改数据库结构、公开 API、页面、稳定角色或阶段 ID
- 删除、裁剪或替换最终持久化的全量事实与证据
- 摘要生成、分块合并、新工作流或其他开放式语义增强
- Task 10、推送、PR 或合并

## 输入契约

- 输入为 Task 2 已生成的完整角色候选、完整阶段候选与全量角色事实
- 每条事实使用 `characterFactFingerprint` 形成稳定去重键
- Dify 两阶段继续接收 JSON 字符串形式的 `context_json`

## 输出契约

- 每次发送的 `context_json.length` 不超过 180000
- 相同语义事实集合不受输入数组顺序影响，产生相同预算视图
- 发送事实的 fingerprint 唯一且为原始事实集合子集
- 每条入选事实至少保留一条非空原文 evidence
- 预算视图不得参与来源指纹、稳定 ID、闭包、投影或数据库持久化
- 构建成功后仍持久化全部去重来源事实，而不是仅持久化发送给 Dify 的子集

## DECISION

- DECISION: 180000 字符是两阶段调用的统一硬预算，为 Dify 200000 字符限制保留安全余量
- DECISION: 角色身份摘要与阶段元数据先计入固定开销，事实按最终 `JSON.stringify` 长度逐条纳入
- DECISION: 事实语义字段限于 fingerprint、chapter_index、entity、aliases、fact_type、fact、evidence、alias_relation、alias_confidence、stage_hint、stage_type、stage_stability 和 stable_difference
- DECISION: 不发送 source_hash、prompt_hash、model、schema_version、时间戳、数据库状态、review 字段及其他存储元数据
- DECISION: 事实先保留结构化 alias 与 stage 信号，再按章节轮转选择；章内使用固定事实类型优先级和 fingerprint 排序
- DECISION: 单条事实若无法在剩余预算内完整纳入则跳过，不截断事实或证据文本
- DECISION: Dify 成本可忽略，不作为真实重试和后续样板验证的阻力

## QUESTION

- 无

## BLOCKER

- BLOCKER: 需要修改 Task 2 或 Task 4 已封板契约
- BLOCKER: 需要裁剪最终投影或数据库中的全量事实与证据
- BLOCKER: 需要数据库迁移、公开 API、页面、摘要或分块工作流
- BLOCKER: 预算化后任一阶段输入仍可能超过 200000 字符
- BLOCKER: 发现其他 Agent 正在修改热点文件

## FOLLOW_UP

- FOLLOW_UP: 后续可增加预算命中率、发送事实数和省略事实数观测指标
- FOLLOW_UP: 连续返回空 stages 的候选可增加独立质量分类，不阻断本次输入预算修复
- FOLLOW_UP: 逐条完整序列化可在出现实际性能问题后改为增量长度计算
- FOLLOW_UP: 多阶段候选中未归属具体阶段的顶层事实表达语义留待独立设计

## 文件所有权

- 实现 subagent 独占 `server/workflows.js` 和 `test/service.test.js` 中 Task 9B 相关区域
- 总控不与实现 subagent 并行修改热点文件
- 规格和代码质量审查 subagent 只读，不修改、提交或派发任务
- 其他生产代码、数据库 Schema、Dify 文件、公开 API、页面与真实 runs 目录冻结

## 审查关

- 实现完成并停止修改后进行一次只读规格审查
- 规格问题由总控分类处理，通过后再进行一次只读代码质量审查
- 只有数据错误、确定性错误、预算越界、全量事实丢失、契约不一致或测试失败可以阻断
- 新功能建议与长尾输入标记为 FOLLOW_UP，不得扩写 Task 9B

## 升级与停止条件

- 已发生 3 次修复循环
- 需要改变 Task 2、Task 4、数据库、API、稳定身份或持久化语义
- 修复扩展为摘要、分块合并、新工作流或开放式语义探索
- 实际规模明显超过两个热点文件和控制卡测试边界

## 完成证据

- 大于 200000 字符且含重复事实的候选回归测试先红后绿
- 两阶段 Dify 输入均不超过 180000 字符
- 输入乱序产生相同预算视图
- 结构化信号优先和章节轮转通过测试
- 构建后全量去重事实仍被持久化
- 聚焦测试、`node --test test/service.test.js`、`npm run verify` 和 `git diff --check` 通过
- 规格审查和代码质量审查通过
- Task 9B 形成独立提交

## 当前授权

用户已授权推进 Task 9，并明确 Dify 成本可忽略；允许在本控制卡内完成 Task 9B 实现、测试、双审、独立提交和真实样板重试，不得进入 Task 10、推送、创建 PR 或合并

## 封板记录

- 实现：两阶段 Dify 输入采用 180000 字符硬预算，消除重复事实与存储元数据，保留结构化信号和章节代表事实
- 失败保护：固定元数据超限或原候选事实全部无法纳入预算时，在调用 Dify 前失败并沿用上一版投影
- 测试：Task 9B 聚焦测试 4/4，`node --test test/service.test.js` 114/114，`npm run verify` 150/150
- 验证：Lint、生产构建与 `git diff --check` 通过
- 审查：最终规格审查 PASS，最终代码质量审查 PASS
- BLOCKER: 无
- QUESTION: 无
