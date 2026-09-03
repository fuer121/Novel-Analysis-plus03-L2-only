import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, Database, LoaderCircle, RefreshCw, Search, X } from "lucide-react";
import { formatTime } from "../api.js";
import { useAppContext } from "../context/appContext.js";
import { useCharacterLibraryData } from "../hooks/useCharacterLibraryData.js";
import { navigate, paths, useRoute } from "../router.js";

const STATE_COPY = {
  loading: ["角色库读取中", "正在读取前置状态、当前投影和角色列表"],
  no_chapters: ["尚无章节", "先导入小说章节，再建立章节线索与角色事实"],
  no_l1: ["章节线索尚未建立", "先完成章节线索，角色事实才能获得稳定来源"],
  no_character_group: ["尚无角色事实索引组", "前往事实索引创建 characters 角色索引组"],
  no_character_facts: ["角色事实尚未就绪", "角色索引组还没有完成任何章节"],
  library_missing: ["角色库尚未建立", "角色事实已经可用，可以开始首次构建"],
  building: ["角色库更新中", "构建完成后会自动刷新当前投影"]
};

export function CharacterLibraryPage({ bookId, characterLibraryTask, characterLibraryBusy, onStartCharacterLibrary }) {
  const { books } = useAppContext();
  const { query } = useRoute();
  const book = books.find((entry) => entry.book_id === bookId) || null;
  const taskForBook = characterLibraryTask?.payload?.bookId === bookId ? characterLibraryTask : null;
  const data = useCharacterLibraryData({ book, bookId, task: taskForBook });
  const [activeStageId, setActiveStageId] = useState("");
  const rowFocusRef = useRef(null);
  const drawerRef = useRef(null);
  const drawerCloseRef = useRef(null);
  const drawerWasOpenRef = useRef(false);
  const selectedId = query.character_id || "";
  const building = Boolean(characterLibraryBusy && taskForBook);
  const channelBlocked = Boolean(characterLibraryBusy && !taskForBook);
  const selectCharacter = data.selectCharacter;
  const clearSelection = data.clearSelection;

  const closeDrawer = useCallback(() => {
    navigate(paths.characters(bookId), { replace: true, scroll: false });
    window.setTimeout(() => rowFocusRef.current?.focus(), 0);
  }, [bookId]);

  useEffect(() => {
    if (selectedId) void selectCharacter(selectedId);
    else clearSelection();
  }, [selectedId, selectCharacter, clearSelection]);

  useEffect(() => {
    if (!selectedId) {
      drawerWasOpenRef.current = false;
      return undefined;
    }
    if (!drawerWasOpenRef.current) {
      drawerWasOpenRef.current = true;
      window.setTimeout(() => drawerCloseRef.current?.focus(), 0);
    }
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        closeDrawer();
        return;
      }
      if (event.key !== "Tab" || !window.matchMedia("(max-width: 899px)").matches) return;
      const focusable = [...(drawerRef.current?.querySelectorAll(
        "button:not([disabled]), input:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex='-1'])"
      ) || [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!drawerRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedId, closeDrawer]);

  const activeStage = useMemo(() => {
    const stages = data.selectedCharacter?.stages || [];
    return stages.find((stage) => stage.id === activeStageId) || stages[0] || null;
  }, [activeStageId, data.selectedCharacter]);

  function openCharacter(characterId, trigger) {
    rowFocusRef.current = trigger;
    navigate(`${paths.characters(bookId)}?character_id=${encodeURIComponent(characterId)}`, { replace: true, scroll: false });
  }

  function startBuild() {
    if (!book?.chapter_count) return;
    void onStartCharacterLibrary({
      bookId,
      startChapter: 1,
      endChapter: Number(book.chapter_count),
      indexGroupKey: "characters"
    });
  }

  const library = data.library;
  const stateCopy = STATE_COPY[data.pageState.kind];
  const showTable = Boolean(library) && ["partial", "ready", "building"].includes(data.pageState.kind);

  return (
    <section className={`character-library-page${selectedId ? " has-drawer" : ""}`}>
      <header className="page-hero">
        <div>
          <span>{book?.book_name || bookId}</span>
          <h2>角色库</h2>
          <p>聚合角色事实，形成可追溯的角色与阶段档案</p>
        </div>
        <div className="page-hero-actions">
          <button className="secondary inline" type="button" onClick={() => navigate(`${paths.l2(bookId)}?g=characters`)}>
            <Database size={15} />
            前往事实索引
          </button>
          <button className="primary inline" type="button" disabled={characterLibraryBusy || !book?.chapter_count} title={channelBlocked ? "另一部书正在更新角色库" : undefined} onClick={startBuild}>
            {building ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}
            {library ? "更新角色库" : "建立角色库"}
          </button>
        </div>
      </header>

      <LibrarySummary library={library} pageState={data.pageState} task={taskForBook} />

      {data.error ? <div className="alert"><AlertTriangle size={18} /><span>{data.error}</span></div> : null}

      {stateCopy && !showTable ? (
        <section className="character-library-gate">
          <div>
            <strong>{stateCopy[0]}</strong>
            <span>{stateCopy[1]}</span>
          </div>
          {data.pageState.kind === "no_chapters" ? (
            <button className="secondary inline" type="button" onClick={() => navigate(paths.book(bookId))}>返回书籍首页 <ArrowRight size={14} /></button>
          ) : data.pageState.kind === "no_l1" ? (
            <button className="secondary inline" type="button" onClick={() => navigate(paths.l1(bookId))}>前往章节线索 <ArrowRight size={14} /></button>
          ) : data.pageState.kind === "no_character_group" || data.pageState.kind === "no_character_facts" ? (
            <button className="secondary inline" type="button" onClick={() => navigate(`${paths.l2(bookId)}?g=characters`)}>前往事实索引 <ArrowRight size={14} /></button>
          ) : data.pageState.kind === "library_missing" ? (
            <button className="primary inline" type="button" disabled={characterLibraryBusy} onClick={startBuild}>建立角色库</button>
          ) : null}
        </section>
      ) : null}

      {showTable ? (
        <div className="character-library-workspace">
          <section className="character-library-main" aria-label="角色列表">
            <CharacterToolbar data={data} />
            <div className="character-library-table-wrap">
              <table className="character-library-table">
                <thead><tr><th>角色姓名</th><th>确认别名</th><th>性别</th><th>阶段</th><th>年龄</th><th>身份或职业</th><th>外形事实数</th><th>档案状态</th><th>最近更新</th></tr></thead>
                <tbody>
                  {data.characters.map((character) => (
                    <tr
                      key={character.id}
                      className={selectedId === character.id ? "is-selected" : ""}
                      tabIndex="0"
                      aria-selected={selectedId === character.id}
                      onClick={(event) => openCharacter(character.id, event.currentTarget)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openCharacter(character.id, event.currentTarget);
                        }
                      }}
                    >
                      <td><strong>{character.canonical_name}</strong></td>
                      <td>{character.aliases?.length ? character.aliases.join("、") : "-"}</td>
                      <td>{character.gender || "-"}</td>
                      <td>{character.stage_count || "-"}</td>
                      <td>-</td><td>-</td><td>-</td>
                      <td><StatusLabel value={character.profile_status} /></td>
                      <td>{formatTime(character.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.loading ? <div className="empty-state">角色列表读取中</div> : !data.characters.length ? <div className="empty-state">没有匹配当前条件的角色</div> : null}
            </div>
          </section>

          {selectedId ? (
            <aside ref={drawerRef} className="character-library-drawer" aria-label="角色详情" aria-live="polite">
              <div className="character-drawer-head">
                <div><span>角色档案</span><h3>{data.selectedCharacter?.canonical_name || "读取中"}</h3></div>
                <button ref={drawerCloseRef} className="icon-button" type="button" title="关闭角色详情" aria-label="关闭角色详情" onClick={closeDrawer}><X size={18} /></button>
              </div>
              {data.detailLoading ? <div className="empty-state tall">角色详情读取中</div> : data.detailError ? (
                <div className="character-detail-error"><AlertTriangle size={18} /><strong>{data.detailError}</strong><span>列表仍可继续使用，关闭后可选择其他角色</span></div>
              ) : data.selectedCharacter ? (
                <CharacterDetail character={data.selectedCharacter} activeStage={activeStage} activeStageId={activeStage?.id || ""} onStageChange={setActiveStageId} />
              ) : null}
            </aside>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function LibrarySummary({ library, pageState, task }) {
  const coverage = library?.coverage || {};
  const start = coverage.start_chapter ?? library?.start_chapter;
  const end = coverage.end_chapter ?? library?.end_chapter;
  return (
    <section className="character-library-summary" aria-label="角色库状态摘要">
      <SummaryItem label="角色" value={library ? library.character_count : "-"} />
      <SummaryItem label="阶段" value={library ? library.stage_count : "-"} />
      <SummaryItem label="覆盖章节" value={start && end ? `${start}-${end}` : "-"} />
      <SummaryItem label="构建状态" value={task && pageState.kind === "building" ? "构建中" : library?.status || "未建立"} />
      <SummaryItem label="最近更新" value={formatTime(library?.updated_at)} />
      {pageState.kind === "partial" ? <div className="character-library-warning"><AlertTriangle size={16} />事实来源或当前投影部分可用，后续更新可能新增角色或调整档案</div> : null}
    </section>
  );
}

function SummaryItem({ label, value }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function CharacterToolbar({ data }) {
  return (
    <div className="character-library-toolbar">
      <label className="character-search"><span>搜索角色</span><div><Search size={15} /><input value={data.search} onChange={(event) => data.setSearch(event.target.value)} placeholder="姓名或确认别名" /></div></label>
      <label><span>筛选</span><select value={data.filter} onChange={(event) => data.setFilter(event.target.value)}><option value="all">全部角色</option><option value="multi_stage">多阶段</option><option value="incomplete">信息不足</option></select></label>
      <label><span>排序</span><select value={data.sort} onChange={(event) => data.setSort(event.target.value)}><option value="name">按姓名</option><option value="updated">按最近更新</option><option value="facts">按事实数</option></select></label>
    </div>
  );
}

function CharacterDetail({ character, activeStage, activeStageId, onStageChange }) {
  const appearanceFacts = (activeStage?.facts || []).filter((fact) => ["appearance", "personality"].includes(fact.fact_type));
  return (
    <div className="character-detail-body">
      <div className="character-overview"><div><span>确认别名</span><strong>{character.aliases?.length ? character.aliases.join("、") : "-"}</strong></div><div><span>性别</span><strong>{character.gender || "-"}</strong></div><div><span>档案状态</span><StatusLabel value={character.profile_status} /></div></div>
      {character.stages?.length > 1 ? <div className="character-stage-tabs" role="tablist" aria-label="角色阶段">{character.stages.map((stage) => <button key={stage.id} type="button" role="tab" aria-selected={activeStageId === stage.id} onClick={() => onStageChange(stage.id)}>{stage.name}</button>)}</div> : null}
      {activeStage ? (
        <>
          <section className="character-profile-grid"><ProfileField label="阶段" value={activeStage.name} /><ProfileField label="年龄" value={activeStage.age} /><ProfileField label="身份或职业" value={activeStage.identity_profession} /><ProfileField label="稳定外形" value={activeStage.stable_appearance} wide /><ProfileField label="稳定气质" value={activeStage.stable_temperament} wide /><ProfileField label="原文五官" value={activeStage.original_facial_features} wide /><ProfileField label="设计五官" value={activeStage.designed_facial_features} badge="设计推导" wide />{activeStage.design_basis?.length ? <ProfileField label="设计依据" value={activeStage.design_basis.join("；")} wide /> : null}</section>
          <section className="character-evidence"><h4>外形事实与证据 <span>{appearanceFacts.length}</span></h4>{appearanceFacts.length ? appearanceFacts.map((fact) => <details key={fact.fingerprint}><summary><span>第 {fact.chapter_index} 章</span>{fact.fact || "外形事实"}</summary><div>{fact.evidence?.length ? fact.evidence.map((item, index) => <blockquote key={`${fact.fingerprint}:${index}`}>{item}</blockquote>) : <p>暂无原文摘录</p>}</div></details>) : <div className="empty-state">该阶段暂无外形事实证据</div>}</section>
        </>
      ) : <div className="empty-state">暂无阶段档案</div>}
    </div>
  );
}

function ProfileField({ label, value, badge, wide = false }) {
  return <div className={wide ? "wide" : ""}><span>{label}{badge ? <em>{badge}</em> : null}</span><p>{value || "-"}</p></div>;
}

function StatusLabel({ value }) {
  const label = value === "complete" || value === "completed" ? "完整" : value === "partial" ? "待补充" : value || "-";
  return <span className={`character-status status-${value || "unknown"}`}>{label}</span>;
}
