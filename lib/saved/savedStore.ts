"use client";

import { useSyncExternalStore } from "react";
import { ArtworkResult } from "@/lib/types/artwork";
import { IMAGE_HOSTS, isSourceHost } from "@/lib/sources/imageHosts";

/**
 * Saved references, kept in this browser only (localStorage): no account,
 * nothing sent anywhere. Each save keeps a trimmed copy of the result --
 * credit, links, license, the vision check's tags and the main colors --
 * never the image itself, so attribution stays attached and images stay
 * hotlinked from their sources (Unsplash requires it). Export / Import
 * moves saves between browsers as a small JSON file.
 */

export type Board = { id: string; name: string; createdAt: number };

export type SavedItem = {
  result: ArtworkResult;
  savedAt: number;
  note: string;
  boardIds: string[];
};

export type SavedState = { version: 1; items: SavedItem[]; boards: Board[] };

const STORAGE_KEY = "itera:saved:v1";
const MAX_NOTE_LENGTH = 500;
const MAX_BOARD_NAME_LENGTH = 40;
const MAX_ITEMS = 2000;

const EMPTY: SavedState = { version: 1, items: [], boards: [] };

let state: SavedState = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

// --- Cleaning what's read back -----------------------------------------------
// Saves come back from localStorage and from imported files, which anyone
// could edit, so every field is checked: only https links to the three
// sources' own sites (an edited file can't make a board load images from
// anywhere else), only #rrggbb colors, only known fields. Anything
// malformed is dropped, never shown.

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

// Where pages link to, and Unsplash's download-tracking API (image hosts
// are in lib/sources/imageHosts.ts).
const LINK_HOSTS = ["metmuseum.org", "artic.edu", "unsplash.com"];
const DOWNLOAD_HOSTS = ["api.unsplash.com"];

function text(value: unknown, max = 500): string | undefined {
  return typeof value === "string" && value.trim() ? value.slice(0, max) : undefined;
}

/**
 * The link as https (http is upgraded: Wikidata hands out Commons links
 * as http), if it points to one of these hosts or their subdomains.
 */
function sourceUrl(value: unknown, hosts: string[]): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value.replace(/^http:\/\//i, "https://"));
    return isSourceHost(url, hosts) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

const imageUrlOf = (value: unknown) => sourceUrl(value, IMAGE_HOSTS);
const linkOf = (value: unknown) => sourceUrl(value, LINK_HOSTS);

function oneOf<T extends string | number>(value: unknown, options: readonly T[]): T | undefined {
  return options.includes(value as T) ? (value as T) : undefined;
}

function cleanLighting(value: unknown): ArtworkResult["lighting"] {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  const sources = oneOf(v.sources, [1, 2, 3] as const);
  const quality = oneOf(v.quality, ["hard", "soft"] as const);
  const direction = oneOf(v.direction, ["front", "side", "back", "top", "below", "ambient"] as const);
  const shadow = oneOf(v.shadow, [0, 1, 2, 3] as const);
  const contrast = oneOf(v.contrast, ["low", "medium", "high"] as const);
  const readable = oneOf(v.readable, ["yes", "partly", "no"] as const);
  const type = text(v.type, 40);
  if (!sources || !quality || !direction || shadow === undefined || !contrast || !readable || !type) return undefined;
  return { sources, quality, direction, shadow, type, contrast, readable };
}

function cleanColor(value: unknown): ArtworkResult["color"] {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  const temperature = oneOf(v.temperature, ["warm", "cool", "neutral", "mixed"] as const);
  const saturation = oneOf(v.saturation, ["vivid", "muted", "black and white"] as const);
  return temperature && saturation ? { temperature, saturation } : undefined;
}

function cleanMetrics(value: unknown): ArtworkResult["imageMetrics"] {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  const number = (key: string) => (typeof v[key] === "number" && Number.isFinite(v[key]) ? (v[key] as number) : 0);
  const palette = Array.isArray(v.palette)
    ? v.palette
        .filter(
          (swatch): swatch is { color: string; share: number } =>
            Boolean(swatch) &&
            typeof swatch.color === "string" &&
            HEX_COLOR.test(swatch.color) &&
            typeof swatch.share === "number" &&
            swatch.share >= 0 &&
            swatch.share <= 1
        )
        .map((swatch) => ({ color: swatch.color, share: swatch.share }))
        .slice(0, 12)
    : [];
  return {
    contrast: number("contrast"),
    darkShare: number("darkShare"),
    brightShare: number("brightShare"),
    drama: number("drama"),
    sharpness: number("sharpness"),
    colorfulness: number("colorfulness"),
    palette
  };
}

/** The fields a save needs, checked; null if it can't be shown. */
function cleanResult(value: unknown): ArtworkResult | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const id = text(v.id, 200);
  const title = text(v.title, 300);
  const artist = text(v.artist, 200);
  const source = text(v.source, 100);
  const imageUrl = imageUrlOf(v.imageUrl);
  const originalLink = linkOf(v.originalLink);
  if (!id || !title || !artist || !source || !imageUrl || !originalLink) return null;

  const matchReasons = Array.isArray(v.matchReasons)
    ? v.matchReasons.filter((reason): reason is string => typeof reason === "string").slice(0, 7)
    : undefined;

  return {
    id,
    title,
    artist,
    source,
    imageUrl,
    originalLink,
    thumbnailUrl: imageUrlOf(v.thumbnailUrl),
    sourceLink: linkOf(v.sourceLink),
    artistLink: linkOf(v.artistLink),
    licenseType: text(v.licenseType, 100),
    objectDate: text(v.objectDate, 100),
    medium: text(v.medium, 200),
    // Checked again by the server route before it's ever called.
    downloadLocation: sourceUrl(v.downloadLocation, DOWNLOAD_HOSTS),
    imageAspectRatio:
      typeof v.imageAspectRatio === "number" && v.imageAspectRatio > 0 ? v.imageAspectRatio : undefined,
    matchReasons,
    lightingScore: typeof v.lightingScore === "number" ? v.lightingScore : undefined,
    lightingType: text(v.lightingType, 40),
    lighting: cleanLighting(v.lighting),
    color: cleanColor(v.color),
    imageMetrics: cleanMetrics(v.imageMetrics)
  };
}

