# Feicai Sample Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将《废材那又怎样》的 80 个角色、83 张正式图片、输入索引和历史下载记录迁入标准书籍工作区

**Architecture:** 以上层角色名别名文件作为正式角色范围，将其中唯一失效的谭浮图片引用修正为实际 1024×1536 的 `谭浮.jpeg`。正式图片只复制修正后索引引用的 83 张，未引用图片、下载源文件、备份和含签名 URL 的上传记录进入 runs 或 archive

**Tech Stack:** Node.js 22、POSIX shell、`rsync`、`shasum -a 256`、JSON、CSV

---

## 已确认事实

- 上层索引包含 80 个角色和 83 个唯一图片引用
- 唯一失效引用为 `谭浮-立绘-1024x1536.jpeg`
- `谭浮.jpeg` 是 1024×1536 的更新版本，作为修正后的正式立绘
- 根目录有 88 张图片文件，正式集合为索引引用的 83 张
- `_source_谭系统.png`、`北长尾山雀.jpeg`、`燕老师.jpeg`、`谭浮-立绘-v1.jpeg`、`鸟.jpeg` 不进入正式集合
- artifacts 内没有专项脚本
- 上传结果 JSON 包含内部 URL、签名、文件 token 和绝对路径，只能本地归档
- 旧来源保留至 2026-09-10

## 目标映射

| 来源 | 目标 |
| --- | --- |
| 上层角色名别名文件原文 | `archive/2026/source-records/1721648-角色名-别名原始.txt` |
| 修正后的角色名别名索引 | `inputs/character-names/aliases.json` 和 `final/exports/character-index.json` |
| 索引引用的 83 张根目录图片 | `final/characters/images/` |
| `manifest.json` 与上传结果 JSON | `archive/2026/local-records/` |
| `_source_downloads/`、`_role_base_source_downloads/` | `runs/2026-06-23-portrait-import-r01/inputs/` |
| `谭浮/` 与 `谭浮-立绘-v1.jpeg` | `runs/2026-08-11-tanfu-outfits-r01/outputs/` |
| `重绘前备份-20260812/` | `runs/2026-08-12-character-redraw-r01/outputs/` |
| 未进入正式集合的其他图片 | `archive/2026/legacy-images/` |

## 执行步骤

- [ ] 生成 artifacts 与上层索引的完整源 SHA-256 清单
- [ ] 创建 `scripts-inventory.csv`，记录专项脚本数量为 0
- [ ] 创建原始到目标的 `mapping.csv` 和迁移 manifest
- [ ] 保存原始别名索引到本地归档
- [ ] 生成修正后的 `aliases.json`，仅把谭浮首张图片改为 `谭浮.jpeg`
- [ ] 从修正后索引复制 83 张正式图片
- [ ] 生成正式图片 SHA-256 清单与角色图片引用验证
- [ ] 复制下载源、谭浮候选版本、重绘备份和本地上传记录
- [ ] 为三个历史批次创建 `manifest.json`
- [ ] 生成分组 validation 和目标 SHA-256 清单
- [ ] 更新书籍 README，状态设为 `copied_pending_source_cleanup`
- [ ] 运行目录契约、全量测试和构建
- [ ] 提交可跟踪输入、清单、正式索引和批次 manifest

## 完成条件

- 正式索引为 80 个角色、83 个唯一图片引用
- 所有正式图片存在且 SHA-256 已记录
- 谭浮的正式立绘引用为 `谭浮.jpeg`
- 五张非正式图片均未进入 final
- 敏感上传记录没有进入 Git
- 源目标分组哈希校验通过
- 旧来源保留至 2026-09-10
- 产品源码、数据库和 API 未修改

