# Task 9 控制卡：端到端验收与项目文档收口

- 日期：2026-09-02
- 当前关卡：Task 9A 确定性缺陷修复关
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

## QUESTION

- 无，扩大既定样板范围、覆盖不可恢复数据或修改封板契约仍需由总控暂停裁决

## BLOCKER

- BLOCKER: 端到端测试暴露 Task 2 至 Task 8 的数据错误、原子激活破坏或已确认契约不一致
- BLOCKER: 三本样板书缺少必要章节、L1/L2 角色事实、Dify 凭据或稳定工作流版本
- BLOCKER: 真实构建会覆盖无法恢复的有效投影或需要破坏性数据操作
- BLOCKER: 发现其他 Agent 正在修改 `test/service.test.js`、README、设计基线、实施计划或目标 runs 目录
- BLOCKER: 需要进入 Task 10、推送、PR 或合并

## FOLLOW_UP

- FOLLOW_UP: Task 10 执行最终回归、分支检查、推送、PR 与自动合并
- FOLLOW_UP: 真实 React 组件级竞态与焦点自动化可在现有工具链具备依赖后补充
- FOLLOW_UP: 列表字段和精确来源新鲜度 API 由后续独立任务评估

## 文件所有权

- 前置、规格和质量审查 subagent 只读
- 单一实现 subagent 独占 `test/service.test.js`、`README.md`、`docs/character-library-design.md` 和实施计划 Task 9 区域
- 总控独占 `.ui-review/character-library/` 与三本样板书 `runs/2026-09-02-character-library-r01/`
- 所有生产代码、Dify 文件、数据库 Schema、旧 runs 和无关书籍 Prompt 冻结
- Task 9A 期间仅额外开放 `server/workflows.js` 和 `test/service.test.js` 对应回归区域，封板后立即重新冻结

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

- Task 9 聚焦端到端测试先红后绿
- `npm run verify` 和 `git diff --check` 通过
- 本地 API 返回持久化角色数、阶段数、覆盖和可读详情
- 1440x900 与 390x844 截图落盘并完成交互和无重叠检查
- 三本样板书各自有完成、部分完成或明确阻断的 runs 证据，不虚报结果
- README、设计基线、实施计划和控制卡读回一致
- 规格审查和代码质量审查通过

## 当前授权

用户已授权推进 Task 9，可在本控制卡内完成前置审查、自动化测试、真实验收、文档同步、双审、独立提交并封板；不得推送、创建 PR、合并或进入 Task 10
