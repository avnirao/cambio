import {
  type Card,
  type GameState,
  type GameView,
  type PublicPlayer,
  rankOf,
  scoreOf,
} from "./types";

// ----------------- Pure helpers -----------------

export function freshDeck(): Card[] {
  const d: Card[] = [];
  for (let i = 0; i < 52; i++) d.push(i);
  return d;
}

export function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function initialState(seatOrder: string[]): GameState {
  const deck = shuffle(freshDeck());
  const hands: Record<string, (Card | null)[]> = {};
  const setupReady: Record<string, boolean> = {};
  const seenPositions: Record<string, number[]> = {};
  for (const pid of seatOrder) {
    hands[pid] = [deck.pop()!, deck.pop()!, deck.pop()!, deck.pop()!];
    setupReady[pid] = false;
    seenPositions[pid] = [2, 3];
  }
  // First card of discard from deck
  const first = deck.pop()!;
  return {
    deck,
    discard: [first],
    hands,
    seatOrder,
    phase: "setup",
    setupReady,
    turn: 0,
    turnCount: 0,
    drawn: null,
    drawnBy: null,
    cambioCalledBy: null,
    cambioStartTurn: null,
    scores: null,
    winnerId: null,
    log: [{ t: Date.now(), msg: "Game started — peek your bottom 2 cards" }],
    seenPositions,
  };
}

function pushLog(s: GameState, msg: string) {
  s.log.push({ t: Date.now(), msg });
  if (s.log.length > 30) s.log.shift();
}

function drawFromDeck(s: GameState): Card {
  if (s.deck.length === 0) {
    // Reshuffle discard (keep top) into deck
    const top = s.discard.pop()!;
    s.deck = shuffle(s.discard);
    s.discard = [top];
    pushLog(s, "Deck reshuffled from discard");
  }
  return s.deck.pop()!;
}

function advanceTurn(s: GameState) {
  s.turn = (s.turn + 1) % s.seatOrder.length;
  s.turnCount++;
  // If cambio was called, end after one full lap back to the next player
  if (
    s.cambioCalledBy !== null &&
    s.cambioStartTurn !== null &&
    s.turnCount >= s.cambioStartTurn + s.seatOrder.length
  ) {
    finalizeScores(s);
  }
}

function finalizeScores(s: GameState) {
  s.phase = "finished";
  const scores: Record<string, number> = {};
  for (const pid of s.seatOrder) {
    scores[pid] = (s.hands[pid] || [])
      .filter((c): c is Card => c !== null)
      .reduce((sum, c) => sum + scoreOf(c), 0);
  }
  s.scores = scores;
  // Cambio caller wins ties; if not tied, lowest score wins
  const entries = Object.entries(scores);
  entries.sort((a, b) => a[1] - b[1]);
  const lowest = entries[0][1];
  const tied = entries.filter((e) => e[1] === lowest).map((e) => e[0]);
  if (s.cambioCalledBy && tied.includes(s.cambioCalledBy)) {
    s.winnerId = s.cambioCalledBy;
  } else if (s.cambioCalledBy && !tied.includes(s.cambioCalledBy)) {
    // Cambio caller failed — they get +10 penalty in some variants, but for v1
    // just declare the lowest as winner.
    s.winnerId = tied[0];
  } else {
    s.winnerId = tied[0];
  }
  pushLog(s, `Game over — winner: ${s.winnerId.slice(0, 6)}…`);
}

// ----------------- Actions -----------------

export function actSetupReady(s: GameState, pid: string): GameState {
  if (s.phase !== "setup") throw new Error("Not in setup");
  if (!(pid in s.hands)) throw new Error("Not a player");
  s.setupReady[pid] = true;
  // Mark bottom 2 positions as "seen" by this player
  s.seenPositions[pid] = [2, 3];
  pushLog(s, `${pid.slice(0, 6)}… is ready`);
  if (Object.values(s.setupReady).every(Boolean)) {
    s.phase = "play";
    pushLog(s, "All players ready — game begins!");
  }
  return s;
}

function requireTurn(s: GameState, pid: string) {
  if (s.phase !== "play") throw new Error("Not in play phase");
  if (s.seatOrder[s.turn] !== pid) throw new Error("Not your turn");
}

export function actDraw(s: GameState, pid: string, from: "deck" | "discard"): GameState {
  requireTurn(s, pid);
  if (s.drawn) throw new Error("Already drew");
  if (from === "deck") {
    const c = drawFromDeck(s);
    s.drawn = { card: c, from: "deck" };
    s.drawnBy = pid;
    pushLog(s, `${pid.slice(0, 6)}… drew from deck`);
  } else {
    if (s.discard.length === 0) throw new Error("Empty discard");
    const c = s.discard.pop()!;
    s.drawn = { card: c, from: "discard" };
    s.drawnBy = pid;
    pushLog(s, `${pid.slice(0, 6)}… took from discard`);
  }
  return s;
}

export function actDiscardDrawn(s: GameState, pid: string): GameState {
  requireTurn(s, pid);
  if (!s.drawn) throw new Error("Nothing drawn");
  if (s.drawn.from === "discard")
    throw new Error("Can't discard a card you took from discard — must swap");
  s.discard.push(s.drawn.card);
  pushLog(s, `${pid.slice(0, 6)}… discarded`);
  s.drawn = null;
  s.drawnBy = null;
  advanceTurn(s);
  return s;
}

