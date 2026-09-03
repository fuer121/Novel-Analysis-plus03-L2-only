# Task 7 控制卡：角色库入口与全局任务通道

- 日期：2026-09-02
- 当前关卡：已封板
- 执行方式：只读前置审查后，由单一实现 subagent 执行
- 负责方：总控维护控制卡、裁决、验收和统一提交；subagent 分别承担只读审查与实现
- 设计基线：[`docs/character-library-design.md`](../character-library-design.md)
- 实施计划：[`docs/superpowers/plans/2026-09-02-character-library.md`](../superpowers/plans/2026-09-02-character-library.md)
- 上游封板：[`docs/task-controls/2026-09-02-character-library-task-6.md`](2026-09-02-character-library-task-6.md)

## 目标

让用户可以从书籍首页进入角色库路由，并让 character-library 构建任务进入现有全局任务通道，在页面切换后继续显示和跟踪

## 本期包含

- `#/book/:id/characters` 路径生成与解析
- App 中 character-library `useTaskChannel`
- 顶部任务栏和书籍任务聚合接入
- 书籍首页角色库入口卡
- 入口状态只显示角色数、阶段数和构建状态
- 路由、旅程和构建验证

## 明确不包含

- Task 8 角色库表格、详情抽屉、数据 hook 和页面样式
- 角色图片、历史快照、人工归并和回滚
- 后端 API、Task 5 构建、数据库和 Dify 修改
- 推送、PR、合并和 Task 8

## 输入契约

- Task 6 已封板的角色库 API 与 URL helper
- 现有 hash router、`useTaskChannel`、顶部 `TaskChip` 和书籍任务聚合
- 当前书籍、诊断聚合、索引组和任务状态

## 输出契约

- `paths.characters(bookId)` 生成 `/book/:id/characters`
- 路由解析结果为 `{ route: "characters", bookId, query }`
- character-library 任务在切页后保持 SSE 跟踪，并进入顶部任务栏和对应书籍聚合
- 角色库任务不得改变 L1/L2 旅程优先级
- 书籍首页入口不展示图片能力，不提前实现 Task 8 主界面

## DECISION

- DECISION: 入口位于书籍首页，与章节线索、事实索引和提问管理同级
- DECISION: 使用 Lucide `Users` 图标，文案为“角色库”
- DECISION: Task 7 只建立导航与任务通道，B 方案页面内容留给 Task 8
- DECISION: character-library task 不替代章节线索和事实索引的当前旅程判断
- DECISION: characters 路由在 Task 8 前由 App 使用现有 `page-hero` 与 `empty-state` 提供最小过渡承载，不新增页面文件或样式
- DECISION: `BOOK_SCOPED_ROUTES`、面包屑和任务类型常量必须同步支持 characters 与 character-library
- DECISION: 首页角色数、阶段数和构建状态通过既有 `characterLibraryUrl(bookId)` 读取，任务终态后重新加载
- DECISION: character-library channel 复用现有 `useTaskChannel`，顶部 TaskChip 点击进入角色库路由，并纳入书籍与工作台任务聚合
- DECISION: 导出纯 `parseHash` 供路由测试，返回当前标准形状 `{ route, bookId, query }`

## QUESTION

- 无

## BLOCKER

- BLOCKER: 若实现需要修改 Task 6 API、后端、样式或 Task 8 页面文件，立即停止

## FOLLOW_UP

- FOLLOW_UP: Task 8 实现角色库 B 方案主页面
- FOLLOW_UP: 角色库任务完成后刷新列表与详情

## 文件所有权

- 前置审查 subagent 只读
- 实现阶段单一 subagent 独占 `src/router.js`、`src/App.jsx`、`src/pages/BookHomePage.jsx`、`src/pages/WorkbenchPage.jsx`、`src/utils/breadcrumbs.js`、`src/constants/index.js` 和 `test/journey.test.js`
- 后端、Task 8 页面和样式文件冻结
- 总控不与实现 subagent 并行修改热点文件

## 审查关

- 实现前路由、任务通道和过渡页面契约审查
- 实现后只读规格审查
- 规格通过后只读代码质量审查

## 升级与停止条件

- 已发生 3 次修复循环
- 需要实现 Task 8 页面或样式
- 需要修改后端、数据库或 Task 5/6 契约
- 实际范围明显超过控制卡
- 发现其他 Agent 正在修改热点文件
- 出现无法由现有设计文件确定的产品 QUESTION

## 完成证据

- 路由与旅程测试先红后绿
- `node --test test/journey.test.js` 通过
- `npm run build`、`npm test`、`npm run lint` 和 `git diff --check` 通过
- 规格审查和代码质量审查通过
- 设计基线、实施计划和控制卡完成封板同步

## 当前授权

Task 7 已完成实现、浏览器验收与双审并封板；不得继续修改或进入 Task 8，等待用户授权

## 前置审查结果

- 状态：PASS
- 路由：新增 characters 路由和最小过渡承载，避免落入诊断页
- 任务：复用 `useTaskChannel`，加入顶部任务栏、书籍首页和工作台聚合
- 状态：通过 Task 6 角色库状态 API读取角色数、阶段数和构建状态，终态后刷新
- 配套：同步任务类型常量、面包屑和纯路由解析测试
- 边界：不修改后端、样式、Task 8 页面或 Task 5/6 契约

## 封板记录

- 状态：PASS
- 实现：新增 characters 路由、全局 character-library 任务通道、顶部任务提示、书籍与工作台任务聚合、书籍首页入口和最小过渡页
- 浏览器验收：入口状态正常，点击后到达 `#/book/1836527/characters`，面包屑为 `工作台 > 凰宫梦 > 角色库`，过渡页正常显示，控制台无应用错误
- 环境说明：验收期间发现旧后端进程占用 `5174` 并返回 SPA HTML，停止该仓库旧进程后当前后端恢复 JSON 响应，未据此修改 Task 7 代码
- 规格审查：PASS，无 BLOCKER、QUESTION 或新增 FOLLOW_UP
- 代码质量审查：PASS，Node 导入污染在一轮修复内完成收敛
- 聚焦测试：16/16
- 全仓测试：140/140
- 修复循环：1 次
- 剩余风险：SSE 恢复、任务终态刷新和无效书籍跳转缺少组件级行为测试，作为非阻断 FOLLOW_UP
