export interface Channel {
  id: string;
  name: string;
  originalName: string;
  category: string;
  url: string;
  enabled: boolean;
  attributes: Record<string, string>;
  extraLines: string[]; // any extra lines like #EXTVLCOPT before the URL
}

const ATTR_REGEX = /([a-zA-Z0-9-]+)="([^"]*)"/g;

export function parseM3U(content: string): Channel[] {
  const lines = content.split(/\r?\n/);
  const channels: Channel[] = [];
  let current: Partial<Channel> | null = null;
  let extraLines: string[] = [];
  let counter = 0;

  for (let raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith("#EXTM3U")) continue;

    if (line.startsWith("#EXTINF")) {
      const commaIdx = line.indexOf(",");
      const meta = commaIdx >= 0 ? line.slice(0, commaIdx) : line;
      const name = commaIdx >= 0 ? line.slice(commaIdx + 1).trim() : "Unnamed";

      const attributes: Record<string, string> = {};
      let m: RegExpExecArray | null;
      ATTR_REGEX.lastIndex = 0;
      while ((m = ATTR_REGEX.exec(meta)) !== null) {
        attributes[m[1]] = m[2];
      }

      current = {
        id: `ch_${counter++}_${Math.random().toString(36).slice(2, 8)}`,
        name,
        originalName: name,
        category: attributes["group-title"] || "Uncategorized",
        attributes,
        enabled: true,
      };
      extraLines = [];
      continue;
    }

    if (line.startsWith("#")) {
      // extra directive, attach to next URL
      if (current) extraLines.push(line);
      continue;
    }

    // URL line
    if (current) {
      current.url = line;
      current.extraLines = extraLines;
      channels.push(current as Channel);
      current = null;
      extraLines = [];
    }
  }

  return channels;
}

export function exportM3U(channels: Channel[]): string {
  const out: string[] = ["#EXTM3U"];
  for (const ch of channels) {
    if (!ch.enabled) continue;
    const attrs = { ...ch.attributes, "group-title": ch.category };
    const attrStr = Object.entries(attrs)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => `${k}="${v}"`)
      .join(" ");
    const duration = attrs["tvg-duration"] || "-1";
    const prefix = attrStr ? `#EXTINF:${duration} ${attrStr},` : `#EXTINF:${duration},`;
    out.push(`${prefix}${ch.name}`);
    for (const extra of ch.extraLines || []) out.push(extra);
    out.push(ch.url);
  }
  return out.join("\n") + "\n";
}

export function dedupeByUrl(channels: Channel[]): { channels: Channel[]; removed: number } {
  const seen = new Set<string>();
  const result: Channel[] = [];
  let removed = 0;
  for (const ch of channels) {
    const key = ch.url.trim().toLowerCase();
    if (seen.has(key)) {
      removed++;
      continue;
    }
    seen.add(key);
    result.push(ch);
  }
  return { channels: result, removed };
}

export function groupByCategory(channels: Channel[]): Record<string, Channel[]> {
  const groups: Record<string, Channel[]> = {};
  for (const ch of channels) {
    (groups[ch.category] ||= []).push(ch);
  }
  return groups;
}

// ── Diff types ────────────────────────────────────────────────────────────

export interface PlaylistDiff {
  // stream URLs of channels the user disabled (but not deleted)
  disabled:  string[];
  // stream URLs of channels the user deleted entirely
  deleted:   string[];
  // custom name overrides: url → new name
  renamed:   Record<string, string>;
  // category overrides: url → new category
  recatted:  Record<string, string>;
  // per-category ordered list of stream URLs (only stored when order differs from source)
  order:     Record<string, string[]>;
  // channels added from source or elsewhere — stored in full
  added:     Array<{ name: string; url: string; category: string; attributes: Record<string, string>; extraLines: string[] }>;
}

/**
 * Build a minimal diff between the original source channels and the
 * user's current edited channel list.
 *
 * @param sourceChannels  The original channels as parsed from the provider
 * @param editedChannels  The current state in the editor
 */
export function buildDiff(sourceChannels: Channel[], editedChannels: Channel[]): PlaylistDiff {
  const sourceByUrl = new Map(sourceChannels.map(c => [c.url, c]));
  const editedUrls  = new Set(editedChannels.map(c => c.url));

  const diff: PlaylistDiff = {
    disabled: [],
    deleted:  [],
    renamed:  {},
    recatted: {},
    order:    {},
    added:    [],
  };

  // Channels in source but not in edited list → deleted
  for (const sc of sourceChannels) {
    if (!editedUrls.has(sc.url)) {
      diff.deleted.push(sc.url);
    }
  }

  // Walk edited channels to find mutations and additions
  for (const ec of editedChannels) {
    const sc = sourceByUrl.get(ec.url);

    if (!sc) {
      // Not in source → added by the user
      diff.added.push({
        name:       ec.name,
        url:        ec.url,
        category:   ec.category,
        attributes: ec.attributes,
        extraLines: ec.extraLines ?? [],
      });
      continue;
    }

    if (!ec.enabled) diff.disabled.push(ec.url);
    if (ec.name     !== sc.name)     diff.renamed[ec.url]  = ec.name;
    if (ec.category !== sc.category) diff.recatted[ec.url] = ec.category;
  }

  // Per-category order — only record when it differs from the source order
  const editedByCategory = groupByCategory(editedChannels);
  const sourceByCategory = groupByCategory(sourceChannels);

  for (const [cat, ecChans] of Object.entries(editedByCategory)) {
    const scChans   = sourceByCategory[cat] ?? [];
    const scUrls    = scChans.map(c => c.url);
    const ecUrls    = ecChans.map(c => c.url);
    // Only store if order actually differs
    const orderChanged = ecUrls.some((url, i) => url !== scUrls[i]);
    if (orderChanged) diff.order[cat] = ecUrls;
  }

  return diff;
}

/**
 * Apply a stored diff on top of freshly-fetched source channels.
 * Returns the final channel list ready to export or display.
 */
export function applyDiff(sourceChannels: Channel[], diff: PlaylistDiff): Channel[] {
  const deletedSet  = new Set(diff.deleted);
  const disabledSet = new Set(diff.disabled);

  // Start from source, applying mutations
  let result: Channel[] = sourceChannels
    .filter(c => !deletedSet.has(c.url))
    .map(c => ({
      ...c,
      enabled:  !disabledSet.has(c.url),
      name:     diff.renamed[c.url]  ?? c.name,
      category: diff.recatted[c.url] ?? c.category,
      attributes: {
        ...c.attributes,
        ...(diff.recatted[c.url] ? { "group-title": diff.recatted[c.url] } : {}),
      },
    }));

  // Apply per-category ordering
  if (Object.keys(diff.order).length > 0) {
    const byUrl = new Map(result.map(c => [c.url, c]));
    const orderedCats = new Set(Object.keys(diff.order));
    const unordered   = result.filter(c => !orderedCats.has(c.category));
    const ordered: Channel[] = [];

    for (const [cat, urls] of Object.entries(diff.order)) {
      for (const url of urls) {
        const ch = byUrl.get(url);
        if (ch) ordered.push(ch);
      }
    }

    result = [...ordered, ...unordered];
  }

  // Append added channels at the end (in their category)
  const counter = result.length;
  const addedChannels: Channel[] = (diff.added ?? []).map((a, i) => ({
    id:           `added_${counter + i}`,
    name:         a.name,
    originalName: a.name,
    url:          a.url,
    category:     a.category,
    attributes:   a.attributes,
    extraLines:   a.extraLines ?? [],
    enabled:      !disabledSet.has(a.url),
  }));

  return [...result, ...addedChannels];
}
