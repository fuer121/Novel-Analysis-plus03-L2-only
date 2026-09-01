# 书籍旧源清理执行记录

**执行日期**：2026-08-27

**授权**：用户明确确认提前执行删除，不再等待原定 2026-09-10 观察窗口

## 删除前门禁

- 94 个确认路径全部存在
- 四本书源目标 SHA-256 全部一致
- 活跃旧 `artifacts/` 引用为 0
- 81 个根专项脚本均有保全副本
- 脚本状态分布为 historical 74、active 原版 4、review 3

## 已删除范围

- 4 个旧书籍 `artifacts/` 目录
- 5 份上层提示词和别名文件
- `redraw-four-characters.jsonl`、`redraw-four-output/`、`redraw-peijian-prompt.txt`
- 嵌套空副本 `../Novel-Analysis-plus03-L2提问/Novel-Analysis-plus03-L2-only/`
- 81 个根书籍专项脚本

共删除 94 个精确顶层路径，执行后复核残留为 0

## 保留范围

- `books/` 中的正式工作区、迁移证据、历史归档和批次
- `data/`、`server/`、`src/`、`docs/` 和测试
- 根 `scripts/` 中 4 个产品级工具
- 外层 `../Novel-Analysis-plus03-L2提问/` 目录本身
- 迁移 manifest、源目标 SHA-256 和校验记录

## 完成状态

四本书迁移状态统一更新为 `completed_source_cleaned`

原 `source_cleanup_after: 2026-09-10` 作为历史计划字段保留，实际清理日期记录为 `source_cleaned_at: 2026-08-27`
