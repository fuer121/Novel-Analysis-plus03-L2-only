import { ArrowRight } from "lucide-react";
import { ProgressBar } from "../ProgressBar.jsx";

/**
 * 书籍首页入口卡：图标 + 标题（L1/L2 角标）+ 简介 + 状态摘要 + 进行中进度条。
 */
export function EntryCard({ icon: Icon, title, badge, description, stat, actionLabel, running = false, percent = 0, onClick }) {
  return (
    <button className="entry-card" type="button" onClick={onClick}>
      <span className="entry-icon"><Icon size={19} /></span>
      <span className="entry-title">
        {title}
        {badge ? <span className="badge">{badge}</span> : null}
      </span>
      <span className="entry-desc">{description}</span>
      {running ? <ProgressBar percent={percent} tone="info" label={title} /> : null}
      <span className="entry-foot">
        <span className="entry-stat">{stat}</span>
        <span className="entry-go">{actionLabel}<ArrowRight size={13} /></span>
      </span>
    </button>
  );
}
