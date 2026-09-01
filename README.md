# 小说分析台（plus03 · L2 提问版）

独立本地 Web 服务：用自托管 Dify 分批获取小说章节原文（只获取一次），在本地章节库上构建两级索引，并基于索引事实做 GPT 提问式分析。全部内容**明文**存储在本地 SQLite。

## 核心功能

1. **章节导入** — 通过自托管 Dify 工作流分批拉取章节原文，只拉一次；重复导入自动跳过已有章节。
2. **L1 路由索引** — 章节级"导航信号"：路由实体/别名、关键词、类别分数。回答"这类分析该看哪些章节"。元数据明文，供检索路由；不是深度摘要、不是事实库。
3. **L2 事实索引** — 章节级"类型化事实库"：按索引组（如人物外貌、法宝、势力）抽取可复用事实（category/entity/fact_type/importance/confidence + fact/evidence），回答"这些章节里有哪些可召回的证据"。一本书可建多个索引组。
4. **L2 提问（l2_query）** — 唯一的分析模式：输入一个问题并选定索引组与章节范围，后端在本地 L2 事实库中打分召回（纯本地、无 LLM 调用），把召回事实交给 Dify analysis-summary 工作流汇总成回答；事实量超预算时自动分块汇总再合并，Dify 不可用时降级为本地事实摘录。

L1/L2 是**可复用的导航与证据层，不是最终分析结果**。索引新鲜度由章节 `content_hash`（sha256）+ 执行签名（`dify:<target>:<工作流版本>`）判定，章节或工作流版本变化后对应索引自动视为过期。

## 安全说明

- **所有内容明文存储**：SQLite 文件即原文。仅在可信本机/局域网使用，不要暴露公网，妥善保管 `data/` 目录。
- 章节原文会发送到你自托管 Dify 工作流配置的 LLM 服务商（导入只走 Dify 工具节点不接 LLM；L1/L2/汇总会过 LLM），请自行确认该链路的合规性。
- 本仓库是 [Novel-Analysis](https://github.com/fuer121/Novel-Analysis) 的精简重构版（加密存储、多分析模式、OpenAI 直连、多人协作重构设施均已移除；历史代码见原仓库）。

## 书籍工作区

书籍专项输入、脚本、执行批次、最终成果和历史归档统一放在 `books/<book_id>-<book_name>/`

目录职责、命名规则和迁移要求见 `books/README.md`，应用数据库仍统一保存在 `data/novel-chapters.sqlite`

旧来源清理前运行 `npm run books:cleanup:check`，只有校验窗口结束且四本书源目标 SHA-256 全部一致时，才进入人工删除确认

## 准备

```bash
cp .env.example .env
```

编辑 `.env` 填入自托管 Dify 的地址与四个工作流 API Key（章节导入、L1、L2、分析汇总）。

把 `dify-workflows/` 下 4 个工作流导入自托管 Dify 并发布为 Workflow API：

- `minimal-chapter-fetch.workflow.yml`：只返回章节原文 JSON，不接 LLM
- `l1-route-index.workflow.yml`、`l2-fact-index.workflow.yml`：索引 prompt 由后端动态传入，不在 Dify 固化
- `analysis-summary.workflow.yml`：通用 GPT 执行壳，prompt/schema/context 全部由后端传入

工作流文件哈希记录在 `dify-workflows/manifest.json`（`npm run dify:manifest` 重新生成，`npm run dify:manifest:check` 校验）。

要求 Node.js ≥ 22.5（使用内置 `node:sqlite`）。

## 启动

```bash
npm install
npm run dev
```

- 前端：`http://127.0.0.1:5173`
- 后端 API：`http://127.0.0.1:5174`

局域网访问（构建后由后端托管整个站点，仅在可信局域网/VPN 使用）：

```bash
npm run build
npm run start:lan
# http://你的局域网IP:5174
```

## 页面

- `/`：L2 提问。选择书籍、索引组和章节范围，输入问题，创建/跟踪/查看/复制/删除提问任务。
- `/library`：书籍章节库。导入章节、构建 L1/L2 索引、查看覆盖度与事实、删除本地书籍数据。
- `/prompts`：索引工作台。管理 L1/L2 索引 Prompt（全局默认 + 书籍级覆盖）与 L2 索引组。
- `/diagnostics`：运行环境、Dify 各通道配置与数据库诊断。

## API（主要）

- `POST /api/books/imports`：创建章节导入任务（`book_name` 与 `book_id` 绑定）
- `GET /api/imports/:id`、`GET /api/imports/:id/events`（SSE）
- `GET /api/books/:bookId/chapters`：章节元数据
- `POST /api/books/:bookId/l1-indexes`、`GET .../l1-indexes/coverage|chapters`
- `GET/POST/PUT/DELETE /api/books/:bookId/index-groups[/:groupKey]`：L2 索引组
- `POST /api/books/:bookId/l2-indexes`、`GET .../l2-indexes/coverage`、`GET /api/books/:bookId/l2-facts`
- `POST /api/analyses`：创建 L2 提问任务，请求体 `{ book_id, name?, query, index_group_keys, chapter_indexes? }`
- `GET /api/analyses`、`GET /api/analyses/:id`、`DELETE /api/analyses/:id`、`POST /api/analyses/:id/resume-run`、`GET /api/analyses/:id/events`（SSE）
- `GET/PUT /api/index-prompts`、`GET/PUT /api/books/:bookId/index-prompts`：L1/L2 索引 Prompt
- `GET /api/config`、`GET /api/health`、`GET /api/diagnostics`、`GET /api/dify/test?target=import|l1|l2|analysis_summary|all`

## 从旧加密版迁移数据

旧版（Novel-Analysis 加密版）的本地库可以通过一次性脚本迁移为明文库，保留章节、L1/L2 索引和 L2 提问历史，避免重新消耗 LLM 调用：

```bash
node scripts/migrate-to-plaintext.mjs --source <旧库路径> --target <新库路径> [--key-file <密钥文件>]
```

- 密钥来源优先级：`--key-file` > `NOVEL_MASTER_KEY` 环境变量 > macOS Keychain（`novel-chapter-gpt-service / master-key`）
- 只迁移 l2_query 模式的分析记录；`analysis_chapters`、`prompt_groups`、`l1_window_indexes` 不迁移
- `--target` 已存在会报错退出，防止覆盖

## 测试

```bash
npm test        # node:test 全量（service + 契约 + manifest + 迁移）
npm run lint
npm run build
npm run verify  # 以上三连
```

测试覆盖：Dify 分批与输出解析、明文落库与 content_hash、导入/二次导入跳过、L1/L2 索引与事实准入、l2_query 召回/分块/降级、迁移脚本。
