# Task 9 控制卡：端到端验收与项目文档收口

- 日期：2026-09-03
- 当前关卡：Task 9 已通过封板关
- 执行方式：只读前置审查后，由单一实现 subagent 完成自动化测试与文档；样板书验证由总控按门控执行
- 负责方：总控维护控制卡、裁决、真实环境验收和统一提交；subagent 承担只读审查、实现与只读双审
- 设计基线：[`docs/character-library-design.md`](../character-library-design.md)
- 实施计划：[`docs/superpowers/plans/2026-09-02-character-library.md`](../superpowers/plans/2026-09-02-character-library.md)
- 上游封板：[`docs/task-controls/2026-09-02-character-library-task-8.md`](2026-09-02-character-library-task-8.md)

## 目标

以自动化端到端测试、真实 API 读回、浏览器验收和可核验样板书记录证明角色库第一阶段链路成立，并让 README、设计基线与实施计划准确反映已完成和未完成的验证

## 本期包含

- 从章节、L1、L2 角色事实、角色库构建到状态、列表和详情读回的端到端服务测试
- 角色与阶段稳定字段、部分覆盖、事实证据、事实与设计分层断言
- `npm run verify` 与本地 API 读回
- B 方案桌面和移动端浏览器验收截图写入 `.ui-review/character-library/`
- 三本样板书的前置条件检查、已有成果复用和按分级计划执行验证
- 样板书验证证据写入各书 `runs/2026-09-02-character-library-r01/`
- README、设计基线、实施计划和控制卡收口

## 明确不包含

- Task 2 至 Task 8 已封板生产代码或契约修改
- 为通过样板书而扩展自然语言规则、Dify Schema、Prompt 或投影语义
- 角色图片、形象生成、上传、重绘和图片入口
- 批量改写历史数据、破坏性迁移或删除现有投影
- Task 10 推送、PR、自动合并和最终远端操作

## 输入契约

- Task 2 至 Task 8 已封板的投影、持久化、Dify、构建、API、路由与页面契约
- `${DATA_DIR:-data}/novel-chapters.sqlite` 中三本样板书的真实章节、L1、L2 与角色库状态
- 本地环境变量提供的 Dify 凭据和已锁定工作流版本
- 《凰宫梦》179 人正式角色基线及三本样板书现有 README、runs 和 final 证据

## 输出契约

- 自动化测试必须使用隔离临时数据库，不污染本地真实书籍数据
- 样板书验证必须记录输入范围、前置状态、实际命令或 API、结果数量、失败项、断点和读回证据
- 已有有效构建不重复执行，失败或中断保留上一版投影并记录恢复点
- 未运行、缺少前置条件或因成本与风险停止的样板验证必须明确标为未完成或 BLOCKED
- README 与设计基线只声明有文件和读回证据支持的结果

## DECISION

- DECISION: 自动化端到端服务测试是 Task 9 必须完成的封板项
- DECISION: 浏览器验收复用 Task 8 页面契约，并把截图落盘为项目证据
- DECISION: 三本样板书按小规模端到端、正式基线回归、基础角色与阶段分离的顺序执行
- DECISION: 样板运行目录使用当前日期 `2026-09-02-character-library-r01`
- DECISION: 任何真实构建前先检查现有投影、L1/L2 覆盖、失败章、Dify 配置和可恢复断点
- DECISION: 不因验收失败修改已封板业务规则，确定性产品缺陷另行分类并停止封板
- DECISION: 当前无关的书籍角色图片 Prompt 修改不属于 Task 9，不覆盖、不回滚、不暂存
- DECISION: 用户已明确授权真实样板构建，Dify 成本不作为验证阻力或停止条件
- DECISION: 真实构建前先完成 Task 9A，明确的新鲜章节空集合必须读取零条角色事实并产生零次 Dify 调用
- DECISION: Task 9A 已由 `aa8d2a8` 修复并双审封板，允许恢复隔离端到端测试与真实样板验证
- DECISION: 样板书 `12144762` 已完成 L1 190/190、L2 190/190 和首次角色库真实构建，当前投影以 `partial` 激活，包含 73 个角色、73 个阶段和 531 条事实链接
- DECISION: 首次真实构建的 8 个失败候选中，7 个由 Dify `context_json` 超过 200000 字符触发，1 个由 Dify 返回空 stages 触发；后者继续按现有契约保持失败，不伪造完整档案
- DECISION: Task 9B 只在 `callCharacterProfile` 调用前生成确定性预算输入视图，硬预算为 180000 个 JavaScript 字符，不改变 Task 2 全量事实、来源指纹、稳定 ID、投影或持久化事实
- DECISION: 预算输入保留顶层 `{ book, character, stages }`，角色仅携带身份摘要，事实仅在顶层 stages 中出现一次，并按事实指纹去重、结构化信号优先和章节轮转稳定选择
- DECISION: Dify 调用成本不作为 Task 9B 或真实样板验证的停止条件；输入预算修复双审封板后重试真实构建
- DECISION: Task 9B 已由 `1d9094a` 双审封板，预算修复后的中间重建不再出现 context 超限，随后由 Task 9C 继续闭合终态 checkpoint
- DECISION: Task 9C 前的中间结果仍有 Dify 空 stages 和已吸收 checkpoint 未闭合问题，最终状态以下方三本真实样板封板记录为准
- DECISION: Task 9C 只闭合 terminal build 中已确定被消费的分类 checkpoint，使用现有 succeeded 状态和 identity_match 审计，不新增状态、不改写历史 build
- DECISION: Task 9C 已由 `b98dd09` 和 `5c55ada` 完成终态闭合与 lineage 消歧，规格和质量审查均通过
- DECISION: 三本真实样板均完成全授权范围构建，Dify 成本未作为停止条件
- DECISION: `12144762` 当前 build `bfcfb002-a19e-4eed-b5d6-d933ad2cfcc8` 为 partial，覆盖 190/190 章，包含 76 个角色、76 个阶段和 1297 条事实链接
- DECISION: `1836527` 当前 build `daf2b655-11c4-47d3-97e7-0383fe72c9ef` 为 partial，覆盖 2242/2243 章，包含 790 个角色、801 个阶段和 21454 条事实链接
- DECISION: `222767` 当前 build `56c5f443-0c28-4a21-ae61-fe95b6ad27fc` 为 partial，覆盖 1155/3869 章，包含 590 个角色、591 个阶段和 13777 条事实链接
- DECISION: 三本当前 build 的失败 item 分别为 6、18、27，均已闭合且原因为 Dify 返回空 stages，不伪造档案
- DECISION: 《凰宫梦》790 个投影角色未达到 179 人正式基线一致性，作为数据质量 FOLLOW_UP，不阻断 Task 9 链路验收

