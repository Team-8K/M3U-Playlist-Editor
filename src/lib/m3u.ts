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