export function actSwap(s: GameState, pid: string, position: number): GameState {
  requireTurn(s, pid);
  if (!s.drawn) throw new Error("Nothing drawn");
  const hand = s.hands[pid];
  if (position < 0 || position >= hand.length) throw new Error("Bad position");
  const existing = hand[position];
  if (existing === null) throw new Error("Empty slot");
  hand[position] = s.drawn.card;
  s.discard.push(existing);
  // Player now knows what's at this position
  if (!s.seenPositions[pid].includes(position)) s.seenPositions[pid].push(position);
  pushLog(s, `${pid.slice(0, 6)}… swapped position ${position + 1}`);
  s.drawn = null;
  s.drawnBy = null;
  advanceTurn(s);
  return s;
}

export function actCallCambio(s: GameState, pid: string): GameState {
  requireTurn(s, pid);
  if (s.drawn) throw new Error("Finish your draw first");
  if (s.cambioCalledBy) throw new Error("Cambio already called");
  s.cambioCalledBy = pid;
  s.cambioStartTurn = s.turnCount;
  pushLog(s, `${pid.slice(0, 6)}… called CAMBIO!`);
  advanceTurn(s);
  return s;
}

// Snap: player tries to dump a matching card onto the discard pile.
// target: { userId, position } — own or opponent.
// If opponent and successful: snapper must give one of their own cards (giveFromPosition).
export function actSnap(
  s: GameState,
  snapper: string,
  target: { userId: string; position: number },
  giveFromPosition: number | null,
): GameState {
  if (s.phase !== "play") throw new Error("Not in play");
  if (s.discard.length === 0) throw new Error("No discard top");
  const top = s.discard[s.discard.length - 1];
  const topRank = rankOf(top);
  const targetHand = s.hands[target.userId];
  if (!targetHand) throw new Error("Bad target player");
  if (target.position < 0 || target.position >= targetHand.length)
    throw new Error("Bad target position");
  const card = targetHand[target.position];

  if (card !== null && rankOf(card) === topRank) {
    // Successful snap
    targetHand[target.position] = null;
    s.discard.push(card);
    pushLog(
      s,
      `${snapper.slice(0, 6)}… SNAPPED ${target.userId === snapper ? "own" : "opponent's"} card!`,
    );
    if (target.userId !== snapper) {
      // Snapper gives one of their own cards to the opponent's empty slot
      if (giveFromPosition === null)
        throw new Error("Must choose a card to give");
      const myHand = s.hands[snapper];
      if (giveFromPosition < 0 || giveFromPosition >= myHand.length)
        throw new Error("Bad give position");
      const giving = myHand[giveFromPosition];
      if (giving === null) throw new Error("Can't give empty slot");
      myHand[giveFromPosition] = null;
      targetHand[target.position] = giving;
      // Receiver does NOT know what the new card is (snapper might know it).
      // Snapper loses knowledge of that position.
      s.seenPositions[snapper] = s.seenPositions[snapper].filter(
        (p) => p !== giveFromPosition,
      );
      // Remove any prior knowledge the target had of that position
      s.seenPositions[target.userId] = s.seenPositions[target.userId].filter(
        (p) => p !== target.position,
      );
      pushLog(s, `${snapper.slice(0, 6)}… gave a card to ${target.userId.slice(0, 6)}…`);
    } else {
      // Own snap — they had seen this position; drop knowledge of empty slot
      s.seenPositions[snapper] = s.seenPositions[snapper].filter(
        (p) => p !== target.position,
      );
    }
  } else {
    // Wrong snap — penalty +1 face-down card
    const penalty = drawFromDeck(s);
    s.hands[snapper].push(penalty);
    pushLog(s, `${snapper.slice(0, 6)}… snapped WRONG (+1 penalty card)`);
  }
  return s;
}

// ----------------- View builder -----------------

export function buildView(
  state: GameState,
  meta: { id: string; code: string; status: string; version: number },
  myUserId: string,
  playerMeta: { user_id: string; username: string; seat: number }[],
): GameView {
  const players: PublicPlayer[] = playerMeta
    .slice()
    .sort((a, b) => a.seat - b.seat)
    .map((pm) => {
      const hand = state.hands[pm.user_id] || [];
      const seen = new Set(state.seenPositions[pm.user_id] || []);
      const visible: (Card | null | "hidden")[] = hand.map((c, i) => {
        if (c === null) return null;
        if (pm.user_id === myUserId && seen.has(i)) return c;
        return "hidden";
      });
      return {
        user_id: pm.user_id,
        username: pm.username,
        seat: pm.seat,
        handSize: hand.filter((c) => c !== null).length,
        hand: visible,
      };
    });

  const currentTurnUserId =
    state.phase === "play" || state.phase === "cambio"
      ? state.seatOrder[state.turn] ?? null
      : null;

  const drawnView =
    state.drawn && state.drawnBy
      ? {
          card: state.drawnBy === myUserId ? state.drawn.card : -1,
          by: state.drawnBy,
          from: state.drawn.from,
        }
      : null;

  return {
    id: meta.id,
    code: meta.code,
    status: meta.status,
    version: meta.version,
    phase: state.phase,
    myUserId,
    isMyTurn: currentTurnUserId === myUserId,
    currentTurnUserId,
    deckCount: state.deck.length,
    discardTop: state.discard.length ? state.discard[state.discard.length - 1] : null,
    discardCount: state.discard.length,
    players,
    drawn: drawnView,
    cambioCalledBy: state.cambioCalledBy,
    scores: state.scores,
    winnerId: state.winnerId,
    log: state.log.slice(-15),
    setupReady: state.setupReady,
  };
}
