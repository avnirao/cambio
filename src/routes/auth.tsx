import { useState } from "react";
import { useNavigate, createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Play — Cambio" },
      { name: "description", content: "Pick a name and jump into a Cambio game." },
    ],
  }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/" });
  },
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const name = username.trim() || `Player${Math.floor(Math.random() * 9000 + 1000)}`;
      const { error } = await supabase.auth.signInAnonymously({
        options: { data: { username: name } },
      });
      if (error) throw error;
      navigate({ to: "/" });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-popover/80 backdrop-blur rounded-xl border p-8 shadow-2xl">
        <h1 className="text-3xl mb-1 display text-accent">Cambio</h1>
        <p className="text-sm text-muted-foreground mb-6">
          The card game where the lowest hand wins.
        </p>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="username">Display name</Label>
            <Input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="How others see you"
              maxLength={24}
              autoFocus
            />
          </div>
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Joining…" : "Play"}
          </Button>
        </form>
      </div>
    </div>
  );
}