## QUESTION

- 无，扩大既定样板范围、覆盖不可恢复数据或修改封板契约仍需由总控暂停裁决

## BLOCKER

- BLOCKER: 端到端测试暴露 Task 2 至 Task 8 的数据错误、原子激活破坏或已确认契约不一致
- BLOCKER: 三本样板书缺少必要章节、L1/L2 角色事实、Dify 凭据或稳定工作流版本
- BLOCKER: 真实构建会覆盖无法恢复的有效投影或需要破坏性数据操作
- BLOCKER: 发现其他 Agent 正在修改 `test/service.test.js`、README、设计基线、实施计划或目标 runs 目录
- BLOCKER: 需要进入 Task 10、推送、PR 或合并
- BLOCKER: Task 9B 预算输入无法稳定控制在 200000 字符以内，或需要改变 Task 2、Task 4、数据库、公开 API、稳定 ID 或最终持久化事实语义
- BLOCKER: terminal build 仍存在无法映射或未终结的 pending build item，导致进度和断点状态不可核验

## FOLLOW_UP

- FOLLOW_UP: Task 10 执行最终回归、分支检查、推送、PR 与自动合并
- FOLLOW_UP: 真实 React 组件级竞态与焦点自动化可在现有工具链具备依赖后补充
- FOLLOW_UP: 列表字段和精确来源新鲜度 API 由后续独立任务评估
- FOLLOW_UP: 治理非角色主体进入角色库、可疑别名归并和中英文性别值混用
- FOLLOW_UP: 对《凰宫梦》790 与 179 人正式基线的差距开展角色事实准入和别名质量专项评估
- FOLLOW_UP: 对 Dify 空 stages 候选提供可观测重试与模型输出质量分析

## 文件所有权

- 前置、规格和质量审查 subagent 只读
- 单一实现 subagent 独占 `test/service.test.js`、`README.md`、`docs/character-library-design.md` 和实施计划 Task 9 区域
- 总控独占 `.ui-review/character-library/` 与三本样板书 `runs/2026-09-02-character-library-r01/`
- 所有生产代码、Dify 文件、数据库 Schema、旧 runs 和无关书籍 Prompt 冻结
- Task 9A 期间仅额外开放 `server/workflows.js` 和 `test/service.test.js` 对应回归区域，封板后立即重新冻结
- Task 9B 期间由单一实现 subagent 独占 `server/workflows.js` 和 `test/service.test.js` 对应预算回归区域，总控与审查 subagent 不并行修改
- Task 9C 期间由单一实现 subagent 独占 `server/workflows.js` 和 `test/service.test.js` 对应状态闭合区域，总控与审查 subagent 不并行修改

## 审查关

- 实现前只读测试链路、真实数据前置条件、运行成本与证据格式审查
- 自动化测试和文档完成后只读规格审查
- 规格通过后只读代码质量审查
- 真实样板验证结果由总控核对文件、数量与 API 读回，不接受口头完成声明

## 升级与停止条件

- 已发生 3 次修复循环
- 已跨越 2 次用户产品裁决
- 真实样板构建成为开放式数据修复或规则调优
- 需要独立分支、worktree、长期恢复或明显超过本控制卡
- 任何样板失败要求修改 Task 2 至 Task 8 已封板范围

## 完成证据

- Task 9 聚焦端到端测试先红后绿，最终 1/1 通过
- `test/service.test.js` 120/120、`npm run verify` 156/156、lint、Vite build 和 `git diff --check` 通过
- 本地 API 返回三本样板书持久化角色数、阶段数、事实链接、覆盖和质量摘要
- `1440x900` 与 `390x844` 截图落盘并完成表格、筛选、抽屉、部分构建提示和无重叠检查
- 三本样板书均有 partial runs 证据，不虚报《凰宫梦》179 人基线或《离婚后她惊艳了世界》全书覆盖
- README、设计基线、实施计划和控制卡读回一致
- 最终规格审查 PASS：自动化测试、三本样板 manifest、实时 API 数量、失败 build 保护和 B 方案截图符合已确认范围
- 最终代码质量审查 PASS：E2E 测试隔离、资源清理、稳定 ID 复用、JSON 证据、链接和提交边界均通过检查

## 当前授权

用户已授权完成 Task 9 的真实验收、文档同步、双审、独立提交和封板，Dify 成本不作为验证阻力；Task 9 已满足封板条件，不得推送、创建 PR、合并或进入 Task 10
