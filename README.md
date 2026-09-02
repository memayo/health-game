# Health Game

Realtime browser game. Vanilla HTML/CSS/JS ES modules + Firebase Anonymous Auth +
Firebase Realtime Database. No build step, no game server.

The **Host** client is the only authoritative resolver: it advances phases, resolves
movement, checks answers, awards shields, eliminates players and publishes results.

## Firebase config

1. Create a Firebase project with **Anonymous Authentication** and a **Realtime Database**.
2. Copy `js/firebase-config.example.js` to `js/firebase-config.js`.
3. Paste your own values (`apiKey`, `authDomain`, `databaseURL`, `projectId`, ...).

`js/firebase-config.js` is gitignored and is never committed.

## Run locally

There is **no `package.json` and no build step** — this is plain HTML/CSS/ES modules.
`npm run` / `npm install` do not apply. Firebase and SheetJS are loaded from a CDN at
runtime, so there is nothing to install.

You only need any static file server, because ES modules require `http://`, not `file://`.

```bash
python -m http.server 8000
```

Open `http://localhost:8000/index.html`.

### Testing from phones on the same Wi-Fi

Bind to all interfaces instead:

```bash
python -m http.server 8000 --bind 0.0.0.0
```

Find the PC's local IPv4 address:

```bash
ipconfig
```

Look for `IPv4 Address` under your Wi-Fi adapter, e.g. `192.168.1.25`. Other devices on
the same Wi-Fi then open `http://192.168.1.25:8000`.

Windows Firewall may ask to allow Python the first time — allow it on **Private**
networks. No URL is hard-coded in the app, so it works the same from `localhost`,
a `192.168.x.x` address, or Firebase Hosting.

Alternatives:

- **VS Code Live Server** — right-click `index.html` -> "Open with Live Server".
- **`npx serve .`** — then open `http://localhost:3000`.
- **`firebase serve`** — only if the Firebase CLI is installed (`npm i -g firebase-tools`).

Open three tabs/browsers: one Host, two Players.

## Deploy

```bash
firebase deploy
```

`firebase.json` serves the repository root as Hosting and deploys
`database.rules.json` as the Realtime Database rules.

## Question .xlsx format

The Host imports an `.xlsx` file. Only the **first worksheet** is read. Two layouts are
supported and detected automatically — no manual conversion needed.

### 1. Blooket Import Template (recommended)

Export or fill in the standard Blooket template and import it as-is.

| Question # | Question Text | Answer 1 | Answer 2 | Answer 3 (Optional) | Answer 4 (Optional) | Time Limit (sec) | Correct Answer(s) |
|---|---|---|---|---|---|---|---|
| 1 | ... | ... | ... | ... | ... | 20 | 4 |

- **The header row is found automatically.** A decorative title above it
  (e.g. `Blooket Import Template`) is ignored; the first 25 rows are scanned for
  `Question Text` plus at least two `Answer N` columns.
- Header matching trims whitespace, ignores case, and tolerates line breaks and
  trailing notes, so `Answer 3`, `Answer 3\n(Optional)` and
  `Correct Answer(s)\n(Only include Answer #)` all match.
- **`Correct Answer(s)` uses answer NUMBERS, not letters**: `1` = Answer 1 … `4` = Answer 4.
  Accepts a number (`4`), text (`"4"`, `"4.0"`), or several (`"1, 3"` / `"1,3"`).
  With several, **any** listed answer is accepted as correct.
- Answers 3 and 4 may be blank — 2 to 4 answers are supported and the quiz renders
  however many exist. If a middle answer is blank, `Correct Answer(s)` still refers to
  the original answer number.
- `Question #` is optional metadata. `Time Limit (sec)` drives that question's
  quiz countdown.

### 2. Simple layout

| question | A | B | C | D | correct |
|---|---|---|---|---|---|
| ... | ... | ... | ... | ... | A |

`correct` is `A`/`B`/`C`/`D` (case-insensitive).

### Validation

A row must have question text, at least 2 non-empty answers, and a correct answer that
points to a non-empty answer.

- Rows that are entirely blank — including template filler rows that only carry a
  `Question #` or `Time Limit` — are ignored silently and are **not** counted as skipped.
- Rows with real content that fail validation are skipped individually with a reason
  logged to the console. One bad row never fails the whole file.
- The Host shows a short summary (`13 questions`, plus `/ N skipped` when applicable).
  The console carries the detail: detected format, header row number, and each skip reason.

Each participant gets their own randomized sequence (see Rounds below). Correct answers
live only in `hostPrivate/`, readable by the Host alone; a client receives only its own
`questions/{uid}` card with `id`, `text`, `choices`, `timeLimit` and `deadline`.

## Realtime Database layout

```
rooms/{CODE}/
  meta/        hostUid, createdAt                  (read: any auth, write: host)
  public/      phase, round, totalRounds, phaseResolved,
               moveStartedAt, moveDeadline, quizStartedAt,
               moveResults, lockedRoom, result,
               gameOver, closed                    (read: any auth, write: host)
  players/{uid} displayName, connected, alive       (read: any auth - NO role/position)
  positions/{uid} roomId                           (read: host + normal Players ONLY)
  roles/{uid}  'player' | 'hunter'                 (read: owner + host, write: host)
  questions/{uid} id, text, choices, timeLimit,
               deadline                            (read: owner + host, write: host)
  actions/
    moves/{uid}   target                           (read: owner + host, write: owner)
    answers/{uid} choice                           (read: owner + host, write: owner)
    hunter/{uid}  target, lock                     (read: owner + host, write: hunter)
  hostPrivate/ questions[] (with answer keys),
               deck{master,offsets}, hunterRoom,
               hunterTarget, turn/{uid}{shield,
               movementSuccess}                     (host only)
```

