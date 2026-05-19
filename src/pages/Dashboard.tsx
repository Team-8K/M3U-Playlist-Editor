import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Plus, Trash2, Edit3, Download, Clock,
  ListMusic, ChevronRight, RefreshCw, FileMusic, Globe, Tv, Share2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  supabase,
  listEditedPlaylists,
  deleteEditedPlaylist,
  createPlaylistSignedUrl,
  type SourcePlaylistRow,
  type EditedPlaylistRow,
} from "@/lib/supabase";

export default function Dashboard() {
  const navigate = useNavigate();
  const [source,   setSource]   = useState<SourcePlaylistRow | null>(null);
  const [edited,   setEdited]   = useState<EditedPlaylistRow[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [resyncing, setResyncing] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [{ data: s, error: se }, editedRows] = await Promise.all([
        supabase
          .from("source_playlists")
          .select("*")
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        listEditedPlaylists(),
      ]);
      if (se) toast.error("Failed to load source playlist");
      setSource(s as SourcePlaylistRow | null);
      setEdited(editedRows);
    } catch {
      toast.error("Failed to load playlists");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // ── Resync source ─────────────────────────────────────────────
  const handleResync = async () => {
    if (!source) return;
    if (source.source_type === "file") {
      toast.info("File playlists cannot be resynced — reload via the Editor.");
      return;
    }
    if (source.source_type === "xtream") {
      toast.info("Xtream resync requires your provider password — use the Editor to reload.");
      return;
    }
    if (!source.url) return;

    setResyncing(true);
    try {
      const res = await fetch("/api/m3u-proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: source.url }),
      });
      if (!res.ok) { toast.error("Could not reach your provider"); return; }
      const text = await res.text();
      const count = (text.match(/#EXTINF/g) || []).length;

      const { error } = await supabase
        .from("source_playlists")
        .update({ channel_count: count })
        .eq("id", source.id);

      if (error) throw error;
      toast.success(`Resynced — ${count.toLocaleString()} channels available`);
      load();
    } catch (err: any) {
      toast.error(err?.message || "Resync failed");
    } finally {
      setResyncing(false);
    }
  };

  // ── Delete source ─────────────────────────────────────────────
  const deleteSource = async () => {
    if (!source) return;
    const { error } = await supabase
      .from("source_playlists")
      .delete()
      .eq("id", source.id);
    if (error) { toast.error("Delete failed"); return; }
    setSource(null);
    toast.success("Source playlist deleted");
  };

  // ── Delete one edited playlist ────────────────────────────────
  const handleDeleteEdited = async (row: EditedPlaylistRow) => {
    try {
      await deleteEditedPlaylist(row);
      setEdited(prev => prev.filter(r => r.id !== row.id));
      toast.success(`"${row.name}" deleted`);
    } catch (err: any) {
      toast.error(err?.message || "Delete failed");
    }
  };

  // ── Get Player URL (signed URL, 1-year expiry) ───────────────
  const [generatingUrlId, setGeneratingUrlId] = useState<string | null>(null);

  const handleGetPlayerUrl = async (row: EditedPlaylistRow) => {
    if (!row.storage_path) {
      toast.error("Open this playlist in the Editor, re-save it, then try again.");
      return;
    }
    setGeneratingUrlId(row.id);
    try {
      const url = await createPlaylistSignedUrl(row.storage_path);
      await navigator.clipboard.writeText(url);
      toast.success("Player URL copied! Paste it into TiviMate or any M3U player.", { duration: 5000 });
    } catch (err: any) {
      toast.error(err?.message || "Could not generate player URL");
    } finally {
      setGeneratingUrlId(null);
    }
  };

  // ── Download one edited playlist ──────────────────────────────
  const handleDownloadEdited = async (row: EditedPlaylistRow) => {
    let content = row.content;
    if (!content && row.storage_path) {
      const { data, error } = await supabase.storage
        .from("edited-playlists")
        .download(row.storage_path);
      if (error || !data) { toast.error("Download failed"); return; }
      content = await data.text();
    }
    if (!content) { toast.error("No content to download"); return; }
    const blob = new Blob([content], { type: "audio/x-mpegurl" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `${row.name.replace(/\s+/g, "-")}.m3u`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Downloaded");
  };

  // ── Open edited playlist in editor ────────────────────────────
  const handleOpenInEditor = (row: EditedPlaylistRow) => {
    navigate(`/editor?edited=${row.id}`);
  };

  const sourceTypeIcon = (t: string) =>
    t === "file"   ? <FileMusic className="h-4 w-4" /> :
    t === "url"    ? <Globe className="h-4 w-4" /> :
                     <Tv className="h-4 w-4" />;

  const fmt = (d: string) =>
    new Date(d).toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
    });

  return (
    <div className="min-h-screen px-4 py-8 max-w-5xl mx-auto">

      {/* Page header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-display font-bold text-2xl md:text-3xl text-foreground">
            My Playlists
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Your source and edited playlists
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="p-2 rounded-lg text-muted-foreground hover:text-primary transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <Button
            variant="gold"
            size="sm"
            onClick={() => navigate("/editor")}
            className="flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            {source ? "Reload Playlist" : "Load Playlist"}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <div className="h-10 w-10 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <p className="text-xs text-muted-foreground tracking-widest uppercase">Loading…</p>
        </div>
      ) : (
        <div className="space-y-10">

          {/* ── SOURCE PLAYLIST ─────────────────────────────────── */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="h-8 w-8 rounded-lg bg-primary/10 border border-primary/25 flex items-center justify-center">
                <Globe className="h-4 w-4 text-primary" />
              </div>
              <div>
                <h2 className="font-display font-bold text-base tracking-wide">
                  Imported Source
                </h2>
                <p className="text-xs text-muted-foreground">
                  Your raw playlist from your provider
                </p>
              </div>
            </div>

            {!source ? (
              <EmptyState
                icon={<Globe className="h-8 w-8 text-muted-foreground/40" />}
                title="No source playlist yet"
                description="Load a playlist in the editor — it will be saved here automatically."
                cta="Go to Editor"
                onClick={() => navigate("/editor")}
              />
            ) : (
              <div className="bg-gradient-card ring-gold rounded-xl p-4 flex items-center gap-4 group">
                <div className="h-10 w-10 rounded-lg bg-primary/10 border border-primary/25 flex items-center justify-center flex-shrink-0 text-primary">
                  {sourceTypeIcon(source.source_type)}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-foreground truncate">
                    {source.name}
                  </p>
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    <span className="text-xs text-muted-foreground capitalize">
                      {source.source_type}
                    </span>
                    {source.channel_count > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {source.channel_count.toLocaleString()} channels
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Updated {fmt(source.updated_at)}
                    </span>
                  </div>
                  {source.url && (
                    <p className="text-xs text-muted-foreground/60 font-mono truncate mt-0.5 max-w-xs">
                      {source.url}
                    </p>
                  )}
                  {source.xtream_host && (
                    <p className="text-xs text-muted-foreground/60 font-mono truncate mt-0.5 max-w-xs">
                      {source.xtream_host} · {source.xtream_user}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  {source.source_type === "url" && (
                    <button
                      onClick={handleResync}
                      disabled={resyncing}
                      className="p-2 rounded-lg hover:bg-primary/10 text-muted-foreground hover:text-primary transition-all"
                      title="Resync from provider"
                    >
                      <RefreshCw className={`h-4 w-4 ${resyncing ? "animate-spin" : ""}`} />
                    </button>
                  )}
                  <button
                    onClick={() => navigate(`/editor?source=${source.id}`)}
                    className="p-2 rounded-lg hover:bg-primary/10 text-muted-foreground hover:text-primary transition-all"
                    title="Open in editor"
                  >
                    <Edit3 className="h-4 w-4" />
                  </button>
                  <button
                    onClick={deleteSource}
                    className="p-2 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-all"
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                <ChevronRight
                  className="h-4 w-4 text-muted-foreground/30 flex-shrink-0 group-hover:text-primary/50 transition-colors cursor-pointer"
                  onClick={() => navigate(`/editor?source=${source.id}`)}
                />
              </div>
            )}
          </section>

          {/* ── EDITED PLAYLISTS ─────────────────────────────────── */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-lg bg-primary/10 border border-primary/25 flex items-center justify-center">
                  <ListMusic className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <h2 className="font-display font-bold text-base tracking-wide">
                    My Playlists
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Your saved, cleaned playlists — ready for your player
                  </p>
                </div>
              </div>
              {edited.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {edited.length} saved
                </span>
              )}
            </div>

            {edited.length === 0 ? (
              <EmptyState
                icon={<ListMusic className="h-8 w-8 text-muted-foreground/40" />}
                title="No saved playlists yet"
                description='After editing a playlist in the editor, click "Save to Dashboard" to store it here.'
                cta="Go to Editor"
                onClick={() => navigate("/editor")}
              />
            ) : (
              <div className="space-y-3">
                {edited.map(row => (
                  <div
                    key={row.id}
                    className="bg-gradient-card ring-gold rounded-xl p-4 flex items-center gap-4 group"
                  >
                    <div className="h-10 w-10 rounded-lg bg-primary/10 border border-primary/25 flex items-center justify-center flex-shrink-0 text-primary">
                      <ListMusic className="h-4 w-4" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-foreground truncate">
                        {row.name}
                      </p>
                      <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                        <span className="text-xs text-primary font-semibold">
                          {row.enabled_count.toLocaleString()} channels enabled
                        </span>
                        {row.channel_count !== row.enabled_count && (
                          <span className="text-xs text-muted-foreground">
                            of {row.channel_count.toLocaleString()} total
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Saved {fmt(row.updated_at)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {/* Open in Editor — re-upload / continue editing */}
                      <button
                        onClick={() => handleOpenInEditor(row)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-primary/30 text-primary hover:bg-primary/10 transition-all"
                        title="Open in Editor to continue editing"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                        Open in Editor
                      </button>
                      <button
                        onClick={() => handleGetPlayerUrl(row)}
                        disabled={generatingUrlId === row.id}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-primary/30 text-primary hover:bg-primary/10 transition-all disabled:opacity-50"
                        title="Copy a URL to use in TiviMate or any M3U player"
                      >
                        <Share2 className="h-3.5 w-3.5" />
                        {generatingUrlId === row.id ? "Generating…" : "Get Player URL"}
                      </button>
                      <button
                        onClick={() => handleDownloadEdited(row)}
                        className="p-2 rounded-lg hover:bg-primary/10 text-muted-foreground hover:text-primary transition-all"
                        title="Download M3U"
                      >
                        <Download className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteEdited(row)}
                        className="p-2 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-all"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

    </div>
  );
}

function EmptyState({
  icon, title, description, cta, onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  cta: string;
  onClick: () => void;
}) {
  return (
    <div className="bg-gradient-card ring-gold rounded-xl p-10 flex flex-col items-center text-center gap-3">
      {icon}
      <p className="font-semibold text-sm text-foreground">{title}</p>
      <p className="text-xs text-muted-foreground max-w-xs leading-relaxed">
        {description}
      </p>
      <button
        onClick={onClick}
        className="mt-2 text-xs font-semibold text-primary hover:underline flex items-center gap-1"
      >
        {cta} <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
