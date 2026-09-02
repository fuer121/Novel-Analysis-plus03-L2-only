# Task 8 控制卡：角色库全宽表格与详情抽屉

- 日期：2026-09-02
- 当前关卡：已封板
- 执行方式：只读前置审查后，由单一实现 subagent 执行
- 负责方：总控维护控制卡、裁决、验收和统一提交；subagent 分别承担只读审查、实现与只读双审
- 设计基线：[`docs/character-library-design.md`](../character-library-design.md)
- 实施计划：[`docs/superpowers/plans/2026-09-02-character-library.md`](../superpowers/plans/2026-09-02-character-library.md)
- 上游封板：[`docs/task-controls/2026-09-02-character-library-task-7.md`](2026-09-02-character-library-task-7.md)

## 目标

在既有角色库路由中实现 B 方案全宽高密度角色表格与右侧详情抽屉，让用户能够识别角色库状态、搜索筛选角色并查看分阶段核心档案与外形证据

## 本期包含

- `useCharacterLibraryData(bookId)` 页面数据 hook
- 页面头部、构建与覆盖摘要、更新角色库和前往事实索引操作
- 全宽角色表格、搜索、筛选、排序和键盘选中
- 右侧详情抽屉、阶段切换、证据展开和 Escape 关闭
- 设计基线 12.5 的页面状态与明确下一步入口
- 桌面、窄屏和移动端响应式布局
- 聚焦测试、构建、全仓验证、浏览器截图与交互验收

## 明确不包含

- 角色图片、形象生成、重绘、上传或图片入口
- 后端、数据库、Dify、Task 2 至 Task 7 已封板契约修改
- 人工归并、历史快照、回滚和跨书角色库
- Task 9 端到端数据链路测试与 README 收口
- 推送、PR、合并和 Task 9

## 输入契约

- Task 6 已封板的角色库状态、列表、详情和构建 API
- Task 7 已封板的 characters 路由与全局 character-library 任务通道
- 设计基线 12.2 至 12.5 的字段、状态与交互要求
- 现有页面布局、按钮、表单、任务状态和响应式设计语言

## 输出契约

- 角色列表只展示 Task 6 返回的当前投影，不在前端推导新的角色事实
- 搜索、筛选、排序通过既有 API 契约执行，搜索请求延迟 250ms
- 角色详情与列表独立加载，切换角色时抽屉保持打开并更新内容
- 更新操作复用 Task 7 全局任务通道，终态后刷新状态、列表与当前详情
- 原文五官与设计五官分层展示，设计内容必须带“设计推导”标记
- 所有空态、前置不足、构建中、部分可用、需更新和错误状态均提供明确反馈或下一步入口

## DECISION

- DECISION: 采用已确认 B 方案，全宽表格加右侧详情抽屉
- DECISION: 桌面抽屉宽度使用 `clamp(560px, 42vw, 640px)`，窄屏覆盖主体，移动端宽度为 `100vw`
- DECISION: 表格在移动端保持横向滚动，不改成卡片列表
- DECISION: 使用现有组件和样式令牌，不引入新 UI 框架或重做全局视觉系统
- DECISION: Task 8 只消费现有 API，不改变后端状态、构建或投影语义
- DECISION: 角色图片入口属于未来范围，本期不展示占位入口
- DECISION: 列表 API 未提供的年龄、身份或职业和外形事实数统一显示 `-`，不逐行请求详情，不把总事实数冒充外形事实数
- DECISION: 深链接使用 `#/book/:id/characters?character_id=:characterId`，选中角色同步参数，关闭抽屉移除参数，目标角色 404 时保留列表并显示角色已不存在
- DECISION: 当前 API 不能可靠比较角色库与最新事实来源指纹，本期不宣称精确“需更新”；L2 来源存在失败、缺失、过期或空章时提示来源不完整，其余状态显示构建时间和可更新操作
- DECISION: 更新角色库显式提交整书 `start_chapter`、`end_chapter` 和 `index_group_key=characters`

## QUESTION

- 无

## BLOCKER

- BLOCKER: 需要修改 Task 6 API、数据库、Dify 或 Task 5 构建语义
- BLOCKER: 既有 API 无法表达设计基线要求且不存在保守降级展示
- BLOCKER: 发现其他 Agent 正在修改 Task 8 热点文件
- BLOCKER: 浏览器验收出现文本、控件重叠或无法完成表格与抽屉核心交互

## FOLLOW_UP

- FOLLOW_UP: Task 9 增加完整数据链路测试、README 与样板书验收收口
- FOLLOW_UP: 角色图片与形象生成入口由后续独立任务评估
- FOLLOW_UP: 列表 API 可补充年龄、身份或职业、阶段摘要和 `appearance_fact_count`，替换本期保守空值
- FOLLOW_UP: 状态 API 可补充与最新 L1/L2 来源指纹的精确新鲜度比较，支持可靠“需更新”判定

## 文件所有权

- 前置、规格和质量审查 subagent 只读
- 实现阶段单一 subagent 独占 `src/hooks/useCharacterLibraryData.js`、`src/pages/CharacterLibraryPage.jsx`、`src/styles/pages/character-library.css`、`src/styles.css`、`src/App.jsx` 和 Task 8 聚焦测试区域
- 总控不与实现 subagent 并行修改热点文件
- 后端、数据库、Dify 与 Task 2 至 Task 7 文件冻结

## 审查关

- 实现前只读 API 映射、页面状态、交互和响应式设计审查
- 实现后只读规格审查
- 规格通过后只读代码质量审查
- 双审不得扩展后端契约、图片能力或 Task 9 范围

## 升级与停止条件

- 已发生 3 次修复循环
- 已跨越 2 次用户产品裁决
- 实际范围明显超过控制卡或无法在当前 Task 封板
- 需要独立分支、worktree、长期探索或修改封板契约
- 出现不能由设计基线和现有 API 唯一裁决的产品 QUESTION

## 完成证据

- Task 8 聚焦测试通过
- `npm run verify` 和 `git diff --check` 通过
- 桌面、900px 以下和640px 以下浏览器截图与交互验收通过
- 表格搜索、筛选、排序、行选择、阶段切换、证据展开、Escape 关闭和更新任务衔接通过
- 规格审查和代码质量审查通过
- 设计基线、实施计划和控制卡完成封板同步

## 当前授权

Task 8 已完成实现、双审、浏览器验收与独立提交并封板；不得继续修改或进入 Task 9，等待用户授权

## 封板记录

- 状态：PASS
- 实现：页面数据 hook、状态摘要、全宽角色表格、搜索筛选排序、右侧详情抽屉、阶段切换、事实证据、深链接、全局构建任务衔接和响应式布局
- 规格审查：首轮发现 3 项已确认规格缺口，完成窄修复后复审 PASS
- 代码质量审查：首轮发现 2 项明显缺陷，完成窄修复后复审 PASS
- 修复循环：2 次，未触发复杂度哨兵
- 聚焦测试：20/20
- 全仓测试：144/144
- 浏览器验收：真实空态通过；临时只读 mock 数据下表格、搜索空态、深链接、阶段切换、抽屉、Escape 与焦点约束通过
- 响应式验收：1440px 桌面保留表格上下文，820px 抽屉覆盖主体并约束焦点，390px 抽屉为 `100vw`，无整页横向溢出或可见文本溢出
- 验收环境：mock API 仅在临时本地端口运行，验收后已停止，未写数据库或项目文件
- 剩余风险：年龄、身份或职业和外形事实数等待列表 API 增强；精确新鲜度等待来源指纹 API；真实组件级竞态与焦点自动化测试留给 Task 9
