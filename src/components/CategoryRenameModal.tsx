import { useState, useEffect } from "react";
import { Layers, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onClose: () => void;
  currentName: string;
  existingCategories: string[];
  channelCount: number;
  onApply: (newName: string) => void;
}

export const CategoryRenameModal = ({
  open,
  onClose,
  currentName,
  existingCategories,
  channelCount,
  onApply,
}: Props) => {
  const [value, setValue] = useState(currentName);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setValue(currentName);
      setError(null);
    }
  }, [open, currentName]);

  const validate = (v: string) => {
    const trimmed = v.trim();
    if (!trimmed) return "Name cannot be empty.";
    if (
      trimmed !== currentName &&
      existingCategories.some(
        (c) => c.toLowerCase() === trimmed.toLowerCase()
      )
    ) {
      return `A group named "${trimmed}" already exists — channels will be merged into it.`;
    }
    return null;
  };

  const handleChange = (v: string) => {
    setValue(v);
    setError(validate(v));
  };

  const isMerge =
    value.trim() !== currentName &&
    existingCategories.some(
      (c) => c.toLowerCase() === value.trim().toLowerCase() && c !== currentName
    );

  const handleApply = () => {
    const trimmed = value.trim();
    const err = validate(trimmed);
    // A merge warning is not a blocker — only empty is
    if (err && !isMerge) {
      setError(err);
      return;
    }
    onApply(trimmed);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md bg-gradient-card border-border/60 shadow-elegant">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-xl">
            <Layers className="h-5 w-5 text-primary" />
            Rename Group
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          <p className="text-sm text-muted-foreground">
            Renaming{" "}
            <span className="font-medium text-foreground">{currentName}</span>
            {" "}({channelCount} channel{channelCount !== 1 ? "s" : ""}).
          </p>

          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-widest text-muted-foreground">
              New group name
            </label>
            <Input
              autoFocus
              value={value}
              onChange={(e) => handleChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleApply();
                if (e.key === "Escape") onClose();
              }}
              className="bg-background/60 font-medium"
            />
            {error && (
              <p className={`text-xs ${isMerge ? "text-primary" : "text-destructive"}`}>
                {error}
              </p>
            )}
          </div>

          {isMerge && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-xs text-muted-foreground leading-relaxed">
              <strong className="text-primary">Merge:</strong> All {channelCount} channel
              {channelCount !== 1 ? "s" : ""} from <em>{currentName}</em> will be moved
              into the existing <em>{value.trim()}</em> group.
            </div>
          )}

          <div className="flex justify-end gap-3 pt-1">
            <Button variant="outline" size="sm" onClick={onClose}>
              <X className="h-4 w-4" /> Cancel
            </Button>
            <Button
              variant="gold"
              size="sm"
              onClick={handleApply}
              disabled={!value.trim() || (!isMerge && !!error && !error.includes("merged"))}
            >
              <Check className="h-4 w-4" />
              {isMerge ? "Merge Groups" : "Rename"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
