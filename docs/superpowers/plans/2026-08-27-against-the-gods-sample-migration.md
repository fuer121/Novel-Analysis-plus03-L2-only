# Against the Gods Sample Migration Implementation Plan

**Goal:** 将《逆天邪神》的 307 个正式角色、307 张正式图片、生成与重绘历史以及专项脚本迁入标准书籍工作区

**Official baseline:** `characters.json`、`review-final.json` 和 `images/` 中按 `NNN_角色名.png` 命名的 307 张图片共同构成正式成果

## 迁移边界

- `images/188.png` 与 `images/189.png` 未被正式角色索引引用，不进入 `final/`
- `images-legacy-invalid/`、`images-pre-redraw/`、`redraw-images/` 和生成中间产物进入历史批次
- 飞书记录、同步结果、调试日志和读取结果只进入 Git 忽略的本地归档
- `build_characters.py` 与 `generate_images.py` 作为活跃维护脚本
- `sync_redraws_to_lark.sh` 与 `build_lark_redraw_result.jq` 记录为历史脚本
- 旧来源保留至 `2026-09-10`

## 批次映射

- `runs/2026-08-05-character-generation-r01/`：生成 manifests、预览、失败与续跑产物
- `runs/2026-08-05-character-review-redraw-r01/`：三批审核、72 个重绘及重绘前备份
- `runs/2026-08-05-lark-sync-r01/`：飞书上传、评分与重绘同步记录

## 完成条件

- 正式角色数、审核记录数和正式图片数均为 307
- 307 张正式图片与源文件 SHA-256 一致
- 两张未引用图片不进入 `final/`
- 645 个源文件均进入源清单并在目标映射中得到解释
- 敏感同步记录不进入 Git
- 目录契约、全量测试和构建通过
