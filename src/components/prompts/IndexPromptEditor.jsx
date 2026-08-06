import { useState } from "react";
import { Copy, Lightbulb, Loader2, Lock, LockOpen } from "lucide-react";
import { formatTime } from "../../api.js";
import { coveragePercent } from "../../analysisCoverage.js";

const l1WritingTips = [
  "章节线索只判断章节是否值得继续读取，不写深度设定集。",
  "所有内容贴近本章原文，禁止补全和脑补。",
  "优先记录主体、别名、关键词和分类信号。",
  "控制长度，结构清晰，不堆流水账。",
  "服务所有事实索引，信号要稳定可复用。"
];

const l2WritingTips = [
  "事实索引只抽可复用事实，不写章节摘要。",
  "主体、别名、相关主体要稳定，方便后续召回。",
  "事实颗粒要小而完整，避免把多件事揉成一条。",
  "每条事实保留证据摘记、重要度和置信度。",
  "分类服务分析目标，当前重点是人物、关系、修行、剑与本命物。"
];

/**
 * 索引规则编辑器。受控于外部 value：value 变化时重置草稿并恢复锁定
 * （替代原先 key={hash+updatedAt} 强制重挂的语义；外部值不变时刷新不再丢弃未保存草稿）。
 * editable=false 时整体只读（用于 base 默认组：规则随书籍级 L2 规则同步，不可在此改）。
 */
export function IndexPromptEditor({ type, title, value, updatedAt, coverage, saving, onSave, editable = true }) {
  const [locked, setLocked] = useState(true);
  const [draftState, setDraftState] = useState({ source: value, draft: value });
  if (draftState.source !== value) {
    // 外部值更新后编辑器跟随（渲染期调整 state）
    setDraftState({ source: value, draft: value });
    if (!locked) setLocked(true);
  }
  const draft = draftState.draft;
  const effectiveLocked = !editable || locked;
  const tipConfig = type === "l1"
    ? { title: "章节线索建议", tips: l1WritingTips }
    : type === "l2"
      ? { title: "事实索引建议", tips: l2WritingTips }
      : null;

  function setDraft(nextDraft) {
    setDraftState({ source: value, draft: nextDraft });
  }

  async function handleSave() {
    try {
      await onSave(draft);
      setLocked(true);
    } catch {
      // Parent owns the user-facing error.
    }
  }

  return (
    <div className="index-prompt-card">
      <div className="index-prompt-head">
        <div>
          <div className="index-prompt-title-row">
            <h3>{title}</h3>
            {tipConfig ? <PromptTipPopover tips={tipConfig.tips} title={tipConfig.title} /> : null}
          </div>
          <small>更新 {formatTime(updatedAt)}</small>
        </div>
        {editable ? (
          <button
            className="secondary inline index-lock-button"
            type="button"
            onClick={() => {
              if (!locked) setDraftState({ source: value, draft: value });
              setLocked((state) => !state);
            }}
          >
            {locked ? <Lock size={15} /> : <LockOpen size={15} />}
            {locked ? "解锁" : "锁定"}
          </button>
        ) : null}
      </div>
      <IndexCoverageLine coverage={coverage} />
      <textarea
        value={draft}
        readOnly={effectiveLocked}
        onChange={(event) => setDraft(event.target.value)}
        aria-label={title}
      />
      {!effectiveLocked ? (
        <div className="action-row">
          <button className="primary inline" type="button" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="spin" size={15} /> : null}
            保存
          </button>
        </div>
      ) : null}
    </div>
  );
}

function PromptTipPopover({ title, tips }) {
  const [pinned, setPinned] = useState(false);
  const text = tips.map((tip, index) => `${index + 1}. ${tip}`).join("\n");

  function copyTips() {
    void navigator.clipboard?.writeText(text);
  }

  return (
    <div className={pinned ? "prompt-tip-popover pinned" : "prompt-tip-popover"}>
      <button
        className="prompt-tip-trigger"
        type="button"
        aria-expanded={pinned}
        aria-label={title}
        onClick={() => setPinned((state) => !state)}
      >
        <Lightbulb size={14} />
        建议
      </button>
      <div className="prompt-tip-panel" role="tooltip">
        <div className="prompt-tip-head">
          <strong>{title}</strong>
          <div className="prompt-tip-actions">
            <button type="button" onClick={copyTips}>
              <Copy size={13} />
              复制
            </button>
            <button type="button" onClick={() => setPinned(false)}>
              收起
            </button>
          </div>
        </div>
        <ol>
          {tips.map((tip) => <li key={tip}>{tip}</li>)}
        </ol>
      </div>
    </div>
  );
}

function IndexCoverageLine({ coverage }) {
  const chapters = coverage?.chapters;
  if (!chapters) return <div className="muted-line">读取中</div>;
  const ratio = coveragePercent(coverage);
  const stale = Number(chapters.outdated || 0);
  return (
    <div className={stale ? "inline-warning" : "muted-line"}>
      覆盖 {chapters.completed}/{chapters.total} 章 · {ratio}%
      {stale ? ` · 过期 ${stale} 章` : ""}
    </div>
  );
}
