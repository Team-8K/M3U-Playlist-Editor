import type { Channel } from "./m3u";

/**
 * Compact diff between a source playlist (parsed channels) and the
 * user's edited version. Stored in `edited_playlists.edits_json`.
 *
 * Channels are keyed by their stream URL (normalised), which is the
 * only field guaranteed to be stable between source re-fetches.
 */
export interface PlaylistDiff {
  v: 1;
  /** Lower-cased URLs of source channels that were removed. */
  removed: string[];
  /** Per-channel overrides keyed by lower-cased URL. */
  overrides: Record<
    string,
    { name?: string; category?: string; enabled?: boolean }
  >;
  /** Channels added on top of the source (e.g. from another source playlist). */
  added: Channel[];
  /**
   * Final ordering as a list of lower-cased URLs. Only included when the
   * user reordered things — otherwise we keep the source's order then
   * append `added`.
   */
  order?: string[];
}

const normUrl = (u: string) => u.trim().toLowerCase();

/** Build a diff describing how `edited` differs from `source`. */
export function buildDiff(source: Channel[], edited: Channel[]): PlaylistDiff {
  const srcByUrl = new Map<string, Channel>();
  for (const c of source) srcByUrl.set(normUrl(c.url), c);

  const editedUrls = new Set(edited.map((c) => normUrl(c.url)));

  // Removed = source channels not present in edited
  const removed: string[] = [];
  for (const url of srcByUrl.keys()) {
    if (!editedUrls.has(url)) removed.push(url);
  }

  const overrides: PlaylistDiff["overrides"] = {};
  const added: Channel[] = [];

  for (const ch of edited) {
    const key = normUrl(ch.url);
    const src = srcByUrl.get(key);
    if (!src) {
      // Added channel — keep the full record so we can rebuild
      added.push(ch);
      continue;
    }
    const diff: { name?: string; category?: string; enabled?: boolean } = {};
    if (ch.name !== src.name) diff.name = ch.name;
    if (ch.category !== src.category) diff.category = ch.category;
    if (ch.enabled === false) diff.enabled = false;
    if (Object.keys(diff).length) overrides[key] = diff;
  }

  // Order: only record if it differs from "source order then added"
  const expectedOrder = [
    ...source.filter((c) => !removed.includes(normUrl(c.url))).map((c) => normUrl(c.url)),
    ...added.map((c) => normUrl(c.url)),
  ];
  const actualOrder = edited.map((c) => normUrl(c.url));
  const sameOrder =
    expectedOrder.length === actualOrder.length &&
    expectedOrder.every((u, i) => u === actualOrder[i]);

  const diff: PlaylistDiff = { v: 1, removed, overrides, added };
  if (!sameOrder) diff.order = actualOrder;
  return diff;
}

/** Apply a stored diff to freshly-parsed source channels. */
export function applyDiff(source: Channel[], diff: PlaylistDiff | null | undefined): Channel[] {
  if (!diff || diff.v !== 1) return source;

  const removed = new Set(diff.removed || []);
  const overrides = diff.overrides || {};

  const fromSource: Channel[] = [];
  for (const ch of source) {
    const key = normUrl(ch.url);
    if (removed.has(key)) continue;
    const ov = overrides[key];
    if (ov) {
      fromSource.push({
        ...ch,
        name: ov.name ?? ch.name,
        category: ov.category ?? ch.category,
        enabled: ov.enabled ?? ch.enabled,
        attributes: {
          ...ch.attributes,
          "group-title": ov.category ?? ch.category,
        },
      });
    } else {
      fromSource.push(ch);
    }
  }

  const combined = [...fromSource, ...(diff.added || [])];

  if (!diff.order || !diff.order.length) return combined;

  const byUrl = new Map(combined.map((c) => [normUrl(c.url), c]));
  const ordered: Channel[] = [];
  const used = new Set<string>();
  for (const url of diff.order) {
    const c = byUrl.get(url);
    if (c && !used.has(url)) {
      ordered.push(c);
      used.add(url);
    }
  }
  // Append anything not mentioned in `order` (defensive).
  for (const c of combined) {
    if (!used.has(normUrl(c.url))) ordered.push(c);
  }
  return ordered;
}
