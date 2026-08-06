import test from "node:test";
import assert from "node:assert/strict";

const { deriveJourney, journeyInputForBook } = await import("../src/utils/journey.js");

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
