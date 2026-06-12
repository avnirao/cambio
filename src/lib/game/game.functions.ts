import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  actAbilityBlindSwap,
  actAbilityConfirm,
  actAbilityLookSwapDecide,
  actAbilityLookSwapPeek,
  actAbilityPeekOther,
  actAbilityPeekSelf,
  actAbilitySkip,
  actCallCambio,
  actDiscardDrawn,
  actDraw,
  actSetupReady,
  actSnap,
  actSwap,
  buildView,
  initialState,
} from "./engine";
import type { GameState } from "./types";
import { loadAdminAndProfile, loadGameForAction, randCode, saveState } from "./game.server";


// ============= Create =============
export const createGame = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin, username } = await loadAdminAndProfile(context.userId);
    let code = randCode();
    // Try a few times in unlikely collision
    for (let i = 0; i < 5; i++) {
      const { data: existing } = await supabaseAdmin
        .from("games")
        .select("id")
        .eq("code", code)
        .maybeSingle();
      if (!existing) break;
      code = randCode();
    }
    const { data: game, error } = await supabaseAdmin
      .from("games")
      .insert({
        code,
        host_id: context.userId,
        status: "lobby",
        state: {},
        version: 0,
      })
      .select()
      .single();
    if (error || !game) throw new Error(error?.message || "Failed to create game");
    await supabaseAdmin.from("game_players").insert({
      game_id: game.id,
      user_id: context.userId,
      username,
      seat: 0,
    });
    return { code };
  });

// ============= Join =============
export const joinGame = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ code: z.string().min(1).max(8) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin, username } = await loadAdminAndProfile(context.userId);
    const code = data.code.toUpperCase();
    const { data: game } = await supabaseAdmin
      .from("games")
      .select("*")
      .eq("code", code)
      .maybeSingle();
    if (!game) throw new Error("Game not found");
    if (game.status !== "lobby") {
      // Allow rejoin if already a player
      const { data: existing } = await supabaseAdmin
        .from("game_players")
        .select("id")
        .eq("game_id", game.id)
        .eq("user_id", context.userId)
        .maybeSingle();
      if (!existing) throw new Error("Game already started");
      return { code };
    }
    const { data: players } = await supabaseAdmin
      .from("game_players")
      .select("seat, user_id")
      .eq("game_id", game.id)
      .order("seat", { ascending: true });
    const alreadyIn = players?.find((p) => p.user_id === context.userId);
    if (alreadyIn) return { code };
    if ((players?.length || 0) >= 4) throw new Error("Game is full");
    const usedSeats = new Set((players || []).map((p) => p.seat));
    let seat = 0;
    while (usedSeats.has(seat)) seat++;
    await supabaseAdmin.from("game_players").insert({
      game_id: game.id,
      user_id: context.userId,
      username,
      seat,
    });
    return { code };
  });

// ============= Start (host) =============
export const startGame = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ code: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await loadAdminAndProfile(context.userId);
    const { data: game } = await supabaseAdmin
      .from("games")
      .select("*")
      .eq("code", data.code.toUpperCase())
      .maybeSingle();
    if (!game) throw new Error("Game not found");
    if (game.host_id !== context.userId) throw new Error("Only host can start");
    if (game.status !== "lobby") return { ok: true };
    const { data: players } = await supabaseAdmin
      .from("game_players")
      .select("user_id, seat")
      .eq("game_id", game.id)
      .order("seat", { ascending: true });
    if (!players || players.length < 1) throw new Error("Need at least 1 player");
    const seatOrder = players.map((p) => p.user_id);
    const state = initialState(seatOrder);
    const { error: updateError } = await supabaseAdmin
      .from("games")
      .update({
        status: "setup",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        state: state as any,
        version: game.version + 1,
      })
      .eq("id", game.id);
    if (updateError) throw new Error(updateError.message);
    return { ok: true };
  });


// ============= Get view =============
export const getGameView = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ code: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const { game, players } = await loadGameForAction(data.code, context.userId);
    if (game.status === "lobby") {
      return {
        lobby: true as const,
        id: game.id,
        code: game.code,
        host_id: game.host_id,
        version: game.version,
        myUserId: context.userId,
        players: players.map((p) => ({ user_id: p.user_id, username: p.username, seat: p.seat })),
      };
    }
    const state = game.state as unknown as GameState;
    return {
      lobby: false as const,
      view: buildView(
        state,
        { id: game.id, code: game.code, status: game.status, version: game.version },
        context.userId,
        players,
      ),
    };
  });

