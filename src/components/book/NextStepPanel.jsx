import { ArrowRight } from "lucide-react";

/**
 * 下一步建议卡：journey.js 推导结果 + 可选跳转按钮（journey.page 为 null 时不给跳转）。
 */
export function NextStepPanel({ journey, onGo }) {
  if (!journey) return null;
  return (
    <section className="card-panel next-step-panel">
      <h3 className="card-panel-title">下一步建议</h3>
      <div className="row-item">
        <div className="row-main">
          <strong>{journey.stage}</strong>
          <span className="row-sub">{journey.note}</span>
        </div>
        {journey.page && onGo ? (
          <button className="secondary inline" type="button" onClick={() => onGo(journey.page)}>
            前往
            <ArrowRight size={14} />
          </button>
        ) : null}
      </div>
    </section>
  );
}
