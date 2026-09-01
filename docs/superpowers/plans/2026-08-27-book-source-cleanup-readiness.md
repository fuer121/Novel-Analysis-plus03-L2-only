# Book Source Cleanup Readiness

## 当前状态

四本书均已完成旧源清理，状态为 `completed_source_cleaned`

原定统一复核日期为 `2026-09-10`，用户于 `2026-08-27` 明确授权提前删除，实际清理记录见 `docs/superpowers/specs/2026-08-27-book-source-cleanup-execution.md`

## 复核命令

```bash
npm run books:cleanup:check
```

命令逐项读取每本书的 `source-sha256.txt` 和 `target-sha256.txt`，验证文件是否存在及 SHA-256 是否一致，同时检查产品级工具、`server/`、`src/` 和 `books/*/scripts/active/` 是否仍引用旧 `artifacts/` 路径

当前预期状态为 `source_cleanup_completed`

删除后必须持续满足：四本书全部显示 `source_cleanup_completed`，`active legacy references` 为 0，目标 SHA-256 全部一致

## 待清理来源

- `artifacts/凰宫梦角色形象/` 及其已迁移的上层输入
- `artifacts/废材又怎么样照样吊打你角色形象/` 及 `../1721648-废材-角色名-别名.txt`
- `artifacts/逆天邪神角色形象/`
- `artifacts/离婚后她惊艳了世界角色形象/`、两份上层索引提示词及已归档的书籍专项脚本

## 人工确认后步骤

1. 保存 `books:cleanup:check -- --json` 输出
2. 执行 `npm run books:cleanup:scripts -- --json` 并保存 81 个脚本的逐文件哈希证据
3. 明确列出准备删除的路径，不使用模糊通配符
4. 人工确认删除范围
5. 删除旧来源后再次运行目录契约、全量测试和构建
6. 将四本书迁移状态更新为 `completed_source_cleaned`
7. 永久保留迁移 manifest、源目标 SHA-256 和 validation

复核工具不包含删除功能，避免把校验和不可逆清理合并成一个动作
