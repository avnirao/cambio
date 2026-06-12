import { useEffect, useState, useCallback, useRef } from "react";
import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  getGameView,
  joinGame,
  startGame,
  setupReady,
  drawCard,
  discardDrawn,
  swapDrawn,
  callCambio,
  snapCard,
  abilityPeekSelf,
  abilityPeekOther,
  abilityConfirm,
  abilityBlindSwap,
  abilityLookSwapPeek,
  abilityLookSwapDecide,
  abilitySkip,
} from "@/lib/game/game.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { PlayingCard } from "@/components/game/PlayingCard";
import { toast } from "sonner";
import { rankLabel } from "@/lib/game/types";

export const Route = createFileRoute("/_authenticated/game/$code")({
  head: ({ params }) => ({
    meta: [{ title: `Game ${params.code} — Cambio` }],
  }),
  component: GamePage,
});

type ViewResult = Awaited<ReturnType<typeof getGameView>>;

function GamePage() {
  const { code } = useParams({ from: "/_authenticated/game/$code" });
  const navigate = useNavigate();
  const fetchView = useServerFn(getGameView);
  const join = useServerFn(joinGame);
  const [view, setView] = useState<ViewResult | null>(null);
  const [loading, setLoading] = useState(true);
  const triedJoinRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const v = await fetchView({ data: { code } });
      setView(v);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to load";
      if (message === "Not in game" && !triedJoinRef.current) {
        triedJoinRef.current = true;
        try {
          await join({ data: { code } });
          const v = await fetchView({ data: { code } });
          setView(v);
          return;
        } catch (joinError) {
          toast.error(joinError instanceof Error ? joinError.message : "Failed to join");
        }
      } else {
        toast.error(message);
      }
    } finally {
      setLoading(false);
    }
  }, [fetchView, join, code]);

  // Initial load + realtime
  useEffect(() => {
    refresh();
    const ch = supabase
      .channel(`game-${code}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "games", filter: `code=eq.${code.toUpperCase()}` },
        () => refresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "game_players" },
        () => refresh(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [code, refresh]);

  if (loading || !view) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (view.lobby) {
    return <LobbyView view={view} onLeave={() => navigate({ to: "/" })} />;
  }
  return <BoardView code={code} view={view.view} onLeave={() => navigate({ to: "/" })} />;
}

// =================== Lobby ===================

function LobbyView({
  view,
  onLeave,
}: {
  view: Extract<ViewResult, { lobby: true }>;
  onLeave: () => void;
}) {
  const start = useServerFn(startGame);
  const [busy, setBusy] = useState(false);
  const isHost = view.host_id === view.myUserId;

  async function onStart() {
    setBusy(true);
    try {
      await start({ data: { code: view.code } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen p-6 flex flex-col">
      <header className="flex items-center justify-between mb-8">
        <button onClick={onLeave} className="text-sm text-muted-foreground hover:text-foreground">
          ← Leave
        </button>
        <h2 className="display text-accent text-xl">Cambio</h2>
        <span className="w-12" />
      </header>
      <main className="flex-1 flex items-center justify-center">
        <div className="max-w-md w-full bg-popover/70 backdrop-blur rounded-xl border p-8 text-center">
          <p className="text-sm text-muted-foreground uppercase tracking-widest mb-2">Room code</p>
          <p className="display text-6xl tracking-[0.4em] text-accent mb-8">{view.code}</p>
          <p className="text-sm text-muted-foreground mb-4">
            Share this code. Game starts when host deals.
          </p>
          <ul className="space-y-2 mb-8 text-left">
            {view.players
              .slice()
              .sort((a, b) => a.seat - b.seat)
              .map((p) => (
                <li
                  key={p.user_id}
                  className="flex items-center justify-between bg-muted/40 rounded px-3 py-2"
                >
                  <span>
                    {p.username}
                    {p.user_id === view.host_id && (
                      <span className="ml-2 text-xs text-accent uppercase">host</span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">seat {p.seat + 1}</span>
                </li>
              ))}
            {Array.from({ length: 4 - view.players.length }).map((_, i) => (
              <li
                key={`empty-${i}`}
                className="text-xs text-muted-foreground/60 italic px-3 py-2 border border-dashed rounded"
              >
                Waiting for player…
              </li>
            ))}
          </ul>
          {isHost ? (
            <Button
              onClick={onStart}
              disabled={busy || view.players.length < 2}
              className="w-full"
            >
              Deal {view.players.length < 2 && "(need 2+)"}
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground italic">Waiting for host to deal…</p>
          )}
        </div>
      </main>
    </div>
  );
}

// =================== Board ===================

type GameView = Extract<ViewResult, { lobby: false }>["view"];

function BoardView({
  code,
  view,
  onLeave,
}: {
  code: string;
  view: GameView;
  onLeave: () => void;
}) {
  const ready = useServerFn(setupReady);
  const draw = useServerFn(drawCard);
  const disc = useServerFn(discardDrawn);
  const swap = useServerFn(swapDrawn);
  const cambio = useServerFn(callCambio);
  const snap = useServerFn(snapCard);

  const aPeekSelf = useServerFn(abilityPeekSelf);
  const aPeekOther = useServerFn(abilityPeekOther);
  const aConfirm = useServerFn(abilityConfirm);
  const aBlindSwap = useServerFn(abilityBlindSwap);
  const aLookPeek = useServerFn(abilityLookSwapPeek);
  const aLookDecide = useServerFn(abilityLookSwapDecide);
  const aSkip = useServerFn(abilitySkip);

  // Snap UX: when armed, next click on a hand card attempts a snap.
  const [snapArmed, setSnapArmed] = useState(false);
  // For opponent snap: after picking target, need to pick own card to give.
  const [pendingSnap, setPendingSnap] = useState<
    { userId: string; position: number } | null
  >(null);

  // Brief reveal at setup phase
  const [setupRevealed, setSetupRevealed] = useState(false);
  const myReady = view.setupReady[view.myUserId];

  const myAbility = view.ability && view.ability.by === view.myUserId ? view.ability : null;
  const othersAbility = view.ability && view.ability.by !== view.myUserId ? view.ability : null;

  async function call<T>(fn: () => Promise<T>) {
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    }
  }

  function handleAbilityCardClick(userId: string, position: number) {
    if (!myAbility) return false;
    const kind = myAbility.kind;
    if (kind === "peekSelf") {
      if (userId !== view.myUserId) {
        toast.error("Pick one of YOUR cards");
        return true;
      }
      call(() => aPeekSelf({ data: { code, position } }));
      return true;
    }
    if (kind === "peekOther") {
      if (myAbility.revealed) return true; // waiting for confirm
      if (userId === view.myUserId) {
        toast.error("Pick an OPPONENT's card");
        return true;
      }
      call(() => aPeekOther({ data: { code, targetUserId: userId, position } }));
      return true;
    }
    if (kind === "blindSwap") {
      call(() => aBlindSwap({ data: { code, targetUserId: userId, position } }));
      return true;
    }
    if (kind === "lookSwap") {
      if (myAbility.step === "pick") {
        call(() => aLookPeek({ data: { code, targetUserId: userId, position } }));
      } else if (myAbility.step === "lookSwapChooseSwap") {
        if (userId !== view.myUserId) {
          toast.error("Pick one of YOUR cards to swap with");
          return true;
        }
        call(() => aLookDecide({ data: { code, swapWithPosition: position } }));
      }
      return true;
    }
    return false;
  }

  function handleSnapTarget(userId: string, position: number) {
    if (!snapArmed) return;
    if (userId === view.myUserId) {
      call(() =>
        snap({
          data: { code, targetUserId: userId, targetPosition: position, giveFromPosition: null },
        }),
      );
      setSnapArmed(false);
    } else {
      // Need to pick a card to give if successful
      setPendingSnap({ userId, position });
      toast.info("Pick one of YOUR cards to give if the snap succeeds");
    }
  }

  function handleGiveCard(position: number) {
    if (!pendingSnap) return;
    const p = pendingSnap;
    setPendingSnap(null);
    setSnapArmed(false);
    call(() =>
      snap({
        data: {
          code,
          targetUserId: p.userId,
          targetPosition: p.position,
          giveFromPosition: position,
        },
      }),
    );
  }

  // ---------- finished ----------
  if (view.phase === "finished") {
    const winner = view.players.find((p) => p.user_id === view.winnerId);
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 gap-6">
        <h2 className="display text-5xl text-accent">
          {winner?.user_id === view.myUserId ? "You won!" : `${winner?.username} won`}
        </h2>
        <div className="bg-popover/70 rounded-xl border p-6 min-w-[280px]">
          <h3 className="text-sm uppercase tracking-widest text-muted-foreground mb-3">
            Final scores
          </h3>
          <ul className="space-y-2">
            {view.players.map((p) => (
              <li key={p.user_id} className="flex justify-between">
                <span>{p.username}</span>
                <span
                  className={
                    p.user_id === view.winnerId ? "text-accent font-bold" : "text-foreground"
                  }
                >
                  {view.scores?.[p.user_id] ?? 0}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <Button onClick={onLeave}>Back to lobby</Button>
      </div>
    );
  }

  // ---------- setup ----------
  if (view.phase === "setup") {
    const me = view.players.find((p) => p.user_id === view.myUserId)!;
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 gap-8">
        <div className="text-center">
          <h2 className="display text-3xl text-accent mb-2">Peek your bottom 2 cards</h2>
          <p className="text-sm text-muted-foreground">
            Remember them — this is your only free look.
          </p>
        </div>
        <SetupHand
          hand={me.hand}
          revealed={setupRevealed}
          onPeek={() => setSetupRevealed(true)}
        />
        <div className="flex flex-col items-center gap-2">
          {!myReady ? (
            <Button
              disabled={!setupRevealed}
              onClick={() =>
                call(async () => {
                  await ready({ data: { code } });
                })
              }
            >
              I'm ready
            </Button>
          ) : (
            <p className="text-muted-foreground text-sm italic">Waiting for others…</p>
          )}
          <div className="flex gap-2 mt-4 text-xs text-muted-foreground">
            {view.players.map((p) => (
              <span key={p.user_id} className={view.setupReady[p.user_id] ? "text-accent" : ""}>
                {p.username} {view.setupReady[p.user_id] ? "✓" : "…"}
              </span>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ---------- play ----------
  const me = view.players.find((p) => p.user_id === view.myUserId)!;
  const opponents = view.players.filter((p) => p.user_id !== view.myUserId);
  const someoneDrawing = view.drawn !== null;
  const myDraw = view.drawn?.by === view.myUserId ? view.drawn : null;

  return (
    <div className="min-h-screen flex flex-col p-4 md:p-6">
      {/* Top bar */}
      <header className="flex items-center justify-between mb-4">
        <button onClick={onLeave} className="text-sm text-muted-foreground hover:text-foreground">
          ← Leave
        </button>
        <div className="flex items-center gap-4">
          <span className="text-xs text-muted-foreground uppercase tracking-widest">
            Room <span className="text-accent font-mono">{view.code}</span>
          </span>
          {view.cambioCalledBy && (
            <span className="text-xs uppercase tracking-widest text-primary font-bold">
              CAMBIO called
            </span>
          )}
        </div>
      </header>

      {/* Ability banner */}
      {(myAbility || othersAbility) && (
        <AbilityBanner
          view={view}
          myAbility={myAbility}
          othersAbility={othersAbility}
          onSkip={() => call(() => aSkip({ data: { code } }))}
          onConfirm={() => call(() => aConfirm({ data: { code } }))}
          onLookSwapPass={() =>
            call(() => aLookDecide({ data: { code, swapWithPosition: null } }))
          }
        />
      )}

      {/* Opponents */}
      <div
        className={`grid gap-4 mb-6 ${opponents.length === 1 ? "grid-cols-1" : opponents.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}
      >
        {opponents.map((p) => (
          <OpponentArea
            key={p.user_id}
            player={p}
            isTurn={view.currentTurnUserId === p.user_id}
            armed={snapArmed || !!myAbility}
            revealedHere={
              myAbility?.revealed && myAbility.revealed.userId === p.user_id
                ? { position: myAbility.revealed.position, card: myAbility.revealed.card }
                : null
            }
            onCardClick={(pos) => {
              if (handleAbilityCardClick(p.user_id, pos)) return;
              handleSnapTarget(p.user_id, pos);
            }}
          />
        ))}
      </div>

      {/* Center: deck + discard + drawn card */}
      <div className="flex-1 flex flex-col items-center justify-center gap-4">
        <div className="flex items-end gap-6">
          <button
            disabled={!view.isMyTurn || !!myDraw || view.phase !== "play" || !!view.ability}
            onClick={() => call(() => draw({ data: { code, from: "deck" } }))}
            className="flex flex-col items-center gap-1 disabled:opacity-50"
          >
            <PlayingCard card="hidden" size="lg" />
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Deck ({view.deckCount})
            </span>
          </button>
          <button
            disabled={
              !view.isMyTurn ||
              !!myDraw ||
              view.discardTop === null ||
              view.phase !== "play" ||
              !!view.ability
            }
            onClick={() => call(() => draw({ data: { code, from: "discard" } }))}
            className="flex flex-col items-center gap-1 disabled:opacity-50"
          >
            {view.discardTop !== null ? (
              <PlayingCard card={view.discardTop} size="lg" />
            ) : (
              <PlayingCard card={null} size="lg" label="Discard" />
            )}
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Discard
            </span>
          </button>

          {view.drawn && (
            <div className="flex flex-col items-center gap-1 ml-6 animate-in fade-in slide-in-from-bottom-2">
              <PlayingCard card={myDraw ? myDraw.card : "hidden"} size="lg" />
              <span className="text-[10px] uppercase tracking-widest text-accent">
                {myDraw ? "Your draw" : `${opponents.find((o) => o.user_id === view.drawn?.by)?.username}'s draw`}
              </span>
            </div>
          )}
        </div>

        {/* Action bar */}
        <div className="flex flex-wrap gap-2 justify-center mt-4 min-h-[40px]">
          {view.isMyTurn && myDraw && (
            <>
              {myDraw.from === "deck" && (
                <Button
                  variant="secondary"
                  onClick={() => call(() => disc({ data: { code } }))}
                >
                  Discard drawn
                </Button>
              )}
              <span className="text-xs self-center text-muted-foreground italic">
                …or click one of your cards to swap
              </span>
            </>
          )}
          {view.isMyTurn && !myDraw && !view.ability && view.phase === "play" && !view.cambioCalledBy && (
            <Button
              variant="outline"
              onClick={() => call(() => cambio({ data: { code } }))}
            >
              Call Cambio
            </Button>
          )}
          {!someoneDrawing && !view.ability && view.phase === "play" && view.discardTop !== null && (
            <Button
              variant={snapArmed ? "default" : "outline"}
              onClick={() => {
                setSnapArmed((v) => !v);
                setPendingSnap(null);
              }}
              className={snapArmed ? "snap-pulse" : ""}
            >
              {snapArmed
                ? `SNAP ${view.discardTop !== null ? rankLabel(view.discardTop) : ""} — pick a card`
                : "Snap!"}
            </Button>
          )}
          {pendingSnap && (
            <span className="text-xs text-primary self-center">
              Now click one of YOUR cards to give to opponent
            </span>
          )}
        </div>
      </div>

      {/* My hand */}
      <MyHand
        me={me}
        isTurn={view.isMyTurn}
        canSwap={!!myDraw}
        snapArmed={snapArmed}
        pendingGive={pendingSnap !== null}
        abilityActive={!!myAbility}
        revealedHere={
          myAbility?.revealed && myAbility.revealed.userId === view.myUserId
            ? { position: myAbility.revealed.position, card: myAbility.revealed.card }
            : null
        }
        pickedFirst={
          myAbility?.pickedFirst && myAbility.pickedFirst.userId === view.myUserId
            ? myAbility.pickedFirst.position
            : null
        }
        onCardClick={(pos) => {
          if (handleAbilityCardClick(view.myUserId, pos)) return;
          if (pendingSnap) {
            handleGiveCard(pos);
          } else if (snapArmed) {
            handleSnapTarget(view.myUserId, pos);
          } else if (myDraw && view.isMyTurn) {
            call(() => swap({ data: { code, position: pos } }));
          }
        }}
      />

      {/* Log */}
      <div className="mt-3 max-h-24 overflow-y-auto text-xs text-muted-foreground space-y-0.5 max-w-md mx-auto w-full">
        {view.log
          .slice()
          .reverse()
          .map((l, i) => (
            <div key={i}>· {l.msg}</div>
          ))}
      </div>
    </div>
  );
}

// ---------- subcomponents ----------

function SetupHand({
  hand,
  revealed,
  onPeek,
}: {
  hand: GameView["players"][number]["hand"];
  revealed: boolean;
  onPeek: () => void;
}) {
  // Show top row hidden, bottom row revealed-on-peek
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex gap-3">
        <PlayingCard card="hidden" size="lg" />
        <PlayingCard card="hidden" size="lg" />
      </div>
      <div className="flex gap-3">
        {/* positions 2 and 3 are the "bottom" — revealed to me */}
        <PlayingCard
          card={revealed ? hand[2] : "hidden"}
          size="lg"
          onClick={onPeek}
          label="peek"
        />
        <PlayingCard
          card={revealed ? hand[3] : "hidden"}
          size="lg"
          onClick={onPeek}
          label="peek"
        />
      </div>
    </div>
  );
}

