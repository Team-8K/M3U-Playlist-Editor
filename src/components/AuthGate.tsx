import { useState } from "react";
import { Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase";
import type { Session } from "@supabase/supabase-js";

interface Props {
  onAuth: (session: Session | null) => void;
}

type AuthView = "login" | "signup" | "forgot";

export const AuthGate = ({ onAuth: _onAuth }: Props) => {
  const [view, setView]         = useState<AuthView>("login");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [notice, setNotice]     = useState<string | null>(null);

  const clearMessages = () => { setError(null); setNotice(null); };

  const handleLogin = async () => {
    clearMessages(); setBusy(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (err) setError(err.message);
    // onAuthStateChange in App.tsx handles session update
  };

  const handleSignup = async () => {
    clearMessages(); setBusy(true);
    const { error: err } = await supabase.auth.signUp({ email, password });
    setBusy(false);
    if (err) { setError(err.message); } else {
      setNotice("Check your email to confirm your account, then sign in.");
      setView("login");
    }
  };

  const handleForgot = async () => {
    clearMessages(); setBusy(true);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    setBusy(false);
    if (err) { setError(err.message); } else {
      setNotice("Password reset link sent — check your inbox.");
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4">
      <div className="fixed top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent" />
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <img
            src="https://dedicated-team8k.store/logo.png"
            alt="Team 8K"
            className="h-14 w-14 mx-auto mb-4 rounded-xl"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
          <h1 className="font-display font-bold text-3xl text-primary tracking-wide">TEAM 8K</h1>
          <p className="text-xs text-muted-foreground tracking-[0.3em] uppercase mt-1">Exclusive OTT Experience</p>
        </div>

        <div className="bg-gradient-card ring-gold rounded-2xl shadow-elegant p-8">
          <div className="h-14 w-14 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center mx-auto mb-5">
            <Shield className="h-6 w-6 text-primary" />
          </div>
          <h2 className="font-display font-bold text-xl mb-1 text-center">
            {view === "login" ? "Sign In" : view === "signup" ? "Create Account" : "Reset Password"}
          </h2>
          <p className="text-sm text-muted-foreground mb-6 text-center leading-relaxed">
            {view === "login" && "Sign in with your Team 8K credentials."}
            {view === "signup" && "Register a new subscriber account."}
            {view === "forgot" && "We'll email you a reset link."}
          </p>

          <div className="space-y-3 mb-4">
            <Input
              type="email" placeholder="Email address" value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="bg-background/60 border-border focus-visible:ring-primary"
              onKeyDown={(e) => e.key === "Enter" && view === "login" && handleLogin()}
            />
            {view !== "forgot" && (
              <Input
                type="password" placeholder="Password" value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-background/60 border-border focus-visible:ring-primary"
                onKeyDown={(e) => e.key === "Enter" && view === "login" && handleLogin()}
              />
            )}
          </div>

          {error  && <p className="text-xs text-red-400 mb-3 text-center">{error}</p>}
          {notice && <p className="text-xs text-green-400 mb-3 text-center">{notice}</p>}

          {view === "login"  && <Button variant="gold" className="w-full" onClick={handleLogin}  disabled={busy}>{busy ? "Signing in…"       : "Sign In"}</Button>}
          {view === "signup" && <Button variant="gold" className="w-full" onClick={handleSignup} disabled={busy}>{busy ? "Creating account…" : "Create Account"}</Button>}
          {view === "forgot" && <Button variant="gold" className="w-full" onClick={handleForgot} disabled={busy}>{busy ? "Sending…"          : "Send Reset Link"}</Button>}

          <div className="flex justify-between mt-4 text-xs text-muted-foreground">
            {view !== "login" ? (
              <button className="hover:text-primary transition-colors" onClick={() => { clearMessages(); setView("login"); }}>Back to Sign In</button>
            ) : (
              <>
                <button className="hover:text-primary transition-colors" onClick={() => { clearMessages(); setView("forgot"); }}>Forgot password?</button>
                <button className="hover:text-primary transition-colors" onClick={() => { clearMessages(); setView("signup"); }}>Create account</button>
              </>
            )}
          </div>
        </div>
        <p className="text-center text-xs text-muted-foreground mt-6 tracking-wider">© 2026 Team 8K. All Rights Reserved.</p>
      </div>
    </div>
  );
};
