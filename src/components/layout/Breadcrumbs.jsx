import { ChevronRight } from "lucide-react";
import { navigate } from "../../router.js";

/**
 * 顶栏面包屑：工作台 › 书名 › 页面。品牌点击回工作台见 App 顶栏。
 * parts: [{ label, badge?, path? }]，最后一段为当前页（不可点）。
 */
export function Breadcrumbs({ parts }) {
  if (!parts?.length) return null;
  return (
    <nav className="crumbs" aria-label="面包屑">
      {parts.map((part, index) => {
        const last = index === parts.length - 1;
        return (
          <span className="crumb-item" key={`${part.label}-${index}`}>
            {index > 0 ? <ChevronRight className="crumb-sep" size={13} /> : null}
            {last || !part.path ? (
              <span className="crumb-here">
                {part.label}
                {part.badge ? <span className="badge">{part.badge}</span> : null}
              </span>
            ) : (
              <button type="button" onClick={() => navigate(part.path)}>
                {part.label}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}
