# 审查 Brief：工作区整理最终审查与收尾事项

**审查日期**：2026-08-27（第五轮，最终）

**总体结论**：压平执行正确，整理项目整体验收通过。仓库根与工作区根已合一，旧嵌套目录和空壳目录已删除，`npm test` 93 项全过，无已知数据丢失

**处置状态**：G1-G4 已于 2026-08-27 按正式修订意见完成处理

## 已核实事实（无需重复验证）

- 仓库根已压平为 `小说分析重构-plus3-抽取L2提问/`（`git rev-parse --show-toplevel` 确认），旧 `Novel-Analysis-plus03-L2-only/` 嵌套层和 `Novel-Analysis-plus03-L2提问/` 空壳已删除
- `npm test` 93 项全过；git 提交 `17ed57c docs: update flattened repository root`
- `book.json` 相对路径（`../../data/...`）压平后依然成立
- 3 份提示词定稿文件本体全部在位（路径见 G1）
- 审查启动时有 4 个既存未跟踪项：`docs/character-image-generation-rules.md`、`docs/data-and-batch-task-rules.md`、`docs/superpowers/specs/2026-08-27-book-workspace-organization-review-brief.md`、`tmp/`

## 待收尾事项（按优先级排序）

### G1. 提示词定稿入口和"回写"规则丢失（唯一信息损失，优先处理）

原工作区根 `Agent.md` 的 §3 在压平时未并入任何文档，丢失内容为 3 条提示词定稿路径和 1 条操作规则

→ 将以下内容并入 `books/README.md` 或根 `Agent.md`

- `books/1836527-凰宫梦/inputs/prompts/character-image-l2-index.md`
- `books/222767-离婚后她惊艳了世界/inputs/prompts/l1-index.md`
- `books/222767-离婚后她惊艳了世界/inputs/prompts/character-image-l2-index.md`
- 规则：提示词以书籍 `inputs/prompts/` 内 md 定稿为准；若在 `/prompts` 页面临时调整且验证有效，必须回写对应 md

### G2. 设计文档"根目录定义"两行重复

`docs/superpowers/specs/2026-08-27-book-workspace-organization-design.md` 第 16-19 行"仓库根"与"上层工作区根"现指向同一路径，压平后"上层工作区根"概念已不存在，但全文多处仍在使用该表述

→ 精简为一行根定义，文中"上层工作区根"的历史表述标注废弃或改写

### G3. `artifacts/` 空目录残留

仓库根 `artifacts/` 内只剩一个 `.DS_Store`，`Agent.md` 已声明该目录不再是数据入口

→ 删除空目录；`.gitignore` 的 `artifacts/` 条目可保留防呆或一并清理，二选一写清

### G4. 两个历史装饰性小项

- 19 个 runs 批次 manifest 仍为 `status: "copied_pending_source_cleanup"`（源已于 2026-08-27 删除）→ 批量补 `source_cleaned_at: 2026-08-27` 并更新 status，或在设计文档声明"批次 manifest 状态是迁移时快照，不随清理更新"
- `tmp/` 未加入 `.gitignore`（git status 持续显示未跟踪）→ 在 `.gitignore` 添加 `tmp/`

## 附带确认项（非缺陷）

`docs/character-image-generation-rules.md` 和 `docs/data-and-batch-task-rules.md` 被 `Agent.md` §3 列为稳定规则文档，因此已纳入本次 Git 收尾范围，避免换机克隆后规则入口失效

## 不要改动

以下已验证合格，保持原样

- 压平后的目录层级与 git 状态
- 四本书工作区结构、迁移证据、cleanup 工具与测试
- `book.json` 相对路径约定
- 93 项测试现状

## 完成标准

G1 的规则与入口可在 `books/README.md` 或根 `Agent.md` 中查到；G2-G4 各有处置；`npm test` 保持全过；处理后本项目无遗留事项

## 正式处置结果

- G1：3 份提示词定稿入口和页面调整回写规则已补入 `books/README.md`
- G2：设计文档已统一为单一仓库根，原上层工作区改为历史迁移表述
- G3：仅含 `.DS_Store` 的 `artifacts/` 已删除，`.gitignore` 保留 `artifacts/` 防呆规则
- G4：19 个 runs manifest 已更新为 `completed_source_cleaned` 并记录 `source_cleaned_at: 2026-08-27`
- `tmp/`：两个唯一《剑来》评估脚本已迁入 `docs/superpowers/evaluations/2026-08-27-jianlai-l1-recall/`，其余临时图片已清理，根 `tmp/` 已纳入忽略
- 两份被 `Agent.md` 引用的稳定规则文档已纳入本次 Git 收尾范围
