# Tung Tung Chessahur data formats

Your data should never be locked into a format only this app can read. These
are the files Tung Tung Chessahur writes, so another app (a phone trainer, say) can use them.

## 1. Repertoire: PGN

**Repertoire → Export PGN…** writes one standard PGN game with variations:

- The headers say whose repertoire it is: `[Orientation "white"]` or `[Orientation "black"]`
  (the header Lichess studies use), plus `Event "Tung Tung Chessahur repertoire: <name>"`.
- **Your moves** are the only move at each of your turns. **Opponent replies** are the
  main line (the most played one) and variations (the others).
- Positions are shared: if two move orders reach the same position (a transposition),
  what follows is written once, under the first move order.
- **Notes** are comments after the move that reaches the position. Claude's reason for
  your move is written as a comment starting with `Why: `.

**Import PGN…** adds the moves of every game in a PGN file (variations included) to the
selected repertoire. Where the file disagrees with a move of yours that's already in the
repertoire, yours is kept. A file with `[Orientation "..."]` for the other colour is refused.
Any PGN works, for example a Lichess study chapter or a Chessable export.

## 2. Training cards and history: JSON

**Settings → Your data → Training cards → Export…** writes:

```json
{
  "format": "chesscoach-training",
  "version": 1,
  "exportedAt": "2026-11-26T21:04:11.512Z",
  "cards": [ <card>, ... ],
  "reviews": [ <review>, ... ]
}
```

A **card** is a position where it's your move:

| Field | Type | Meaning |
|---|---|---|
| `id` | string | `rep:<repertoire id>:<EPD>` for a repertoire move, `mistake:<id>` for a mistake from a game review |
| `kind` | `"repertoire"` \| `"mistake"` | |
| `answer` | string | The move the card was learned with, in UCI (`g1f3`; castling as `e1g1`) |
| `card` | object | The FSRS state, from [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) 6 with the FSRS-7 model: `stability`, `stabilityFast`, `difficulty`, `state` (0 new, 1 learning, 2 review, 3 relearning), `dueAt` and `lastReviewAt` (ISO dates), `reps`, `lapses`, `scheduledDays`, `learningStep`, … |
| `due` | number | When it's due again, in Unix seconds (the same as `card.dueAt`) |
| `updatedAt` | number | Last change, in Unix seconds |

The EPD in a repertoire card's id is the position's FEN without the move counters
(`r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq -`); the en-passant square
is only written when an en-passant capture is actually possible.

A **review** is one answer:

| Field | Type | Meaning |
|---|---|---|
| `cardId` | string | The card's `id` |
| `rating` | number | 1 = wrong ("Again"), 3 = right ("Good") |
| `reviewedAt` | number | Unix seconds |
| `log` | object | The ts-fsrs review log (the card's state before the answer) |

**Import…** reads such a file: a card replaces the stored one only if its `updatedAt` is
newer; reviews that are already stored are skipped. Files with a higher `version` are refused.

## 3. Everything: SQLite backup

**Settings → Your data → Everything → Back up…** saves a copy of the whole database
(games, engine analysis, repertoires, cards, reviews, cached Claude answers and explorer
answers) as one SQLite file. Any SQLite tool can open it; the tables are described in
`src-tauri/src/db.rs`.

**Restore…** replaces all of your data with a backup. Before that, the current data is
saved in the app's data folder as `before-restore-<time>.sqlite`, so a wrong restore can
be undone. Backups from newer versions of Tung Tung Chessahur are refused.
