import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { createGame, joinGame } from "@/lib/game/game.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Cambio — Play online" },
      { name: "description", content: "Create a room or join one with a 4-letter code." },
    ],
  }),
  component: Lobby,
});

function Lobby() {
  const navigate = useNavigate();
  const create = useServerFn(createGame);
  const join = useServerFn(joinGame);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function onCreate() {
    setBusy(true);
    try {
      const r = await create({});
      navigate({ to: "/game/$code", params: { code: r.code } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function onJoin() {
    if (!code.trim()) return;
    setBusy(true);
    try {
      const r = await join({ data: { code: code.trim().toUpperCase() } });
      navigate({ to: "/game/$code", params: { code: r.code } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  }

  return (
    <div className="min-h-screen p-6 flex flex-col">
      <header className="flex items-center justify-between mb-12">
        <h1 className="text-2xl display text-accent">Cambio</h1>
        <button
          onClick={signOut}
          className="text-xs text-muted-foreground hover:text-foreground uppercase tracking-wider"
        >
          Sign out
        </button>
      </header>

      <main className="flex-1 flex items-center justify-center">
        <div className="w-full max-w-md grid gap-6">
          <div className="text-center mb-4">
            <h2 className="text-4xl display mb-3">Take a seat</h2>
            <p className="text-sm text-muted-foreground">
              Lowest hand wins. Snap a double to dump cards faster.
            </p>
          </div>

          <div className="bg-popover/70 backdrop-blur rounded-xl border p-6 space-y-3">
            <h3 className="text-lg display">Start a new game</h3>
            <p className="text-xs text-muted-foreground">
              You'll get a room code to share with up to 3 friends.
            </p>
            <Button onClick={onCreate} disabled={busy} className="w-full">
              Deal me in
            </Button>
          </div>

          <div className="bg-popover/70 backdrop-blur rounded-xl border p-6 space-y-3">
            <h3 className="text-lg display">Join with a code</h3>
            <div className="flex gap-2">
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="ABCD"
                maxLength={6}
                className="uppercase tracking-[0.4em] text-center font-mono text-lg"
              />
              <Button onClick={onJoin} disabled={busy || !code.trim()} variant="secondary">
                Join
              </Button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
