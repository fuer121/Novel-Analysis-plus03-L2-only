# 书籍工作区目录整理设计

## 目标

在不改变前端、后端、SQLite 数据结构和 Dify 工作流的前提下，将散落的书籍输入资料、专项脚本、执行过程和最终成果统一收口到按书籍组织的工作区

整理后应满足以下条件

- 查找一本书的资料时只需要进入一个目录
- 当前可交付成果只从 `final/` 获取
- 每次执行过程都能在 `runs/` 中独立追溯
- 历史版本完整保留在 `archive/`，但不干扰日常工作
- 仓库根不再出现带书名的提示词、别名、图片或批处理文件
- 产品源码、共享脚本和书籍专项资料之间边界明确

## 根目录定义

- 仓库根：`小说分析重构-plus3-抽取L2提问/`

整理前，提示词、别名文件和 `redraw-four-*` 产物曾位于 Git 仓库上层的工作区根。该层级已于 2026-08-27 压平；以下相关条款保留为迁移历史和安全决策记录

## 不在本次范围内

- 不拆分或迁移 `data/novel-chapters.sqlite`
- 不改变 API、路由、数据库表或 `book_id` 语义
- 不调整 `src/`、`server/`、`test/` 和 `dify-workflows/` 的产品结构
- 不删除历史图片、审计记录或中间结果
- 不将每本书拆成独立 Git 仓库

## 目标目录

```text
Novel-Analysis-plus03-L2-only/
├── books/
│   └── <book_id>-<book_name>/
│       ├── README.md
│       ├── book.json
│       ├── inputs/
│       │   ├── prompts/
│       │   ├── character-names/
│       │   ├── source-images/
│       │   └── batch-inputs/
│       ├── scripts/
│       │   ├── README.md
│       │   ├── active/
│       │   └── review/
│       ├── runs/
│       │   └── YYYY-MM-DD-<task>-rNN/
│       │       ├── manifest.json
│       │       ├── logs/
│       │       ├── outputs/
│       │       ├── review/
│       │       └── scripts/
│       ├── final/
│       │   ├── characters/
│       │   ├── indexes/
│       │   └── exports/
│       ├── archive/
│       │   └── YYYY/
│       └── migration/
│           └── YYYY-MM-DD-<scope>/
├── scripts/                   # 产品级工具保持现有稳定路径
├── data/
│   └── novel-chapters.sqlite
└── tmp/
```

## 首批书籍目录

首批只为已经存在文件产物的书籍创建工作区

| 目录 | 数据库书籍 | 当前来源 |
| --- | --- | --- |
| `books/222767-离婚后她惊艳了世界/` | `222767` 离婚后她惊艳了世界 | `artifacts/离婚后她惊艳了世界角色形象/`、根目录提示词和专项脚本 |
| `books/1836527-凰宫梦/` | `1836527` 凰宫梦 | `artifacts/凰宫梦角色形象/`、根目录提示词和专项脚本 |
| `books/1721648-废材那又怎样/` | `1721648` 废材那又怎样 | `artifacts/废材又怎么样照样吊打你角色形象/` 和根目录别名文件 |
| `books/148431-逆天邪神/` | `148431` 逆天邪神 | `artifacts/逆天邪神角色形象/` |

数据库中只有章节、尚无文件产物的书籍暂不创建空目录

## 各目录职责

### `inputs/`

存放任务开始前已经存在、需要人工维护或后续重复使用的材料，包括提示词、角色名与别名、原始参考图和 JSONL 批处理输入

输入文件应使用描述性名称，不在文件名中重复书名

### `scripts/`

书籍目录内的 `scripts/active/` 只存放确认仍会继续运行的专项脚本，不再按 build、audit、generate、sync、repair 细分

`scripts/review/` 只存放用途尚未废弃、但仍包含旧路径、线上写入或过期基线假设的脚本。该目录不是稳定执行入口，脚本启用前必须完成人工复核并迁入 `scripts/active/`

- 可以对应到具体执行批次的历史脚本进入 `runs/<batch>/scripts/`
- 无法对应批次的历史脚本进入 `archive/YYYY/legacy-scripts/`
- 无法确认是否仍在使用的脚本保持原位并标记为 `review`，不静默移动

仓库根 `scripts/` 中的产品级工具保持现有稳定路径，特别是 `migrate-to-plaintext.mjs` 和 `generate-dify-workflow-manifest.mjs`，避免破坏 `package.json` 与测试中的直接引用

