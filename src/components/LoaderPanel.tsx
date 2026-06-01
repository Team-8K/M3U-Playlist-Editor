import { useRef, useState } from "react";
import { Upload, Shield, Link } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

interface Props {
  onLoad: (
    content: string,
    source: string,
    meta?: {
      type: "file" | "url" | "xtream";
      url?: string;
      xtream_host?: string;
      xtream_user?: string;
    }
  ) => void;
}

type Mode = "file" | "xtream" | "url";

export const LoaderPanel = ({ onLoad }: Props) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>("file");

  // Xtream fields
  const [xHost, setXHost] = useState("");
  const [xUser, setXUser] = useState("");
  const [xPass, setXPass] = useState("");

  // M3U URL field
  const [m3uUrl, setM3uUrl] = useState("");

  // Loading state
  const [loading, setLoading] = useState(false);

  // ── File handler ──────────────────────────────────────────────
  const handleFile = async (file: File) => {
    if (!file) return;
    if (!/\.m3u8?$/i.test(file.name)) {
      toast.error("Please choose a .m3u or .m3u8 file");
      return;
    }
    const text = await file.text();
    onLoad(text, file.name, { type: "file" });
    toast.success(`Loaded ${file.name}`);
  };

  // ── Proxy fetch ───────────────────────────────────────────────
  const fetchViaProxy = async (
    body: Record<string, string>,
    sourceName: string,
    meta?: {
      type: "file" | "url" | "xtream";
      url?: string;
      xtream_host?: string;
      xtream_user?: string;
    }
  ) => {
    setLoading(true);
    try {
      const res = await fetch("/api/m3u-proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const text = await res.text();

      if (!res.ok) {
        let msg = "Failed to load playlist.";
        try {
          msg = JSON.parse(text).error || msg;
        } catch {
          /* not JSON */
        }
        toast.error(msg);
        return;
      }

      onLoad(text, sourceName, meta);
      const count = (text.match(/#EXTINF/g) || []).length;
      toast.success(
        `Loaded ${count.toLocaleString()} channels from ${sourceName}`
      );
    } catch {
      toast.error("Network error — check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  // ── Xtream Codes submit ───────────────────────────────────────
  const handleXtream = async () => {
    const host = xHost.trim().replace(/\/$/, "");
    const user = xUser.trim();
    const pass = xPass.trim();

    if (!host || !user || !pass) {
      toast.error("Please fill in all three fields.");
      return;
    }
    if (!/^https?:\/\/.+/.test(host)) {
      toast.error("Host must start with http:// or https://");
      return;
    }

    // Build the M3U URL from the credentials and treat it identically
    // to a URL paste — same proxy call, same row structure in Supabase.
    const m3uUrl = `${host}/get.php?username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}&type=m3u_plus&output=ts`;
    await fetchViaProxy({ url: m3uUrl }, "Remote playlist", { type: "url", url: m3uUrl });
  };

  // ── M3U URL submit ────────────────────────────────────────────
  const handleM3UUrl = async () => {
    const url = m3uUrl.trim();
    if (!url) {
      toast.error("Please enter a playlist URL.");
      return;
    }
    if (!/^https?:\/\/.+/.test(url)) {
      toast.error("URL must start with http:// or https://");
      return;
    }
    await fetchViaProxy({ url }, "Remote playlist", { type: "url", url });
  };

  const tabs: { id: Mode; label: string }[] = [
    { id: "file", label: "Local File" },
    { id: "xtream", label: "Xtream Codes" },
    { id: "url", label: "Paste URL" },
  ];

  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-gradient-card ring-gold rounded-2xl shadow-elegant overflow-hidden">

        {/* Tabs */}
        <div className="flex border-b border-border/60">
          {tabs.map((t) => {
            const active = mode === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setMode(t.id)}
                className={`flex-1 px-4 py-4 flex items-center justify-center gap-2 text-xs md:text-sm font-display font-bold uppercase tracking-[0.2em] transition-smooth border-b-2 ${
                  active
                    ? "text-primary border-primary bg-primary/5"
                    : "text-muted-foreground hover:text-foreground border-transparent"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="p-6 md:p-8">

          {/* LOCAL FILE */}
          {mode === "file" && (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={async (e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0];
                if (f) await handleFile(f);
              }}
              onClick={() => fileRef.current?.click()}
              className="cursor-pointer rounded-xl border border-dashed border-border/70 hover:border-primary/60 hover:bg-primary/5 transition-smooth py-10 px-6 flex flex-col items-center justify-center text-center"
            >
              <div className="h-14 w-14 rounded-full bg-muted/40 border border-border/60 flex items-center justify-center mb-4">
                <Upload className="h-5 w-5 text-foreground/80" />
              </div>
              <h3 className="font-display font-bold text-lg mb-1">
                Upload Playlist File
              </h3>
              <p className="text-sm text-muted-foreground">
                Drag and drop your .m3u or .m3u8 file here,
                <br />
                or click to browse.
              </p>
              <input
                ref={fileRef}
                type="file"
                accept=".m3u,.m3u8"
                className="hidden"
                onChange={(e) =>
                  e.target.files?.[0] && handleFile(e.target.files[0])
                }
              />
            </div>
          )}

          {/* XTREAM CODES */}
          {mode === "xtream" && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
                <Shield className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Enter your IPTV provider credentials below — these are
                  separate from your Team 8K login. Your provider gives you
                  these details.
                </p>
              </div>

              <div>
                <label className="block text-xs text-muted-foreground uppercase tracking-widest mb-1.5">
                  Server / Portal URL
                </label>
                <Input
                  type="url"
                  placeholder="http://cf.yourprovider.com"
                  value={xHost}
                  onChange={(e) => setXHost(e.target.value)}
                  className="bg-background/60 border-border focus-visible:ring-primary font-mono text-sm"
                  autoComplete="off"
                  data-1p-ignore
                  data-lpignore="true"
                  onKeyDown={(e) => e.key === "Enter" && handleXtream()}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted-foreground uppercase tracking-widest mb-1.5">
                    Provider Username
                  </label>
                  <Input
                    type="text"
                    placeholder="your_iptv_username"
                    value={xUser}
                    onChange={(e) => setXUser(e.target.value)}
                    autoComplete="off"
                    data-1p-ignore
                    data-lpignore="true"
                    name="iptv-username"
                    className="bg-background/60 border-border focus-visible:ring-primary font-mono text-sm"
                    onKeyDown={(e) => e.key === "Enter" && handleXtream()}
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground uppercase tracking-widest mb-1.5">
                    Provider Password
                  </label>
                  <Input
                    type="password"
                    placeholder="your_iptv_password"
                    value={xPass}
                    onChange={(e) => setXPass(e.target.value)}
                    autoComplete="new-password"
                    data-1p-ignore
                    data-lpignore="true"
                    name="iptv-password"
                    className="bg-background/60 border-border focus-visible:ring-primary font-mono text-sm"
                    onKeyDown={(e) => e.key === "Enter" && handleXtream()}
                  />
                </div>
              </div>

              {xHost && xUser && (
                <p className="text-xs text-muted-foreground font-mono bg-background/40 rounded-lg px-3 py-2 truncate">
                  → {xHost.replace(/\/$/, "")}/get.php?username={xUser}
                  &password=••••••&type=m3u_plus
                </p>
              )}

              <Button
                variant="gold"
                className="w-full"
                onClick={handleXtream}
                disabled={loading}
              >
                {loading ? "Loading playlist…" : "Load My Playlist"}
              </Button>
            </div>
          )}

          {/* PASTE URL */}
          {mode === "url" && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
                <Link className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Paste your full M3U URL. Fetched via a secure proxy to bypass
                  browser restrictions. Nothing is stored.
                </p>
              </div>

              <div>
                <label className="block text-xs text-muted-foreground uppercase tracking-widest mb-1.5">
                  M3U Playlist URL
                </label>
                <Input
                  type="url"
                  placeholder="http://cf.yourprovider.com/get.php?username=...&password=..."
                  value={m3uUrl}
                  onChange={(e) => setM3uUrl(e.target.value)}
                  className="bg-background/60 border-border focus-visible:ring-primary font-mono text-sm"
                  autoComplete="off"
                  onKeyDown={(e) => e.key === "Enter" && handleM3UUrl()}
                />
              </div>

              <Button
                variant="gold"
                className="w-full"
                onClick={handleM3UUrl}
                disabled={loading}
              >
                {loading ? "Loading playlist…" : "Load Playlist"}
              </Button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border/60 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Shield className="h-3.5 w-3.5 text-primary" />
          <span>
            {mode === "file"
              ? "100% Client-side. Your playlist never leaves your device."
              : "Fetched via secure proxy. Credentials are never logged or stored."}
          </span>
        </div>
      </div>
    </div>
  );
};
