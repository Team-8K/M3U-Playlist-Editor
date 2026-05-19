import { useEffect, useMemo, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Search, Trash2, Download, Copy, RotateCcw, Tv,
  Share2,
  ToggleLeft, Link as LinkIcon, Save, ChevronLeft, RefreshCw,
  Replace, X, CheckSquare, Undo2, Redo2, Plus,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { toast } from "sonner";
import { LoaderPanel } from "@/components/LoaderPanel";
import { CategoryGroup } from "@/components/CategoryGroup";
import { SummarySidebar } from "@/components/SummarySidebar";
import { AddFromSourceModal } from "@/components/AddFromSourceModal";
import { useHistory } from "@/hooks/useHistory";
import {
  Channel, parseM3U, exportM3U, dedupeByUrl, groupByCategory,
} from "@/lib/m3u";
import {
  supabase,
  saveNewEditedPlaylist,
  updateEditedPlaylist,
  uploadPlaylistFile,
  upsertSourcePlaylist,
  listEditedPlaylists,
  createPlaylistSignedUrl,
  type SourcePlaylistRow,
  type EditedPlaylistRow,
} from "@/lib/supabase";

export default function EditorPage() {
  const navigate  = useNavigate();
  const [params]  = useSearchParams();
  const sourceId  = params.get("source");
  const editedId  = params.get("edited");

  // ── History (undo/redo) ───────────────────────────────────────
  const { channels, setChannels, resetChannels, undo, redo, canUndo, canRedo } = useHistory([]);

  const [source,          setSource]          = useState<string>("");
  const [sourceRow,       setSourceRow]       = useState<SourcePlaylistRow | null>(null);
  const [editedRow,       setEditedRow]       = useState<EditedPlaylistRow | null>(null);
  const [search,          setSearch]          = useState("");
  const [catFilter,       setCatFilter]       = useState<string>("all");
  const [dupes,           setDupes]           = useState(0);
  const [saving,          setSaving]          = useState(false);
  const [resyncing,       setResyncing]       = useState(false);

  // ── Bulk selection ────────────────────────────────────────────
  const [selectedIds,     setSelectedIds]     = useState<Set<string>>(new Set());

  // ── Find & Replace ────────────────────────────────────────────
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [findText,        setFindText]        = useState("");
  const [replaceText,     setReplaceText]     = useState("");
  const [useRegex,        setUseRegex]        = useState(false);
  const [replaceCount,    setReplaceCount]    = useState<number | null>(null);

  // ── Save dialog ───────────────────────────────────────────────
  const [showSaveDialog,  setShowSaveDialog]  = useState(false);
  const [playlistName,    setPlaylistName]    = useState("");
  const [existingList,    setExistingList]    = useState<EditedPlaylistRow[]>([]);
  const [overwriteTarget, setOverwriteTarget] = useState<string>("new");

  // ── Add from source modal ─────────────────────────────────────
  const [showAddSource,   setShowAddSource]   = useState(false);

  // ── Keyboard shortcuts (Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z) ──────
  const undoRef = useRef(undo);
  const redoRef = useRef(redo);
  undoRef.current = undo;
  redoRef.current = redo;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key === "z" && !e.shiftKey) { e.preventDefault(); undoRef.current(); }
      if (e.key === "y" || (e.key === "z" && e.shiftKey)) { e.preventDefault(); redoRef.current(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // ── Load saved edited playlist ────────────────────────────────
  useEffect(() => {
    if (!editedId) return;
    (async () => {
      const { data, error } = await supabase
        .from("edited_playlists").select("*").eq("id", editedId).single();
      if (error || !data) { toast.error("Could not load saved playlist"); return; }
      const row = data as EditedPlaylistRow;
      setEditedRow(row);

      let content = row.content;
      if (!content && row.storage_path) {
        const { data: file, error: fe } = await supabase.storage
          .from("edited-playlists").download(row.storage_path);
        if (fe || !file) { toast.error("Could not download playlist file"); return; }
        content = await file.text();
      }
      if (!content) { toast.error("Playlist has no content"); return; }

      const parsed = parseM3U(content);
      if (!parsed.length) { toast.error("No channels found in saved playlist"); return; }
      resetChannels(parsed);
      setSource(row.name);
      setPlaylistName(row.name);

      // Also load the source row so "Add from source" works
      if (row.source_playlist_id) {
        const { data: sr } = await supabase
          .from("source_playlists").select("*").eq("id", row.source_playlist_id).single();
        if (sr) setSourceRow(sr as SourcePlaylistRow);
      }
      toast.success(`Loaded "${row.name}" — ${parsed.length.toLocaleString()} channels`);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editedId]);

  // ── Load from source playlist ─────────────────────────────────
  useEffect(() => {
    if (!sourceId) return;
    (async () => {
      const { data, error } = await supabase
        .from("source_playlists").select("*").eq("id", sourceId).single();
      if (error || !data) { toast.error("Could not load playlist"); return; }
      const row = data as SourcePlaylistRow;
      setSourceRow(row);

      if (row.source_type === "url" && row.url) {
        const res = await fetch("/api/m3u-proxy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: row.url }),
        });
        if (!res.ok) { toast.error("Could not re-fetch playlist URL"); return; }
        const text = await res.text();
        handleLoad(text, row.name, row);
      } else if (row.storage_path) {
        const { data: file, error: fe } = await supabase.storage
          .from("source-playlists").download(row.storage_path);
        if (fe || !file) { toast.error("Could not download saved playlist file"); return; }
        const text = await file.text();
        handleLoad(text, row.name, row);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId]);

  // ── Handle new load (from LoaderPanel) ───────────────────────
  const handleLoad = useCallback(async (
    content: string,
    src: string,
    existingRow?: SourcePlaylistRow | null,
    meta?: { type: "file" | "url" | "xtream"; url?: string; xtream_host?: string; xtream_user?: string; }
  ) => {
    const parsed = parseM3U(content);
    if (!parsed.length) { toast.error("No channels found in playlist"); return; }
    resetChannels(parsed);
    setSource(src);
    setSearch("");
    setCatFilter("all");
    setDupes(0);
    setSelectedIds(new Set());
    setEditedRow(null);
    setPlaylistName("");

    if (!existingRow) {
      try {
        const row = await upsertSourcePlaylist({
          name: src,
          source_type: meta?.type ?? "url",
          url: meta?.url ?? null,
          xtream_host: meta?.xtream_host ?? null,
          xtream_user: meta?.xtream_user ?? null,
          channel_count: parsed.length,
        });
        setSourceRow(row);
        toast.success("Source playlist saved to dashboard");
      } catch (err: any) {
        toast.error(`Could not save source: ${err?.message || "unknown error"}`);
      }
    } else {
      setSourceRow(existingRow);
    }
  }, [resetChannels]);

  const onLoadFromPanel = useCallback((
    content: string,
    src: string,
    meta?: { type: "file" | "url" | "xtream"; url?: string; xtream_host?: string; xtream_user?: string; }
  ) => {
    handleLoad(content, src, null, meta);
  }, [handleLoad]);

  // ── Resync ────────────────────────────────────────────────────
  const handleResync = async () => {
    if (!sourceRow || sourceRow.source_type === "file") return;
    setResyncing(true);
    try {
      if (sourceRow.source_type !== "url" || !sourceRow.url) {
        toast.error("Xtream resync requires your provider password. Please reload via the loader panel.");
        return;
      }
      const res = await fetch("/api/m3u-proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: sourceRow.url }),
      });
      if (!res.ok) { toast.error("Could not re-fetch playlist URL"); return; }
      const content = await res.text();
      const parsed = parseM3U(content);
      if (!parsed.length) { toast.error("No channels found after resync"); return; }
      resetChannels(parsed);
      setSelectedIds(new Set());
      const updated = await upsertSourcePlaylist({
        name: sourceRow.name,
        source_type: sourceRow.source_type,
        url: sourceRow.url ?? null,
        xtream_host: sourceRow.xtream_host ?? null,
        xtream_user: sourceRow.xtream_user ?? null,
        channel_count: parsed.length,
      });
      setSourceRow(updated);
      toast.success(`Resynced — ${parsed.length.toLocaleString()} channels loaded`);
    } catch (err: any) {
      toast.error(err?.message || "Resync failed");
    } finally {
      setResyncing(false);
    }
  };

  // ── Add channels from source ──────────────────────────────────
  const handleAddFromSource = (newChannels: Channel[]) => {
    setChannels(prev => {
      // Avoid URL dupes
      const existingUrls = new Set(prev.map(c => c.url.trim().toLowerCase()));
      const toAdd = newChannels.filter(c => !existingUrls.has(c.url.trim().toLowerCase()));
      return [...prev, ...toAdd];
    });
  };

  const existingUrls = useMemo(
    () => new Set(channels.map(c => c.url.trim().toLowerCase())),
    [channels]
  );

  // ── Save to dashboard ─────────────────────────────────────────
  const openSaveDialog = async () => {
    if (!channels.length) return;
    if (!playlistName) setPlaylistName(source || "My Playlist");

    // Load current edited playlists to check the cap
    try {
      const rows = await listEditedPlaylists();
      setExistingList(rows);
      // If editing an existing one, no cap check needed
      if (!editedRow) {
        // Filter out the one we're currently editing (shouldn't exist, but safety)
        const others = rows.filter(r => r.id !== editedRow);
        if (others.length >= 2) {
          // At cap — force overwrite selection, default to oldest
          setOverwriteTarget(others[others.length - 1].id);
        } else {
          setOverwriteTarget("new");
        }
      } else {
        setOverwriteTarget(editedRow.id);
      }
    } catch {
      setExistingList([]);
      setOverwriteTarget(editedRow?.id ?? "new");
    }
    setShowSaveDialog(true);
  };

  const handleSaveToDashboard = async () => {
    if (!channels.length || !playlistName.trim()) return;
    setSaving(true);
    setShowSaveDialog(false);
    try {
      const enabled = channels.filter(c => c.enabled);
      const m3uText = exportM3U(channels);
      const name    = playlistName.trim();

      // Always upload to storage so Get Player URL always works
      const filename    = `edited-${Date.now()}.m3u`;
      const storagePath = await uploadPlaylistFile("edited-playlists", filename, m3uText);

      // Determine target row: overwrite existing or create new
      const targetId = overwriteTarget !== "new" ? overwriteTarget : editedRow?.id ?? null;

      if (targetId) {
        // Overwrite existing row — delete old storage file first to save space
        const existing = existingList.find(r => r.id === targetId) ?? editedRow;
        if (existing?.storage_path && existing.storage_path !== storagePath) {
          await supabase.storage.from("edited-playlists").remove([existing.storage_path]);
        }
        const updated = await updateEditedPlaylist(targetId, {
          name,
          content:            null,   // always use storage_path, not inline
          storage_path:       storagePath,
          channel_count:      channels.length,
          enabled_count:      enabled.length,
          source_playlist_id: sourceRow?.id ?? (existing as any)?.source_playlist_id ?? null,
        });
        setEditedRow(updated);
        toast.success(`"${name}" updated!`);
      } else {
        // Create new row
        const newRow = await saveNewEditedPlaylist({
          source_playlist_id: sourceRow?.id ?? null,
          name,
          content:       null,
          storage_path:  storagePath,
          channel_count: channels.length,
          enabled_count: enabled.length,
        });
        setEditedRow(newRow);
        toast.success(`"${name}" saved to dashboard!`);
      }
    } catch (err: any) {
      toast.error(err?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  // ── Find & Replace ────────────────────────────────────────────
  const handleFindReplace = () => {
    if (!findText.trim()) { toast.error("Enter something to find"); return; }
    let count = 0;
    setChannels(prev => prev.map(ch => {
      let newName = ch.name;
      try {
        if (useRegex) {
          const re = new RegExp(findText, "gi");
          if (re.test(ch.name)) { newName = ch.name.replace(new RegExp(findText, "gi"), replaceText); count++; }
        } else {
          if (ch.name.toLowerCase().includes(findText.toLowerCase())) {
            newName = ch.name.replace(new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), replaceText);
            count++;
          }
        }
      } catch { /* invalid regex */ }
      return newName !== ch.name ? { ...ch, name: newName } : ch;
    }));
    setReplaceCount(count);
    if (count === 0) toast.info("No matches found");
    else toast.success(`Replaced ${count} channel name${count > 1 ? "s" : ""}`);
  };

  // ── Bulk selection ────────────────────────────────────────────
  const handleSelectChange = (id: string, selected: boolean) =>
    setSelectedIds(prev => { const n = new Set(prev); selected ? n.add(id) : n.delete(id); return n; });

  const handleSelectAllInCategory = (category: string, selected: boolean) =>
    setSelectedIds(prev => {
      const n = new Set(prev);
      channels.filter(c => c.category === category).forEach(c => selected ? n.add(c.id) : n.delete(c.id));
      return n;
    });

  const handleDeleteSelected = (ids: string[]) => {
    const idSet = new Set(ids);
    setChannels(prev => prev.filter(c => !idSet.has(c.id)));
    setSelectedIds(prev => { const n = new Set(prev); ids.forEach(id => n.delete(id)); return n; });
    toast.success(`Deleted ${ids.length} channel${ids.length > 1 ? "s" : ""}`);
  };

  // ── Reorder within category ───────────────────────────────────
  const handleReorder = (category: string, newOrder: Channel[]) => {
    setChannels(prev => {
      const others = prev.filter(c => c.category !== category);
      // Preserve the original inter-category order by splicing back at the right position
      const firstIdx = prev.findIndex(c => c.category === category);
      const result = [...others];
      result.splice(firstIdx, 0, ...newOrder);
      return result;
    });
  };

  // ── Category rename ───────────────────────────────────────────
  const handleRenameCategory = (oldName: string, newName: string) => {
    setChannels(prev => prev.map(c =>
      c.category === oldName
        ? { ...c, category: newName, attributes: { ...c.attributes, "group-title": newName } }
        : c
    ));
    toast.success(`Category renamed to "${newName}"`);
  };

  // ── Derived state ─────────────────────────────────────────────
  const categories = useMemo(() => Array.from(new Set(channels.map(c => c.category))).sort(), [channels]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return channels.filter(c => {
      if (catFilter !== "all" && c.category !== catFilter) return false;
      if (!q) return true;
      return c.name.toLowerCase().includes(q) || c.category.toLowerCase().includes(q);
    });
  }, [channels, search, catFilter]);

  const grouped   = useMemo(() => groupByCategory(filtered), [filtered]);
  const groupKeys = useMemo(() => Object.keys(grouped).sort(), [grouped]);
  const enabledCount = channels.filter(c => c.enabled).length;

  const updateChannel = (id: string, patch: Partial<Channel>) =>
    setChannels(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c));

  const handleDedupe = () => {
    const { channels: cleaned, removed } = dedupeByUrl(channels);
    setChannels(cleaned);
    setDupes(p => p + removed);
    toast.success(removed > 0 ? `Removed ${removed} duplicate${removed > 1 ? "s" : ""}` : "No duplicates found");
  };

  const handleEnableAll  = (enabled: boolean) => setChannels(prev => prev.map(c => ({ ...c, enabled })));
  const handleToggleCat  = (cat: string, enabled: boolean) =>
    setChannels(prev => prev.map(c => c.category === cat ? { ...c, enabled } : c));

  const handleReset = () => {
    resetChannels([]);
    setSource(""); setSearch(""); setCatFilter("all");
    setDupes(0); setSourceRow(null); setEditedRow(null);
    setSelectedIds(new Set()); setPlaylistName("");
  };

  const handleDownload = () => {
    const text = exportM3U(channels);
    const blob = new Blob([text], { type: "audio/x-mpegurl" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `${(playlistName || "team8k-playlist").replace(/\s+/g, "-")}.m3u`; a.click();
    URL.revokeObjectURL(url);
    toast.success("Playlist downloaded");
  };

  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(exportM3U(channels)); toast.success("Copied to clipboard"); }
    catch { toast.error("Clipboard unavailable"); }
  };

  const [generatingUrl, setGeneratingUrl] = useState(false);

  const handleGetUrl = async () => {
    if (!editedRow) {
      toast.error("Save your playlist to the dashboard first, then you can get a player URL.");
      return;
    }
    if (!editedRow.storage_path) {
      toast.error("Re-save your playlist in the editor and try again.");
      return;
    }
    setGeneratingUrl(true);
    try {
      const url = await createPlaylistSignedUrl(editedRow.storage_path);
      await navigator.clipboard.writeText(url);
      toast.success("Player URL copied! Paste it into TiviMate or any M3U player.", { duration: 5000 });
    } catch (err: any) {
      toast.error(err?.message || "Could not generate player URL");
    } finally {
      setGeneratingUrl(false);
    }
  };

  const canResync     = sourceRow && sourceRow.source_type !== "file";
  const totalSelected = selectedIds.size;

  return (
    <div className="min-h-screen">
      <div className="px-4 pt-6 pb-2 max-w-6xl mx-auto">
        <button
          onClick={() => navigate("/dashboard")}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Back to Dashboard
        </button>
      </div>

      <SidebarProvider style={{ minHeight: "unset" }}>
        <div className="flex w-full pb-16 relative overflow-x-hidden" style={{ minHeight: "unset" }}>
          {channels.length > 0 && (
            <SummarySidebar
              total={channels.length}
              enabled={enabledCount}
              categories={categories.length}
              duplicatesRemoved={dupes}
            />
          )}

          <div className="flex-1 min-w-0 flex flex-col">
            {channels.length > 0 && (
              <div className="sticky top-14 z-20 h-12 flex items-center border-b border-border/50 backdrop-blur-md px-3 bg-muted opacity-0">
                <SidebarTrigger className="text-primary hover:bg-primary/10" />
                <span className="ml-3 text-xs tracking-[0.25em] uppercase text-muted-foreground font-display">
                  Summary
                </span>
              </div>
            )}

            <div className="container max-w-6xl">
              <div className="editor-page-title">
                <h1 className="text-3xl">Premium M3U Playlist Editor &amp; Cleaner</h1>
              </div>

              {channels.length === 0 ? (
                <main className="animate-fade-in">
                  <div className="text-center mb-10">
                    <h2 className="font-display font-bold text-3xl mb-3 md:text-4xl text-center">
                      Load Your Playlist
                    </h2>
                    <p className="text-muted-foreground text-sm">
                      Everything runs in your browser — your source is saved to your dashboard automatically.
                    </p>
                  </div>
                  <LoaderPanel onLoad={onLoadFromPanel} />
                  <div className="mt-10 max-w-3xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                      { t: "Edit & Rename",   d: "Rename channels & categories" },
                      { t: "Drag & Drop",     d: "Reorder channels within a group" },
                      { t: "Undo / Redo",     d: "Ctrl+Z / Ctrl+Y anytime" },
                      { t: "Save & Export",   d: "Named saves to your dashboard" },
                    ].map(f => (
                      <div key={f.t} className="bg-gradient-card ring-gold rounded-xl p-5 text-center">
                        <h4 className="font-display font-bold text-sm mb-1">{f.t}</h4>
                        <p className="text-xs text-muted-foreground">{f.d}</p>
                      </div>
                    ))}
                  </div>
                </main>
              ) : (
                <main className="animate-fade-in space-y-6">
                  {/* Stats bar */}
                  <div className="bg-gradient-card ring-gold rounded-2xl p-5 md:p-6 shadow-elegant flex flex-wrap items-center gap-4 justify-between">
                    <div className="flex items-center gap-5">
                      <div className="h-12 w-12 rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-center">
                        <Tv className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground truncate max-w-[280px]">
                          {source}
                          {editedRow && <span className="ml-2 text-primary/70">· editing saved playlist</span>}
                        </p>
                        <p className="font-display font-bold text-lg">
                          <span className="text-gradient-gold">{enabledCount}</span>
                          <span className="text-muted-foreground"> / {channels.length} enabled</span>
                          <span className="text-muted-foreground text-sm font-normal"> · {categories.length} categories</span>
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      {/* Undo / Redo */}
                      <Button
                        variant="goldOutline" size="sm"
                        onClick={undo} disabled={!canUndo}
                        title="Undo (Ctrl+Z)"
                      >
                        <Undo2 className="h-4 w-4" /> Undo
                      </Button>
                      <Button
                        variant="goldOutline" size="sm"
                        onClick={redo} disabled={!canRedo}
                        title="Redo (Ctrl+Y)"
                      >
                        <Redo2 className="h-4 w-4" /> Redo
                      </Button>

                      {canResync && (
                        <Button variant="goldOutline" size="sm" onClick={handleResync} disabled={resyncing}>
                          <RefreshCw className={`h-4 w-4 ${resyncing ? "animate-spin" : ""}`} />
                          {resyncing ? "Syncing…" : "Resync"}
                        </Button>
                      )}

                      <Button variant="goldOutline" size="sm" onClick={() => handleEnableAll(true)}>
                        <ToggleLeft className="h-4 w-4" /> Enable all
                      </Button>
                      <Button variant="goldOutline" size="sm" onClick={() => handleEnableAll(false)}>
                        Disable all
                      </Button>
                      {sourceRow && (
                        <Button variant="goldOutline" size="sm" onClick={() => setShowAddSource(true)} title="Browse your source playlist and add channels">
                          <Plus className="h-4 w-4" /> Add Channels
                        </Button>
                      )}
                      <Button variant="goldOutline" size="sm" onClick={handleDedupe}>
                        <Trash2 className="h-4 w-4" /> Dedupe
                      </Button>
                      <Button variant="goldOutline" size="sm" onClick={() => setShowFindReplace(v => !v)}>
                        <Replace className="h-4 w-4" /> Find &amp; Replace
                      </Button>
                      <Button variant="goldOutline" size="sm" onClick={handleReset}>
                        <RotateCcw className="h-4 w-4" /> Reset
                      </Button>
                    </div>
                  </div>

                  {/* Find & Replace panel */}
                  {showFindReplace && (
                    <div className="bg-gradient-card ring-gold rounded-2xl p-5 shadow-elegant space-y-3">
                      <div className="flex items-center justify-between mb-1">
                        <h3 className="font-display font-bold text-sm text-primary uppercase tracking-widest">
                          Find &amp; Replace Channel Names
                        </h3>
                        <button onClick={() => { setShowFindReplace(false); setReplaceCount(null); }} className="text-muted-foreground hover:text-foreground">
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="grid md:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-muted-foreground uppercase tracking-widest mb-1.5">Find</label>
                          <Input
                            placeholder="Text to find…"
                            value={findText}
                            onChange={e => { setFindText(e.target.value); setReplaceCount(null); }}
                            className="bg-background/60 border-border focus-visible:ring-primary"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-muted-foreground uppercase tracking-widest mb-1.5">Replace with</label>
                          <Input
                            placeholder="Replacement text…"
                            value={replaceText}
                            onChange={e => { setReplaceText(e.target.value); setReplaceCount(null); }}
                            className="bg-background/60 border-border focus-visible:ring-primary"
                            onKeyDown={e => e.key === "Enter" && handleFindReplace()}
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                          <input type="checkbox" checked={useRegex} onChange={e => setUseRegex(e.target.checked)} className="h-3.5 w-3.5 accent-primary" />
                          Use regex
                        </label>
                        {replaceCount !== null && replaceCount > 0 && (
                          <span className="text-xs text-primary">{replaceCount} replaced</span>
                        )}
                        <Button variant="gold" size="sm" onClick={handleFindReplace} className="ml-auto">
                          <Replace className="h-4 w-4" /> Replace All
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Bulk selection bar */}
                  {totalSelected > 0 && (
                    <div className="bg-gradient-card ring-gold rounded-2xl px-5 py-3 flex items-center gap-4 shadow-elegant">
                      <CheckSquare className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium text-primary">
                        {totalSelected} channel{totalSelected > 1 ? "s" : ""} selected
                      </span>
                      <div className="flex gap-2 ml-auto">
                        <Button variant="goldOutline" size="sm" onClick={() => handleDeleteSelected(Array.from(selectedIds))}>
                          <Trash2 className="h-4 w-4" /> Delete selected
                        </Button>
                        <Button variant="goldOutline" size="sm" onClick={() => setSelectedIds(new Set())}>
                          <X className="h-4 w-4" /> Clear
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Filters */}
                  <div className="bg-gradient-card ring-gold rounded-2xl p-4 md:p-5 flex flex-col md:flex-row gap-3">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search channels…"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="pl-9 bg-background/60 border-border focus-visible:ring-primary"
                      />
                    </div>
                    <Select value={catFilter} onValueChange={setCatFilter}>
                      <SelectTrigger className="md:w-64 bg-background/60 border-border">
                        <SelectValue placeholder="All categories" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All categories</SelectItem>
                        {categories.map(c => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Channel groups */}
                  <div className="space-y-4">
                    {groupKeys.length === 0 ? (
                      <div className="bg-gradient-card ring-gold rounded-2xl p-12 text-center text-muted-foreground">
                        No channels match your filters.
                      </div>
                    ) : (
                      groupKeys.map(cat => (
                        <CategoryGroup
                          key={cat}
                          category={cat}
                          channels={grouped[cat]}
                          defaultOpen={groupKeys.length <= 3 || !!search}
                          selectedIds={selectedIds}
                          onToggle={(id, enabled) => updateChannel(id, { enabled })}
                          onRename={(id, name) => updateChannel(id, { name })}
                          onRenameCategory={handleRenameCategory}
                          onToggleAll={handleToggleCat}
                          onSelectChange={handleSelectChange}
                          onSelectAllInCategory={handleSelectAllInCategory}
                          onDeleteSelected={handleDeleteSelected}
                          onReorder={handleReorder}
                        />
                      ))
                    )}
                  </div>

                  {/* Export / save bar */}
                  <div className="sticky bottom-0 z-30">
                    <div className="bg-gradient-card ring-gold rounded-2xl p-4 md:p-5 shadow-gold backdrop-blur-md flex flex-wrap gap-3 justify-between items-center">
                      <p className="text-sm">
                        <span className="text-muted-foreground">Ready to export </span>
                        <span className="text-gradient-gold font-display font-bold">{enabledCount}</span>
                        <span className="text-muted-foreground"> channels</span>
                      </p>
                      <div className="flex gap-2 flex-wrap">
                        {/* Copy, Download and Get URL only available for edited (not raw source) playlists */}
                        {editedRow && (
                          <>
                            <Button variant="goldOutline" onClick={handleCopy}>
                              <Copy className="h-4 w-4" /> Copy
                            </Button>
                            <Button variant="goldOutline" onClick={handleDownload}>
                              <Download className="h-4 w-4" /> Download
                            </Button>
                            <Button
                              variant="goldOutline"
                              onClick={handleGetUrl}
                              disabled={generatingUrl}
                              title="Copy a URL to use directly in TiviMate or any M3U player"
                            >
                              <Share2 className="h-4 w-4" />
                              {generatingUrl ? "Generating…" : "Get Player URL"}
                            </Button>
                          </>
                        )}
                        <Button variant="gold" onClick={openSaveDialog} disabled={saving}>
                          <Save className="h-4 w-4" />
                          {saving ? "Saving…" : editedRow ? "Update Playlist" : "Save to Dashboard"}
                        </Button>
                      </div>
                    </div>
                  </div>
                </main>
              )}
            </div>
          </div>
        </div>
      </SidebarProvider>

      {/* ── Save / name dialog ─────────────────────────────────── */}
      <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <DialogContent className="bg-gradient-card border-border">
          <DialogHeader>
            <DialogTitle className="font-display font-bold text-lg">
              {editedRow ? "Update Playlist" : "Save Playlist"}
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-4">
            <div>
              <label className="block text-xs text-muted-foreground uppercase tracking-widest mb-1.5">Playlist name</label>
              <Input
                autoFocus
                placeholder="e.g. Sports Channels, My IPTV…"
                value={playlistName}
                onChange={e => setPlaylistName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSaveToDashboard()}
                className="bg-background/60 border-border focus-visible:ring-primary"
              />
            </div>

            {/* Overwrite selector — shown when user has 2 playlists already and isn't editing one */}
            {!editedRow && existingList.length >= 2 && (
              <div>
                <label className="block text-xs text-muted-foreground uppercase tracking-widest mb-2">
                  You already have 2 saved playlists. Choose one to replace:
                </label>
                <div className="space-y-2">
                  {existingList.map(row => (
                    <label
                      key={row.id}
                      className={`flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-all ${
                        overwriteTarget === row.id
                          ? "border-primary bg-primary/10"
                          : "border-border hover:border-primary/40"
                      }`}
                    >
                      <input
                        type="radio"
                        name="overwrite"
                        value={row.id}
                        checked={overwriteTarget === row.id}
                        onChange={() => setOverwriteTarget(row.id)}
                        className="accent-primary"
                      />
                      <div>
                        <p className="text-sm font-medium">{row.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {row.enabled_count.toLocaleString()} channels · saved {new Date(row.updated_at).toLocaleDateString()}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              {editedRow
                ? `This will overwrite "${editedRow.name}" in your dashboard.`
                : existingList.length >= 2
                ? "The selected playlist above will be replaced with your current edits."
                : `${enabledCount} of ${channels.length} channels will be saved.`}
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="goldOutline" onClick={() => setShowSaveDialog(false)}>Cancel</Button>
            <Button
              variant="gold"
              onClick={handleSaveToDashboard}
              disabled={!playlistName.trim() || (!editedRow && existingList.length >= 2 && overwriteTarget === "new")}
            >
              <Save className="h-4 w-4" />
              {editedRow ? "Update" : existingList.length >= 2 ? "Replace & Save" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add from source modal */}
      <AddFromSourceModal
        open={showAddSource}
        onClose={() => setShowAddSource(false)}
        sourcePlaylistId={sourceRow?.id ?? editedRow?.source_playlist_id ?? null}
        existingUrls={existingUrls}
        onAdd={handleAddFromSource}
      />

    </div>
  );
}
