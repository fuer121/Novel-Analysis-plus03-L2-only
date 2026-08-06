import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config, publicRuntimeConfig } from "./config.js";
import {
  deleteBook,
  deleteAnalysisRun,
  createBookIndexGroup,
  deleteBookIndexGroup,
  disableBookIndexGroup,
  ensureBook,
  getBookIndexPrompts,
  getDatabaseDiagnostics,
  getIndexPromptSettings,
  listBookIndexGroups,
  listL1ChapterIndexes,
  listAnalysisRuns,
  listBooks,
  listChapterMetadata,
  updateBookIndexGroup,
  updateBookIndexPrompts,
  saveIndexPromptSettings
} from "./db.js";
import { cancelTask, getTask, listTasks, pauseTask, publicTask, resumeTask, subscribeTask, taskDiagnostics } from "./tasks.js";
import { sanitizeError } from "./sanitize.js";
import { testDifyConnection } from "./dify.js";
import {
  getL1IndexCoverageForBook,
  publicAnalysisRunWithResult,
  getL2IndexCoverageForBook,
  listL2FactsForBook,
  resumeAnalysisRunTask,
  startL1IndexTask,
  startL2IndexTask,
  startAnalysisTask,
  startImportTask
} from "./workflows.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const staticDir = config.staticDir || path.resolve(__dirname, "..", "dist");

app.use(express.json({ limit: "2mb" }));

app.get("/api/config", (_request, response) => {
  response.json({ ok: true, runtime: publicRuntimeConfig() });
});

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    status: "ok",
    generated_at: new Date().toISOString(),
    runtime: publicRuntimeConfig()
  });
});

app.get("/api/diagnostics", (_request, response) => {
  response.json({
    ok: true,
    generated_at: new Date().toISOString(),
    runtime: publicRuntimeConfig(),
    database: getDatabaseDiagnostics(),
    tasks: taskDiagnostics()
  });
});

app.get("/api/dify/test", async (_request, response, next) => {
  try {
    const target = normalizeDifyTestTarget(_request.query.target);
    const targets = target === "all"
      ? ["import", "l1", "l2", "analysis_summary"]
      : [target];
    const results = {};
    for (const key of targets) {
      try {
        results[key] = await testDifyConnection({ target: key });
      } catch (error) {
        const safe = sanitizeError(error);
        results[key] = {
          ok: false,
          status: safe.status || 500,
          error: safe.message,
          details: safe.details || null
        };
      }
    }
    if (target === "all") {
      const allOk = targets.every((key) => Boolean(results[key]?.ok));
      response.json({
        ok: allOk,
        target,
        dify: results
      });
      return;
    }
    const single = results[target];
    if (!single?.ok) {
      const error = new Error(single?.error || "Dify 连通性测试失败。");
      error.status = single?.status || 500;
      error.details = single?.details || undefined;
      throw error;
    }
    response.json({ ok: true, target, dify: single });
  } catch (error) {
    next(error);
  }
});

app.get("/api/tasks", (request, response) => {
  response.json({
    ok: true,
    tasks: listTasks({
      type: request.query.type,
      status: request.query.status
    })
  });
});

app.get("/api/books", (_request, response) => {
  response.json({ ok: true, books: listBooks() });
});

