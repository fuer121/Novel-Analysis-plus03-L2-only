# 项目地图

## 1. 项目定位

本项目是本地小说分析工作台，通过 Dify 导入章节、构建 L1 路由索引和 L2 事实索引，再基于 L2 事实完成提问分析或角色形象生成

删除影响：会把 L1、L2 误当成最终分析成品，或跳过证据层直接生成结果

## 2. 代码地图

- `server/index.js`：Express API 入口和路由
- `server/workflows.js`：章节导入、L1/L2 构建和 L2 提问任务编排
- `server/db.js`：SQLite 表结构、查询和写入语义
- `server/config.js`：数据目录、端口和 Dify 配置
- `src/`：React 前端、页面、任务状态和 API 调用
- `dify-workflows/`：导入、L1、L2 和分析汇总工作流定义
- `scripts/`：产品级迁移和工作流工具，书籍专项脚本进入对应 `books/<book_id>-<book_name>/scripts/`
- `test/`：服务、契约、工作流清单和迁移测试
- `books/`：按书籍收口输入、专项脚本、执行批次、正式成果和历史归档
- `artifacts/`：旧书籍来源已于 2026-08-27 清理，该目录不再是项目数据入口

删除影响：会增加入口误判，容易在产物目录修复业务逻辑，或在前端任务中无意改变后端语义

## 3. 文档地图

- [`README.md`](README.md)：项目架构、启动方式、页面、API、迁移和验证命令
- [`docs/data-and-batch-task-rules.md`](docs/data-and-batch-task-rules.md)：SQLite、L2 数据、备份、批量任务、断点和完成状态规则
- [`docs/character-image-generation-rules.md`](docs/character-image-generation-rules.md)：跨书籍角色形象提炼、生图、JPEG 输出、质检、重绘和上传规则
- [`books/README.md`](books/README.md)：书籍工作区目录职责、批次规则和迁移要求
- [《凰宫梦》179 人正式角色基线](books/1836527-凰宫梦/final/characters/README.md)：当前样板书的正式成果入口和校验证据
- [《逆天邪神》角色形象生成与质检 SOP](books/148431-逆天邪神/inputs/prompts/角色形象生成与质检SOP.md)：单书实践记录，不作为跨书籍默认配置

删除影响：执行者会重复猜测规则，或把单书案例、历史 PNG 产物和一次性数字误当成新任务的通用标准

## 4. 真相源与安全边界

- 运行数据以 `${DATA_DIR:-data}/novel-chapters.sqlite` 为准，`DATA_DIR` 由 `server/config.js` 解析
- 数据库是明文且使用 WAL 模式，不得在无可恢复备份时删除、覆盖或批量改写
- API Key 和 Dify Key 只通过本地环境变量传入，不得写入源码、Prompt、任务清单、日志或交付产物

删除影响：可能读写错误数据库、不可逆丢失明文原文与索引，或泄露可产生费用的外部服务凭据

## 5. 验证与优先级

代码变更默认运行 `npm run verify`，只修改文档时进行读回、链接、格式和差异检查

规则冲突时按「用户当前明确指令 > `Agent.md` > `docs/` 中的稳定规则 > `README.md` > 专项 SOP > 历史脚本与产物惯例」执行

删除影响：可能放过代码回归，或让历史 PNG 脚本、旧 Prompt 和一次性产物覆盖当前稳定规则
