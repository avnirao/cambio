# Cambio Card Powers + Scoring

Implement the official ability and scoring rules you listed. Powers trigger when a player **discards** a card drawn from the deck (taking from discard pile gives no power).

## Scoring changes (`src/lib/game/types.ts`)
- A = 1
- 2–10 = face value
- J, Q = 10 (was 11/12)
- Black K (spades/clubs) = 10
- Red K (hearts/diamonds) = -1
- Joker = 0 *(deferred — current deck has no jokers; see Out of scope)*

## Engine changes (`src/lib/game/engine.ts`)
Add an `ability` field to `GameState` representing a pending power after a deck-drawn discard:

```ts
ability: {
  by: string;
  kind: "peekSelf" | "peekOther" | "blindSwap" | "lookSwap";
  step: "pick" | "lookSwapChooseSwap"; // black K has 2 steps
  revealed?: { userId: string; position: number; card: Card }; // for lookSwap step 2
} | null
```

Flow change in `actDiscardDrawn`:
- If `drawn.from === "deck"`, inspect rank and set `state.ability` instead of advancing turn:
  - 7, 8 → `peekSelf`
  - 9, 10 → `peekOther`
  - J, Q → `blindSwap`
  - Black K → `lookSwap`
  - Red K, A, 2–6 → no power, advance turn normally
- Turn only advances after the ability resolves (or is skipped).

New actions:
- `actAbilityPeek({ targetUserId, position })` — for peekSelf/peekOther. Adds to seenPositions (peekSelf) or returns a one-shot reveal that only the acting player sees (peekOther: store in `ability.revealed` then advance + clear; the view only exposes `revealed.card` to `myUserId === ability.by`).
- `actAbilityBlindSwap({ a:{userId,position}, b:{userId,position} })` — swap two cards face-down without looking. Clears seenPositions for both swapped positions for everyone.
- `actAbilityLookSwapPeek({ targetUserId, position })` — step 1: reveals the card to the acting player only (`ability.revealed`), then transitions to `step: "lookSwapChooseSwap"`.
- `actAbilityLookSwapDecide({ swap: boolean, myPosition?: number })` — step 2: either swap the revealed opponent card with one of own, or pass.
- `actAbilitySkip()` — escape hatch to skip a power.

All ability actions guard: `state.ability?.by === pid` and validate `kind`/`step`; idempotent on stale calls.

`requireTurn` updated: most actions still require turn, but ability actions require `state.ability?.by === pid` (turn ownership implied since only the turn player sets abilities).

## Server functions (`src/lib/game/game.functions.ts`)
Add server functions wrapping each new engine action: `abilityPeek`, `abilityBlindSwap`, `abilityLookSwapPeek`, `abilityLookSwapDecide`, `abilitySkip`. Same auth + version-bump pattern as existing actions.

## View (`buildView`)
Expose to the client:
```ts
ability: { by, kind, step, revealed? } | null
```
`revealed.card` is included only when `myUserId === ability.by`; otherwise stripped to `-1`. Other players see that an ability is pending and whose.

## UI (`src/routes/_authenticated/game.$code.tsx`)
When `view.ability && view.ability.by === myUserId`:
- Banner explaining the power ("Peek one of your cards", "Peek an opponent's card", "Blind swap any two cards", "Look at any card, then optionally swap with one of yours").
- Card-click handlers route to the right ability serverFn based on `kind`/`step` instead of normal swap/discard.
- Show `ability.revealed.card` as a temporary face-up reveal with a "Done" / "Swap with…" prompt for lookSwap.
- "Skip" button calls `abilitySkip`.
When `view.ability && view.ability.by !== myUserId`: dim the board with "Waiting for {name} to use their power…".

## Out of scope (ask before doing)
- **Jokers**: deck is 52 cards. Adding 2 jokers requires expanding `Card` encoding (currently `idx % 13`, no joker slot) and touching `rankOf`/`scoreOf`/`PlayingCard` rendering. Want me to add them in a follow-up?
- "One-hand only" rule — physical, not enforceable in code.
- First-turn = player to dealer's right — currently `turn` starts at 0; want me to randomize or set to seat 1?