function OpponentArea({
  player,
  isTurn,
  armed,
  revealedHere,
  onCardClick,
}: {
  player: GameView["players"][number];
  isTurn: boolean;
  armed: boolean;
  revealedHere: { position: number; card: number } | null;
  onCardClick: (position: number) => void;
}) {
  return (
    <div
      className={`bg-felt-dark/40 rounded-lg p-3 flex flex-col items-center gap-2 ${isTurn ? "turn-glow" : ""}`}
    >
      <div className="text-sm font-medium">
        {player.username}{" "}
        <span className="text-xs text-muted-foreground">({player.handSize})</span>
      </div>
      <div className="flex flex-wrap gap-1 justify-center max-w-[200px]">
        {player.hand.map((c, i) => {
          const showRevealed = revealedHere?.position === i && revealedHere.card !== -1;
          return (
            <PlayingCard
              key={i}
              card={showRevealed ? revealedHere!.card : c}
              size="sm"
              onClick={armed && c !== null ? () => onCardClick(i) : undefined}
              highlight={(armed && c !== null) || showRevealed}
            />
          );
        })}
      </div>
    </div>
  );
}

function MyHand({
  me,
  isTurn,
  canSwap,
  snapArmed,
  pendingGive,
  abilityActive,
  revealedHere,
  pickedFirst,
  onCardClick,
}: {
  me: GameView["players"][number];
  isTurn: boolean;
  canSwap: boolean;
  snapArmed: boolean;
  pendingGive: boolean;
  abilityActive: boolean;
  revealedHere: { position: number; card: number } | null;
  pickedFirst: number | null;
  onCardClick: (position: number) => void;
}) {
  const interactive = canSwap || snapArmed || pendingGive || abilityActive;
  return (
    <div
      className={`bg-felt-dark/40 rounded-lg p-4 flex flex-col items-center gap-2 max-w-md mx-auto w-full ${isTurn ? "turn-glow" : ""}`}
    >
      <div className="text-sm font-medium">
        You <span className="text-xs text-muted-foreground">({me.handSize})</span>
      </div>
      <div className="flex flex-wrap gap-2 justify-center">
        {me.hand.map((c, i) => {
          const showRevealed = revealedHere?.position === i && revealedHere.card !== -1;
          const isPicked = pickedFirst === i;
          return (
            <PlayingCard
              key={i}
              card={showRevealed ? revealedHere!.card : c}
              size="md"
              onClick={interactive && c !== null ? () => onCardClick(i) : undefined}
              highlight={(interactive && c !== null) || showRevealed || isPicked}
            />
          );
        })}
      </div>
    </div>
  );
}

