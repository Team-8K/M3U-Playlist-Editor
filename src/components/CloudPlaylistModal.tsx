import { useState } from "react";
import { Cloud, Save, Trash2, Download, X, RefreshCw, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { type SavedPlaylist } from "@/lib/supabase";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
  playlists: SavedPlaylist[];
  loading: boolean;
  error: string | null;
  currentContent: string; // serialised M3U of current session
  onSave: (name: string, existingId?: string) => Promise<void>;
  onLoad: (playlist: SavedPlaylist) => void;
  onDelete: (id: string) => Promise<void>;
  onRefresh: () => void;
}

export const CloudPlaylistModal = ({
  open,
  onClose,
  playlists,
  loading,
  error,
  currentContent,
  onSave,
  onLoad,
  onDelete,
  onRefresh,
}: Props) => {
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SavedPlaylist | null>(null);

  const handleSaveNew = async () => {
    const name = newName.trim();
    if (!name) return;
    setSaving(true);
    try {
      await onSave(name);
      setNewName("");
    } finally {
      setSaving(false);
    }
  };

  const handleOverwrite = async (pl: SavedPlaylist) => {
    setSaving(true);
    try {
      await onSave(pl.name, pl.id);
    } finally {
      setSaving(false);
    }
  };

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-xl bg-gradient-card border-border/60 shadow-elegant max-h-[90vh] flex flex-col gap-0 p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/50">
            <DialogTitle className="flex items-center gap-2 font-display text-xl">
              <Cloud className="h-5 w-5 text-primary" />
              Cloud Playlists
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            {/* Save new */}
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-widest text-muted-foreground">
                Save current playlist
              </p>
              <div className="flex gap-2">
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. My IPTV - cleaned"
                  onKeyDown={(e) => e.key === "Enter" && handleSaveNew()}
                  className="bg-background/60 text-sm flex-1"
                />
                <Button
                  variant="gold"
                  size="sm"
                  onClick={handleSaveNew}
                  disabled={!newName.trim() || saving || !currentContent}
                >
                  <Plus className="h-4 w-4" />
                  Save
                </Button>
              </div>
            </div>

            {/* Saved list */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-widest text-muted-foreground">
                  Saved playlists
                </p>
                <button
                  onClick={onRefresh}
                  disabled={loading}
                  className="text-muted-foreground hover:text-primary transition-colors"
                  title="Refresh"
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
                </button>
              </div>

              {error && (
                <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-xs text-destructive">
                  {error}
                </div>
              )}

              {loading && playlists.length === 0 ? (
                <div className="py-10 text-center text-xs text-muted-foreground">
                  Loading…
                </div>
              ) : playlists.length === 0 ? (
                <div className="py-10 text-center text-xs text-muted-foreground">
                  No saved playlists yet.
                </div>
              ) : (
                <div className="rounded-xl border border-border/50 divide-y divide-border/30 overflow-hidden">
                  {playlists.map((pl) => (
                    <div
                      key={pl.id}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{pl.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {fmt(pl.updated_at)}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-foreground"
                          title="Load into editor"
                          onClick={() => { onLoad(pl); onClose(); }}
                        >
                          <Download className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-primary"
                          title="Overwrite with current"
                          disabled={saving || !currentContent}
                          onClick={() => handleOverwrite(pl)}
                        >
                          <Save className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          title="Delete"
                          onClick={() => setDeleteTarget(pl)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="px-6 py-4 border-t border-border/50 flex justify-end">
            <Button variant="outline" size="sm" onClick={onClose}>
              <X className="h-4 w-4" /> Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
      >
        <AlertDialogContent className="bg-gradient-card border-border/60">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete playlist?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.name}</strong> will be permanently deleted
              from the cloud. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (deleteTarget) {
                  await onDelete(deleteTarget.id);
                  setDeleteTarget(null);
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
