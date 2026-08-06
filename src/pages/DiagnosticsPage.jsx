import { Activity, Database, HardDrive, RefreshCcw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiGet, formatTime } from "../api.js";
import { taskDisplayName } from "../constants/index.js";
import { taskStatusLabel } from "../constants/taskStatus.js";
import { useAppContext } from "../context/appContext.js";
import { IconButton, Panel, RuntimeGrid, StatusPill } from "../ui.jsx";

export function DiagnosticsPage() {
  const { config, setError } = useAppContext();
  const [diagnostics, setDiagnostics] = useState(null);
  const [busy, setBusy] = useState(false);
  // 请求序号：卸载或重复触发时在途响应直接作废
  const loadSeqRef = useRef(0);

  const loadDiagnostics = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    setBusy(true);
    setError("");
    try {
      const data = await apiGet("/api/diagnostics");
      if (seq !== loadSeqRef.current) return;
      setDiagnostics(data);
    } catch (error) {
      if (seq !== loadSeqRef.current) return;
      setError(error.message);
    } finally {
      if (seq === loadSeqRef.current) setBusy(false);
    }
  }, [setError]);

  useEffect(() => {
    // 初次加载与手动刷新同一条路径（同一 busy 语义）；
    // 微任务中启动：加载函数同步 setBusy/setError，不能落在 effect 同步阶段
    void Promise.resolve().then(() => loadDiagnostics());
    return () => {
      loadSeqRef.current += 1;
    };
  }, [loadDiagnostics]);

  const runtime = useMemo(() => diagnostics?.runtime || config || {}, [diagnostics?.runtime, config]);
  const database = diagnostics?.database || {};
  const tasks = diagnostics?.tasks || {};
  const books = database.books || [];
  const totals = database.totals || {};
  const l1Status = database.statuses?.l1 || {};
  const l2Status = database.statuses?.l2 || {};
  const analysisStatus = database.statuses?.analyses || {};

  const healthItems = useMemo(() => [
    { label: "Dify", ok: Boolean(runtime.difyConfigured), value: runtime.difyConfigured ? "已配置" : "未配置" },
    { label: "章节线索", ok: Boolean(runtime.difyL1Configured), value: runtime.difyL1Configured ? "已配置" : "未配置" },
    { label: "事实索引", ok: Boolean(runtime.difyL2Configured), value: runtime.difyL2Configured ? "已配置" : "未配置" },
    { label: "分析汇总", ok: Boolean(runtime.difyAnalysisSummaryConfigured), value: runtime.difyAnalysisSummaryConfigured ? "已配置" : "未配置" },
    // 任务运行中是正常状态，不算异常：用信息色而非危险色
    { label: "任务", tone: Number(tasks.live || 0) ? "info" : "ok", value: Number(tasks.live || 0) ? `${tasks.live} 个运行中` : "空闲" }
  ], [runtime, tasks.live]);

  return (
    <section className="diagnostics-layout">
      <header className="page-hero">
        <div>
          <span>低频运维页</span>
          <h2>诊断</h2>
          <p>运行环境 · 任务健康度 · 数据规模（顶栏图标进入）。</p>
        </div>
      </header>

      <Panel icon={Database} title="运行环境">
        <RuntimeGrid config={runtime} />
        <div className="diagnostic-storage">
          <span>数据目录：{runtime.dataDir || "-"}</span>
        </div>
      </Panel>

      <Panel
        icon={ShieldCheck}
        title="系统诊断"
        action={<IconButton icon={RefreshCcw} label="刷新" onClick={loadDiagnostics} disabled={busy} />}
      >
        <div className="diagnostic-hero">
          {healthItems.map((item) => (
            <div className="diagnostic-health-card" key={item.label}>
              <span>{item.label}</span>
              <strong className={item.tone || (item.ok ? "ok" : "bad")}>{item.value}</strong>
            </div>
          ))}
        </div>
        <p className="diagnostic-note">
          只展示运行和索引元数据，不展示密钥、章节正文、L1 内容或 L2 事实正文。
        </p>
      </Panel>

      <div className="diagnostics-grid">
        <Panel icon={Database} title="数据规模">
          <div className="diagnostic-metrics">
            <Metric label="书籍" value={totals.books} />
            <Metric label="章节" value={totals.chapters} />
            <Metric label="章节线索" value={totals.l1_indexes} />
            <Metric label="事实索引章节" value={totals.l2_chapter_statuses} />
            <Metric label="事实" value={totals.l2_facts} />
            <Metric label="提问" value={totals.analyses} />
            <Metric label="汇总分块" value={totals.summary_parts} />
          </div>
        </Panel>

        <Panel icon={Activity} title="状态分布">
          <div className="diagnostic-status-grid">
            <StatusGroup title="章节线索" values={l1Status} />
            <StatusGroup title="事实索引" values={l2Status} />
            <StatusGroup title="提问任务" values={analysisStatus} />
            <StatusGroup title="内存任务" values={tasks.by_status || {}} />
          </div>
        </Panel>
      </div>

      <Panel icon={HardDrive} title="存储与任务">
        <div className="diagnostic-storage">
          <span>数据库：{formatBytes(database.storage?.db_file_bytes || 0)}</span>
          <span>更新时间：{formatTime(database.storage?.db_updated_at)}</span>
          <span>数据目录：{runtime.dataDir || "-"}</span>
        </div>
        {tasks.recent?.length ? (
          <div className="table-wrap diagnostic-table">
            <table>
              <thead>
                <tr>
                  <th>类型</th>
                  <th>状态</th>
                  <th>进度</th>
                  <th>更新时间</th>
                  <th>错误</th>
                </tr>
              </thead>
              <tbody>
                {tasks.recent.map((task) => (
                  <tr key={task.id}>
                    <td>{taskDisplayName(task.type)}</td>
                    <td><StatusPill status={task.status} /></td>
                    <td>{taskProgressText(task.progress)}</td>
                    <td>{formatTime(task.updatedAt)}</td>
                    <td>{task.error || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">暂无内存任务</div>
        )}
      </Panel>

      <Panel icon={Database} title="书籍索引概览">
        {books.length ? (
          <div className="table-wrap diagnostic-table">
            <table>
              <thead>
                <tr>
                  <th>书籍</th>
                  <th>章节</th>
                  <th>章节线索完成</th>
                  <th>事实索引完成</th>
                  <th>事实数</th>
                  <th>提问</th>
                  <th>更新</th>
                </tr>
              </thead>
              <tbody>
                {books.map((book) => (
                  <tr key={book.book_id}>
                    <td>
                      <strong>{book.book_name || book.book_id}</strong>
                      <span className="muted-cell">{book.book_id}</span>
                    </td>
                    <td>{book.chapter_count || 0}</td>
                    <td>{statusCount(book.l1, "completed")}</td>
                    <td>{statusCount(book.l2, "completed")}</td>
                    <td>{book.l2_facts || 0}</td>
                    <td>{statusCount(book.analyses, "completed")}/{sumCounts(book.analyses)}</td>
                    <td>{formatTime(book.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">暂无书籍</div>
        )}
      </Panel>
    </section>
  );
}

function Metric({ label, value }) {
  return (
    <div className="diagnostic-metric">
      <span>{label}</span>
      <strong>{Number(value || 0).toLocaleString("zh-CN")}</strong>
    </div>
  );
}

function StatusGroup({ title, values }) {
  const entries = Object.entries(values || {}).filter(([, count]) => Number(count || 0) > 0);
  return (
    <div className="diagnostic-status-group">
      <strong>{title}</strong>
      {entries.length ? entries.map(([status, count]) => (
        <span key={status}>{taskStatusLabel(status)} {Number(count || 0)}</span>
      )) : <span>无记录</span>}
    </div>
  );
}

function taskProgressText(progress = {}) {
  const total = Number(progress.total || 0);
  const done = Number(progress.completed || 0) + Number(progress.failed || 0) + Number(progress.skipped || 0);
  return total ? `${done}/${total} · ${progress.current || ""}` : progress.current || "-";
}

function statusCount(values, key) {
  return Number(values?.[key] || 0);
}

function sumCounts(values = {}) {
  return Object.values(values || {}).reduce((sum, value) => sum + Number(value || 0), 0);
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
