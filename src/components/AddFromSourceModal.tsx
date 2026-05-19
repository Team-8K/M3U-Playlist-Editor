import { useEffect, useState, useMemo } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Plus, ChevronDown, Check } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { Channel, parseM3U, groupByCategory } from "@/lib/m3u";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
  sourcePlaylistId: string | null;
  existingUrls: Set<string>;        // urls already in the edited playlist
  onAdd: (channels: Channel[]) => void;
}

export function AddFromSourceModal({
  open, onClose, sourcePlaylistId, existingUrls, onAdd,
}: Props) {
  const [loading,   setLoading]   = useState(false);
  const [source,    setSource]    = useState<Channel[]>([]);
  const [search,    setSearch]    = useState("");
  const [selected,  setSelected]  = useState<Set<string>>(new Set());
  const [expanded,  setExpanded]  = useState<Set<string>>(new Set());

  // ── Load source playlist ──────────────────────────────────────
  useEffect(() => {
    if (!open || !sourcePlaylistId) return;
    setLoading(true);
    setSelected(new Set());
    setSearch("");

    (async () => {
      try {
        // Fetch source row to get url / storage_path
        const { data: row, error } = await supabase
          .from("source_playlists")
          .select("*")
          .eq("id", sourcePlaylistId)
          .single();

        if (error || !row) { toast.error("Could not load source playlist"); return; }

        let content = "";
        if (row.source_type === "url" && row.url) {
          const res = await fetch("/api/m3u-proxy", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: row.url }),
          });
          if (!res.ok) { toast.error("Could not reach your provider"); return; }
          content = await res.text();
        } else if (row.storage_path) {
          const { data: file, error: fe } = await supabase.storage
            .from("source-playlists")
            .download(row.storage_path);
          if (fe || !file) { toast.error("Could not download source file"); return; }
          content = await file.text();
        } else {
          toast.error("Source playlist has no URL or file — please reload it in the editor first.");
          return;
        }

        const parsed = parseM3U(content);
        // Filter out channels already in the edited playlist
        const available = parsed.filter(
          ch => !existingUrls.has(ch.url.trim().toLowerCase())
        );
        setSource(available);

        // Auto-expand first 3 categories for discoverability
        const cats = Array.from(new Set(available.map(c => c.category))).sort();
        setExpanded(new Set(cats.slice(0, 3)));
      } catch (err: any) {
        toast.error(err?.message || "Failed to load source");
      } finally {
        setLoading(false);
      }
    })();
  }, [open, sourcePlaylistId]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return source;
    return source.filter(
      c => c.name.toLowerCase().includes(q) || c.category.toLowerCase().includes(q)
    );
  }, [source, search]);

  const grouped   = useMemo(() => groupByCategory(filtered), [filtered]);
  const groupKeys = useMemo(() => Object.keys(grouped).sort(), [grouped]);

  // ── Selection helpers ─────────────────────────────────────────
  const toggleChannel = (id: string) =>
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const toggleCategory = (cat: string) => {
    const ids = grouped[cat].map(c => c.id);
    const allIn = ids.every(id => selected.has(id));
    setSelected(prev => {
      const n = new Set(prev);
      ids.forEach(id => allIn ? n.delete(id) : n.add(id));
      return n;
    });
  };

  const toggleExpand = (cat: string) =>
    setExpanded(prev => { const n = new Set(prev); n.has(cat) ? n.delete(cat) : n.add(cat); return n; });

  const handleAdd = () => {
    const toAdd = source.filter(c => selected.has(c.id)).map(c => ({ ...c, enabled: true }));
    if (!toAdd.length) { toast.error("Select at least one channel"); return; }
    onAdd(toAdd);
    toast.success(`Added ${toAdd.length} channel${toAdd.length > 1 ? "s" : ""}`);
    onClose();
  };

  const selectedCount = selected.size;

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="bg-gradient-card border-border max-w-2xl w-full max-h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/50">
          <DialogTitle className="font-display font-bold text-lg flex items-center gap-2">
            <Plus className="h-5 w-5 text-primary" />
            Add Channels from Source
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">
            {source.length > 0
              ? `${source.length.toLocaleString()} channels available — ${selectedCount} selected`
              : "Loading your source playlist…"}
          </p>
        </DialogHeader>

        {/* Search */}
        <div className="px-6 py-3 border-b border-border/50">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search channels or categories…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 bg-background/60 border-border focus-visible:ring-primary"
            />
          </div>
        </div>

        {/* Channel list */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              <p className="text-xs text-muted-foreground">Loading source playlist…</p>
            </div>
          ) : groupKeys.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground text-sm">
              {search ? "No channels match your search." : "All channels from this source are already in your playlist."}
            </div>
          ) : (
            groupKeys.map(cat => {
              const catChannels = grouped[cat];
              const catSelected = catChannels.filter(c => selected.has(c.id)).length;
              const allCatSel   = catSelected === catChannels.length;
              const isOpen      = expanded.has(cat);

              return (
                <div key={cat} className="bg-background/40 border border-border/50 rounded-xl overflow-hidden">
                  {/* Category header */}
                  <div
                    className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-primary/5 transition-colors"
                    onClick={() => toggleExpand(cat)}
                  >
                    <input
                      type="checkbox"
                      checked={allCatSel}
                      ref={el => { if (el) el.indeterminate = catSelected > 0 && !allCatSel; }}
                      onChange={() => toggleCategory(cat)}
                      onClick={e => e.stopPropagation()}
                      className="h-4 w-4 rounded border-border accent-primary cursor-pointer flex-shrink-0"
                    />
                    <ChevronDown className={cn(
                      "h-4 w-4 text-primary transition-transform flex-shrink-0",
                      isOpen ? "rotate-0" : "-rotate-90"
                    )} />
                    <span className="font-display font-bold text-sm flex-1 truncate">{cat}</span>
                    <span className="text-xs text-muted-foreground flex-shrink-0">
                      {catSelected > 0
                        ? <span className="text-primary font-semibold">{catSelected} / {catChannels.length}</span>
                        : catChannels.length}
                    </span>
                  </div>

                  {/* Channels */}
                  {isOpen && (
                    <div className="border-t border-border/40 divide-y divide-border/30">
                      {catChannels.map(ch => (
                        <label
                          key={ch.id}
                          className={cn(
                            "flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors",
                            selected.has(ch.id) ? "bg-primary/5" : "hover:bg-background/60"
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={selected.has(ch.id)}
                            onChange={() => toggleChannel(ch.id)}
                            className="h-4 w-4 rounded border-border accent-primary cursor-pointer flex-shrink-0"
                          />
                          {selected.has(ch.id) && (
                            <Check className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                          )}
                          <span className="text-sm truncate">{ch.name}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t border-border/50 flex gap-2">
          <Button variant="goldOutline" onClick={onClose}>Cancel</Button>
          <Button
            variant="gold"
            onClick={handleAdd}
            disabled={selectedCount === 0 || loading}
          >
            <Plus className="h-4 w-4" />
            Add {selectedCount > 0 ? `${selectedCount} channel${selectedCount > 1 ? "s" : ""}` : "channels"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
