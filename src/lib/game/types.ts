// Shared types between server engine and client views.

export type Phase = "setup" | "play" | "cambio" | "finished";

// Card is index 0..51. rank = idx % 13 (0=A, 1..9 = 2..10, 10=J, 11=Q, 12=K)
// suit = floor(idx / 13)
export type Card = number;

export type AbilityKind = "peekSelf" | "peekOther" | "blindSwap" | "lookSwap";
export type AbilityStep = "pick" | "lookSwapChooseSwap";

export interface Ability {
  by: string;
  kind: AbilityKind;
  step: AbilityStep;
  // For peekOther / lookSwap: the card revealed only to the acting player.
  revealed?: { userId: string; position: number; card: Card };
  // For blindSwap: first picked slot.
  pickedFirst?: { userId: string; position: number };
}

export interface GameState {
  deck: Card[]; // top is last (pop)
  discard: Card[]; // top is last
  hands: Record<string, (Card | null)[]>; // playerId -> positional slots
  seatOrder: string[]; // playerIds in turn order
  phase: Phase;
  setupReady: Record<string, boolean>;
  turn: number; // index into seatOrder
  turnCount: number;
  drawn: { card: Card; from: "deck" | "discard" } | null;
  drawnBy: string | null;
  cambioCalledBy: string | null;
  cambioStartTurn: number | null;
  scores: Record<string, number> | null;
  winnerId: string | null;
  log: { t: number; msg: string }[];
  // Per-player tracking of positions they have peeked in their OWN hand.
  seenPositions: Record<string, number[]>;
  // Pending card ability after discarding a deck-drawn card.
  ability: Ability | null;
}

export interface PublicPlayer {
  user_id: string;
  username: string;
  seat: number;
  handSize: number;
  hand: (Card | null | "hidden")[]; // for me: actual cards I've seen; "hidden" otherwise. For others: always "hidden" or null
  // Note: empty slots show null. Hidden face-down show "hidden".
}

export interface GameView {
  id: string;
  code: string;
  status: string;
  version: number;
  phase: Phase;
  myUserId: string;
  isMyTurn: boolean;
  currentTurnUserId: string | null;
  deckCount: number;
  discardTop: Card | null;
  discardCount: number;
  players: PublicPlayer[];
  drawn: { card: Card; by: string; from: "deck" | "discard" } | null;
  // Only the drawer sees the drawn card value; for others, drawn.card is -1.
  cambioCalledBy: string | null;
  scores: Record<string, number> | null;
  winnerId: string | null;
  log: { t: number; msg: string }[];
  setupReady: Record<string, boolean>;
  ability: {
    by: string;
    kind: AbilityKind;
    step: AbilityStep;
    // Card value only present for the acting player; -1 for others.
    revealed?: { userId: string; position: number; card: Card };
    pickedFirst?: { userId: string; position: number };
  } | null;
}

export function rankOf(card: Card): number {
  return card % 13;
}
export function suitOf(card: Card): number {
  return Math.floor(card / 13);
}
export function rankLabel(card: Card): string {
  const r = rankOf(card);
  return ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"][r];
}
export function suitLabel(card: Card): string {
  return ["♠", "♥", "♦", "♣"][suitOf(card)];
}
// Scoring (Cambio house rules):
// A=1, 2..10=face, J=Q=10, Black K (♠/♣)=10, Red K (♥/♦)=-1.
export function scoreOf(card: Card): number {
  const r = rankOf(card);
  if (r === 12) return isRed(card) ? -1 : 10; // King
  if (r === 10 || r === 11) return 10; // Jack / Queen
  return r + 1; // Ace..10
}
export function isRed(card: Card): boolean {
  const s = suitOf(card);
  return s === 1 || s === 2;
}
export function isBlack(card: Card): boolean {
  return !isRed(card);
}
