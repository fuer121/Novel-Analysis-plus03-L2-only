import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { deriveJourney, journeyInputForBook } = await import("../src/utils/journey.js");
const { parseHash, paths } = await import("../src/router.js");
const { TASK_TYPES, taskDisplayName } = await import("../src/constants/index.js");
const { breadcrumbParts } = await import("../src/utils/breadcrumbs.js");
const { deriveCharacterLibraryPageState, characterListQuery, characterSourceIncomplete } = await import("../src/hooks/useCharacterLibraryData.js");

function liveTask(type, bookId = "book-1") {
  return { id: `${type}-1`, type, status: "running", payload: { bookId } };
}

test("journey: 导入任务进行中优先于一切", () => {
  const next = deriveJourney({
    hasContent: false,
    importTask: liveTask("import"),
    l1Task: liveTask("l1-index")
  });
  assert.equal(next.stage, "导入原文（进行中）");
  assert.equal(next.page, null);
});

test("journey: 无章节时下一步是导入原文", () => {
  const next = deriveJourney({ hasContent: false });
  assert.equal(next.stage, "导入原文");
  assert.equal(next.page, null);
});

test("journey: 章节线索构建中", () => {
  const next = deriveJourney({ hasContent: true, l1Task: liveTask("l1-index") });
  assert.equal(next.stage, "章节线索（进行中）");
  assert.equal(next.page, "l1");
});

test("journey: 章节线索未完成时下一步是构建章节线索", () => {
  const next = deriveJourney({ hasContent: true, l1Done: false });
  assert.equal(next.stage, "构建章节线索");
  assert.equal(next.page, "l1");
});

test("journey: 已取消的 L1 任务不算进行中", () => {
  const next = deriveJourney({
    hasContent: true,
    l1Task: { ...liveTask("l1-index"), status: "cancelled" },
    l1Done: false
  });
  assert.equal(next.stage, "构建章节线索");
});

test("journey: 事实索引构建中", () => {
  const next = deriveJourney({ hasContent: true, l1Done: true, l2Task: liveTask("l2-index") });
  assert.equal(next.stage, "事实索引（进行中）");
  assert.equal(next.page, "l2");
});

test("journey: 章节线索就绪但无索引组时下一步是创建索引组", () => {
  const next = deriveJourney({ hasContent: true, l1Done: true, l2GroupCount: 0 });
  assert.equal(next.stage, "创建事实索引组");
  assert.equal(next.page, "l2");
});

test("journey: 全部就绪后下一步是提问", () => {
  const next = deriveJourney({ hasContent: true, l1Done: true, l2GroupCount: 2 });
  assert.equal(next.stage, "提问");
  assert.equal(next.page, "ask");
});

test("journeyInputForBook: 从诊断聚合行与任务列表组装输入", () => {
  const book = { book_id: "book-1", chapter_count: 100 };
  // 诊断的 index_groups 含 base 默认组：2 = base + 1 个用户创建组
  const aggregate = { l1: { completed: 100 }, index_groups: 2 };
  const tasks = [
    liveTask("l2-index", "book-1"),
    liveTask("l1-index", "other-book")
  ];
  const input = journeyInputForBook({ book, aggregate, tasks });
  assert.deepEqual(
    { hasContent: input.hasContent, l1Done: input.l1Done, l2GroupCount: input.l2GroupCount },
    { hasContent: true, l1Done: true, l2GroupCount: 1 }
  );
  assert.equal(input.l1Task, null, "其他书的任务不应归入本书");
  assert.equal(input.l2Task?.type, "l2-index");
  const next = deriveJourney(input);
  assert.equal(next.stage, "事实索引（进行中）");
});

test("journeyInputForBook: 仅有 base 默认组时不算已创建索引组", () => {
  const book = { book_id: "book-1", chapter_count: 100 };
  const aggregate = { l1: { completed: 100 }, index_groups: 1 };
  const input = journeyInputForBook({ book, aggregate });
  assert.equal(input.l2GroupCount, 0);
  const next = deriveJourney(input);
  assert.equal(next.stage, "创建事实索引组");
});

test("journeyInputForBook: L1 未覆盖全部章节时 l1Done 为 false", () => {
  const book = { book_id: "book-1", chapter_count: 100 };
  const input = journeyInputForBook({ book, aggregate: { l1: { completed: 99 }, index_groups: 0 } });
  assert.equal(input.l1Done, false);
});

test("journeyInputForBook: 空聚合与空任务等价于刚导入", () => {
  const input = journeyInputForBook({ book: { book_id: "b", chapter_count: 10 } });
  const next = deriveJourney(input);
  assert.equal(next.stage, "构建章节线索");
});

test("router: 生成并解析角色库书籍路由", () => {
  assert.equal(paths.characters("book/1"), "/book/book%2F1/characters");
  assert.deepEqual(parseHash("#/book/book-1/characters"), {
    route: "characters",
    bookId: "book-1",
    query: {}
  });
});

