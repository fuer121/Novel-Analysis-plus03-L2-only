import { useState } from "react";

/**
 * 规则折叠卡（v5 rule-fold）：默认收起，头部显示标题 + 「规则」tag + meta + 展开指示，
 * 展开后正文限高滚动。children 即规则编辑器等内容。
 */
export function RuleFold({ title, meta = "", defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rule-fold">
      <button className="rf-head" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <h5>{title}</h5>
        <span className="tag">规则</span>
        <span className="rf-meta">
          {meta ? <span>{meta}</span> : null}
          <span>{open ? "收起 ▴" : "查看完整版 ▾"}</span>
        </span>
      </button>
      {open ? <div className="rf-body">{children}</div> : null}
    </section>
  );
}
