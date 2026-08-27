# 审查 Brief：书籍工作区迁移完成状态与后续推进

**审查日期**：2026-08-27（第三轮）

**结论**：四本书迁移全部完成且可信，冻结期纪律执行正常。剩余工作为设计文档补三处结构说明、第四阶段（上层工作区清理）和 2026-09-10 删除窗口。本 brief 供评估后续推进顺序使用

## 已核实事实（无需重复验证）

- 四本书均有 `migration-manifest.json` + `validation.json`，`all_checks_passed: true`
  - 148431 逆天邪神：645 源文件 100% 覆盖，307 官方角色/图基线，未引用的 188.png、189.png 正确排除为历史文件，2 个 artifacts 内嵌脚本转为 active
  - 1721648 废材那又怎样：186 源文件覆盖，83 图引用全部存在，1 处有意的引用修正已留痕
  - 1836527 凰宫梦：350 源文件覆盖，179 人基线核验通过，30 个脚本三态分类（active 2 / historical 28）
  - 222767 离婚后她惊艳了世界：1167 源文件 100% 覆盖，拒绝过期 280 条基线（无效"楚锁锁-老年"阶段），确认 279 条权威基线，53 个脚本三态分类（active 4 / review 3 / historical 46），114 个敏感记录确认未被 Git 跟踪
- `npm test` 90 项全过；books/ 仅 98 个跟踪文件共 2.9M，零图片入库；active/review 脚本和迁移清单均已跟踪
- 全仓库 tracked 文件中已无任何指向旧 `artifacts/` 的活跃代码引用（残留命中均为迁移记录、清理规则和设计文档，属正常）
- active 脚本零 `artifacts/` 硬编码，均从脚本位置推导 `BOOK_ROOT`
- `scripts/check-book-cleanup-readiness.mjs` 实测运行正常：四本书源/目标 SHA-256 全对，`window_elapsed: false`，状态 `waiting_for_verification_window`
- 18 个 runs 批次全部有 `manifest.json`（148431×3、1721648×3、1836527×11、222767×1）
- 当前磁盘状态：`artifacts/` 1.6G + `books/` 1.7G 双份，符合冻结期设计，统一复核日 2026-09-10

## 待修正（轻微，建议先处理）

### F1. 设计文档目录树落后于实现

`docs/superpowers/specs/2026-08-27-book-workspace-organization-design.md` 的目标目录树缺少两个已实现的一级/二级结构

- `books/<book>/migration/`（迁移清单存放处，四本书均已使用）
- `books/<book>/scripts/review/`（离婚书已使用，3 个脚本已入 Git）

→ 在"目标目录"和"各目录职责"章节补充这两个结构的职责、命名和保留策略

### F2. `runs/*-current/` 需要受控的可变工作区约定

`books/222767-离婚后她惊艳了世界/runs/role-all-current/` 和 `runs/image-generation-current/` 均是 active 脚本使用的可变工作目录，不是历史批次

→ 已选择在设计文档和书籍 README 中将 `runs/<task>-current/` 写成正式例外，其生成内容由 Git 忽略，需要长期保留时固化为带 manifest 的日期批次，不解析或改写“最新历史批次”

### F3. readiness 工具不覆盖活跃引用检查

`check-book-cleanup-readiness.mjs` 只核对文件数量与 SHA-256，不检查是否有新任务仍在往旧路径写入

→ 已将活跃引用检查纳入 readiness 工具，扫描产品级工具、`server/`、`src/` 和 `books/*/scripts/active/`，排除已分类的历史副本和不可直接执行的 review 脚本

## 待推进

### N1. 第四阶段：上层工作区根清理

以下文件仍在 `小说分析重构-plus3-抽取L2提问/` 原位（迁入 books 的只是副本）

- 3 份提示词 md：`凰宫梦-角色形象-L2索引提示词.md`、`离婚后她惊艳了世界-角色形象-L2索引提示词.md`、`离婚后她惊艳了世界-L1索引提示词.md`
- 2 份别名 txt：`1721648-废材-角色名-别名.txt`、`1836527-凰宫梦-角色名-别名.txt`
- redraw 相关：`redraw-four-characters.jsonl`、`redraw-four-output/`、`redraw-peijian-prompt.txt`（书籍归属需先按设计文档"无法仅凭文件名确认归属的文件标记待人工确认"处理）

这些文件无 Git 安全网，删除前必须以迁移 SHA-256 清单为依据，建议与 09-10 删除窗口合并处理，不要提前单独删

### N2. 嵌套副本处置

`Novel-Analysis-plus03-L2提问/Novel-Analysis-plus03-L2-only/`（内含 artifacts/ 和 books/）尚未按设计文档 P8 对比标准处置

→ 按设计执行：比较相对路径、文件数量、总字节数、SHA-256、`book.json` 和迁移状态；完全一致或为主项目子集则列证据经人工确认后删除；含唯一文件则合并到对应书籍 `runs/` 或 `archive/`；无法确认保持原位标记 review。不得凭目录名、修改时间或肉眼抽查判定

### N3. 2026-09-10 删除窗口

对四本书分别执行：readiness 检查（包含活跃引用门禁）→ 按各书 `scripts-inventory.csv` 生成精确删除清单 → 人工确认 → 删除旧 `artifacts/<书名>/`、上层已迁移文件和清单中的根脚本原位副本。不使用预设数量作为删除依据

删除完成后需再次更新 `Agent.md`（§2 `artifacts/` 条目和冻结期描述将过期）并确认 `npm test` 通过

## 建议推进顺序（供评估）

1. 先处理 F1、F2（纯文档/约定修正，无风险）
2. 启动 N1、N2 的核对与归类（复制和清单工作现在可做，删除动作一律等 09-10）
3. 09-10 当天按 N3 流程执行删除，F3 作为删除前强制步骤

## 不要改动

以下已验证合格，保持原样

- 四本书的迁移产物结构、校验证据和 Git 跟踪范围
- 脚本三态分类结果（active/historical/review）及 review 脚本的人工复核要求
- cleanup readiness 工具、测试和配套文档
- 14 天冻结纪律与 `source_cleanup_after: 2026-09-10` 约定
