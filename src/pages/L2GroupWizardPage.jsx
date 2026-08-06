import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Loader2, Play, Rocket } from "lucide-react";
import { factIndexName } from "../analysisCoverage.js";
import { apiGet, l2CoverageUrl, l2FactsUrl } from "../api.js";
import { Taskbar } from "../components/Taskbar.jsx";
import { isLiveTask, TERMINAL_TASK_STATUSES } from "../constants/taskStatus.js";
import { useAppContext } from "../context/appContext.js";
import {
  normalizeIndexGroupKeyClient,
  resolveAvailableIndexGroupKey,
  slugifyIndexGroupKey
} from "../hooks/usePromptIndexGroups.js";
import { navigate, paths, useRoute } from "../router.js";
import { otherBookTaskHint } from "../utils/taskProgress.js";
import { Panel } from "../ui.jsx";

const STEPS = ["定义", "规则", "试跑验收", "全量构建"];
const TRIAL_SAMPLE_LIMIT = 5;

/**
 * 新建索引组四步向导（#/book/:id/l2/new?step=N）：定义 → 规则 → 试跑验收 → 全量构建。
 * 全部走真实 API：第二步离开时 POST 创建组（已创建则 PUT 更新）；试跑 = force:true 的
 * 小范围构建；全量 = mode:"missing" 全书断点补齐，启动后跳回 L2 页（?g=key）。
 * 试跑未验收前「进入全量」保持 disabled（向导内强制先验收）。
 */