Players write only their own action node, and only during the matching phase.
Hidden choices and correct answers are never in `public/`.

## Sessions and roles

State is live-only. There is no persistence, no reconnect and no saved match:

- Anonymous Auth uses **session** persistence — the uid lives in the tab and dies with it.
- A one-shot ticket carries the room code from Home to the game page. It is consumed on
  read, so a **refresh never rejoins**; the client is sent back to Home.
- A player leaving removes their own record; the Host leaving removes the whole room.
- No localStorage is used anywhere.

Roles do not exist until Start. On Start the Host picks exactly one Hunter at random
(`assignRandomRoles`) and writes roles to `roles/{uid}`, which each client can read only
for itself. The lobby never shows roles, and `public/result` carries no Hunter uid — the
Hunter emerges as an anonymous sprite.

## Rounds, timers and questions

- **Game length = number of imported questions** (`getTotalRounds`). 13 questions -> 13 rounds.
- **Winner** (`decideWinner`, checked after each result): no Players alive -> HUNTER WINS;
  final round finished with a Player alive -> PLAYERS WIN.
- **MOVE** has one shared deadline (`MOVE_TIME_SECONDS`, default 12).
  No selection = no movement. The Hunter's target falls back to their hidden last
  room; the lock is never carried over and simply becomes `null`.
- **QUIZ** is per participant: each gets their own question and their own deadline
  from the sheet's `Time Limit (sec)`, falling back to `DEFAULT_QUIZ_TIME_SECONDS`.
  No answer before the deadline counts as wrong.
- **Individual decks**: one shared random permutation plus a distinct random offset
  per participant (`assignQuestionDecks`). Nobody repeats a question, and while
  participants <= questions nobody shares a question in the same round.
- **Deadlines are authoritative.** The Host stores them in game state and stamps every
  submission with `serverTimestamp()`; a submission written after its deadline is
  ignored. Client countdowns are display only.

## Phases

`move` -> `quiz` -> `result` -> `move` ... -> `ended`

- **move** — Host sees the map but none of the choices. Players pick one orthogonally adjacent room.
  The Hunter picks any room as `target` and any room as `lock` (they may be the same).
- **quiz** — Movement is resolved and animated; the locked room is shown red on the Host
  map. Everyone answers the same question.
- **result** — Host camera focuses the Hunter target room. If the Hunter answered
  correctly the Hunter emerges from that room's pipe, waits exactly 1 s, then attacks.

Shield (this turn only): successful move **and** correct answer.
Attack: players in the target room survive with a shield, otherwise they are eliminated.

## Assets

`js/assetConfig.js` holds every asset hook. **Each animation names its own sheet**,
row and frame count, so idle and walk can live in separate files:

```js
idle_down: { sheet: 'assets/characters/16x32 Idle-Sheet.png', row: 0, frames: 4 }
walk_down: { sheet: 'assets/characters/16x32 Walk-Sheet.png', row: 0, frames: 4 }
```

An animation with `sheet: null` falls back to the CSS pixel placeholder, so characters
can be converted one at a time (the Hunter is still a placeholder). `frameWidth` /
`frameHeight` are the **cell pitch**, not the drawn art size. `background-size` is derived
from the image's natural dimensions x `scale`, so any grid works without extra config.

Current Player sheets are 128x160 = a 4 x 5 grid of 32x32 cells, with the 16x32 character
centred in each cell and its feet on the cell's bottom edge. Rows: 0 down, 1 right,
2 left, 3 unused, 4 up. Filenames containing spaces are URL-encoded automatically.

Animation states: `idle_down/up/left/right`, `walk_down/up/left/right`.

`EFFECT_ASSETS.playerElimination` layers square PNGs for the elimination burst. Per
sprite: `src`, `size` (rendered square px), `rotate`, `offset` (fractions of `size`, to
recentre art that is off-centre inside its own canvas) and `delay`. Sources are drawn
square-to-square so they are never stretched. Duration is `TIMING.eliminateDuration`.

## Tuning

All timings and tunables are in `js/gameConfig.js`
(movement duration, sprite FPS, camera, blackout, result delay,
and the required 1000 ms Hunter emerge wait).

## Rules that are intentionally isolated

- `assignStartingRooms()` in `js/gameState.js` — spawn allocation.
- `assignRandomRoles()` / `selectRandomHunter()` — exactly one random Hunter on Start.
- `assignRandomStartingRooms()` — random spawn per Player; rooms may collide.
- `assignQuestionDecks()` / `questionIdFor()` — per-participant question sequences.
- `getTotalRounds()` — game length; cap it here if ever needed.
- `decideWinner()` — the win condition.
- `shouldEndGame()` in `js/gameState.js` — only the unambiguous "no alive players" case.
