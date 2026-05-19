import { Tv, CheckCircle2, XCircle, Copy as CopyIcon, Layers, Sparkles } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  useSidebar,
} from "@/components/ui/sidebar";

interface SummarySidebarProps {
  total: number;
  enabled: number;
  categories: number;
  duplicatesRemoved: number;
}

export const SummarySidebar = ({
  total,
  enabled,
  categories,
  duplicatesRemoved,
}: SummarySidebarProps) => {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const disabled = total - enabled;

  const stats = [
    {
      label: "Total channels",
      value: total,
      icon: Tv,
      tone: "text-foreground",
    },
    {
      label: "Enabled",
      value: enabled,
      icon: CheckCircle2,
      tone: "text-primary",
    },
    {
      label: "Disabled",
      value: disabled,
      icon: XCircle,
      tone: "text-muted-foreground",
    },
    {
      label: "Categories",
      value: categories,
      icon: Layers,
      tone: "text-foreground",
    },
    {
      label: "Duplicates removed",
      value: duplicatesRemoved,
      icon: CopyIcon,
      tone: "text-primary",
    },
  ];

  return (
    <Sidebar collapsible="icon" className="border-r border-border/50">
      <SidebarContent className="bg-gradient-card pt-12">
        <SidebarGroup>
          <SidebarGroupLabel className="flex items-center gap-2 text-primary/80 font-display tracking-[0.25em] uppercase text-[10px]">
            <Sparkles className="h-3 w-3" />
            {!collapsed && <span>Summary</span>}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <ul className="space-y-2 mt-2 px-1">
              {stats.map((s) => {
                const Icon = s.icon;
                return (
                  <li
                    key={s.label}
                    className="ring-gold rounded-xl bg-background/40 p-3 flex items-center gap-3"
                  >
                    <div className="h-8 w-8 shrink-0 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center">
                      <Icon className={`h-4 w-4 ${s.tone}`} />
                    </div>
                    {!collapsed && (
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">
                          {s.label}
                        </p>
                        <p className="font-display font-bold text-lg leading-tight text-gradient-gold">
                          {s.value}
                        </p>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
};
