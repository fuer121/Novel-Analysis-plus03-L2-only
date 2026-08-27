# 根专项脚本清理审查

**审查日期**：2026-08-27

**结论**：根 `scripts/` 的 81 个书籍专项脚本已于 2026-08-27 经用户明确授权删除，保全副本仍存在

## 数量口径

| 类型 | 数量 | 保全位置 |
| --- | ---: | --- |
| historical | 74 | 各书 `archive/2026/legacy-scripts/` |
| active 原版 | 4 | `archive/2026/source-records/active-scripts/` |
| review | 3 | `scripts/review/` |
| 合计 | 81 | 全部已保全 |

根目录另有 4 个产品级工具，不属于删除候选：

- `check-book-cleanup-readiness.mjs`
- `check-root-script-cleanup-readiness.mjs`
- `generate-dify-workflow-manifest.mjs`
- `migrate-to-plaintext.mjs`

## 补录修正

`scripts/enrich-divorce-faces.py` 未出现在原 `scripts-inventory.csv` 中

根据脚本内容和配套的 face-enrichment 数据快照，已归属为 222767 离婚书的 historical 一次性脚本，并保全至：

`books/222767-离婚后她惊艳了世界/archive/2026/legacy-scripts/enrich-divorce-faces.py`

源目标 SHA-256 均为：

`bb4efad9ae519a6265004c0a4865204e023a9deb0021f97fc2c68fa68747d3bb`

## active 脚本说明

4 个 active 脚本的新入口因路径迁移和 279 条基线修正，与根原版内容不同：

- `build-divorce-characters.mjs`
- `generate-divorce-images.py`
- `update-divorce-role-all-r21.py`
- `upload-divorce-single-image-dify.py`

本次删除安全性不依赖新 active 入口与旧脚本相同，而是依赖 `archive/2026/source-records/active-scripts/` 中的原版副本与根脚本 SHA-256 一致

## 机器复核

```bash
npm run books:cleanup:scripts
```

当前预期输出：

```text
root script candidates: 81
historical: 74; active source copies: 4; review: 3
removed sources: 81; remaining sources: 0
all preserved with matching SHA-256: true
```

需要逐文件证据时执行：

```bash
npm run books:cleanup:scripts -- --json
```

JSON 结果包含每个删除候选的源路径、状态、保全路径、源目标 SHA-256 和 readiness 结果

## 删除门禁

删除已于 2026-08-27 执行完成，后续运行本检查器应持续显示 `removed sources: 81; remaining sources: 0`

2026-09-10 或之后仍必须：

1. 重新执行 `npm run books:cleanup:check`
2. 重新执行 `npm run books:cleanup:scripts`
3. 列出 81 个精确源路径
4. 获得用户明确删除确认
5. 删除后重跑全量测试和构建
