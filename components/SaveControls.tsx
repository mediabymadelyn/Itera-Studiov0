"use client";

import { FormEvent, useEffect, useState } from "react";
import { ArtworkResult } from "@/lib/types/artwork";
import {
  Board,
  SavedState,
  createBoard,
  isSaved,
  removeSaved,
  restoreSaved,
  saveResult,
  setInBoard,
  setNote,
  useSaved
} from "@/lib/saved/savedStore";
import { reportUnsplashDownload } from "@/components/unsplashDownload";
import { showToast } from "@/components/Toaster";
import Menu from "@/components/Menu";

// Boards are called "collections" everywhere people can see them; the
// stored data keeps its original "boards" name so existing saves load.

/**
 * Saves a result, saying so if it can't be kept. Choosing a photo to keep
 * is using it, so a saved Unsplash photo is reported to Unsplash like
 * opening its original (once per page session, see unsplashDownload.ts).
 */
export function save(result: ArtworkResult, collectionIds: string[] = []): boolean {
  if (!saveResult(result, collectionIds)) {
    showToast("Couldn't save this image.");
    return false;
  }
  reportUnsplashDownload(result);
  return true;
}

/** Removes a save everywhere, with Undo in the toast. */
export function unsave(result: ArtworkResult) {
  const removed = removeSaved(result.id);
  if (!removed) return;
  showToast(
    <>
      Removed <em>{result.title}</em>
    </>,
    { label: "Undo", run: () => restoreSaved(removed) }
  );
}

/** Takes an image out of one collection (it stays saved), with Undo. */
export function removeFromCollection(result: ArtworkResult, collection: Board) {
  setInBoard(result.id, collection.id, false);
  showToast(
    <>
      Removed from <em>{collection.name}</em>
    </>,
    { label: "Undo", run: () => setInBoard(result.id, collection.id, true) }
  );
}

function BookmarkIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        d="M6 3.5h12a.5.5 0 0 1 .5.5v16.2a.3.3 0 0 1-.48.24L12 16.2l-6.02 4.24a.3.3 0 0 1-.48-.24V4a.5.5 0 0 1 .5-.5Z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * A card's corner. Normally the bookmark: one click saves (to All saved),
 * another removes. Inside a collection it's "Remove" instead, which takes
 * the image out of that collection only -- unsaving everywhere from there
 * would be a surprise.
 */
export function CardSaveButton({ result, collection }: { result: ArtworkResult; collection?: Board }) {
  const saved = isSaved(useSaved(), result.id);

  if (collection) {
    return (
      <button
        type="button"
        className="card-save card-remove"
        onClick={() => removeFromCollection(result, collection)}
        aria-label={`Remove ${result.title} from ${collection.name}`}
        title={`Remove from ${collection.name}`}
      >
        <span aria-hidden="true">×</span> Remove
      </button>
    );
  }

  return (
    <button
      type="button"
      className={saved ? "card-save is-saved" : "card-save"}
      onClick={() => (saved ? unsave(result) : save(result))}
      aria-pressed={saved}
      aria-label={saved ? `Remove from saved: ${result.title}` : `Save: ${result.title}`}
      title={saved ? "Saved · click to remove" : "Save"}
    >
      <BookmarkIcon filled={saved} />
    </button>
  );
}

/** Each collection's newest image, for its thumbnail in the picker. */
function latestImages(saved: SavedState): Map<string, ArtworkResult> {
  const latest = new Map<string, ArtworkResult>();
  // Items are newest first, so the first one seen per collection wins.
  for (const item of saved.items) {
    for (const id of item.boardIds) if (!latest.has(id)) latest.set(id, item.result);
  }
  return latest;
}

/**
 * In the expanded view: Save / Saved, "Add to collection" (a panel of
 * collections, each with its newest image, its count and whether this
 * image is in it; a new-collection field at the bottom) and "Add note".
 * Under them, the collections this image is in, each with an × to take it
 * out. A note that's already written shows straight away.
 */