// ============= Actions =============
const codeSchema = z.object({ code: z.string() });

export const setupReady = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => codeSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin, game } = await loadGameForAction(data.code, context.userId);
    const next = actSetupReady(game.state as unknown as GameState, context.userId);
    await saveState(supabaseAdmin, game, next);
    return { ok: true };
  });

export const drawCard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ code: z.string(), from: z.enum(["deck", "discard"]) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin, game } = await loadGameForAction(data.code, context.userId);
    const next = actDraw(game.state as unknown as GameState, context.userId, data.from);
    await saveState(supabaseAdmin, game, next);
    return { ok: true };
  });

export const discardDrawn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => codeSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin, game } = await loadGameForAction(data.code, context.userId);
    const next = actDiscardDrawn(game.state as unknown as GameState, context.userId);
    await saveState(supabaseAdmin, game, next);
    return { ok: true };
  });

export const swapDrawn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ code: z.string(), position: z.number().int().min(0).max(20) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin, game } = await loadGameForAction(data.code, context.userId);
    const next = actSwap(game.state as unknown as GameState, context.userId, data.position);
    await saveState(supabaseAdmin, game, next);
    return { ok: true };
  });

export const callCambio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => codeSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin, game } = await loadGameForAction(data.code, context.userId);
    const next = actCallCambio(game.state as unknown as GameState, context.userId);
    await saveState(supabaseAdmin, game, next);
    return { ok: true };
  });

export const snapCard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        code: z.string(),
        targetUserId: z.string().uuid(),
        targetPosition: z.number().int().min(0).max(20),
        giveFromPosition: z.number().int().min(0).max(20).nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin, game } = await loadGameForAction(data.code, context.userId);
    const next = actSnap(
      game.state as unknown as GameState,
      context.userId,
      { userId: data.targetUserId, position: data.targetPosition },
      data.giveFromPosition,
    );
    await saveState(supabaseAdmin, game, next);
    return { ok: true };
  });

// ============= Card abilities =============
const pos = z.number().int().min(0).max(20);
const targetSchema = z.object({
  code: z.string(),
  targetUserId: z.string().uuid(),
  position: pos,
});

export const abilityPeekSelf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ code: z.string(), position: pos }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin, game } = await loadGameForAction(data.code, context.userId);
    const next = actAbilityPeekSelf(game.state as unknown as GameState, context.userId, data.position);
    await saveState(supabaseAdmin, game, next);
    return { ok: true };
  });

export const abilityPeekOther = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => targetSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin, game } = await loadGameForAction(data.code, context.userId);
    const next = actAbilityPeekOther(game.state as unknown as GameState, context.userId, data.targetUserId, data.position);
    await saveState(supabaseAdmin, game, next);
    return { ok: true };
  });

export const abilityConfirm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => codeSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin, game } = await loadGameForAction(data.code, context.userId);
    const next = actAbilityConfirm(game.state as unknown as GameState, context.userId);
    await saveState(supabaseAdmin, game, next);
    return { ok: true };
  });

export const abilityBlindSwap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => targetSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin, game } = await loadGameForAction(data.code, context.userId);
    const next = actAbilityBlindSwap(game.state as unknown as GameState, context.userId, data.targetUserId, data.position);
    await saveState(supabaseAdmin, game, next);
    return { ok: true };
  });

export const abilityLookSwapPeek = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => targetSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin, game } = await loadGameForAction(data.code, context.userId);
    const next = actAbilityLookSwapPeek(game.state as unknown as GameState, context.userId, data.targetUserId, data.position);
    await saveState(supabaseAdmin, game, next);
    return { ok: true };
  });

export const abilityLookSwapDecide = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ code: z.string(), swapWithPosition: pos.nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin, game } = await loadGameForAction(data.code, context.userId);
    const next = actAbilityLookSwapDecide(game.state as unknown as GameState, context.userId, data.swapWithPosition);
    await saveState(supabaseAdmin, game, next);
    return { ok: true };
  });

export const abilitySkip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => codeSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin, game } = await loadGameForAction(data.code, context.userId);
    const next = actAbilitySkip(game.state as unknown as GameState, context.userId);
    await saveState(supabaseAdmin, game, next);
    return { ok: true };
  });