function cleanBoard(value: unknown): Board | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const id = text(v.id, 60);
  const name = text(v.name, MAX_BOARD_NAME_LENGTH);
  if (!id || !name) return null;
  return { id, name: name.trim(), createdAt: typeof v.createdAt === "number" ? v.createdAt : Date.now() };
}

function cleanState(value: unknown): SavedState {
  if (!value || typeof value !== "object") return EMPTY;
  const v = value as Record<string, unknown>;
  const boards = (Array.isArray(v.boards) ? v.boards : []).map(cleanBoard).filter((b): b is Board => b !== null);
  const boardIds = new Set(boards.map((board) => board.id));
  const seen = new Set<string>();
  const items: SavedItem[] = [];
  for (const raw of Array.isArray(v.items) ? v.items : []) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const result = cleanResult(item.result);
    if (!result || seen.has(result.id)) continue;
    seen.add(result.id);
    items.push({
      result,
      savedAt: typeof item.savedAt === "number" ? item.savedAt : Date.now(),
      note: typeof item.note === "string" ? item.note.slice(0, MAX_NOTE_LENGTH) : "",
      boardIds: Array.isArray(item.boardIds)
        ? item.boardIds.filter((id): id is string => typeof id === "string" && boardIds.has(id))
        : []
    });
  }
  return { version: 1, items: items.slice(0, MAX_ITEMS), boards };
}

// --- Store -------------------------------------------------------------------

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    state = raw ? cleanState(JSON.parse(raw)) : EMPTY;
  } catch {
    // Private window, blocked storage or a broken entry: start empty.
    state = EMPTY;
  }
  // Another tab saved something: follow it.
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;
    try {
      state = event.newValue ? cleanState(JSON.parse(event.newValue)) : EMPTY;
    } catch {
      state = EMPTY;
    }
    listeners.forEach((listener) => listener());
  });
}

function commit(next: SavedState) {
  state = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Full or blocked storage: the save still works until the tab closes.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  load();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): SavedState {
  load();
  return state;
}

const getServerSnapshot = () => EMPTY;

/** Everything saved in this browser; re-renders when it changes. */
export function useSaved(): SavedState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Only what a save needs (no descriptions or catalog tags). */
function trimmed(result: ArtworkResult): ArtworkResult {
  return cleanResult(result) ?? result;
}

export function isSaved(saved: SavedState, id: string): boolean {
  return saved.items.some((item) => item.result.id === id);
}

/** Saves the result (newest first); returns false if it can't be saved. */
export function saveResult(result: ArtworkResult, boardIds: string[] = []): boolean {
  load();
  if (isSaved(state, result.id)) return true;
  const clean = cleanResult(result);
  if (!clean) return false;
  commit({
    ...state,
    items: [{ result: trimmed(clean), savedAt: Date.now(), note: "", boardIds }, ...state.items].slice(0, MAX_ITEMS)
  });
  return true;
}