test("character library: 注册任务类型与面包屑", () => {
  assert.equal(TASK_TYPES.CHARACTER_LIBRARY, "character-library");
  assert.equal(taskDisplayName(TASK_TYPES.CHARACTER_LIBRARY), "角色库");
  assert.deepEqual(breadcrumbParts({ route: "characters", bookId: "book-1", bookName: "示例书" }), [
    { label: "工作台", path: "/" },
    { label: "示例书", path: "/book/book-1" },
    { label: "角色库" }
  ]);
});

test("character library: 任务不改变 L1/L2 旅程优先级", () => {
  const input = journeyInputForBook({
    book: { book_id: "book-1", chapter_count: 100 },
    aggregate: { l1: { completed: 100 }, index_groups: 1 },
    tasks: [liveTask("character-library")]
  });
  assert.equal(deriveJourney(input).stage, "创建事实索引组");
});

test("character library: App 和书籍入口接入全局任务通道", async () => {
  const [appSource, bookSource, workbenchSource] = await Promise.all([
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/BookHomePage.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/WorkbenchPage.jsx", import.meta.url), "utf8")
  ]);
  assert.match(appSource, /const characterLibraryChannel = useTaskChannel\(/);
  assert.match(appSource, /activeRoute === "characters"/);
  assert.match(bookSource, /title="角色库"/);
  assert.match(bookSource, /paths\.characters\(bookId\)/);
  assert.match(workbenchSource, /characterLibraryTask/);
});

test("character library: 页面状态按前置条件和当前投影确定性派生", () => {
  assert.equal(deriveCharacterLibraryPageState({ chapterCount: 0 }).kind, "no_chapters");
  assert.equal(deriveCharacterLibraryPageState({ chapterCount: 10, l1Completed: 0 }).kind, "no_l1");
  assert.equal(deriveCharacterLibraryPageState({ chapterCount: 10, l1Completed: 10, hasCharacterGroup: false }).kind, "no_character_group");
  assert.equal(deriveCharacterLibraryPageState({ chapterCount: 10, l1Completed: 10, hasCharacterGroup: true, l2Completed: 0 }).kind, "no_character_facts");
  assert.equal(deriveCharacterLibraryPageState({ chapterCount: 10, l1Completed: 10, hasCharacterGroup: true, l2Completed: 8, sourceIncomplete: true, library: null }).kind, "library_missing");
  assert.equal(deriveCharacterLibraryPageState({ chapterCount: 10, l1Completed: 10, hasCharacterGroup: true, l2Completed: 8, sourceIncomplete: true, library: { status: "partial" } }).kind, "partial");
  assert.equal(deriveCharacterLibraryPageState({ chapterCount: 10, l1Completed: 10, hasCharacterGroup: true, l2Completed: 10, library: { status: "completed" } }).kind, "ready");
});

test("character library: 列表查询只发送锁定的搜索筛选排序参数", () => {
  assert.deepEqual(characterListQuery({ search: " 沈昭 ", filter: "multi_stage", sort: "updated" }), {
    search: "沈昭",
    filter: "multi_stage",
    sort: "updated"
  });
  assert.deepEqual(characterListQuery({ search: "", filter: "unknown", sort: "unknown" }), {
    search: "",
    filter: "all",
    sort: "name"
  });
});

test("character library: 来源不完整使用实际 outdated 计数", () => {
  assert.equal(characterSourceIncomplete({ chapterCount: 10, chapters: { completed: 10, outdated: 1 } }), true);
  assert.equal(characterSourceIncomplete({ chapterCount: 10, chapters: { completed: 10, outdated: 0 } }), false);
  assert.equal(characterSourceIncomplete({ chapterCount: 10, chapters: { completed: 10 }, failed: [3] }), true);
});

test("character library: Task 8 页面接入表格、抽屉与整书更新参数", async () => {
  const [appSource, pageSource, styleSource] = await Promise.all([
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/CharacterLibraryPage.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/styles/pages/character-library.css", import.meta.url), "utf8")
  ]);
  assert.match(appSource, /<CharacterLibraryPage/);
  assert.match(appSource, /index_group_key: indexGroupKey/);
  assert.match(pageSource, /character-library-table/);
  assert.match(pageSource, /character-library-drawer/);
  assert.match(pageSource, /<details/);
  assert.match(pageSource, /loading: \["角色库读取中"/);
  assert.match(pageSource, /"personality"/);
  assert.match(appSource, /<CharacterLibraryPage/);
  assert.match(pageSource, /drawerCloseRef\.current\?\.focus/);
  assert.match(pageSource, /matchMedia\("\(max-width: 899px\)"\)/);
  const hookSource = await readFile(new URL("../src/hooks/useCharacterLibraryData.js", import.meta.url), "utf8");
  assert.match(hookSource, /summaryRequestRef/);
  assert.match(hookSource, /reloadRequestRef/);
  assert.match(styleSource, /clamp\(560px, 42vw, 640px\)/);
});
