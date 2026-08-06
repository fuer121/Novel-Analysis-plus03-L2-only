import { Database } from "lucide-react";
import { AnalysisCommandPanel } from "../components/analysis/AnalysisCommandPanel.jsx";
import { AnalysisHistoryPanel } from "../components/analysis/AnalysisHistoryPanel.jsx";
import { AnalysisResultPanel } from "../components/analysis/AnalysisResult.jsx";
import { useAppContext } from "../context/appContext.js";
import { useAnalysisData } from "../hooks/useAnalysisData.js";
import { navigate, paths } from "../router.js";
import { otherBookTaskHint } from "../utils/taskProgress.js";

/**
 * 提问管理页（#/book/:id/ask）：由分析页改造而来。书来自路由（无本地选书），
 * 发起提问 + 提问任务管理（进行中可暂停/恢复/取消，历史可查看结果/复制续跑）。
 */
export function AskManagePage({
  bookId,
  onLoadBookIndexGroups,
  analysisTask,
  analysisBusy,
  onStartAnalysis,
  onResumeAnalysisRun,
  onAnalysisCancel,
  onAnalysisPause,
  onAnalysisResume
}) {
  const { books } = useAppContext();
  const book = books.find((entry) => entry.book_id === bookId) || null;
  // 任务通道是全局的：本书任务驱动本页任务盒与结果拉取；别书任务占用通道时禁用启动并给出提示
  const scopedAnalysisTask = analysisTask?.payload?.bookId === bookId ? analysisTask : null;
  const externalAnalysisTask = analysisBusy && !scopedAnalysisTask ? analysisTask : null;
  const blockedHint = otherBookTaskHint(externalAnalysisTask, books, "正在提问");
  const {
    analyses,
    listBusy,
    loadAnalyses,
    analysisForm,
    updateAnalysisForm,
    selectedBook,
    analysisProviderReady,
    indexGroups,
    selectedL2QueryIndexKeys,
    toggleL2QueryIndexKey,
    selectedL2QueryEnabledIndexKeys,
    hasBoundIndexGroups,
    l2QueryText,
    setL2QueryText,
    selectedIndexes,
    chaptersInRange,
    l2CoveragesByGroup,
    selectedAnalysis,
    loadAnalysisResult,
    startAnalysis,
    controlAnalysis,
    resumeSelectedAnalysis,
    copyAnalysis,
    deleteAnalysis
  } = useAnalysisData({
    bookId,
    analysisTask: scopedAnalysisTask,
    onStartAnalysis,
    onResumeAnalysisRun,
    onAnalysisCancel,
    onAnalysisPause,
    onAnalysisResume,
    onLoadBookIndexGroups
  });

  return (
    <section className="analysis-layout analysis-workspace">
      <header className="page-hero">
        <div>
          <span>{book?.book_name || bookId}</span>
          <h2>提问管理</h2>
          <p>基于章节线索与事实索引提问，管理进行中和历史的提问任务。</p>
        </div>
        <div className="page-hero-actions">
          <button className="secondary inline" type="button" onClick={() => navigate(paths.l2(bookId))}>
            <Database size={16} />
            管理事实索引
          </button>
        </div>
      </header>

      <section className="analysis-command-row">
        <AnalysisCommandPanel
          selectedBook={selectedBook}
          analysisForm={analysisForm}
          onFormChange={updateAnalysisForm}
          indexGroups={indexGroups}
          selectedL2QueryIndexKeys={selectedL2QueryIndexKeys}
          onToggleIndexKey={toggleL2QueryIndexKey}
          l2QueryText={l2QueryText}
          onL2QueryTextChange={setL2QueryText}
          l2CoveragesByGroup={l2CoveragesByGroup}
          selectedL2QueryEnabledIndexKeys={selectedL2QueryEnabledIndexKeys}
          hasBoundIndexGroups={hasBoundIndexGroups}
          analysisProviderReady={analysisProviderReady}
          selectedCount={selectedIndexes.length}
          totalInRange={chaptersInRange.length}
          onStart={startAnalysis}
          analysisTask={scopedAnalysisTask}
          analysisBusy={analysisBusy && Boolean(scopedAnalysisTask)}
          blockedHint={blockedHint}
          onControl={controlAnalysis}
        />
      </section>

      <section className="analysis-review-row">
        <AnalysisHistoryPanel
          analyses={analyses}
          books={books}
          selectedId={selectedAnalysis?.id}
          listBusy={listBusy}
          onRefresh={loadAnalyses}
          onSelect={loadAnalysisResult}
          onCopy={copyAnalysis}
          onDelete={deleteAnalysis}
        />
        <AnalysisResultPanel
          analysis={selectedAnalysis}
          analysisBusy={analysisBusy}
          onResume={resumeSelectedAnalysis}
        />
      </section>
    </section>
  );
}
