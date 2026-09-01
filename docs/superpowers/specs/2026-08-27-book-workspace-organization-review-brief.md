# 审查 Brief：《书籍工作区目录整理设计》修订任务

**修订对象**：`docs/superpowers/specs/2026-08-27-book-workspace-organization-design.md`

**审查日期**：2026-08-27

## 审查已核实的事实（无需重复验证）

- 第一阶段骨架已落地：`books/` 下四本书目录、`book.json`、`migration-manifest.template.json`、`books/.gitignore` 均已创建，且被 `test/book-workspace.test.js` 契约测试锁定（`book.json` 四字段 deepEqual + 五个一级目录）
- 当前 `npm test` 88 项全过
- `scripts/` 共 83 个脚本，78 个硬编码 `artifacts/` 路径
- `artifacts/` 总量 1.6GB
- 数据库 7 本书，4 本有文件产物，计划覆盖正确；`1721648` 的 DB 书名是"废材那又怎样"，与计划一致
- 待清理的散落文件（提示词 md、别名 txt、`redraw-four-characters.jsonl`、`redraw-four-output/` 等）实际位于上层目录 `小说分析重构-plus3-抽取L2提问/`，不在仓库根目录；仓库根目录本来就是干净的
- 上层目录存在嵌套副本 `Novel-Analysis-plus03-L2提问/Novel-Analysis-plus03-L2-only/`（内含 artifacts/ 和 books/）

## 必须修正（阻塞项）

### P1. `scripts/shared/` 与现有引用冲突

计划目标目录将产品级工具移入 `scripts/shared/`，但存在硬引用

- `package.json` 的 `"dify:manifest": "node scripts/generate-dify-workflow-manifest.mjs"`
- `test/migrate-to-plaintext.test.js:11` 的 `../scripts/migrate-to-plaintext.mjs`

移动即挂 `npm test` 与 `npm run dify:manifest`，与计划"不调整 test/"、"npm test 不受影响"的约束自相矛盾

→ 二选一并写进计划：① 产品级工具保留在 `scripts/` 根，目标目录图改为 `scripts/`（去掉 `shared/`）；② 或在迁移步骤中显式增加"更新 package.json 与 test/migrate-to-plaintext.test.js 引用"步骤

### P2. "仍在维护的专项脚本"无判定规则，验收不可执行

83 个脚本无法凭直觉区分维护状态

→ 在计划中补充判定规则（如：近 3 个任务轮次使用 / 被其他脚本 import / 列入显式维护清单），或直接附上 83 个脚本的维护/归档分类清单作为计划附录

## 需要补强

### P3. 界定"仓库根"与"上层工作区根"

计划目录图以仓库为根，但散落文件在上层工作区。需明确

- 迁移范围包含仓库外文件，这些文件无 git 安全网，校验和清单是唯一保障
- 上层 md 提示词迁入 `inputs/prompts/` 后会被 git 追踪（不在 `books/.gitignore` 忽略范围），确认是否有意
- 修正设计文档第 13 行验收条件：仓库根目录本就无散落文件，该条件已天然满足，应改为针对上层工作区根

### P4. 脚本五分类与现有动词不匹配

`finalize-`、`prepare-`、`promote-`、`apply-`、`update-`、`verify-`、`decide-`、`classify-`、`enrich-`、`export-`、`replace-`、`redraw-` 等动词无法明确归入 build/audit/generate/sync/repair

→ 补一张动词→类别映射表，或取消子分类只保留书籍级 `scripts/`

### P5. 写明磁盘双份代价

"复制→校验→原件归档 `archive/2026/migration-source/`"意味着 1.6GB artifacts 迁移后永久双份（峰值约 3.2GB）

→ 计划应显式说明，或给 migration-source 定义保留期限/清理条件

### P6. 覆盖 artifacts 内嵌脚本

`artifacts/逆天邪神角色形象/` 内有 `build_characters.py`、`generate_images.py`。计划的脚本迁移章节只覆盖 `scripts/` 顶层

→ 在 artifacts 映射章节补充内嵌脚本的归类规则

### P7. 点名更新 `Agent.md`

`Agent.md` §2 描述 `scripts/`、`artifacts/` 职责，§3 硬链接 `artifacts/逆天邪神角色形象/角色形象生成与质检SOP.md`，迁移后失效

→ 第四阶段"更新仓库说明"应明确列出 `Agent.md` 和 `README.md`

### P8. 重复项目副本的处置标准

第四阶段"确认疑似重复项目目录"需写明：确认什么（对比哪些内容）、处置选项（删除/合并/保留）及决策依据

### P9. 注明契约测试约束

计划中补充说明：`book.json` 字段与五个一级目录已被 `test/book-workspace.test.js` 锁定，调整结构必须同步修改契约测试

## 不要改动

以下设计审查通过，保持原样

- 复制优先 + SHA-256 清单 + 逐书迁移的安全策略
- `book.json` 最小元数据
- `books/.gitignore` 忽略规则
- `legacy-artifacts/` 兜底机制
- 归属不明文件标记人工确认
- 不改造历史脚本的策略
- 书籍命名以 DB 为准
- 凰宫梦作为样板书

## 完成标准

修订后的计划：两个阻塞项有明确选择和步骤；P3–P9 各有对应条款；与已落地的第一阶段产物（books/ 骨架、契约测试、`books/.gitignore`）无矛盾
