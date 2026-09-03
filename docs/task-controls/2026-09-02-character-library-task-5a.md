# Task 5A 控制卡：角色库构建契约收口

- 日期：2026-09-02
- 当前关卡：PASS，契约收口完成，等待 Task 5 实现授权
- 执行方式：两个只读 subagent 并行审查，总控汇总与裁决
- 负责方：总控维护控制卡、验收和统一提交；数据模型与构建链路 subagent 只读审查
- 上级控制卡：[`docs/task-controls/2026-09-02-character-library-task-5.md`](2026-09-02-character-library-task-5.md)
- 设计基线：[`docs/character-library-design.md`](../character-library-design.md)
- 实施计划：[`docs/superpowers/plans/2026-09-02-character-library.md`](../superpowers/plans/2026-09-02-character-library.md)

## 目标

在 Task 5 实现前锁定构建顺序、暂存恢复、增量闭包、稳定 ID、Dify 适配和完整事实读取契约，消除已识别的循环依赖与数据模型阻断

## 本期包含

- `character_library_build_items` 暂存与恢复模型的窄范围不可逆设计审查
- Task 2 与 Task 4 的无环调用顺序
- 部分构建、失败复用、重试清单和原子激活语义
- 受影响角色闭包、事实删除与跨角色别名归并语义
- 角色与阶段稳定 ID 的唯一匹配和歧义降级算法
- Dify 变量映射、API Key 和工作流版本契约
- L2 事实稳定分页接口与排序键
- 来源指纹的组成和失效条件

## 明确不包含

- 生产代码和测试修改
- Task 2、Task 3 或 Task 4 已封板业务规则的扩写
- Task 5 构建实现、Task 6 API 与前端实现
- 分布式锁、多进程执行和历史角色快照浏览

## 输入契约

- Task 2 确定性角色投影输入与输出
- Task 3 构建记录、当前投影和原子激活语义
- Task 4 Dify Schema、Prompt builder、归一化函数与工作流配置
- 当前 L1/L2 事实读取接口、排序能力和覆盖状态
- 上一版当前角色投影及其来源事实链接

## 输出契约

- 可直接用于 Task 5 实现的无环构建步骤与状态转换
- `character_library_build_items` 字段、唯一约束、状态、断点和恢复规则
- 可复现的增量闭包与稳定 ID 延续算法
- 明确的 Dify 适配、版本和失败降级契约
- 稳定分页接口、排序键和完整读取终止条件
- 已分类的 `DECISION`、`QUESTION`、`BLOCKER` 与 `FOLLOW_UP`

## DECISION

- DECISION: 允许部分构建，但单角色失败不得把已有角色从当前投影静默删除
- DECISION: 更新已有角色库时，成功角色使用新结果，失败角色沿用上一版并标记失败或过期
- DECISION: 首次构建允许激活 `partial` 投影，失败候选必须进入质量摘要和待重试清单
- DECISION: 增量构建读取上一版投影，重建受影响角色闭包，复用未受影响角色，合并完整集合后原子替换
- DECISION: 稳定 ID 采用保守延续，只有与上一版逻辑身份唯一匹配时复用，歧义时生成新 ID 并写质量警告
- DECISION: L2 事实使用稳定分页或专用范围接口完整读取，不使用任意放大的单次 `limit`
- DECISION: 来源指纹包含事实指纹、覆盖状态、Task 2 规则版本、Task 4 Schema/Prompt 版本和 Dify 工作流版本

## QUESTION

- 无未裁决 QUESTION

## BLOCKER

- BLOCKER: Task 5 实现关未获得用户批准

## FOLLOW_UP

- FOLLOW_UP: 分布式锁和多进程并发执行
- FOLLOW_UP: 历史角色快照浏览与人工回滚

## 文件所有权

- 两个设计 subagent 均只读，不得修改或提交任何共享文件
- 总控仅维护 Task 5A 控制卡、设计基线和实施计划
- Task 5 生产代码与测试继续冻结

## 审查关

- 数据模型审查：检查暂存表、状态约束、恢复边界和原子激活兼容性
- 构建链路审查：检查无环顺序、增量闭包、稳定 ID、Dify 适配和分页契约
- 总控验收：交叉核对两份结论，裁决冲突并将确定项写回正式信源

## 升级条件

- 出现无法兼容 Task 3 已封板语义的不可逆数据模型变化
- 两份审查对核心契约给出互斥结论且无法由现有设计基线裁决
- Task 5A 实际范围扩展到生产实现或 Task 6
- 达到项目协作规则规定的修复循环或产品裁决阈值

## 完成证据

- 两个只读 subagent 按统一交接格式返回结论
- 七项已确认决策全部映射为可实现契约
- 所有 BLOCKER 已解决或具有明确实现方案
- 不存在未裁决 QUESTION
- 控制卡、设计基线和实施计划一致
- 文档检查与 `git diff --check` 通过

## 当前授权

Task 5A 已封板，Task 5 实现关仍未获用户批准，不得派发实现 subagent、修改生产代码、修改测试或进入 Task 6

## 审查结论

- 状态：PASS
- 数据模型：批准新增 `character_library_build_items` 和 `character_library_builds.control_state` 的兼容迁移，暂存项不进入当前投影
- 无环流程：完整事实读取、临时候选、第一次 Task 4、Task 2、闭包与稳定 ID、第二次 Task 4、暂存、完整集合合并、Task 3 原子激活
- 增量闭包：从事实增删改扩展旧、新 confirmed alias 连通分量，歧义时升级全书重建
- 稳定 ID：只复用唯一双向匹配，拆分、合并、并列或冲突生成新 ID并告警
- Dify：复用 analysis-summary target、Key 和版本，builder 三段 JSON 组合为工作流 `context_json`
- 分页：固定 `chapter_index ASC, id ASC` 的 keyset 分页，激活前复核覆盖和来源指纹
- 剩余风险：两阶段 Dify 结果可能不一致，最终档案不得反向修改第一次调用经 Task 2 确定的身份和阶段结构
