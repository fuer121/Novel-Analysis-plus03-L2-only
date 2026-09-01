# 书籍工作区

每本书使用 `<book_id>-<book_name>` 作为唯一目录名

## 目录职责

- `inputs/` 保存提示词、角色名、原始参考图和批处理输入
- `scripts/active/` 只保存确认仍会继续运行的书籍专项脚本
- `runs/` 保存按 `YYYY-MM-DD-<task>-rNN` 命名的执行批次
- `final/` 只保存当前认可并可交付的版本
- `archive/` 完整保留旧版本和迁移前快照

历史脚本优先随对应批次进入 `runs/<batch>/scripts/`，无法对应批次时进入 `archive/YYYY/legacy-scripts/`

每本书迁移前必须建立 `scripts-inventory.csv`，将所有专项脚本标记为 `active`、`historical` 或 `review`

产品源码和 SQLite 数据库不进入书籍目录，数据库统一使用 `data/novel-chapters.sqlite`

新增文件前先判断归属，不允许把带书名的输入或输出重新放回仓库根目录

## 提示词定稿入口

- `10473186-碰触成瘾/inputs/prompts/character-image-l2-index.md`
- `12144762-哥，别舔女主了！妹宝被你死对头亲晕了/inputs/prompts/character-image-l2-index.md`
- `1836527-凰宫梦/inputs/prompts/character-image-l2-index.md`
- `222767-离婚后她惊艳了世界/inputs/prompts/l1-index.md`
- `222767-离婚后她惊艳了世界/inputs/prompts/character-image-l2-index.md`
- `8720253-死亡就变强：全球诡异求我别送/inputs/prompts/character-image-l2-index.md`

提示词以书籍 `inputs/prompts/` 内的 Markdown 定稿为准。若在 `/prompts` 页面临时调整且验证有效，必须回写对应文件
