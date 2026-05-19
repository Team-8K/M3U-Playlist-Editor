import { useState, useMemo } from "react";
import { Search, Replace, CheckSquare, Square, X, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Channel, bulkRename } from "@/lib/m3u";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
  channels: Channel[];
  onApply: (updated: Channel[], count: number) => void;
}

export const BulkRenameModal = ({ open, onClose, channels, onApply }: Props) => {
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filterText, setFilterText] = useState("");
  const [regexError, setRegexError] = useState<string | null>(null);

  // Validate regex
  useMemo(() => {
    if (!useRegex || !find) {
      setRegexError(null);
      return;
    }
    try {
      new RegExp(find, "gi");
      setRegexError(null);
    } catch (e: unknown) {
      setRegexError(e instanceof Error ? e.message : "Invalid regex");
    }
  }, [find, useRegex]);

  const filteredChannels = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    return channels.filter((c) =>
      q ? c.name.toLowerCase().includes(q) || c.category.toLowerCase().includes(q) : true
    );
  }, [channels, filterText]);

  // Live preview of what the rename will look like
  const preview = useMemo(() => {
    if (!find || regexError) return null;
    const ids = selectedIds.size > 0 ? selectedIds : undefined;
    const { channels: updated } = bulkRename(channels, find, replace, {
      caseSensitive,
      regex: useRegex,
      ids,
    });
    const changedMap = new Map<string, string>();
    updated.forEach((ch) => {
      const orig = channels.find((c) => c.id === ch.id);
      if (orig && orig.name !== ch.name) changedMap.set(ch.id, ch.name);
    });
    return changedMap;
  }, [find, replace, caseSensitive, useRegex, channels, selectedIds, regexError]);

  const affectedCount = preview?.size ?? 0;

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredChannels.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredChannels.map((c) => c.id)));
    }
  };

  const handleApply = () => {
    if (!find || regexError) return;
    const ids = selectedIds.size > 0 ? selectedIds : undefined;
    const { channels: updated, count } = bulkRename(channels, find, replace, {
      caseSensitive,
      regex: useRegex,
      ids,
    });
    onApply(updated, count);
    handleClose();
  };

  const handleClose = () => {
    setFind("");
    setReplace("");
    setSelectedIds(new Set());
    setFilterText("");
    setRegexError(null);
    onClose();
  };

  const allSelected =
    filteredChannels.length > 0 &&
    filteredChannels.every((c) => selectedIds.has(c.id));

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-2xl bg-gradient-card border-border/60 shadow-elegant max-h-[90vh] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/50">
          <DialogTitle className="flex items-center gap-2 font-display text-xl">
            <Wand2 className="h-5 w-5 text-primary" />
            Bulk Rename
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Find / Replace inputs */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs uppercase tracking-widest text-muted-foreground">
                Find
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={find}
                  onChange={(e) => setFind(e.target.value)}
                  placeholder={useRegex ? "^HD\\s+" : "HD "}
                  className={cn(
                    "pl-8 bg-background/60 font-mono text-sm",
                    regexError && "border-destructive focus-visible:ring-destructive"
                  )}
                />
              </div>
              {regexError && (
                <p className="text-xs text-destructive">{regexError}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <label className="text-xs uppercase tracking-widest text-muted-foreground">
                Replace with
              </label>
              <div className="relative">
                <Replace className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={replace}
                  onChange={(e) => setReplace(e.target.value)}
                  placeholder="Leave empty to remove"
                  className="pl-8 bg-background/60 font-mono text-sm"
                />
              </div>
            </div>
          </div>

          {/* Options row */}
          <div className="flex items-center gap-6 text-sm">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <Switch
                checked={caseSensitive}
                onCheckedChange={setCaseSensitive}
                className="scale-90"
              />
              <span className="text-muted-foreground text-xs">Case-sensitive</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <Switch
                checked={useRegex}
                onCheckedChange={setUseRegex}
                className="scale-90"
              />
              <span className="text-muted-foreground text-xs">Regex</span>
            </label>
            {affectedCount > 0 && (
              <span className="ml-auto text-xs text-primary font-medium">
                {affectedCount} channel{affectedCount !== 1 ? "s" : ""} will be renamed
              </span>
            )}
          </div>

          {/* Channel list with optional selection */}
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  placeholder="Filter channels to target..."
                  className="pl-8 bg-background/60 text-sm h-8"
                />
              </div>
              <button
                onClick={toggleSelectAll}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors shrink-0"
              >
                {allSelected ? (
                  <CheckSquare className="h-4 w-4 text-primary" />
                ) : (
                  <Square className="h-4 w-4" />
                )}
                {allSelected ? "Deselect all" : "Select all"}
              </button>
            </div>

            <p className="text-[10px] text-muted-foreground">
              {selectedIds.size === 0
                ? "No selection = rename applies to all channels"
                : `${selectedIds.size} channel${selectedIds.size !== 1 ? "s" : ""} selected — rename applies to selection only`}
            </p>

            <div className="rounded-xl border border-border/50 overflow-hidden max-h-64 overflow-y-auto divide-y divide-border/30">
              {filteredChannels.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  No channels match your filter.
                </div>
              ) : (
                filteredChannels.map((ch) => {
                  const newName = preview?.get(ch.id);
                  const isSelected = selectedIds.has(ch.id);
                  return (
                    <div
                      key={ch.id}
                      onClick={() => toggleSelect(ch.id)}
                      className={cn(
                        "flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors text-sm",
                        isSelected
                          ? "bg-primary/8 hover:bg-primary/12"
                          : "hover:bg-muted/40"
                      )}
                    >
                      {isSelected ? (
                        <CheckSquare className="h-4 w-4 text-primary shrink-0" />
                      ) : (
                        <Square className="h-4 w-4 text-muted-foreground shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <span className={cn("truncate block", newName && "line-through text-muted-foreground")}>
                          {ch.name}
                        </span>
                        {newName && (
                          <span className="truncate block text-primary text-xs mt-0.5">
                            → {newName}
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {ch.category}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border/50 flex items-center justify-end gap-3">
          <Button variant="outline" size="sm" onClick={handleClose}>
            <X className="h-4 w-4" /> Cancel
          </Button>
          <Button
            variant="gold"
            size="sm"
            onClick={handleApply}
            disabled={!find || !!regexError || affectedCount === 0}
          >
            <Wand2 className="h-4 w-4" />
            Apply{affectedCount > 0 ? ` (${affectedCount})` : ""}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