每本书迁移前必须创建 `scripts-inventory.csv`，字段固定为

```text
filename,book_id,status,category,last_known_run,dependencies,target_path,notes
```

`status` 只允许以下值

- `active`：有明确后续用途、被稳定入口引用，或列入本次样板迁移维护清单
- `historical`：只用于复盘，后续不再作为执行入口
- `review`：现有证据不足，暂时保持原位

专项脚本当前多数未被 Git 跟踪，因此不能只依赖提交时间判断维护状态

### `runs/`

存放一次明确执行产生的完整过程，批次名统一为 `YYYY-MM-DD-<task>-rNN`

每个批次至少包含 `manifest.json`，记录书籍 ID、任务名称、创建时间、使用脚本、输入来源、输出位置和状态

过程图片、候选结果、日志和人工审核信息只能进入对应批次，不能直接堆放在书籍根目录

对需要在多次执行间原地续跑的任务，允许使用 `runs/<task>-current/` 作为受控的可变工作区例外。该目录不属于历史批次，可不提供批次 `manifest.json`，其生成内容必须被 Git 忽略，脚本必须从 `BOOK_ROOT` 推导路径

当可变工作区产生需要长期保留的证据时，必须固化为新的 `YYYY-MM-DD-<task>-rNN` 批次并补齐 manifest，不允许通过“自动选择最新日期批次”来修改历史记录

### `final/`

存放当前认可并可交付、上传或被后续流程消费的唯一版本

旧最终版本在新版本确认后整体移入 `archive/YYYY/`，不使用 `final-v2`、`final-new` 或 `current-latest` 等并列目录

### `archive/`

完整保留被替换的历史最终版本、无法准确还原批次的旧实验，以及迁移前目录快照

归档内容默认只读，后续任务需要复用时应复制到新的 `runs/`，不能直接覆盖归档文件

### `migration/`

存放书籍工作区迁移的永久证据，包括迁移 manifest、源目标 SHA-256 清单、脚本分类清单和校验结果

迁移目录按 `YYYY-MM-DD-<scope>` 命名。旧源删除后仍永久保留，不随普通 runs 或 archive 清理

### 根目录 `tmp/`

只存放可重新生成且可以整体删除的缓存，不存放唯一副本、人工审核结论或最终图片

## `book.json`

每本书使用最小元数据描述身份和数据库关系

```json
{
  "book_id": "222767",
  "book_name": "离婚后她惊艳了世界",
  "slug": "divorce",
  "database": "../../data/novel-chapters.sqlite"
}
```

该文件不复制章节、角色或分析业务数据

## 迁移映射原则

### 原上层工作区根散落文件

- `*-L1索引提示词.md` 和 `*-L2索引提示词.md` 进入对应书籍的 `inputs/prompts/`
- `*-角色名-别名.txt` 进入对应书籍的 `inputs/character-names/`
- `redraw-*.jsonl` 和相关提示词进入对应书籍的 `inputs/batch-inputs/`
- `redraw-*-output/` 根据内容进入对应书籍的某个迁移批次或 `archive/2026/`

无法仅凭文件名确认归属的文件在迁移清单中标记为待人工确认，不静默猜测

原上层工作区文件迁入 `inputs/prompts/` 后默认纳入 Git。迁入前必须检查 API Key、内部服务地址、敏感原文和不应提交的业务数据；包含敏感内容时保留本地并补充忽略规则

### 现有 `artifacts/`

- 明确的最终图片目录迁入 `final/characters/`
- 有日期、轮次或候选含义的目录迁入对应 `runs/`
- 已存在的 `archive/`、备份、失败和废弃目录迁入 `archive/2026/`
- 审计 JSON、CSV 和说明文档优先随对应批次进入 `runs/<batch>/review/`
- 无法可靠拆分批次的大目录先整体放入 `archive/2026/legacy-artifacts/`，保持原始相对结构
- `artifacts/` 内的 Python、JavaScript 和 Shell 脚本也必须进入 `scripts-inventory.csv`，再按 active、historical、review 规则归类

### 现有 `scripts/`

带 `divorce`、`huanggong`、角色专名或明确书籍语义的脚本先进入对应书籍的 `scripts-inventory.csv`

- `active` 脚本移入对应书籍的 `scripts/active/`
- `historical` 脚本随批次或历史归档保存
- `review` 脚本保持原位，等待人工确认
- `migrate-to-plaintext.mjs`、`generate-dify-workflow-manifest.mjs` 等产品级工具保留在仓库根 `scripts/`

