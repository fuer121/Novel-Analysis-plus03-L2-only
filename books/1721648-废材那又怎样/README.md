# 废材那又怎样

- 书籍 ID：`1721648`
- 数据库：`../../data/novel-chapters.sqlite`
- 迁移状态：`copied_pending_source_cleanup`
- 正式角色：80 个
- 正式图片：83 张
- 源清理复核日期：`2026-09-10`

## 当前来源

- `artifacts/废材又怎么样照样吊打你角色形象/`
- 上层目录 `1721648-废材-角色名-别名.txt`
- 专项脚本：无

## 正式成果

- `inputs/character-names/aliases.json`：修正后的角色名、别名与图片索引
- `final/exports/character-index.json`：正式导出索引
- `final/characters/images/`：索引引用的 83 张正式图片
- `final/characters/evidence/image-sha256.json`：正式图片哈希证据

## 迁移说明

原索引中的 `谭浮-立绘-1024x1536.jpeg` 已按审查结论修正为实际存在且尺寸为 1024×1536 的 `谭浮.jpeg`

下载源、候选版本和重绘备份已归入 `runs/`，未被正式索引引用的图片及含内部地址和令牌的上传记录仅保存在 Git 忽略的 `archive/` 中

旧来源在 `2026-09-10` 复核前保持原位，不执行删除