export function SavePanel({ result }: { result: ArtworkResult }) {
  const saved = useSaved();
  const item = saved.items.find((entry) => entry.result.id === result.id);
  const [newCollection, setNewCollection] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);

  useEffect(() => {
    setNewCollection("");
    setNoteOpen(false);
  }, [result.id]);

  function addCollection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = createBoard(newCollection);
    if (!id) return;
    if (item) setInBoard(result.id, id, true);
    else save(result, [id]);
    setNewCollection("");
  }

  function toggleCollection(collection: Board, on: boolean) {
    if (!on) removeFromCollection(result, collection);
    else if (item) setInBoard(result.id, collection.id, true);
    else save(result, [collection.id]);
  }

  const counts = new Map(
    saved.boards.map((collection) => [
      collection.id,
      saved.items.filter((entry) => entry.boardIds.includes(collection.id)).length
    ])
  );
  const thumbnails = latestImages(saved);
  const inCollections = saved.boards.filter((collection) => item?.boardIds.includes(collection.id));
  const showNote = item && (noteOpen || item.note.length > 0);

  return (
    <div className="save-panel">
      <div className="save-row">
        <button
          type="button"
          className={item ? "chip chip-small save-toggle is-on" : "chip chip-small save-toggle"}
          onClick={() => (item ? unsave(result) : save(result))}
          aria-pressed={Boolean(item)}
        >
          <BookmarkIcon filled={Boolean(item)} />
          {item ? "Saved" : "Save"}
        </button>

        <Menu label="Add to collection ▾" align="center">
          {() => (
            <div className="collection-picker">
              <span className="collection-picker-heading">Collections</span>
              {saved.boards.length === 0 && (
                <p className="collection-picker-empty">No collections yet. Name your first one below.</p>
              )}
              {saved.boards.map((collection) => {
                const on = item?.boardIds.includes(collection.id) ?? false;
                const thumbnail = thumbnails.get(collection.id);
                return (
                  <button
                    key={collection.id}
                    type="button"
                    className={on ? "collection-row is-in" : "collection-row"}
                    onClick={() => toggleCollection(collection, !on)}
                    aria-pressed={on}
                  >
                    <span
                      className="collection-thumb"
                      style={
                        thumbnail
                          ? { backgroundImage: `url(${JSON.stringify(thumbnail.thumbnailUrl ?? thumbnail.imageUrl)})` }
                          : undefined
                      }
                      aria-hidden="true"
                    />
                    <span className="collection-row-text">
                      <span className="collection-row-name">{collection.name}</span>
                      <span className="collection-row-count">
                        {counts.get(collection.id)} {counts.get(collection.id) === 1 ? "image" : "images"}
                      </span>
                    </span>
                    <span className="collection-row-state">{on ? "✓ Added" : "Add"}</span>
                  </button>
                );
              })}
              <form className="collection-picker-new" onSubmit={addCollection}>
                <input
                  className="save-input"
                  value={newCollection}
                  onChange={(event) => setNewCollection(event.target.value)}
                  placeholder="New collection"
                  maxLength={40}
                  aria-label="New collection name"
                  autoFocus={saved.boards.length === 0}
                />
                <button type="submit" className="text-button">
                  Create
                </button>
              </form>
            </div>
          )}
        </Menu>

        {item && !showNote && (
          <button type="button" className="text-button" onClick={() => setNoteOpen(true)}>
            Add note
          </button>
        )}
      </div>

      {inCollections.length > 0 && (
        <div className="save-collections" aria-label="In collections">
          {inCollections.map((collection) => (
            <span key={collection.id} className="collection-chip">
              {collection.name}
              <button
                type="button"
                onClick={() => removeFromCollection(result, collection)}
                aria-label={`Remove from ${collection.name}`}
                title={`Remove from ${collection.name}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {showNote && (
        <textarea
          className="save-note"
          value={item.note}
          // Saved as you type, so closing the view never loses a note.
          onChange={(event) => setNote(result.id, event.target.value)}
          placeholder="Why you saved it"
          maxLength={500}
          rows={2}
          aria-label="Note"
          autoFocus={noteOpen && item.note.length === 0}
        />
      )}
    </div>
  );
}
