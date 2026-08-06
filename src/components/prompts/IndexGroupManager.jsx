import { factIndexName } from "../../analysisCoverage.js";
import { BASE_INDEX_GROUP_KEY } from "../../constants/index.js";
import {
  normalizeIndexGroupKeyClient,
  resolveAvailableIndexGroupKey,
  slugifyIndexGroupKey
} from "../../hooks/usePromptIndexGroups.js";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";

export function IndexGroupManager({ groups, selectedKey, draft, busy, onSelect, onNew, onDraftChange, onSave, onDelete }) {
  const isCreating = !selectedKey;
  // base 默认组随书籍自动存在（兼容历史数据），服务端禁止改名/改规则/删除，UI 对应只读
  const isBaseGroup = selectedKey === BASE_INDEX_GROUP_KEY;
  const previewRawKey = draft.group_key || slugifyIndexGroupKey(draft.name);
  const previewKey = resolveAvailableIndexGroupKey(previewRawKey, groups);
  const previewBaseKey = normalizeIndexGroupKeyClient(previewRawKey);
  const previewAdjusted = isCreating && previewBaseKey !== previewKey;
  return (
    <div className="index-group-manager">
      <div className="index-group-head">
        <div>
          <strong>事实索引</strong>
          <span>每个事实索引只负责一类稳定分析方向</span>
        </div>
        <div className="index-group-head-actions">
          <button className="secondary inline index-group-new-button" type="button" onClick={onNew}>
            <Plus size={14} />
            新建事实索引
          </button>
        </div>
      </div>
      {groups.length ? (
        <div className="index-group-tabs">
          {groups.map((group) => (
            <button
              key={group.group_key}
              type="button"
              className={group.group_key === selectedKey ? "active" : ""}
              onClick={() => onSelect(group.group_key)}
            >
              <strong>{factIndexName(group)}</strong>
              {group.group_key === BASE_INDEX_GROUP_KEY ? <span>默认</span> : null}
            </button>
          ))}
        </div>
      ) : null}
      {isCreating || selectedKey ? (
        <div className="index-group-editor">
          <div className="form-grid compact">
            <label>
              <span>名称</span>
              <input value={draft.name} placeholder="修炼法宝事实索引" disabled={isBaseGroup} onChange={(event) => onDraftChange({ name: event.target.value })} />
            </label>
          </div>
          {isCreating ? (
            <div className="muted-line">
              索引 key：{previewKey}
              {previewAdjusted ? `（${previewBaseKey} 已存在，自动避让）` : ""}
            </div>
          ) : null}
          <label className="block-label">
            <span>事实索引规则</span>
            <textarea value={draft.l2_index_prompt} placeholder="写清楚这个事实索引只提取哪些可复用事实。" disabled={isBaseGroup} onChange={(event) => onDraftChange({ l2_index_prompt: event.target.value })} />
          </label>
          {isBaseGroup ? (
            <div className="muted-line">默认索引兼容历史数据，规则随书籍级 L2 规则同步，不可单独编辑。</div>
          ) : null}
          <div className="index-group-actions">
            <div className="action-row">
              <button className="secondary inline index-group-save-button" type="button" onClick={onSave} disabled={busy || isBaseGroup}>
                {busy ? <Loader2 className="spin" size={15} /> : <Save size={15} />}
                保存事实索引
              </button>
              {!isCreating && !isBaseGroup ? (
                <button className="danger inline" type="button" onClick={onDelete} disabled={busy}>
                  <Trash2 size={15} />
                  删除
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
