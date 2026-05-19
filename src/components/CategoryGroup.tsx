import { useState, useRef } from "react";
import { ChevronDown, Pencil, Check, X, Trash2, GripVertical, FolderPlus, FolderInput } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Channel } from "@/lib/m3u";
import { cn } from "@/lib/utils";

// ── Sortable channel row ──────────────────────────────────────────────────

function SortableChannelRow({
  ch,
  isSelected,
  isEditing,
  draft,
  onDraftChange,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  onToggle,
  onSelectChange,
}: {
  ch: Channel;
  isSelected: boolean;
  isEditing: boolean;
  draft: string;
  onDraftChange: (v: string) => void;
  onStartEdit: () => void;
  onCommitEdit: () => void;
  onCancelEdit: () => void;
  onToggle: (enabled: boolean) => void;
  onSelectChange: (selected: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: ch.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.85 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-3 px-4 py-3 transition-colors",
        isSelected ? "bg-primary/5" : "",
        ch.enabled ? "opacity-100" : "opacity-50",
        isDragging ? "shadow-elegant ring-1 ring-primary/30 rounded-xl bg-card" : ""
      )}
    >
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        className="touch-none cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground transition-colors flex-shrink-0"
        tabIndex={-1}
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-4 w-4" />
      </button>

      {/* Checkbox */}
      <input
        type="checkbox"
        checked={isSelected}
        onChange={e => onSelectChange(e.target.checked)}
        className="h-4 w-4 rounded border-border accent-primary cursor-pointer flex-shrink-0"
      />

      <Switch checked={ch.enabled} onCheckedChange={onToggle} />

      <div className="flex-1 min-w-0">
        {isEditing ? (
          <div className="flex items-center gap-2">
            <Input
              autoFocus
              value={draft}
              onChange={e => onDraftChange(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") onCommitEdit();
                if (e.key === "Escape") onCancelEdit();
              }}
              className="h-8 bg-background/60"
            />
            <button onClick={onCommitEdit} className="text-primary hover:text-primary-glow">
              <Check className="h-4 w-4" />
            </button>
            <button onClick={onCancelEdit} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 group">
            <span className="truncate text-sm font-medium">{ch.name}</span>
            {ch.name !== ch.originalName && (
              <span className="text-[10px] uppercase tracking-wider text-primary/70">edited</span>
            )}
            <button
              onClick={onStartEdit}
              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary transition-smooth"
              title="Rename"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── CategoryGroup ─────────────────────────────────────────────────────────

interface Props {
  category: string;
  channels: Channel[];
  allCategories: string[];           // for "Move to existing group" list
  defaultOpen?: boolean;
  selectedIds: Set<string>;
  onToggle: (id: string, enabled: boolean) => void;
  onRename: (id: string, name: string) => void;
  onRenameCategory: (oldName: string, newName: string) => void;
  onToggleAll: (category: string, enabled: boolean) => void;
  onSelectChange: (id: string, selected: boolean) => void;
  onSelectAllInCategory: (category: string, selected: boolean) => void;
  onDeleteSelected: (ids: string[]) => void;
  onReorder: (category: string, newOrder: Channel[]) => void;
  onMoveToGroup: (ids: string[], targetGroup: string) => void;   // move selected to existing group
  onMoveToNewGroup: (ids: string[], newGroupName: string) => void; // move selected to a brand-new group
  onCreateGroup: (groupName: string) => void;                    // create empty group
}

export const CategoryGroup = ({
  category,
  channels,
  allCategories,
  defaultOpen = false,
  selectedIds,
  onToggle,
  onRename,
  onRenameCategory,
  onToggleAll,
  onSelectChange,
  onSelectAllInCategory,
  onDeleteSelected,
  onReorder,
  onMoveToGroup,
  onMoveToNewGroup,
  onCreateGroup,
}: Props) => {
  const [open,       setOpen]       = useState(defaultOpen);
  const [editingId,  setEditingId]  = useState<string | null>(null);
  const [draft,      setDraft]      = useState("");
  const [editingCat, setEditingCat] = useState(false);
  const [catDraft,   setCatDraft]   = useState("");

  // ── New group inline input state ──────────────────────────────
  const [showNewGroupInput, setShowNewGroupInput] = useState<"create" | "move" | null>(null);
  const [newGroupName,      setNewGroupName]      = useState("");
  const newGroupInputRef = useRef<HTMLInputElement>(null);

  const sensors = useSensors(useSensor(PointerSensor, {
    activationConstraint: { distance: 6 },
  }));

  const enabledCount = channels.filter(c => c.enabled).length;
  const allEnabled   = enabledCount === channels.length;

  const categorySelectedIds = channels.map(c => c.id).filter(id => selectedIds.has(id));
  const allCatSelected  = categorySelectedIds.length === channels.length && channels.length > 0;
  const someCatSelected = categorySelectedIds.length > 0;

  // Other groups the user can move channels into
  const otherGroups = allCategories.filter(g => g !== category);

  // ── Channel rename ────────────────────────────────────────────
  const startEdit  = (ch: Channel) => { setEditingId(ch.id); setDraft(ch.name); };
  const commitEdit = () => {
    if (editingId && draft.trim()) onRename(editingId, draft.trim());
    setEditingId(null);
  };

  // ── Category rename ───────────────────────────────────────────
  const startCatEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCatDraft(category);
    setEditingCat(true);
    setOpen(true);
  };
  const commitCatEdit = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (catDraft.trim() && catDraft.trim() !== category) onRenameCategory(category, catDraft.trim());
    setEditingCat(false);
  };
  const cancelCatEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingCat(false);
  };

  // ── New group input helpers ───────────────────────────────────
  const openNewGroupInput = (mode: "create" | "move", e: React.MouseEvent) => {
    e.stopPropagation();
    setNewGroupName("");
    setShowNewGroupInput(mode);
    setTimeout(() => newGroupInputRef.current?.focus(), 50);
  };

  const commitNewGroup = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    const name = newGroupName.trim();
    if (!name) { setShowNewGroupInput(null); return; }
    if (showNewGroupInput === "create") {
      onCreateGroup(name);
    } else if (showNewGroupInput === "move") {
      onMoveToNewGroup(categorySelectedIds, name);
    }
    setNewGroupName("");
    setShowNewGroupInput(null);
  };

  // ── Drag end ──────────────────────────────────────────────────
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = channels.findIndex(c => c.id === active.id);
    const newIdx = channels.findIndex(c => c.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    onReorder(category, arrayMove(channels, oldIdx, newIdx));
  };

  return (
    <div className="bg-gradient-card ring-gold rounded-2xl overflow-hidden shadow-elegant">
      {/* ── Category header ─────────────────────────────────────── */}
      <div
        className="w-full flex items-center gap-3 px-4 py-4 hover:bg-primary/5 transition-smooth text-left cursor-pointer"
        onClick={() => !editingCat && !showNewGroupInput && setOpen(o => !o)}
      >
        {/* Category checkbox */}
        <div onClick={e => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={allCatSelected}
            ref={el => { if (el) el.indeterminate = someCatSelected && !allCatSelected; }}
            onChange={e => onSelectAllInCategory(category, e.target.checked)}
            className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
          />
        </div>

        <ChevronDown className={cn(
          "h-5 w-5 text-primary transition-transform flex-shrink-0",
          open ? "rotate-0" : "-rotate-90"
        )} />

        {/* Name / rename field */}
        <div className="flex-1 min-w-0" onClick={e => editingCat && e.stopPropagation()}>
          {editingCat ? (
            <div className="flex items-center gap-2">
              <Input
                autoFocus
                value={catDraft}
                onChange={e => setCatDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") commitCatEdit();
                  if (e.key === "Escape") setEditingCat(false);
                }}
                onClick={e => e.stopPropagation()}
                className="h-8 bg-background/60 font-display font-bold text-sm"
              />
              <button onClick={commitCatEdit} className="text-primary hover:text-primary-glow flex-shrink-0">
                <Check className="h-4 w-4" />
              </button>
              <button onClick={cancelCatEdit} className="text-muted-foreground hover:text-foreground flex-shrink-0">
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 group/cat">
              <h3 className="font-display font-bold text-base md:text-lg truncate">{category}</h3>
              <button
                onClick={startCatEdit}
                className="opacity-0 group-hover/cat:opacity-100 text-muted-foreground hover:text-primary transition-smooth flex-shrink-0"
                title="Rename group"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-0.5">
            {enabledCount} of {channels.length} enabled
            {someCatSelected && (
              <span className="ml-2 text-primary">· {categorySelectedIds.length} selected</span>
            )}
          </p>
        </div>

        {/* Right-side action area */}
        <div className="flex items-center gap-2 flex-shrink-0" onClick={e => e.stopPropagation()}>
          {someCatSelected ? (
            // When channels are selected: show Move + Delete
            <>
              {/* Move to group dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="px-2.5 py-1.5 rounded-full text-xs font-medium border border-primary/30 text-primary hover:bg-primary/10 transition-smooth flex items-center gap-1"
                    title="Move selected channels to a group"
                  >
                    <FolderInput className="h-3 w-3" />
                    Move to
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  {otherGroups.length > 0 && (
                    <>
                      <div className="px-2 py-1 text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                        Existing groups
                      </div>
                      {otherGroups.map(g => (
                        <DropdownMenuItem
                          key={g}
                          onClick={() => onMoveToGroup(categorySelectedIds, g)}
                          className="text-sm"
                        >
                          {g}
                        </DropdownMenuItem>
                      ))}
                      <DropdownMenuSeparator />
                    </>
                  )}
                  <DropdownMenuItem
                    onClick={e => openNewGroupInput("move", e as unknown as React.MouseEvent)}
                    className="text-sm text-primary"
                  >
                    <FolderPlus className="h-3.5 w-3.5 mr-2" />
                    New group…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <button
                onClick={() => onDeleteSelected(categorySelectedIds)}
                className="px-2.5 py-1.5 rounded-full text-xs font-medium border border-destructive/30 text-destructive hover:bg-destructive/10 transition-smooth flex items-center gap-1"
              >
                <Trash2 className="h-3 w-3" /> Delete {categorySelectedIds.length}
              </button>
            </>
          ) : (
            // Default: Enable/Disable all toggle
            <div
              onClick={() => onToggleAll(category, !allEnabled)}
              className="px-3 py-1.5 rounded-full text-xs font-medium border border-primary/30 text-primary hover:bg-primary/10 transition-smooth cursor-pointer"
            >
              {allEnabled ? "Disable all" : "Enable all"}
            </div>
          )}
        </div>
      </div>

      {/* ── Inline new-group name input (shown below header) ────── */}
      {showNewGroupInput && (
        <div
          className="px-4 pb-3 flex items-center gap-2 border-t border-border/40 pt-3"
          onClick={e => e.stopPropagation()}
        >
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {showNewGroupInput === "create" ? "New group name:" : "Move to new group:"}
          </span>
          <Input
            ref={newGroupInputRef}
            value={newGroupName}
            onChange={e => setNewGroupName(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") commitNewGroup();
              if (e.key === "Escape") setShowNewGroupInput(null);
            }}
            placeholder="Group name…"
            className="h-7 text-sm bg-background/60 border-border focus-visible:ring-primary"
          />
          <button onClick={commitNewGroup} className="text-primary hover:text-primary-glow flex-shrink-0">
            <Check className="h-4 w-4" />
          </button>
          <button onClick={() => setShowNewGroupInput(null)} className="text-muted-foreground hover:text-foreground flex-shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ── Channel rows with DnD ────────────────────────────────── */}
      {open && (
        <div className="border-t border-border/50 divide-y divide-border/40">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={channels.map(c => c.id)}
              strategy={verticalListSortingStrategy}
            >
              {channels.map(ch => (
                <SortableChannelRow
                  key={ch.id}
                  ch={ch}
                  isSelected={selectedIds.has(ch.id)}
                  isEditing={editingId === ch.id}
                  draft={draft}
                  onDraftChange={setDraft}
                  onStartEdit={() => startEdit(ch)}
                  onCommitEdit={commitEdit}
                  onCancelEdit={() => setEditingId(null)}
                  onToggle={v => onToggle(ch.id, v)}
                  onSelectChange={s => onSelectChange(ch.id, s)}
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>
      )}
    </div>
  );
};