## 路径兼容策略

现有专项脚本大量通过 `ROOT / "artifacts" / <书名>` 硬编码路径，不能先移动脚本和数据再统一修复

迁移按以下顺序执行

1. 创建目标目录、`book.json`、书籍 `README.md` 和完整迁移清单
2. 将文件复制到目标位置，并核对文件数量、总大小和校验和
3. 逐个调整仍需继续使用的专项脚本，使其从脚本位置推导书籍根目录
4. 对调整后的代表性脚本执行只读或 dry-run 验证
5. 旧来源保留 14 天作为临时安全副本，期间不得继续写入
6. 14 天后再次核对目标文件数量、总大小和 SHA-256 清单
7. 人工确认后删除旧来源，永久保留迁移清单和 SHA-256 记录
8. 更新仓库 `Agent.md`、`README.md` 和对应书籍 `README.md`

不再维护的历史脚本可以随历史批次归档，不要求全部改造成可再次运行

临时复制会使迁移期间磁盘峰值接近源数据的两倍。当前 `artifacts/` 约 1.6GB，完整迁移峰值约 3.2GB；逐书迁移可以限制单次额外占用。`migration-source/` 不作为永久重复备份，完整历史由整理后的 `runs/` 与 `archive/` 承担

## Git 策略

书籍工作区包含大量图片和过程文件，默认继续遵循现有忽略策略，不将大体积产物直接纳入 Git

建议纳入 Git 的内容包括

- `book.json`
- 各级 `README.md`
- 仍在维护的专项脚本
- 不含敏感数据的小型提示词模板
- 迁移清单和批次 `manifest.json`

图片、数据库、日志和大批量 JSON 结果继续忽略，后续如需要跨机器管理再单独评估对象存储或 Git LFS

## 迁移安全要求

- 不删除任何唯一文件
- 不覆盖同名但内容不同的文件
- 每本书独立迁移和验收，不进行一次性全量搬迁
- 迁移前后分别记录文件数量、总字节数和 SHA-256 清单
- 数据库保持原位，并在迁移前后运行现有测试
- 原上层工作区根的疑似重复项目副本不纳入自动迁移，单独确认后处理

重复项目副本必须比较相对路径、文件数量、总字节数、SHA-256、`book.json` 和迁移状态

- 完全一致或确认是主项目子集：列出证据并经人工确认后删除
- 包含主项目没有的唯一文件：合并到对应书籍的 `runs/` 或 `archive/`
- 无法确认：保持原位并记录为 `review`

不得通过目录名、修改时间或肉眼抽查直接判定重复

当前 `book.json` 四字段和每本书的 `inputs/`、`scripts/`、`runs/`、`final/`、`archive/` 五个一级目录已被 `test/book-workspace.test.js` 锁定。调整这些契约时必须同步更新测试

## 分阶段落地

### 第一阶段：建立规范和骨架

创建四本书的标准目录、元数据、说明文档、迁移清单模板和必要的忽略规则，不移动大文件

### 第二阶段：试迁移一本书

选择产物结构较清楚的 `1836527-凰宫梦` 作为样板，完成输入、脚本、批次、最终成果和归档的完整迁移与校验

### 第三阶段：迁移其余书籍

根据样板依次迁移 `1721648`、`148431` 和结构最复杂的 `222767`

### 第四阶段：清理旧入口

处理原上层工作区根散落文件，按对比标准确认疑似重复项目目录，更新 `Agent.md`、`README.md` 和书籍说明，并检查仓库根是否仍有书籍专项产物

## 验收标准

- 四本已有文件产物的书籍均拥有标准工作区和正确 `book_id`
- 一本书的输入、脚本、执行过程、当前成果和历史归档可以在同一工作区找到
- `final/` 中不存在多个含义不清的并列当前版本
- 每个迁移批次都有清单，迁移前后文件数量、大小和校验和一致
- 仍在维护的专项脚本不再硬编码旧 `artifacts/<书名>` 路径
- 每本书都有完整的 `scripts-inventory.csv`，所有专项和 artifacts 内嵌脚本均标记为 active、historical 或 review
- `npm test` 和现有产品功能不因目录整理受到影响
- 仓库根不再散落书籍专项输入和输出
- 临时旧来源只在 14 天校验窗口内保留，不形成永久双份
