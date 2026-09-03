# Task 4 控制卡：角色核心档案 Dify 契约

- 日期：2026-09-02
- 当前关卡：已完成
- 设计基线：[`docs/character-library-design.md`](../character-library-design.md)
- 实施计划：[`docs/superpowers/plans/2026-09-02-character-library.md`](../superpowers/plans/2026-09-02-character-library.md)

## 目标

为角色核心档案锁定 Dify 结构化 Schema、输入 Prompt 和保守输出归一化，使 Task 5 可以依赖稳定的别名、阶段、事实层和设计层契约

## 范围

- 包含：`characterProfileSchema`、`buildCharacterProfileInputs`、`normalizeCharacterProfileOutput` 及相关契约测试
- 不包含：Dify 真实调用、工作流编排、持久化写入、稳定 ID 生成、API 和前端

## 契约

- 输入是书籍摘要、单一角色候选及其保守阶段和事实，不读取数据库
- 输出别名必须包含关系、置信度、证据和质量警告
- 输出阶段必须包含名称、类型、稳定性、稳定差异、核心档案、证据和质量警告
- 原文五官与设计五官分字段返回，设计值不得回填原文事实
- 枚举非法、证据为空、置信度非法或布尔值非法时必须采取保守降级并写入质量警告
- 文本和数组必须去空值、去重并限长，未知字段返回空字符串或空数组

## 已确认决策

- DECISION: 自然语言中的别名明确性、阶段类型与持续性由 Dify Prompt 判断，Task 2 不再扩展
- DECISION: 别名证据为空时归一为 `candidate`，阶段证据为空时归一为 `uncertain` 且 `stable_difference=false`
- DECISION: 非法别名关系降级为 `candidate`，非法阶段类型保留空值，非法阶段稳定性降级为 `uncertain`
- DECISION: 置信度限制在 0 至 1，非数值降级为 0

## 停止条件

- BLOCKER: 若实现需要修改 Task 2 投影规则、Task 3 数据模型或现有 Dify 工作流编排，必须暂停并重新审查
- BLOCKER: 若归一化会把设计推导写入原文事实字段，不得放行

## 后续清单

- FOLLOW_UP: Dify YAML 实际变量绑定和线上样例回放由 Task 5 处理
- FOLLOW_UP: Prompt 质量评估只基于已确认样板书，不通过无限长尾句式扩写当前契约

## 审查关

- 范围审查：通过
- 契约审查：通过
- 不可逆设计审查：不适用，本 Task 不修改持久化或对外 API
- 实现后规格审查：通过，未进入 Task 5 构建编排或修改已封板层
- 实现后代码质量审查：通过，保守降级、去重、限长和事实设计分层均有测试

## 完成证据

- 聚焦契约测试和 `test/service.test.js` 通过
- `npm test`、`npm run lint` 和 `git diff --check` 通过
- 实现后规格审查和代码质量审查通过

## 当前授权

Task 4 已封板，停止修改契约实现和测试，未经新授权不进入 Task 5、推送或创建 PR
