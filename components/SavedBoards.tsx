"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { ArtworkResult } from "@/lib/types/artwork";
import { createBoard, deleteBoard, exportSaved, importSaved, renameBoard, useSaved } from "@/lib/saved/savedStore";
import ResultCard from "@/components/ResultCard";
import Lightbox, { creditLine } from "@/components/Lightbox";
import MasonryGrid from "@/components/MasonryGrid";
import CopyableSwatch, { useCopy } from "@/components/CopyableSwatch";
import { FilterToolbar, useResultFilters } from "@/components/ResultFilters";
import { useSlidingHighlight } from "@/components/useSlidingHighlight";
import { boardColors } from "@/components/boardColors";
import { showToast } from "@/components/Toaster";
import Menu from "@/components/Menu";


const ALL = "all";

function downloadFile(name: string, type: string, contents: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function fileSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "saved";
}

/**
 * Saved images and collections (stored as "boards", see SaveControls.tsx).
 * Before the images: the title, the collection chips, the selected
 * collection's name with Rename and Delete, and one line for what's shown
 * (its colors, Copy credits, Filter, Download). Filters stay folded away
 * until asked for.
 */
export default function SavedBoards() {
  const saved = useSaved();
  // Saves live in this browser, so the server renders nothing for them;
  // waiting for the browser avoids a flash of "Nothing saved yet".
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  const [boardId, setBoardId] = useState<string>(ALL);
  const [expanded, setExpanded] = useState<ArtworkResult | null>(null);
  const [unavailable, setUnavailable] = useState<Set<string>>(new Set());
  // Naming a new collection, or renaming the selected one.
  const [editing, setEditing] = useState<"new" | "rename" | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [boardName, setBoardName] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const credits = useCopy();

  const board = saved.boards.find((entry) => entry.id === boardId);
  // A deleted collection (here or in another tab) falls back to All saved.
  useEffect(() => {
    if (boardId !== ALL && !board) setBoardId(ALL);
  }, [boardId, board]);

  const items = saved.items.filter(
    (item) => !unavailable.has(item.result.id) && (boardId === ALL || item.boardIds.includes(boardId))
  );
  const notes = new Map(items.map((item) => [item.result.id, item.note]));
  const filters = useResultFilters(items.map((item) => item.result));
  const shown = filters.ordered;
  const palette = boardColors(shown);
  const boardTitle = board?.name ?? "All saved";

  const boardKeys = [ALL, ...saved.boards.map((entry) => entry.id)].join(",");
  const boardHighlight = useSlidingHighlight(boardId, [ready, boardKeys, saved.items.length, editing]);

  const handleUnavailable = useCallback((id: string) => {
    setUnavailable((current) => (current.has(id) ? current : new Set(current).add(id)));
  }, []);

  function selectBoard(id: string) {
    setBoardId(id);
    setEditing(null);
    setConfirmingDelete(false);
    filters.reset();
  }

  function submitBoard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (editing === "rename" && board) {
      renameBoard(board.id, boardName);
      setEditing(null);
    } else {
      const id = createBoard(boardName);
      if (id) selectBoard(id);
      else setEditing(null);
    }
    setBoardName("");
  }

  function removeBoard() {
    if (!board) return;
    const name = board.name;
    deleteBoard(board.id);
    selectBoard(ALL);
    showToast(
      <>
        Deleted <em>{name}</em>. Its images are still in All saved.
      </>
    );
  }

  function openSheet() {
    window.open(`/saved/sheet${board ? `?board=${encodeURIComponent(board.id)}` : ""}`, "_blank");
  }

  function downloadCredits() {
    const lines = shown.map(creditLine);
    downloadFile(
      `${fileSlug(boardTitle)}-credits.txt`,
      "text/plain",
      `${boardTitle} — credits (Itera Studio)\n\n${lines.join("\n")}\n`
    );
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const added = importSaved(await file.text());
      showToast(
        `Imported ${added.items} ${added.items === 1 ? "image" : "images"} and ${added.boards} ${
          added.boards === 1 ? "collection" : "collections"
        }.`
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Couldn't import that file.");
    }
  }

  const expandedIndex = expanded ? shown.findIndex((result) => result.id === expanded.id) : -1;
  const stepTo = (offset: number) => {
    const next = shown[expandedIndex + offset];
    return expandedIndex === -1 || !next ? undefined : () => setExpanded(next);
  };

  if (!ready) return <section className="saved" aria-busy="true" />;

  return (
    <section className="saved">
      <header className="saved-header">
        <h1 className="saved-title">Saved</h1>
        <p className="saved-subtitle">Kept in this browser only.</p>
      </header>

      <div className="saved-boards-bar">
        {editing === "new" ? (
          <form className="saved-board-form" onSubmit={submitBoard}>
            <input
              className="save-input"
              value={boardName}
              onChange={(event) => setBoardName(event.target.value)}
              placeholder="Collection name"
              maxLength={40}
              aria-label="New collection name"
              autoFocus
              onKeyDown={(event) => event.key === "Escape" && setEditing(null)}
            />
            <button type="submit" className="text-button">
              Create
            </button>
            <button type="button" className="text-button" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </form>
        ) : (
          <div className="saved-boards" ref={boardHighlight.groupRef} {...boardHighlight.groupHandlers}>
            <span
              className={boardHighlight.previewing ? "chip-highlight is-previewing" : "chip-highlight"}
              style={boardHighlight.highlightStyle}
              aria-hidden="true"
            />
            <button
              type="button"
              data-key={ALL}
              className={boardId === ALL ? "chip is-active" : "chip"}
              onClick={() => selectBoard(ALL)}
              aria-pressed={boardId === ALL}
            >
              All saved <span className="chip-count">{saved.items.length}</span>
            </button>
            {saved.boards.map((entry) => (
              <button
                key={entry.id}
                type="button"
                data-key={entry.id}
                className={boardId === entry.id ? "chip is-active" : "chip"}
                onClick={() => selectBoard(entry.id)}
                aria-pressed={boardId === entry.id}
              >
                {entry.name}{" "}
                <span className="chip-count">
                  {saved.items.filter((item) => item.boardIds.includes(entry.id)).length}
                </span>
              </button>
            ))}
            <button
              type="button"
              className="chip saved-new-board"
              onClick={() => {
                setBoardName("");
                setEditing("new");
              }}
            >
              + New collection
            </button>
          </div>
        )}
      </div>

      {/* The selected collection: its name, with Rename and Delete in
          plain sight. Deleting asks first, on the page. */}
      {board && (
        <div className="collection-header">
          {editing === "rename" ? (
            <form className="saved-board-form" onSubmit={submitBoard}>
              <input
                className="save-input collection-rename"
                value={boardName}
                onChange={(event) => setBoardName(event.target.value)}
                maxLength={40}
                aria-label="Rename collection"
                autoFocus
                onKeyDown={(event) => event.key === "Escape" && setEditing(null)}
              />
              <button type="submit" className="text-button">
                Save name
              </button>
              <button type="button" className="text-button" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </form>
          ) : (
            <>
              <h2 className="collection-name">{board.name}</h2>
              {confirmingDelete ? (
                <div className="collection-confirm" role="alertdialog" aria-label="Delete collection">
                  <span>
                    Delete <em>{board.name}</em>? {items.length > 0 && `The ${items.length} ${items.length === 1 ? "image stays" : "images stay"} in All saved.`}
                  </span>
                  <button type="button" className="chip chip-small collection-delete" onClick={removeBoard}>
                    Delete
                  </button>
                  <button type="button" className="text-button" onClick={() => setConfirmingDelete(false)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="collection-actions">
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setBoardName(board.name);
                      setEditing("rename");
                    }}
                  >
                    Rename
                  </button>
                  <button type="button" className="text-button" onClick={() => setConfirmingDelete(true)}>
                    Delete collection
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* One line for what's shown: its colors and what you can do with it. */}
      <div className="saved-board-line">
        {palette.length > 0 && (
          <div className="swatches saved-swatches" role="group" aria-label="Collection colors">
            {palette.map((swatch) => (
              <CopyableSwatch
                key={swatch.color}
                color={swatch.color}
                className="swatch"
                style={{ flexGrow: swatch.share }}
                detail={`${Math.round(swatch.share * 100)}%`}
              />
            ))}
          </div>
        )}
        {items.length > 0 && (
          <>
            <button
              type="button"
              className="text-button"
              onClick={() => credits.copy(shown.map(creditLine).join("\n"), "credits")}
            >
              {credits.copied ? "Copied" : "Copy credits"}
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => setFiltersOpen((open) => !open)}
              aria-expanded={filtersOpen}
            >
              {filters.isFiltered ? "Filter · on" : "Filter"}
            </button>
          </>
        )}
        <Menu label="Download ▾" align="end">
          {(close) => (
            <div className="menu-list">
              <button
                type="button"
                disabled={items.length === 0}
                onClick={() => {
                  close();
                  openSheet();
                }}
              >
                Reference sheet (PDF)
                <span>Images, credits and notes, ready to print</span>
              </button>
              <button
                type="button"
                disabled={items.length === 0}
                onClick={() => {
                  close();
                  downloadCredits();
                }}
              >
                Credits list (.txt)
                <span>One credit line per image</span>
              </button>
              <hr />
              <button
                type="button"
                disabled={saved.items.length === 0}
                onClick={() => {
                  close();
                  downloadFile(
                    `itera-backup-${new Date().toISOString().slice(0, 10)}.json`,
                    "application/json",
                    exportSaved()
                  );
                }}
              >
                Backup file
                <span>Everything saved here, to restore or move to another browser</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  close();
                  fileInput.current?.click();
                }}
              >
                Restore from backup…
                <span>Adds a backup&apos;s saves to these</span>
              </button>
            </div>
          )}
        </Menu>
        <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={importFile} />
      </div>

      {filtersOpen && items.length > 0 && <FilterToolbar filters={filters} />}

      {saved.items.length === 0 ? (
        <p className="state-text saved-empty">
          Nothing saved yet. Hover over any result and click the bookmark in its corner to save it here.
        </p>
      ) : items.length === 0 ? (
        <p className="state-text saved-empty">
          This collection is empty. Open a saved image and choose Add to collection.
        </p>
      ) : shown.length === 0 ? (
        <p className="state-text saved-empty">No saved images match the selected filters.</p>
      ) : (
        <MasonryGrid>
          {shown.map((result) => (
            <ResultCard
              key={result.id}
              result={result}
              activeTag={filters.activeTag}
              showsActiveTag={filters.showsActiveTag(result)}
              note={notes.get(result.id)}
              collection={board}
              onExpand={setExpanded}
              onUnavailable={handleUnavailable}
            />
          ))}
        </MasonryGrid>
      )}

      <Lightbox
        result={expanded}
        onClose={() => setExpanded(null)}
        onPrevious={stepTo(-1)}
        onNext={stepTo(1)}
      />
    </section>
  );
}