export function L2GroupWizardPage({
  bookId,
  l2Task,
  l2Busy,
  onStartL2Index,
  onL2Cancel,
  onL2Pause,
  onL2Resume,
  onLoadBookIndexGroups,
  onCreateBookIndexGroup,
  onUpdateBookIndexGroup
}) {
  const { books, setError } = useAppContext();
  const { query } = useRoute();
  const book = books.find((entry) => entry.book_id === bookId) || null;
  const firstChapter = book?.first_chapter || 1;
  const lastChapter = book?.last_chapter || firstChapter;
  const totalChapters = Number(book?.chapter_count || 0);

  // ---- 步骤（?step=N 直达/刷新恢复；未创建组时 3/4 步渲染空态） ----
  const step = Math.min(4, Math.max(1, Number(query.step || 1) || 1));
  function goStep(next) {
    navigate(`${paths.l2New(bookId)}?step=${next}`);
  }

  // ---- 第一步：定义 ----
  const [name, setName] = useState("");
  const [keyText, setKeyText] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [desc, setDesc] = useState("");
  const [bookGroups, setBookGroups] = useState([]);
  const [createdGroupKey, setCreatedGroupKey] = useState("");
  const [createdGroup, setCreatedGroup] = useState(null);

  useEffect(() => {
    if (!bookId) return undefined;
    let cancelled = false;
    onLoadBookIndexGroups(bookId)
      .then((groups) => {
        if (!cancelled) setBookGroups(groups);
      })
      .catch((error) => {
        if (!cancelled) setError(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [bookId]); // eslint-disable-line react-hooks/exhaustive-deps

  const autoKey = slugifyIndexGroupKey(name);
  const wantedKey = keyTouched ? keyText : autoKey;
  const previewKey = createdGroupKey || resolveAvailableIndexGroupKey(wantedKey, bookGroups);
  const previewAdjusted = !createdGroupKey && normalizeIndexGroupKeyClient(wantedKey) !== previewKey;

  // ---- 第二步：规则（三种起点） ----
  const [rule, setRule] = useState("");
  const [ruleSource, setRuleSource] = useState("");
  const [sourceBusy, setSourceBusy] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function fillFromDefault() {
    setSourceBusy(true);
    setSubmitError("");
    try {
      const data = await apiGet("/api/index-prompts");
      setRule(data.indexPrompts?.l2_index_prompt || "");
      setRuleSource("全局默认规则");
    } catch (error) {
      setSubmitError(error.message);
    } finally {
      setSourceBusy(false);
    }
  }

  // 默认以全局默认规则为起点预填（仅一次、规则仍为空时；失败静默，用户可再手动选起点）。
  const rulePrefilled = useRef(false);
  useEffect(() => {
    if (rulePrefilled.current) return;
    rulePrefilled.current = true;
    apiGet("/api/index-prompts")
      .then((data) => {
        const prompt = data.indexPrompts?.l2_index_prompt || "";
        if (!prompt) return;
        setRule((current) => (current ? current : prompt));
        setRuleSource((current) => (current ? current : "全局默认规则"));
      })
      .catch(() => {});
  }, []);

  function fillFromBookGroup(groupKey) {
    const group = bookGroups.find((entry) => entry.group_key === groupKey);
    if (!group) return;
    setRule(group.l2_index_prompt || "");
    setRuleSource(`本书索引组「${factIndexName(group)}」`);
  }

  const otherBooks = useMemo(() => books.filter((entry) => entry.book_id !== bookId), [books, bookId]);
  const [otherBookId, setOtherBookId] = useState("");
  const [otherBookGroups, setOtherBookGroups] = useState([]);

  async function loadOtherBookGroups(nextBookId) {
    setOtherBookId(nextBookId);
    setOtherBookGroups([]);
    if (!nextBookId) return;
    setSourceBusy(true);
    setSubmitError("");
    try {
      const groups = await onLoadBookIndexGroups(nextBookId);
      setOtherBookGroups(groups.filter((group) => String(group.l2_index_prompt || "").trim()));
    } catch (error) {
      setSubmitError(error.message);
    } finally {
      setSourceBusy(false);
    }
  }

  function fillFromOtherGroup(groupKey) {
    const group = otherBookGroups.find((entry) => entry.group_key === groupKey);
    if (!group) return;
    const bookName = books.find((entry) => entry.book_id === otherBookId)?.book_name || otherBookId;
    setRule(group.l2_index_prompt || "");
    setRuleSource(`《${bookName}》索引组「${factIndexName(group)}」`);
  }

  async function submitDefinitionAndRule() {
    if (!name.trim()) {
      setSubmitError("索引组名称不能为空。");
      return;
    }
    setSubmitting(true);
    setSubmitError("");
    try {
      if (!createdGroupKey) {
        const saved = await onCreateBookIndexGroup(bookId, {
          group_key: previewKey,
          name: name.trim(),
          description: desc.trim(),
          category_scope: [],
          trigger_keywords: [],
          l2_index_prompt: rule
        });
        setCreatedGroupKey(saved.group_key);
        setCreatedGroup(saved);
        setBookGroups((groups) => [...groups, saved]);
      } else {
        const saved = await onUpdateBookIndexGroup(bookId, createdGroupKey, {
          ...(createdGroup || {}),
          name: name.trim(),
          description: desc.trim(),
          l2_index_prompt: rule
        });
        setCreatedGroup(saved);
      }
      goStep(3);
    } catch (error) {
      setSubmitError(error.message);
    } finally {
      setSubmitting(false);
    }
  }

  // ---- 第三步：试跑验收 ----
  const [trialChoice, setTrialChoice] = useState("p20");
  const [trialCustom, setTrialCustom] = useState({ start: "", end: "" });
  const [trialTaskId, setTrialTaskId] = useState("");
  const [trialRange, setTrialRange] = useState(null);
  const [trialResult, setTrialResult] = useState(null);
  const [trialLoading, setTrialLoading] = useState(false);

  const trialRangeEffective = useMemo(() => {
    if (trialChoice === "custom") {
      const start = Number(trialCustom.start) || firstChapter;
      const end = Number(trialCustom.end) || Math.min(firstChapter + 19, lastChapter);
      return { start: Math.min(start, end), end: Math.max(start, end) };
    }
    const size = trialChoice === "p50" ? 50 : 20;
    return { start: firstChapter, end: Math.min(firstChapter + size - 1, lastChapter) };
  }, [trialChoice, trialCustom, firstChapter, lastChapter]);

  // 任务通道是全局单任务：别书任务或本书他组任务占用时禁止启动（与 Taskbar 口径一致）
  const bookL2Task = l2Task?.payload?.bookId === bookId ? l2Task : null;
  const taskGroupKey = bookL2Task?.payload?.indexGroupKey || "";
  const trialTask = bookL2Task && createdGroupKey && taskGroupKey === createdGroupKey ? bookL2Task : null;
  const trialLive = isLiveTask(trialTask);
  const otherGroupTaskName = bookL2Task && isLiveTask(bookL2Task) && taskGroupKey && taskGroupKey !== createdGroupKey
    ? factIndexName(bookGroups.find((group) => group.group_key === taskGroupKey) || { group_key: taskGroupKey, name: "" })
    : "";
  const blockedHint = otherBookTaskHint(l2Busy && !bookL2Task ? l2Task : null, books, "正在构建事实索引")
    || (otherGroupTaskName ? `索引组「${otherGroupTaskName}」正在构建，完成后可启动` : "");

  async function startTrial() {
    if (!createdGroupKey || trialLive || blockedHint) return;
    setTrialResult(null);
    setTrialRange(trialRangeEffective);
    const task = await onStartL2Index({
      bookId,
      indexGroupKey: createdGroupKey,
      startChapter: trialRangeEffective.start,
      endChapter: trialRangeEffective.end,
      force: true,
      mode: "all"
    });
    if (task?.id) setTrialTaskId(task.id);
  }

  // 试跑任务到达终态后拉产出：coverage 计数 + 事实样例行
  const trialTerminal = trialTaskId && trialTask && TERMINAL_TASK_STATUSES.includes(trialTask.status) ? trialTask.status : "";
  useEffect(() => {
    if (!trialTerminal || !trialRange || !createdGroupKey) return undefined;
    if (trialTerminal !== "completed" && trialTerminal !== "completed_with_errors") return undefined;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setTrialLoading(true);
    });
    Promise.all([
      apiGet(l2CoverageUrl(bookId, {
        start_chapter: trialRange.start,
        end_chapter: trialRange.end,
        index_group_key: createdGroupKey
      })),
      apiGet(l2FactsUrl(bookId, {
        start_chapter: trialRange.start,
        end_chapter: trialRange.end,
        index_group_key: createdGroupKey,
        limit: TRIAL_SAMPLE_LIMIT
      }))
    ])
      .then(([coverageData, factsData]) => {
        if (cancelled) return;
        const chapters = coverageData.coverage?.chapters || {};
        setTrialResult({
          status: trialTerminal,
          range: trialRange,
          factsCount: Number(chapters.facts || 0),
          completedChapters: Number(chapters.completed || 0),
          failedCount: Array.isArray(coverageData.coverage?.failed_chapters) ? coverageData.coverage.failed_chapters.length : 0,
          samples: (factsData.facts || []).slice(0, TRIAL_SAMPLE_LIMIT)
        });
      })
      .catch((error) => {
        if (!cancelled) setError(error.message);
      })
      .finally(() => {
        if (!cancelled) setTrialLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [trialTerminal, trialRange, createdGroupKey, bookId, setError]);

  // ---- 第四步：全量 ----
  async function startFullBuild() {
    if (!createdGroupKey || blockedHint) return;
    const task = await onStartL2Index({
      bookId,
      indexGroupKey: createdGroupKey,
      startChapter: firstChapter,
      endChapter: lastChapter,
      force: false,
      mode: "missing"
    });
    if (task) navigate(`${paths.l2(bookId)}?g=${encodeURIComponent(createdGroupKey)}`);
  }

  return (
    <section className="manage-page">
      <header className="page-hero">
        <div>
          <span>{book?.book_name || bookId}</span>
          <h2>新建索引组<span className="badge hero-badge">L2</span></h2>
          <p>定义 → 规则 → 试跑验收 → 全量构建。试跑通过才能进入全量。</p>
        </div>
      </header>

      <div className="steps">
        {STEPS.map((label, index) => {
          const number = index + 1;
          const state = number === step ? "on" : number < step ? "done" : "";
          return (
            <div className={`step ${state}`} key={label}>
              <span className="n">{number < step ? "✓" : number}</span>
              {label}
            </div>
          );
        })}
      </div>

      {step === 1 ? (
        <Panel icon={ArrowRight} title="第一步 · 定义">
          <div className="form-row">
            <label>索引组名称</label>
            <input
              value={name}
              placeholder="修炼法宝事实索引"
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </div>
          <div className="form-row">
            <label>KEY（自动生成，可改）</label>
            <input
              className="mono"
              value={keyTouched ? keyText : autoKey}
              onChange={(event) => {
                setKeyTouched(true);
                setKeyText(normalizeIndexGroupKeyClient(event.target.value));
              }}
            />
            <div className="muted-line">
              实际创建 key：{previewKey}
              {previewAdjusted ? `（${normalizeIndexGroupKeyClient(wantedKey)} 已存在，自动避让）` : ""}
            </div>
          </div>
          <div className="form-row">
            <label>一句话说明（索引组抽屉与提问页将展示）</label>
            <input value={desc} placeholder="这组索引抽什么、服务哪类提问" onChange={(event) => setDesc(event.target.value)} />
          </div>
          <div className="wiz-ops">
            <button className="secondary inline" type="button" onClick={() => navigate(paths.l2(bookId))}>
              <ArrowLeft size={14} />
              返回事实索引
            </button>
            <button className="primary inline" type="button" disabled={!name.trim()} onClick={() => goStep(2)}>
              下一步 · 规则
              <ArrowRight size={14} />
            </button>
          </div>
        </Panel>
      ) : null}

      {step === 2 ? (
        <Panel icon={ArrowRight} title="第二步 · 规则">
          <div className="wiz-card-grid">
            <button type="button" className={`wiz-card${ruleSource === "全局默认规则" ? " on" : ""}`} onClick={fillFromDefault} disabled={sourceBusy}>
              <h6>从默认规则开始</h6>
              <p>使用全局 L2 默认提取规则，在此基础上改写。</p>
            </button>
            <div className={`wiz-card${ruleSource.startsWith("本书索引组") ? " on" : ""}`}>
              <h6>复制本书已有组</h6>
              <p>以本书已建索引组的规则为起点。</p>
              <select defaultValue="" onChange={(event) => fillFromBookGroup(event.target.value)}>
                <option value="" disabled>选择本书索引组…</option>
                {bookGroups.map((group) => (
                  <option key={group.group_key} value={group.group_key}>{factIndexName(group)}</option>
                ))}
              </select>
            </div>
            <div className={`wiz-card${ruleSource.startsWith("《") ? " on" : ""}`}>
              <h6>复制他书已验收组</h6>
              <p>复用其他书已验收的专项规则（高价值路径）。</p>
              <select value={otherBookId} onChange={(event) => void loadOtherBookGroups(event.target.value)}>
                <option value="">选择书…</option>
                {otherBooks.map((entry) => (
                  <option key={entry.book_id} value={entry.book_id}>{entry.book_name || entry.book_id}</option>
                ))}
              </select>
              {otherBookId ? (
                <select defaultValue="" onChange={(event) => fillFromOtherGroup(event.target.value)} disabled={sourceBusy}>
                  <option value="" disabled>选择索引组…</option>
                  {otherBookGroups.map((group) => (
                    <option key={group.group_key} value={group.group_key}>{factIndexName(group)}</option>
                  ))}
                </select>
              ) : null}
            </div>
          </div>
          {ruleSource ? <div className="muted-line">规则来源：{ruleSource}</div> : null}
          <div className="form-row">
            <label>事实索引规则（可编辑全文）</label>
            <textarea value={rule} placeholder="写清楚这个事实索引只提取哪些可复用事实。" onChange={(event) => setRule(event.target.value)} />
          </div>
          {submitError ? <div className="alert">{submitError}</div> : null}
          <div className="wiz-ops">
            <button className="secondary inline" type="button" onClick={() => goStep(1)}>
              <ArrowLeft size={14} />
              上一步
            </button>
            <button className="primary inline" type="button" disabled={submitting || !name.trim()} onClick={submitDefinitionAndRule}>
              {submitting ? <Loader2 className="spin" size={14} /> : null}
              {createdGroupKey ? "保存规则 · 返回试跑" : "创建索引组 · 进入试跑"}
              <ArrowRight size={14} />
            </button>
          </div>
        </Panel>
      ) : null}

      {step === 3 ? (
        <Panel icon={Play} title="第三步 · 试跑验收">
          {!createdGroupKey ? (
            <div className="empty-state">
              <b>还没有创建索引组。</b>
              <span>请先完成「定义」与「规则」两步，创建后即可试跑。</span>
            </div>
          ) : (
            <>
              <div className="trial-range">
                <span className="range-quick">
                  范围
                  <button type="button" className={trialChoice === "p20" ? "on" : ""} onClick={() => setTrialChoice("p20")}>前 20 回</button>
                  <button type="button" className={trialChoice === "p50" ? "on" : ""} onClick={() => setTrialChoice("p50")}>前 50 回</button>
                  <button type="button" className={trialChoice === "custom" ? "on" : ""} onClick={() => setTrialChoice("custom")}>自定义</button>
                </span>
                {trialChoice === "custom" ? (
                  <>
                    <label>
                      起始章节
                      <input type="text" inputMode="numeric" value={trialCustom.start} placeholder={String(firstChapter)} onChange={(event) => setTrialCustom((value) => ({ ...value, start: event.target.value.replace(/\D/g, "") }))} />
                    </label>
                    <label>
                      结束章节
                      <input type="text" inputMode="numeric" value={trialCustom.end} placeholder={String(Math.min(firstChapter + 19, lastChapter))} onChange={(event) => setTrialCustom((value) => ({ ...value, end: event.target.value.replace(/\D/g, "") }))} />
                    </label>
                  </>
                ) : null}
                <span className="muted-line">试跑第 {trialRangeEffective.start}–{trialRangeEffective.end} 回 · 覆盖式重跑（force）</span>
              </div>
              {trialLive ? (
                <Taskbar
                  title={`试跑「${name || createdGroupKey}」`}
                  sub=""
                  form={{ start_chapter: "", end_chapter: "", force: false }}
                  onFormChange={() => {}}
                  busy={l2Busy}
                  startLabel=""
                  onStart={() => {}}
                  task={trialTask}
                  onCancel={onL2Cancel}
                  onPause={onL2Pause}
                  onResume={onL2Resume}
                />
              ) : null}
              {trialTaskId && trialTask && ["failed", "cancelled"].includes(trialTask.status) ? (
                <div className="alert">试跑{trialTask.status === "failed" ? "失败" : "已取消"}：{trialTask.error || "可调整规则或范围后重试。"}</div>
              ) : null}
              {trialLoading ? <div className="muted-line">试跑产出读取中…</div> : null}
              {trialResult ? (
                <div className="trial-result">
                  <div className="trial-stats">
                    <span>产出 <b>{trialResult.factsCount}</b> 条事实</span>
                    <span>覆盖 <b>{trialResult.completedChapters}</b>/{trialResult.range.end - trialResult.range.start + 1} 回</span>
                    <span>失败 <b>{trialResult.failedCount}</b> 回</span>
                  </div>
                  {trialResult.samples.length ? (
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th className="chapter-col">章</th>
                            <th>主体</th>
                            <th>事实类型</th>
                            <th>事实</th>
                          </tr>
                        </thead>
                        <tbody>
                          {trialResult.samples.map((fact, index) => (
                            <tr key={fact.id || index}>
                              <td>{fact.chapter_index}</td>
                              <td><b>{fact.entity || "-"}</b></td>
                              <td>{fact.fact_type || "-"}</td>
                              <td className="summary-cell">{fact.fact || "无事实正文"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="empty-state"><b>试跑完成但没有产出事实。</b><span>规则可能过严或范围不含目标内容，建议返回改规则再试。</span></div>
                  )}
                </div>
              ) : null}
              {blockedHint ? <p className="muted-line">{blockedHint}</p> : null}
              <div className="wiz-ops">
                <div className="wiz-ops-left">
                  <button className="secondary inline" type="button" onClick={() => goStep(2)}>
                    <ArrowLeft size={14} />
                    返回改规则
                  </button>
                  <button className="secondary inline" type="button" disabled={trialLive || Boolean(blockedHint)} onClick={startTrial}>
                    <Play size={14} />
                    {trialResult ? "再次试跑" : "开始试跑"}
                  </button>
                </div>
                <button className="primary inline" type="button" disabled={!trialResult} onClick={() => goStep(4)}>
                  通过验收 · 进入全量
                  <ArrowRight size={14} />
                </button>
              </div>
            </>
          )}
        </Panel>
      ) : null}

      {step === 4 ? (
        <Panel icon={Rocket} title="第四步 · 全量构建">
          {!createdGroupKey ? (
            <div className="empty-state">
              <b>还没有创建索引组。</b>
              <span>请先完成前三步。</span>
            </div>
          ) : (
            <>
              <div className="wiz-summary">
                <div><span>名称</span><b>{name || createdGroup?.name || createdGroupKey}</b></div>
                <div><span>KEY</span><b className="mono">{createdGroupKey}</b></div>
                <div><span>规则来源</span><b>{ruleSource || "手动编写"}</b></div>
                <div><span>试跑产出</span><b>{trialResult ? `${trialResult.factsCount} 条（第 ${trialResult.range.start}–${trialResult.range.end} 回）` : "未试跑"}</b></div>
                <div><span>全书规模</span><b>{totalChapters} 回</b></div>
              </div>
              <p className="muted-line">全量构建为断点补齐（mode: missing）：已完成的章不重复抽取，可随时暂停/继续。</p>
              {blockedHint ? <p className="muted-line">{blockedHint}</p> : null}
              <div className="wiz-ops">
                <button className="secondary inline" type="button" onClick={() => goStep(3)}>
                  <ArrowLeft size={14} />
                  返回试跑
                </button>
                <button className="primary inline" type="button" disabled={!trialResult || Boolean(blockedHint)} onClick={startFullBuild}>
                  <Rocket size={14} />
                  开始全量构建
                </button>
              </div>
            </>
          )}
        </Panel>
      ) : null}
    </section>
  );
}