function AbilityBanner({
  view,
  myAbility,
  othersAbility,
  onSkip,
  onConfirm,
  onLookSwapPass,
}: {
  view: GameView;
  myAbility: GameView["ability"];
  othersAbility: GameView["ability"];
  onSkip: () => void;
  onConfirm: () => void;
  onLookSwapPass: () => void;
}) {
  if (othersAbility) {
    const who = view.players.find((p) => p.user_id === othersAbility.by)?.username ?? "Player";
    return (
      <div className="mb-3 rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-center text-accent">
        Waiting for {who} to use their {labelFor(othersAbility.kind)}…
      </div>
    );
  }
  if (!myAbility) return null;
  const instruction = (() => {
    if (myAbility.kind === "peekSelf") return "Click one of YOUR cards to peek at it.";
    if (myAbility.kind === "peekOther") {
      return myAbility.revealed
        ? "Memorize the revealed card, then click Done."
        : "Click an OPPONENT's card to peek at it.";
    }
    if (myAbility.kind === "blindSwap") {
      return myAbility.pickedFirst
        ? "Click a SECOND card to swap with (any player)."
        : "Pick the FIRST card to swap (any player).";
    }
    if (myAbility.kind === "lookSwap") {
      if (myAbility.step === "pick") return "Black King: click ANY card to look at it.";
      return "Swap with one of YOUR cards, or pass.";
    }
    return "";
  })();
  return (
    <div className="mb-3 rounded-md border border-primary/50 bg-primary/10 px-3 py-2 text-xs flex flex-wrap items-center gap-2 justify-center">
      <span className="uppercase tracking-widest font-bold text-primary">
        {labelFor(myAbility.kind)}
      </span>
      <span className="text-foreground">{instruction}</span>
      {myAbility.kind === "peekOther" && myAbility.revealed && (
        <Button size="sm" variant="default" onClick={onConfirm}>
          Done
        </Button>
      )}
      {myAbility.kind === "lookSwap" && myAbility.step === "lookSwapChooseSwap" && (
        <Button size="sm" variant="secondary" onClick={onLookSwapPass}>
          Pass
        </Button>
      )}
      <Button size="sm" variant="ghost" onClick={onSkip}>
        Skip
      </Button>
    </div>
  );
}

function labelFor(kind: NonNullable<GameView["ability"]>["kind"]): string {
  switch (kind) {
    case "peekSelf": return "Peek own (7/8)";
    case "peekOther": return "Peek other (9/10)";
    case "blindSwap": return "Blind swap (J/Q)";
    case "lookSwap": return "Look + swap (Black K)";
  }
}
