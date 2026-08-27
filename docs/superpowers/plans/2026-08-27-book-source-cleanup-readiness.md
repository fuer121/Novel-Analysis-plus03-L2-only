# Book Source Cleanup Readiness

## 当前状态

四本书均已完成复制迁移，状态为 `copied_pending_source_cleanup`

旧来源的统一复核日期为 `2026-09-10`。在该日期之前不得删除旧 `artifacts/`、上层提示词、别名文件或根目录专项脚本

## 复核命令

```bash
npm run books:cleanup:check
```

命令逐项读取每本书的 `source-sha256.txt` 和 `target-sha256.txt`，验证文件是否存在及 SHA-256 是否一致，同时检查产品级工具、`server/`、`src/` 和 `books/*/scripts/active/` 是否仍引用旧 `artifacts/` 路径

当前预期状态为 `waiting_for_verification_window`

到 `2026-09-10` 当天，只有四本书全部显示 `ready_for_manual_confirmation` 且 `active legacy references` 为 0，才可以进入人工删除确认

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
