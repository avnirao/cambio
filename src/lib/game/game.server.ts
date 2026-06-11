import type { GameState } from "./types";

export function randCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 4; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

export async function loadAdminAndProfile(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("username")
    .eq("id", userId)
    .single();
  return { supabaseAdmin, username: profile?.username || "Player" };
}

export async function loadGameForAction(code: string, userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: game } = await supabaseAdmin
    .from("games")
    .select("*")
    .eq("code", code.toUpperCase())
    .maybeSingle();
  if (!game) throw new Error("Game not found");
  const { data: players } = await supabaseAdmin
    .from("game_players")
    .select("user_id, username, seat")
    .eq("game_id", game.id);
  if (!players?.find((p) => p.user_id === userId)) throw new Error("Not in game");
  return { supabaseAdmin, game, players };
}

export async function saveState(
  supabaseAdmin: Awaited<ReturnType<typeof loadGameForAction>>["supabaseAdmin"],
  game: { id: string; version: number },
  state: GameState,
) {
  const status =
    state.phase === "finished"
      ? "finished"
      : state.phase === "setup"
        ? "setup"
        : "playing";
  await supabaseAdmin
    .from("games")
    .update({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      state: state as any,
      version: game.version + 1,
      status,
    })
    .eq("id", game.id);
}
