# Health Game

Realtime browser game. Vanilla HTML/CSS/JS ES modules + Firebase Anonymous Auth +
Firebase Realtime Database. No build step, no game server.

The **Host** client is the only authoritative resolver: it advances phases, resolves
movement, checks answers, awards shields, eliminates players and publishes results.

## Firebase config

`js/firebase-config.js` is committed (project `healthgame-2b63b`) so GitHub Pages can serve
the game. A Firebase web config is not a secret; access is controlled by
`database.rules.json` and Authentication. To point at another project, replace its values
(see `js/firebase-config.example.js`).

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

**GitHub Pages** (no computer needed): repo Settings -> Pages -> Source "Deploy from a branch",
branch `main`, folder `/ (root)`. The site is then `https://memayo.github.io/health-game/`.
`.nojekyll` must stay: without it Pages drops the effect helpers named `_lib.js`.
If sign-in fails there, add `memayo.github.io` under Firebase Console -> Authentication ->
Settings -> Authorized domains.

**Firebase Hosting**:

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

Everyone answers the same question each round (see Rounds below); the Host screen shows it
too and reveals the answer during RESULT. Correct answers live only in `hostPrivate/`,
readable by the Host alone; a client receives only its own `questions/{uid}` card with
`id`, `text`, `choices`, `timeLimit` and `deadline`.

## Realtime Database layout

```
rooms/{CODE}/
  meta/        hostUid, createdAt                  (read: any auth, write: host)
  public/      phase, round, totalRounds, phaseResolved,
               moveStartedAt, moveDeadline, quizStartedAt,
               moveResults, lockedRoom, result,
               gameOver, closed                    (read: any auth, write: host)
  players/{uid} displayName, connected, alive       (read: any auth - NO role/position)
  positions/{uid} roomId                           (read: host + Players always;
                                                    Hunter only in quiz/result)
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

## Sessions, reconnect and roles

- Anonymous Auth uses **local** persistence: the uid is remembered on the device, so a
  player who refreshes, loses the network or closes the tab comes back as the same user.
  All tabs of one browser share that uid — to test several players on one computer use
  different browsers or private windows.
- Home remembers the last room (`localStorage` `hg.lastRoom`) and shows a **กลับเข้าห้อง**
  (rejoin) button while that room is still running and this uid is its Host or one of its
  players. Typing the same room code on Join also rejoins.
- Dropping out only flags it: players get `players/{uid}/connected = false`, the Host gets
  `public/hostOnline = false` (players see a "waiting for Host" banner). Nothing is deleted.
  An offline player is not waited for: the phase resolves without them (no move / wrong).
- A Host that comes back resumes from the database: questions (`hostPrivate/questions`),
  settings, timers and stats are reloaded, and a half-claimed phase is released.
- **Leave** removes the player; **Close Room** deletes the room. Players still offline in
  the lobby when the Host presses Start are left out of the match.
- No database rule changes were needed for any of this.

The Hunter sees no Player sprites during MOVE and must predict where Players go; once
movement has resolved the Hunter sees resolved positions for QUIZ and RESULT, then loses
them again at the next MOVE. This is enforced by the rules, not just the UI: the
`positions` read is denied to the Hunter while `public/phase` is `move`, so the client
attaches and detaches that listener as the phase changes. Move submissions, answers and
answer keys stay hidden from the Hunter at all times.

Roles do not exist until Start. On Start the Host picks exactly one Hunter at random
(`assignRandomRoles`) and writes roles to `roles/{uid}`, which each client can read only
for itself. The lobby never shows roles, and `public/result` carries no Hunter uid — the
Hunter emerges as an anonymous sprite.

## Match length

The Host picks a match length in the lobby (no limit, 5, 10, 15, 20, 30 minutes). With a
length, rounds keep coming (the question deck cycles) at normal timers until
`public/gameEndsAt` passes; the game then ends after the round that is playing (Players win
if any are alive). The HUD clock shows the time left. With no limit it is one pass of the
questions; the lobby shows an estimate (`fitMatchTiming`).

## Leaderboard

For every question the Host records, per participant (Hunter included), whether it was
correct and how long the answer took (`answer.at - quizStartedAt`; no answer = the full
time limit) in `hostPrivate/stats`. The game-over screen ranks by most correct answers, then
by the smaller total answer time (`rankLeaderboard`).

## Rounds, timers and questions

- **Game length**: with a match length the game runs until the clock ends it
  (`public/totalRounds` = 0); with "no limit" it is one pass of the questions
  (`getTotalRounds`: 13 questions -> 13 rounds).
- **Winner** (`decideWinner`, checked after each result): no Players alive -> HUNTER WINS;
  final round (or the clock) with a Player alive -> PLAYERS WIN.
- **MOVE** has one shared deadline (`MOVE_TIME_SECONDS`, default 12).
  No selection = no movement. The Hunter's target falls back to their hidden last
  room; the lock is never carried over and simply becomes `null`.
- **QUIZ**: one question for everyone, deadline from the sheet's `Time Limit (sec)`,
  falling back to `DEFAULT_QUIZ_TIME_SECONDS`. No answer before the deadline counts as wrong.
- **Shared cycling deck** (`newQuestionDeck` / `drawQuestion`, `hostPrivate/deck`):
  questions come in a random order without repeats; when all have been asked the deck is
  reshuffled and goes round again (never opening with the question that just closed it).
  The round's question id is `hostPrivate/currentQuestion`.
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

## Art and effects (pixelfx)

The look is a pixel-art dungeon drawn in code, no image files:

- `js/dungeonArt.js` paints the rooms (brick back wall, flagstones, moss, bones, the sewer
  grates the Hunter comes out of) and the corridors between adjacent rooms.
- `js/pixelStage.js` puts that on a canvas under the rooms, runs ambient loops (a candle per
  room) and plays one-shot effects on a second canvas above the characters. Everything shares
  one integer pixel scale, so the sprites are scaled to match the map.
- Effects come from [pixelfx](https://github.com/patch-gg/pixelfx) (MIT), vendored in
  `js/vendor/pixelfx/` (core + the categories used). Which effect plays where is set in
  `EFFECT_ASSETS` in `js/assetConfig.js`: grate smoke, claw marks, gold shield bubble, the
  eliminated Player's soul rising (built from the Player sprite itself).
- The Hunter is a live pixelfx creature (`critters/flying-skull`), set in
  `js/characterRenderer.js`.
- `js/pixelDecor.js` mounts decorative effects on plain pages: any element with
  `data-pixelfx="fire/torch"` becomes a live sprite (home and lobby torches, game-over confetti).

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
