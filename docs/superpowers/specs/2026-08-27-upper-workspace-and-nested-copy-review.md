# 上层工作区与嵌套副本审查

**审查日期**：2026-08-27

**范围**：N1 上层散落文件归属与 N2 嵌套项目副本处置证据

**约束**：本轮只核对、复制和留证，不删除任何旧源

**后续状态**：用户于 2026-08-27 明确授权提前清理，本文盘点的上层旧源和嵌套副本已删除，保全批次与迁移证据保留

## N1 上层散落文件

### 已纳入原迁移清单

| 旧源 | 字节 | SHA-256 | 归属 | 现有去向 | 结论 |
| --- | ---: | --- | --- | --- | --- |
| `../凰宫梦-角色形象-L2索引提示词.md` | 8550 | `cdee7fb450a4e2189a18c5c6aac10b4a31ef95e5e88d4b029262da054f29c698` | 1836527 凰宫梦 | `inputs/prompts/character-image-l2-index.md` | 等待 2026-09-10 人工删除确认 |
| `../1836527-凰宫梦-角色名-别名.txt` | 51791 | `e2738027025fb6c15ae918685f74490789942fc58eb3d33564740ecbb26b7a97` | 1836527 凰宫梦 | `inputs/character-names/aliases.txt` | 等待 2026-09-10 人工删除确认 |
| `../1721648-废材-角色名-别名.txt` | 18687 | `7db4e633e0c0052586334ad657ad89de932d9659b41f8de71a2c19f5ec515dd8` | 1721648 废材那又怎样 | `inputs/character-names/aliases.json` 及原始归档 | 等待 2026-09-10 人工删除确认 |
| `../离婚后她惊艳了世界-L1索引提示词.md` | 16947 | `094f20ce2d4a5175291e53c16680e39ed3b82815c8131af18d547598b2ce14a1` | 222767 离婚后她惊艳了世界 | `inputs/prompts/l1-index.md` | 等待 2026-09-10 人工删除确认 |
| `../离婚后她惊艳了世界-角色形象-L2索引提示词.md` | 16971 | `4f6ef5a7d2e2db31868858e2fe1c6b0884c662e39d1668208d5f9e396afae1c1` | 222767 离婚后她惊艳了世界 | `inputs/prompts/character-image-l2-index.md` | 等待 2026-09-10 人工删除确认 |

上述 5 份文件的当前 SHA-256 与各书 `migration/2026-08-27-sample/source-sha256.txt` 一致

### redraw 文件归属与保全

`redraw-four-characters.jsonl`、`redraw-four-output/` 和 `redraw-peijian-prompt.txt` 归属 **1721648 废材那又怎样**

证据：

- JSONL 与输出角色为云染、李天、裴天、元轻，独立提示词与输出另包含裴间
- 5 张最终输出图与 `books/1721648-废材那又怎样/final/characters/images/` 中同名图片 SHA-256 完全一致
- 同名正式图已被原迁移的源目标 SHA-256 清单覆盖

已复制到：

`books/1721648-废材那又怎样/runs/2026-08-27-upper-workspace-redraw-r01/`

保全结果：

| 项目 | 数值 |
| --- | --- |
| 输入文件 | 2 |
| 输出文件 | 42 |
| 总字节 | 4201154 |
| `redraw-four-characters.jsonl` SHA-256 | `9d411a8e74bfae8b2181cbe684661f56e33090607cc5b2149b475fdbbf89f714` |
| `redraw-peijian-prompt.txt` SHA-256 | `482a33667e9d2a0f44aa0cc49821febce0073a51ab52c70d117faa8839746a4d` |
| 输出目录确定性树哈希 | `dee89e192c82eaa7da63abc54655fcac5f129d39f56fa4039d04caec62901824` |

状态为 `copied_pending_source_cleanup`，上层旧源仍保持原位

## N2 嵌套副本

审查对象：

`../Novel-Analysis-plus03-L2提问/Novel-Analysis-plus03-L2-only/`

### 当前实体证据

| 指标 | 结果 |
| --- | ---: |
| 目录数 | 11 |
| 文件数 | 6 |
| 总字节 | 36888 |
| 业务文件数（排除 `.DS_Store`） | 0 |
| `.DS_Store` | 6 |
| `book.json` | 0 |
| migration manifest | 0 |
| 迁移状态 | 不存在 |

相对路径只表现为空的 `artifacts/`、`books/`、两个书籍子目录和子目录骨架，所有实际文件都是 macOS Finder 元数据

### 比较结论

- 该嵌套目录不是完整项目副本，也不是主项目的可执行子集
- 不含任何需要合并到 `runs/`、`archive/` 或 `migration/` 的唯一业务文件
- 由于没有 `book.json` 和迁移记录，不存在可与主项目比较的独立书籍状态

**建议处置**：可列入删除候选，但删除前仍需向用户列出该精确路径并获得明确确认

## 收尾门禁

2026-09-10 或之后才能进入删除流程，并且必须同时满足：

1. `npm run books:cleanup:check` 显示四本书均为 `ready_for_manual_confirmation`
2. `active legacy references` 为 0
3. redraw 保全批次的输入哈希、输出树哈希与上层旧源一致
4. 列出上层旧源、嵌套副本和根历史脚本的精确删除路径
5. 获得用户对删除范围的明确确认
