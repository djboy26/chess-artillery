# CHESS ARTILLERY — rules for any agent working here

Read this before touching anything. The human who owns this project is not a
programmer. They decide what the game should be; you decide how to build it.
They judge your work by playing the game and by reading your summary.

## What this is

Chess where every piece carries a gun. Hot-seat, two humans, one screen.
The whole game is `index.html` (React 18 + three.js from a CDN, JSX transformed
in the browser). `node serve.js` serves it on http://localhost:5173. There is
no build step, no `npm install`, and no dependencies to add. Keep it that way.

## Promises that must never break

1. **Chess is chess.** Board, moves, check, mate, castling, en passant,
   promotion, draws: exactly standard chess. Weapons sit on top and never alter
   move legality.
2. **Damage never edits the rules.** Wounding is cosmetic. HP reaching 0 kills;
   nothing else about a piece changes with HP.
3. **Line pieces shoot only where they move.** Bishop, rook and pawn fire down
   their true chess lines. Knight and queen are the only free-aim weapons.
4. **The damage preview is the single source of truth.** What the aim HUD
   promises is exactly what lands. `shotPreview()` computes; `resolveShot`
   consumes it. Never recompute damage during resolution.
5. **Capture recoil is never lethal.** The capturer is left on at least 1 HP.
6. **One file, no build step.** Do not split `index.html`, add packages, or
   introduce a bundler.
7. **Balance numbers change only when the task asks for a balance change.**
   Every balance number lives in the exported `CONFIG` at the top of
   `index.html`. If your task is not about balance and the drift guard goes red,
   your change has a side effect: find it and remove it. Do not re-baseline.

## Map of index.html

Sections 1 to 8 (`BOARD HELPERS` through `TURN FLOW`) are the pure rules layer
with no DOM and no three.js. Sections 9 to 18 are rendering, cinematics, camera
and UI. The headless harnesses slice the rules layer out using two text
markers: `export const CONFIG` and `  9. PIECE GEOMETRY`. **Never rename or
move those markers, and never let DOM, React or three.js code creep above
section 9.** The checks would silently test the wrong thing or stop running.

## The checks (they are the definition of "done")

- `node chesscheck.cjs` runs the chess-rules fuzz: 120 random games, about
  20 seconds, exit code 1 on any violation. While iterating use the fast
  variant `node chesscheck.cjs --games 15`.
- `node balance-guard.cjs` plays 120 seeded bot games and compares the headline
  balance numbers to `balance-baseline.json`, the numbers the human last
  approved. Exit code 1 on drift. **Only on a task that is explicitly about
  balance**, run `node balance-guard.cjs --rebaseline` and commit the new
  baseline. The human approves the new numbers by merging.
- `node gate.cjs` runs both and prints one verdict line. **You are not finished
  until the gate is green.** The Stop hook enforces this locally, and a pull
  request with a red gate cannot be merged.
- `node balance.cjs 40` prints the readable balance report (measurement only).
  `node balance.cjs 30 "WEAPONS.p.maxRange=5"` sweeps a number without editing.

## How to work

- One task at a time, on its own branch. Make the smallest change that fully
  does the task. Do not refactor, rename or tidy beyond it.
- Reproduce a bug in `chesscheck.cjs` or a small node snippet before fixing it
  when you can. Add a permanent check when a bug reveals a missing invariant.
- If a balance task changes numbers, also update the numbers tables in
  `README.md` ("Where it landed" and the HP list) so the README stays true.
- Never delete work to make a check pass. If you cannot make the gate green,
  push what you have and say so plainly in the pull request.
- Do not edit `.claude/settings.json`, the hook scripts, `gate.cjs`,
  `chesscheck.cjs` or `balance-guard.cjs` to make them pass. Changing the
  checks is a separate task the human has to ask for.

## Your summary (pull request description or final message)

Write it for a non-programmer. Use these headings, in this order:

- **Asked**: the task in one sentence.
- **Changed**: what is different in the game, in plain language. No file
  paths, no function names.
- **Checks**: the gate verdict line, copied exactly.
- **Balance**: "unchanged (guard green)", or a before and after table of the
  numbers that moved and why that was intended.
- **Undo**: "Close this pull request and nothing changes." If already merged,
  the exact revert command.
- **Needs a human**: only if something is unresolved. Say what.
