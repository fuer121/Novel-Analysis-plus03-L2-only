# 剑来

- 书籍 ID：`143170`
- 数据库：`../../data/novel-chapters.sqlite`
- 建书日期：2026-05-15，最近数据活动：2026-07-16

## 当前阶段

统计于 2026-09-01（以数据库为准，后续以本书 README 更新）：

- 章节已全量导入 1279/1279
- L1 路由索引全量完成 1279/1279
- L2 索引组（名称含历史命名，查询必须按 `book_id` + `index_group_key` 精确限定）：
  - `custom-index`（飞剑专项）：1279/1279 章，10768 条事实
  - `custom-index-2`（飞剑专项-注重章节事实）：1279/1279 章，9276 条事实
  - `custom-index-3`（修炼体系-武夫专项）：1278/1279 章，7117 条事实
  - `custom-index-4`（道具类）：1279/1279 章，13187 条事实
  - `custom-index-5`（神奇生物）：1269/1279 章，7418 条事实
  - `items-2`（法宝飞剑类事实）：901/901 章，52 条事实
- 累计 315 次 L2 提问（analysis_runs）

## 下一步

当前无活跃任务；再次使用前按数据与批量任务规则第 6 条核对索引新鲜度（章节 `content_hash` + 执行签名）

## 使用规则

- 索引提示词当前仅存于数据库（`book_index_prompts` / `book_index_groups` 表），未落地 `inputs/prompts/` 文件；如需长期维护，应导出为文件并回写 `books/README.md` 定稿清单
- L1 召回历史评估档案见 `docs/superpowers/evaluations/2026-08-27-jianlai-l1-recall`（历史参考）
