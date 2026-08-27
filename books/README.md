# 书籍工作区

每本书使用 `<book_id>-<book_name>` 作为唯一目录名

## 目录职责

- `inputs/` 保存提示词、角色名、原始参考图和批处理输入
- `scripts/` 保存只服务当前书籍的专项脚本
- `runs/` 保存按 `YYYY-MM-DD-<task>-rNN` 命名的执行批次
- `final/` 只保存当前认可并可交付的版本
- `archive/` 完整保留旧版本和迁移前快照

产品源码和 SQLite 数据库不进入书籍目录，数据库统一使用 `data/novel-chapters.sqlite`

新增文件前先判断归属，不允许把带书名的输入或输出重新放回仓库根目录