app.post("/api/books", (request, response, next) => {
  try {
    response.status(201).json({
      ok: true,
      book: ensureBook(request.body?.book_id ?? request.body?.bookId, request.body?.book_name ?? request.body?.bookName)
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/books/imports", (request, response, next) => {
  try {
    const task = startImportTask(request.body || {});
    response.status(202).json({ ok: true, task: publicTask(task) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/imports/:id", (request, response, next) => {
  try {
    response.json({ ok: true, task: publicTask(getTask(request.params.id)) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/imports/:id/events", (request, response, next) => {
  try {
    subscribeTask(request.params.id, response);
  } catch (error) {
    next(error);
  }
});

app.post("/api/imports/:id/cancel", (request, response, next) => {
  try {
    response.json({ ok: true, task: cancelTask(request.params.id) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/imports/:id/pause", (request, response, next) => {
  try {
    response.json({ ok: true, task: pauseTask(request.params.id) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/imports/:id/resume", (request, response, next) => {
  try {
    response.json({ ok: true, task: resumeTask(request.params.id) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/books/:bookId/l1-indexes", (request, response, next) => {
  try {
    const task = startL1IndexTask({
      ...(request.body || {}),
      book_id: request.params.bookId
    });
    response.status(202).json({ ok: true, task: publicTask(task) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/l1-indexes/:id", (request, response, next) => {
  try {
    response.json({ ok: true, task: publicTask(getTask(request.params.id)) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/l1-indexes/:id/events", (request, response, next) => {
  try {
    subscribeTask(request.params.id, response);
  } catch (error) {
    next(error);
  }
});

app.post("/api/l1-indexes/:id/cancel", (request, response, next) => {
  try {
    response.json({ ok: true, task: cancelTask(request.params.id) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/l1-indexes/:id/pause", (request, response, next) => {
  try {
    response.json({ ok: true, task: pauseTask(request.params.id) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/l1-indexes/:id/resume", (request, response, next) => {
  try {
    response.json({ ok: true, task: resumeTask(request.params.id) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/books/:bookId/chapters", (request, response) => {
  response.json({
    ok: true,
    bookId: request.params.bookId,
    chapters: listChapterMetadata(request.params.bookId)
  });
});

app.get("/api/books/:bookId/l1-indexes/coverage", (request, response, next) => {
  try {
    response.json({
      ok: true,
      coverage: getL1IndexCoverageForBook({
        bookId: request.params.bookId,
        startChapter: request.query.start_chapter || request.query.startChapter || 1,
        endChapter: request.query.end_chapter || request.query.endChapter || 1
      })
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/books/:bookId/l1-indexes/chapters", (request, response, next) => {
  try {
    response.json({
      ok: true,
      chapters: listL1ChapterIndexes(
        request.params.bookId,
        request.query.start_chapter || request.query.startChapter || 1,
        request.query.end_chapter || request.query.endChapter || 1
      )
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/books/:bookId/delete", (request, response) => {
  response.json({ ok: true, ...deleteBook(request.params.bookId) });
});

app.get("/api/books/:bookId/index-groups", (request, response, next) => {
  try {
    response.json({
      ok: true,
      indexGroups: listBookIndexGroups(request.params.bookId, {
        includeDisabled: request.query.include_disabled === "1" || request.query.includeDisabled === "1",
        includeStats: request.query.include_stats === "1" || request.query.includeStats === "1"
      })
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/books/:bookId/index-groups", (request, response, next) => {
  try {
    response.status(201).json({
      ok: true,
      indexGroup: createBookIndexGroup(request.params.bookId, request.body || {})
    });
  } catch (error) {
    next(error);
  }
});

app.put("/api/books/:bookId/index-groups/:groupKey", (request, response, next) => {
  try {
    response.json({
      ok: true,
      indexGroup: updateBookIndexGroup(request.params.bookId, request.params.groupKey, request.body || {})
    });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/books/:bookId/index-groups/:groupKey", (request, response, next) => {
  try {
    const mode = request.query.mode || "disable";
    response.json({
      ok: true,
      ...(mode === "delete"
        ? deleteBookIndexGroup(request.params.bookId, request.params.groupKey)
        : disableBookIndexGroup(request.params.bookId, request.params.groupKey))
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/books/:bookId/l2-indexes", (request, response, next) => {
  try {
    const task = startL2IndexTask({
      ...(request.body || {}),
      book_id: request.params.bookId
    });
    response.status(202).json({ ok: true, task: publicTask(task) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/l2-indexes/:id", (request, response, next) => {
  try {
    response.json({ ok: true, task: publicTask(getTask(request.params.id)) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/l2-indexes/:id/events", (request, response, next) => {
  try {
    subscribeTask(request.params.id, response);
  } catch (error) {
    next(error);
  }
});

app.post("/api/l2-indexes/:id/cancel", (request, response, next) => {
  try {
    response.json({ ok: true, task: cancelTask(request.params.id) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/l2-indexes/:id/pause", (request, response, next) => {
  try {
    response.json({ ok: true, task: pauseTask(request.params.id) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/l2-indexes/:id/resume", (request, response, next) => {
  try {
    response.json({ ok: true, task: resumeTask(request.params.id) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/books/:bookId/l2-indexes/coverage", (request, response, next) => {
  try {
    response.json({
      ok: true,
      coverage: getL2IndexCoverageForBook({
        bookId: request.params.bookId,
        indexGroupKey: request.query.index_group_key || request.query.indexGroupKey || "base",
        startChapter: request.query.start_chapter || request.query.startChapter || 1,
        endChapter: request.query.end_chapter || request.query.endChapter || 1
      })
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/books/:bookId/l2-facts", async (request, response, next) => {
  try {
    response.json({
      ok: true,
      facts: listL2FactsForBook({
        bookId: request.params.bookId,
        startChapter: request.query.start_chapter || request.query.startChapter || 1,
        endChapter: request.query.end_chapter || request.query.endChapter || 1,
        indexGroupKey: request.query.index_group_key || request.query.indexGroupKey,
        indexGroupKeys: request.query.index_group_keys || request.query.indexGroupKeys,
        category: request.query.category || "",
        entity: request.query.entity || "",
        limit: request.query.limit || 500
      })
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/books/:bookId/index-prompts", (request, response, next) => {
  try {
    const bookPrompts = getBookIndexPrompts(request.params.bookId);
    const chapters = listChapterMetadata(request.params.bookId);
    const startChapter = chapters[0]?.chapter_index || 1;
    const endChapter = chapters.at(-1)?.chapter_index || 1;
    response.json({
      ok: true,
      indexPrompts: bookPrompts,
      indexGroups: listBookIndexGroups(request.params.bookId),
      coverage: {
        l1: getL1IndexCoverageForBook({
          bookId: request.params.bookId,
          startChapter,
          endChapter
        }),
        l2: getL2IndexCoverageForBook({
          bookId: request.params.bookId,
          indexGroupKey: request.query.index_group_key || request.query.indexGroupKey || "base",
          startChapter,
          endChapter
        })
      }
    });
  } catch (error) {
    next(error);
  }
});

app.put("/api/books/:bookId/index-prompts", (request, response, next) => {
  try {
    response.json({
      ok: true,
      indexPrompts: updateBookIndexPrompts(request.params.bookId, request.body || {})
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/analyses", (request, response, next) => {
  try {
    const task = startAnalysisTask(request.body || {});
    response.status(202).json({ ok: true, task: publicTask(task) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/analyses", (request, response) => {
  response.json({ ok: true, analyses: listAnalysisRuns(request.query.book_id || request.query.bookId) });
});

app.get("/api/analyses/:id", async (request, response, next) => {
  try {
    response.json({ ok: true, analysis: publicAnalysisRunWithResult(request.params.id) });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/analyses/:id", (request, response, next) => {
  try {
    response.json({ ok: true, ...deleteAnalysisRun(request.params.id) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/analyses/:id/events", (request, response, next) => {
  try {
    subscribeTask(request.params.id, response);
  } catch (error) {
    next(error);
  }
});

app.post("/api/analyses/:id/resume-run", (request, response, next) => {
  try {
    const task = resumeAnalysisRunTask(request.params.id);
    response.status(202).json({ ok: true, task: publicTask(task) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/analyses/:id/cancel", (request, response, next) => {
  try {
    response.json({ ok: true, task: cancelTask(request.params.id) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/analyses/:id/pause", (request, response, next) => {
  try {
    response.json({ ok: true, task: pauseTask(request.params.id) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/analyses/:id/resume", (request, response, next) => {
  try {
    response.json({ ok: true, task: resumeTask(request.params.id) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/index-prompts", (_request, response) => {
  response.json({ ok: true, indexPrompts: getIndexPromptSettings() });
});

app.put("/api/index-prompts", (request, response, next) => {
  try {
    response.json({ ok: true, indexPrompts: saveIndexPromptSettings(request.body || {}) });
  } catch (error) {
    next(error);
  }
});

app.use(express.static(staticDir, {
  setHeaders(response, filePath) {
    if (filePath.endsWith(".html") || filePath.endsWith(".js") || filePath.endsWith(".css")) {
      response.setHeader("Cache-Control", "no-store");
    }
  }
}));
app.get(/.*/, (_request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.sendFile(path.resolve(staticDir, "index.html"));
});

app.use((error, _request, response, _next) => {
  const safe = sanitizeError(error);
  response.status(safe.status || 500).json({
    ok: false,
    error: safe.message,
    details: safe.details
  });
});

app.listen(config.port, config.host, () => {
  console.log(`Novel Chapter GPT Service: http://${config.host}:${config.port}`);
});

function normalizeDifyTestTarget(value) {
  const normalized = String(value || "all").trim().toLowerCase();
  if (["import", "l1", "l2", "analysis_summary", "all"].includes(normalized)) return normalized;
  const error = new Error("target 只支持 import、l1、l2、analysis_summary、all。");
  error.status = 422;
  throw error;
}