export function removeSaved(id: string): SavedItem | undefined {
  load();
  const item = state.items.find((entry) => entry.result.id === id);
  if (item) commit({ ...state, items: state.items.filter((entry) => entry.result.id !== id) });
  return item;
}

/** Puts a removed save back where it was (Undo). */
export function restoreSaved(item: SavedItem) {
  load();
  if (isSaved(state, item.result.id)) return;
  const boardIds = new Set(state.boards.map((board) => board.id));
  const restored = { ...item, boardIds: item.boardIds.filter((id) => boardIds.has(id)) };
  commit({ ...state, items: [...state.items, restored].sort((a, b) => b.savedAt - a.savedAt) });
}

function updateItem(id: string, change: (item: SavedItem) => SavedItem) {
  load();
  commit({ ...state, items: state.items.map((item) => (item.result.id === id ? change(item) : item)) });
}

export function setNote(id: string, note: string) {
  updateItem(id, (item) => ({ ...item, note: note.slice(0, MAX_NOTE_LENGTH) }));
}

export function setInBoard(id: string, boardId: string, inBoard: boolean) {
  updateItem(id, (item) => ({
    ...item,
    boardIds: inBoard
      ? Array.from(new Set([...item.boardIds, boardId]))
      : item.boardIds.filter((existing) => existing !== boardId)
  }));
}

function boardName(name: string): string {
  return name.trim().replace(/\s+/g, " ").slice(0, MAX_BOARD_NAME_LENGTH);
}

/** A new board, or the existing one with that name; null for a blank name. */
export function createBoard(name: string): string | null {
  load();
  const clean = boardName(name);
  if (!clean) return null;
  const existing = state.boards.find((board) => board.name.toLowerCase() === clean.toLowerCase());
  if (existing) return existing.id;
  const id = `board-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  commit({ ...state, boards: [...state.boards, { id, name: clean, createdAt: Date.now() }] });
  return id;
}

export function renameBoard(id: string, name: string) {
  load();
  const clean = boardName(name);
  if (!clean) return;
  commit({ ...state, boards: state.boards.map((board) => (board.id === id ? { ...board, name: clean } : board)) });
}

/** Deletes the board; its saves stay in All saved. */
export function deleteBoard(id: string) {
  load();
  commit({
    ...state,
    boards: state.boards.filter((board) => board.id !== id),
    items: state.items.map((item) => ({ ...item, boardIds: item.boardIds.filter((existing) => existing !== id) }))
  });
}

// --- Export / Import ---------------------------------------------------------

export function exportSaved(): string {
  load();
  return JSON.stringify({ app: "Itera Studio", exportedAt: new Date().toISOString(), ...state }, null, 2);
}

/**
 * Adds an exported file's saves and boards to these, never replacing
 * anything: boards with the same name are merged, saves already here keep
 * their notes and gain the file's boards. Throws on a file that isn't an
 * Itera export.
 */
export function importSaved(json: string): { items: number; boards: number } {
  load();
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("That file isn't an Itera export.");
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { items?: unknown }).items)) {
    throw new Error("That file isn't an Itera export.");
  }
  const incoming = cleanState(parsed);

  const boards = [...state.boards];
  const boardIdMap = new Map<string, string>();
  let newBoards = 0;
  for (const board of incoming.boards) {
    const match = boards.find((existing) => existing.name.toLowerCase() === board.name.toLowerCase());
    if (match) {
      boardIdMap.set(board.id, match.id);
      continue;
    }
    const id = boards.some((existing) => existing.id === board.id) ? `${board.id}-imported` : board.id;
    boards.push({ ...board, id });
    boardIdMap.set(board.id, id);
    newBoards++;
  }

  const items = [...state.items];
  let newItems = 0;
  for (const item of incoming.items) {
    const mapped = item.boardIds.map((id) => boardIdMap.get(id)).filter((id): id is string => Boolean(id));
    const index = items.findIndex((existing) => existing.result.id === item.result.id);
    if (index >= 0) {
      items[index] = { ...items[index], boardIds: Array.from(new Set([...items[index].boardIds, ...mapped])) };
    } else {
      items.push({ ...item, boardIds: mapped });
      newItems++;
    }
  }

  commit({ version: 1, boards, items: items.sort((a, b) => b.savedAt - a.savedAt).slice(0, MAX_ITEMS) });
  return { items: newItems, boards: newBoards };
}
