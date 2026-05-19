import { useEffect, useMemo, useState } from "react";
import { Search, Trash2, Download, Copy, RotateCcw, Tv, ToggleLeft, Link } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { toast } from "sonner";
import { LoaderPanel } from "@/components/LoaderPanel";
import { CategoryGroup } from "@/components/CategoryGroup";
import { SummarySidebar } from "@/components/SummarySidebar";
import {
  Channel,
  parseM3U,
  exportM3U,
  dedupeByUrl,
  groupByCategory,
} from "@/lib/m3u";

const Index = () => {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [source, setSource] = useState<string>("");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [duplicatesRemoved, setDuplicatesRemoved] = useState(0);

  // Auto-load playlist from URL hash (e.g. shared link)
  useEffect(() => {
    const hash = window.location.hash;
    const match = hash.match(/[#&]playlist=([^&]*)/);
    if (match) {
      try {
        const decoded = decodeURIComponent(escape(atob(match[1])));
        handleLoad(decoded, "Shared Playlist Link");
        // Clean the hash from the URL without reloading
        window.history.replaceState(null, "", window.location.pathname);
      } catch {
        // Invalid hash, ignore
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLoad = (content: string, src: string) => {
    const parsed = parseM3U(content);
    if (!parsed.length) {
      toast.error("No channels found in playlist");
      return;
    }
    setChannels(parsed);
    setSource(src);
    setSearch("");
    setCategoryFilter("all");
    setDuplicatesRemoved(0);
  };

  const categories = useMemo(
    () => Array.from(new Set(channels.map((c) => c.category))).sort(),
    [channels]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return channels.filter((c) => {
      if (categoryFilter !== "all" && c.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q)
      );
    });
  }, [channels, search, categoryFilter]);

  const grouped = useMemo(() => groupByCategory(filtered), [filtered]);
  const groupKeys = useMemo(() => Object.keys(grouped).sort(), [grouped]);

  const enabledCount = channels.filter((c) => c.enabled).length;

  const updateChannel = (id: string, patch: Partial<Channel>) =>
    setChannels((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const handleDedupe = () => {
    const { channels: cleaned, removed } = dedupeByUrl(channels);
    setChannels(cleaned);
    setDuplicatesRemoved((prev) => prev + removed);
    toast.success(
      removed > 0 ? `Removed ${removed} duplicate${removed > 1 ? "s" : ""}` : "No duplicates found"
    );
  };

  const handleEnableAll = (enabled: boolean) =>
    setChannels((prev) => prev.map((c) => ({ ...c, enabled })));

  const handleToggleCategoryAll = (category: string, enabled: boolean) =>
    setChannels((prev) =>
      prev.map((c) => (c.category === category ? { ...c, enabled } : c))
    );

  const handleReset = () => {
    setChannels([]);
    setSource("");
    setSearch("");
    setCategoryFilter("all");
    setDuplicatesRemoved(0);
  };

  const handleDownload = () => {
    const text = exportM3U(channels);
    const blob = new Blob([text], { type: "audio/x-mpegurl" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "team8k-playlist.m3u";
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Playlist downloaded");
  };

  const handleCopy = async () => {
    const text = exportM3U(channels);
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Clipboard unavailable");
    }
  };

  const handleGetUrl = async () => {
    try {
      const enabledOnly = channels.filter((c) => c.enabled);
      const text = exportM3U(enabledOnly);
      const encoded = btoa(unescape(encodeURIComponent(text)));
      const url = `${window.location.origin}${window.location.pathname}#playlist=${encoded}`;
      await navigator.clipboard.writeText(url);
      toast.success(`URL copied — ${enabledOnly.length} enabled channels encoded.`);
    } catch {
      toast.error("Could not generate URL");
    }
  };

  return (
    <SidebarProvider style={{ minHeight: 'unset' }}>
      <div className="flex w-full pb-16 relative overflow-x-hidden" style={{ minHeight: 'unset' }}>

        {channels.length > 0 && (
          <SummarySidebar
            total={channels.length}
            enabled={enabledCount}
            categories={categories.length}
            duplicatesRemoved={duplicatesRemoved}
          />
        )}
        <div className="flex-1 min-w-0 flex flex-col">
          {channels.length > 0 && (
            <div className="sticky top-16 z-20 h-12 flex items-center border-b border-border/50 backdrop-blur-md px-3 bg-muted opacity-0">
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
                Everything runs in your browser — nothing is stored or uploaded.
              </p>
            </div>
            <LoaderPanel onLoad={handleLoad} />

            <div className="mt-10 max-w-3xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { t: "Edit & Rename", d: "Rename any channel" },
                { t: "Smart Dedupe", d: "Strip duplicate URLs" },
                { t: "Group & Filter", d: "Auto-group by category" },
                { t: "Clean Export", d: "Valid M3U output" },
              ].map((f) => (
                <div
                  key={f.t}
                  className="bg-gradient-card ring-gold rounded-xl p-5 text-center"
                >
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
                  </p>
                  <p className="font-display font-bold text-lg">
                    <span className="text-gradient-gold">{enabledCount}</span>
                    <span className="text-muted-foreground"> / {channels.length} enabled</span>
                    <span className="text-muted-foreground text-sm font-normal"> · {categories.length} categories</span>
                  </p>
                </div>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button variant="goldOutline" size="sm" onClick={() => handleEnableAll(true)}>
                  <ToggleLeft className="h-4 w-4" /> Enable all
                </Button>
                <Button variant="goldOutline" size="sm" onClick={() => handleEnableAll(false)}>
                  Disable all
                </Button>
                <Button variant="goldOutline" size="sm" onClick={handleDedupe}>
                  <Trash2 className="h-4 w-4" /> Dedupe
                </Button>
                <Button variant="goldOutline" size="sm" onClick={handleReset}>
                  <RotateCcw className="h-4 w-4" /> Reset
                </Button>
              </div>
            </div>

            {/* Filters */}
            <div className="bg-gradient-card ring-gold rounded-2xl p-4 md:p-5 flex flex-col md:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search channels…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 bg-background/60 border-border focus-visible:ring-primary"
                />
              </div>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="md:w-64 bg-background/60 border-border">
                  <SelectValue placeholder="All categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Groups */}
            <div className="space-y-4">
              {groupKeys.length === 0 ? (
                <div className="bg-gradient-card ring-gold rounded-2xl p-12 text-center text-muted-foreground">
                  No channels match your filters.
                </div>
              ) : (
                groupKeys.map((cat) => (
                  <CategoryGroup
                    key={cat}
                    category={cat}
                    channels={grouped[cat]}
                    defaultOpen={groupKeys.length <= 3 || !!search}
                    onToggle={(id, enabled) => updateChannel(id, { enabled })}
                    onRename={(id, name) => updateChannel(id, { name })}
                    onToggleAll={handleToggleCategoryAll}
                  />
                ))
              )}
            </div>

            {/* Export bar (sticky) */}
            <div className="sticky bottom-0 z-30">
              <div className="bg-gradient-card ring-gold rounded-2xl p-4 md:p-5 shadow-gold backdrop-blur-md flex flex-wrap gap-3 justify-between items-center">
                <p className="text-sm">
                  <span className="text-muted-foreground">Ready to export </span>
                  <span className="text-gradient-gold font-display font-bold">
                    {enabledCount}
                  </span>
                  <span className="text-muted-foreground"> channels</span>
                </p>
                <div className="flex gap-2 flex-wrap">
                  <Button variant="goldOutline" onClick={handleCopy}>
                    <Copy className="h-4 w-4" /> Copy
                  </Button>
                  <Button variant="goldOutline" onClick={handleGetUrl}>
                    <Link className="h-4 w-4" /> Get URL
                  </Button>
                  <Button variant="gold" onClick={handleDownload}>
                    <Download className="h-4 w-4" /> Download M3U
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
  );
};

export default Index;
