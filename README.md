# CHESS ARTILLERY

## Running the factory

This game is maintained by a *dark factory*: you write tasks in plain language,
a cloud agent does them while you are away, and nothing ships until you click
**Merge**. You never need to read code.

**1. Give it a task.** Open a new issue at
<https://github.com/djboy26/chess-artillery/issues/new>, describe what you want
the way you would to a colleague, and add the label **factory**. Add the label
**balance** as well only if the task is allowed to change how strong things are.
Only you can add labels, so nobody else can feed the factory.

**2. Wait.** A shift runs every three hours from
<https://claude.ai/code/routines/trig_01EnknRv4HB35z76VhYtnxXC> (press *Run now*
there to skip the wait). It takes the oldest open factory issue, does it, runs
the gate, and opens a pull request written for you under the headings Asked,
Changed, Checks, Balance and Undo.

**3. Decide.** Open <https://github.com/djboy26/chess-artillery/pulls>. A green
check means the gate passed. Read the summary, then press **Merge** to ship it
or **Close** to throw it away. A red gate cannot be merged, by anyone. To play a
pull request before deciding, ask Claude Code on this PC to *check out pull
request #N and start the game*, then open <http://localhost:5173>.

**If it got stuck**, the pull request title starts with *NEEDS A HUMAN* and the
summary says what is blocking. Reply on the issue with clarification; the next
shift reads comments before it starts.

**What green means.** The gate plays 120 random games and checks every position
for chess-rule violations, then plays 120 fixed bot games and compares the
balance numbers to the approved snapshot in `balance-baseline.json`. Anything
outside tolerance is red. Run it yourself with `node gate.cjs`.

**Changing the factory itself** (the rulebook in `CLAUDE.md`, the checks, the
tolerances, the schedule) is not a factory task. Ask Claude Code on this PC.

---

Chess where every piece is armed — and every weapon is a real chess principle
turned into a gun. Play good chess and you literally shoot harder. Hot-seat, two
humans, one screen, one file.

React 18 + three.js + react-three-fiber, loaded as ES modules from a CDN and
JSX-transformed in the browser. **The whole game is `index.html`.**

```bash
node serve.js
```

Then open <http://localhost:5173>. ES module imports are blocked over `file://`,
so it has to be served; any static server works. No build step, no `npm install`.

---

## Chess is chess. Everything else sits on top.

A bug report exposed a rule that was quietly corrupting the game: **wounded
sliding pieces had their move range halved, and that same range fed attack
detection.** A wounded rook on e1 therefore stopped giving check to a king on e8.
The board looked like check, the engine disagreed, and every other piece was free
to wander off. Reproduced at will:

```
healthy rook e1 → inCheck(black)=true   knight b8 legal moves: []
WOUNDED rook e1 → inCheck(black)=false  knight b8 legal moves: [d7 c6 a6]
```

**Wounding is now purely cosmetic** — a marker on the health bar and nothing more.
Damage kills pieces; it never edits the rules.

**A line piece now shoots exactly where it moves.** The aiming cone used to let a
bishop on c1 target 32 squares of which only **7** were on its real diagonals — so
it could snipe a knight it was not aligned with. Clearing that square opens no
line, so there is correctly no check, but on screen it looks exactly like there
should be. Bishop, rook and pawn guns are now locked to their true chess lines
(`lineLocked`), so *clear the line and it IS check*. The knight (a mortar that
lobs) and queen (artillery) keep free aim — they are not line pieces, so they
promise nothing.

A third, subtler hole came from the projectile layer: capture recoil could kill
the capturing piece. Move legality is judged on the position *after* the move, so
a piece that captured **along its own pin line** and then died to recoil vanished
and exposed its king — a move the engine had already certified legal. Capture
recoil can now never be lethal; it leaves the capturer on 1 HP at worst.

Both are verified by `chesscheck.cjs`, which fuzzes the rules:

```bash
node chesscheck.cjs
```

> 120 games · 18,915 positions · **529,881 legal moves verified** · no violations

It asserts, at every position: no offered move leaves your own king in check,
per-piece and whole-side move generation agree, and you are never in check
immediately after your own move.

`previewcheck.cjs` guards the other half of the promise: that the aim HUD never
lies. It plays random games and fires a random shot on nearly every turn. Before
each shot it writes down exactly what the preview promised — which pieces get
hit, for how much, and which of them die — then fires and compares that against
what happened to every piece on the board, splash and friendly fire included. Any
mismatch prints the game, ply, shooter, target square and the promised-versus-
actual numbers, and the run exits red. Run it with `node previewcheck.cjs`; it
takes the same `--games N` and `--seed S` switches as the rules fuzz, and 100
games take about twelve seconds.

> 100 games · 13,637 shots audited · **232,556 piece outcomes compared** · no mismatches

---

## The turn — there is no "end turn"

**Fire (optional), then move. Your move ends your turn.** Nothing to remember, no
button to forget. The piece that fires cannot be the piece that moves.

---

## The eight rules

1. **Normal chess.** Normal board, normal moves, normal draws.
2. Each turn: **optionally one shot** from a loaded piece, **then one legal move**,
   which ends your turn. One shot per turn for your whole army.
3. **Guns are cold until both sides have made 5 moves.** The opening is pure chess.
4. Firing puts that piece on **cooldown** for a few turns. That is the entire
   limit — no charging, no activation, no ammo.
5. HP: pawn 40, knight 70, bishop 80, rook 120, queen 180, king 150. Below half HP
   a piece shows as **wounded** — a warning light only. Movement never changes.
6. **Capturing kills instantly**, but the capturer takes the victim's *remaining*
   HP as recoil, capped at half its own max — and never enough to kill it.
   Finishing wounded pieces is cheap; taking healthy ones hurts.
7. **Check is a free shot** (see below).
8. Win by checkmate, or by draining the king to 0 HP.

---

## Perpetual check — the fix

Check is no longer a separate damage system with its own numbers. **Every piece
giving check automatically fires its own weapon at the king, for its own damage,
and goes on its own cooldown.** A checking piece that is still reloading deals
zero.

That makes perpetual check fix itself, with no special-case rule. Measured:

```
king HP under continuous check from one rook:  65 → 65 → 65 → …
full perpetual (queen oscillating):  threefold repetition after 13 plies,
                                     with the checked king still healthy
```

Discovered check fires **two** guns at once, because two pieces are checking —
real chess tactics map straight onto damage.

### `CHECK_SHOT_MULT` was set from measurement, not guesswork

You predicted check-as-a-shot might be too strong. It was. Turns of
*uninterrupted* checking needed to kill the king (measured when it had 100 HP;
it now has 150, so every figure below is a floor):

| Checker | ×1.0 | ×0.5 |
| --- | --- | --- |
| Rook on an open file (70/hit) | **4** | 7 |
| Queen (45/hit) | 9 | 17 |
| Bishop (25/hit) | 7 | 15 |

Four turns is a kill button. `CHECK_SHOT_MULT` ships at **0.5**. The open-file
rook is still the outlier at 7 — worth watching, but a genuine perpetual draws by
repetition before it gets there.

---

## Weapons — chess principles as guns

Hover any piece for a **live damage breakdown** (`Base 35 · Blocked file ×0.5 ·
Damage 18`). Six conditional multipliers are invisible math without it, so the
panel is not optional decoration.

**♗ Bishop · Sniper.** Instant hitscan beam, unlimited range, pierces everything
in line, and **fires only down its true diagonals**. **Locked to its colour complex.** ×2 from a fianchetto (b2/g2/b7/g7),
+25% while you hold the bishop pair — stacked positive bonuses cap at ×2. Each
further body in the beam takes 60% of the last. 25 base, cd 2.

> The colour lock is far less punishing than it sounds, and the reason is elegant:
> **a diagonal is monochrome.** A bishop firing down its own diagonal always hits
> its own colour, so its core shot never fails. The lock only denies the
> off-diagonal *spread* shots inside its aiming cone. Your "light bishop becomes a
> paperweight" scenario needs the enemy to avoid its diagonals entirely — at which
> point they have also stopped attacking it. Set `BONUS.BISHOP_OFF_COLOUR` to
> `0.35` if you still want it to be a penalty rather than immunity.

**♘ Knight · Fork Gun.** The only weapon with **free aim** — it lobs, so cover is irrelevant and it can fire anywhere in range. That freedom is why it carries the longest reload. The shell
**splits and hits the two nearest enemies** within 1.5 squares of impact. ×2 on an
outpost (opponent's 5th/6th rank), ×0.5 on the a- or h-file; second prong at 50%.
**Cannot fire inside 2.2 squares** — close it down and its gun is dead. 18 base, cd 4.

**♖ Rook · Railgun.** Flat, fast, stopped by the first thing in the way, and
**fires only along its true rank and file**. Damage is
driven by **the line it fires down** (rank or file, whichever the shot follows):
blocked ×0.75, half-open ×1, **open ×2**. +50% on the 7th. **Battery:** two rooks
doubled on a line fire as one combined shot, and both go on cooldown. Its lines are
usually congested, so it fires rarely — but ~42 damage when a file finally opens.
35 base, cd 1.

**♕ Queen · Artillery.** 45 + 20 splash, range 6, lobbed. **Half damage before move
12.** Biggest hitbox on the board. cd 4.

**♙ Pawn · Chain Gun.** ×2 when defended by another pawn, +5 per rank past its own
4th. Its two true forward diagonals only, 3 squares each way, cd 1.

**♔ King · Last Stand.** Unarmed in the middlegame and **can never be shot** — only
checks hurt him. Arms once **both sides are down to 6 pieces**: 20 damage, range 2,
all directions, cd 2.

**En passant is an instant kill.** Ignores HP, zero recoil, obnoxious banner.

---

## Balance, measured by self-play

`balance.cjs` extracts the rules layer out of `index.html` and plays bot-vs-bot
games headlessly in Node — ~75ms a game, so any retune can be re-measured
immediately:

```bash
node balance.cjs 40
```

It reports shots/game, damage per shot, kills, survival rate, and — the most
useful column — **how often each piece even *has* a usable shot**. Config can be
swept without editing the game:

```bash
node balance.cjs 30 "WEAPONS.p.maxRange=5,HP.k=200"
```

### What self-play found, and what changed

| # | Measured problem | Fix |
| --- | --- | --- |
| 1 | Rook openness read its **file** even when firing along a rank | Grade the line actually fired down |
| 2 | Knight took 54% of all shots | cd 2→3, second prong at 50% |
| 3 | Fianchetto ×2 **and** pair ×1.25 stacked to 2.5× | Cap stacked *positive* bonuses at ×2 |
| 4 | Knight still 50% — its edge is *availability*, not damage | Minimum range 2.2: close it down and its gun is dead |
| 5 | Pawn ready 63×/game, able to shoot **17%** of the time | Range 3→4 (target rate → 42%) |
| 6 | King died to ~3 check shots ⇒ **zero checkmates, ever** | King HP 100→150 |
| 7 | A bishop one-shot a pawn, knight *or* bishop ⇒ total annihilation, 50% draws | **Double all piece HP** |
| 8 | Rook was the weakest gun: 6% of shots at 28 dmg | Blocked penalty 0.5→0.75, cd 3→2 |
| 9 | Bishop: top damage in the game, **0%** survival | Pierce falloff 0.6 per body |

**The counterintuitive one is #7.** Doubling HP made games *shorter* (101 → 55
plies) and far more decisive (draws 50% → 7.5%), because material now survives to
form a real endgame instead of grinding down to bare kings that can only shuffle
and repeat.

### Where it landed

| Piece | Share of shots | Dmg/shot | Survival | Role |
| --- | --- | --- | --- | --- |
| ♘ Knight | 40% | 17.7 | 59% | The workhorse — cheap, always has a shot |
| ♗ Bishop | 32% | 43.9 | 3% | Glass cannon, top damage, dies for it |
| ♖ Rook | 10% | 28.0 | 14% | Punishes open lines |
| ♕ Queen | 9% | 57.7 | 25% | Rare, decisive |
| ♙ Pawn | 8% | 13.1 | 11% | Chip damage when better guns reload |

Games average ~55 plies, 7.5% draws, both win conditions live.

### Still open

- **The knight holds 40% of shots.** It deals the *least* per shot, so it reads as
  the machine gun rather than the best gun — but it is the most-used piece by a
  wide margin because it is the only weapon never blocked.
- **Bishop survival is 3%.** It is the top damage dealer and gets focused down for
  it. Arguably correct, still extreme.
- **White wins 62%.** Higher than chess's ~55%; partly first-move advantage
  (white also shoots first), partly a symmetric greedy bot.
- **Checkmate is still rare in bot games (~1 in 40).** My bot is 1-ply greedy and
  cannot see mate, so this number says more about the bot than the design. Real
  players should find far more.
- **The rook battery has never once fired in self-play.** Two rooks doubled with a
  clear line between them simply does not arise. It may be dead content.

### Balance numbers worth knowing

- **Rook battery on an open file: 140** — still the biggest number, but against
  180 HP queens and 120 HP rooks it is now a heavy blow rather than a one-shot.
  It costs both rooks their cooldown.
- Open-file rook alone: 70 against 120 HP pieces.
- Fianchettoed bishop with the pair: **50** on its colour (capped at ×2), 0 off it.
- HP is now `pawn 40 · knight 70 · bishop 80 · rook 120 · queen 180 · king 150`,
  which is what gives the two-to-three-shot kills the design was aiming for.

---

## Look & feel

**Five themes**, switchable live from the dropdown at the top-right and remembered
between sessions: **Ivory** (warm light, default), **Slate** (cool light), **Sage**
(green light), **Walnut** (dark wood), **Carbon** (dark technical). Each palette
drives the HTML chrome, the 3D materials *and* the scene lighting — the warm ground
bounce that flatters Ivory would muddy the dark sets, so every theme carries its own
light rig.

**Every piece visibly carries the gun it fires**, and the barrel swings to track your
locked target while aiming:

| Piece | What you see |
| --- | --- |
| ♙ Pawn | Twin-barrel chain gun with a magazine, canted to its firing diagonal |
| ♘ Knight | Stubby mortar tube on a bipod, canted up — it only ever lobs |
| ♗ Bishop | Long sniper rail with a glowing optic down the diagonal |
| ♖ Rook | Heavy railgun run through the tower, with bracing struts |
| ♕ Queen | Howitzer on a turret ring, barrel elevated |
| ♔ King | Nothing until he arms in the endgame, then a short last-stand piece |

Each muzzle glows in that weapon's tracer colour, so you can read the whole board's
armament at a glance. It is all cosmetic: `CONFIG.HEIGHT` and `PIECE_RADIUS` (the
collision model) are untouched, so ballistics and cover are exactly as measured.

---

## Playability pass — a senior review of the built game

Seven defects found by sitting down and playing it, all fixed:

| # | Defect | Fix |
| --- | --- | --- |
| 1 | **You could not see damage before firing** — the design is conditional bonuses, so hiding the number at the decision point was a design bug | Aim HUD lists every piece the shot will hit and for how much, with **KILL** flagged |
| 2 | **The board never flipped** — Black played upside-down all game | Auto-flip to whoever is on move (setting, default on) |
| 3 | **No undo** — one misclick committed a move forever | `U` / UNDO rewinds to the start of your turn |
| 4 | **20s shot clock always on** — punished thinking in a thinking game | Off by default, toggle in settings |
| 5 | **No turn-handoff moment** — easy to move for the wrong side | Brief "Black to move" toast on every handoff |
| 6 | Aim mode could open with no targets and no explanation | Reads "no shot from here" |
| 7 | The opening turn toast fired behind the rules card | Suppressed at ply 0 |

### The preview cannot lie

A damage preview that is wrong is worse than none, so `shotPreview()` is now the
**single source of truth**: `resolveShot` consumes it rather than recomputing.
That also fixed a real engine inconsistency — a shot used to recompute bonuses as
pieces died mid-resolution, so a beam's first kill could silently change what its
second hit did (losing the bishop-pair bonus, for instance). A shot is now one
instant, evaluated against the board as it was when you pulled the trigger.

Verified: **1,436 plies over 10 full games, 960 shots, 550 predicted hits, zero
mismatches** between what the HUD promised and what landed.

Undo takes one snapshot per turn, so you can take back your own move but never
rewind the opponent's.

---

## Aiming

**Click-to-target, no first-person view.** Press `F` and every square the weapon
can reach lights up: **filled dot** = the shot gets through, **hollow diamond** =
blocked, with the blocking piece ringed in red and named in the bar. Click to
lock, then Fire.

Blocked by your own piece? Switch to **LOB** (`Tab`) and watch the crosses turn
into dots. Knight always lobs; queen chooses; bishop pierces anyway; **rook and
pawn genuinely cannot** — that asymmetry is direct fire vs indirect fire.

> Your latest spec text said "camera moves behind that piece, mouse controls
> horizontal angle". That contradicted your previous instruction ("do not give the
> first person view... let the aiming happen by clicking"), and you confirmed
> click-to-aim wins. Free-aim also hid exactly the information — is this shot
> blocked? — that the new bonus system makes critical.

| Action | Input |
| --- | --- |
| Move | click a piece, then a marked square |
| Aim | `F`, then click a target square |
| Fire | `Space` or the FIRE button |
| Flat/lob | `Tab` |
| End turn | `Enter` · Cancel `Esc` · Mute `M` · Rules `?` |
| Orbit / zoom | right-drag / wheel |
| Theme | dropdown, top-right (remembered) |
| Undo your turn | **U** |

---

## Sound

Synthesised with WebAudio, so the game stays one file with no assets: light and
heavy cannon reports, a shell whistle on lobs, a bright zap for the bishop beam,
layered impact booms scaled to blast size, quiet UI ticks. Unlocks on START
(browsers require a gesture). Your spec's "no sound" line contradicted your
previous request for it; you confirmed keeping it.

---

## Cut in this pass

The charge system, "activated" pieces, per-type crippling (six effects → one),
the old capture-recoil formula, rubble, sudden death, stalemate bleed, the
separate check-damage system with its floor. Stalemate is a draw again. Draws are
chess draws: stalemate, threefold repetition, fifty-move rule.

---

## Bugs found and fixed while reviewing this build

- **`aimAt` crashed on the armed king.** It looked the weapon up without game
  state, so the endgame-only king weapon resolved to `null` and every target
  calculation threw. Game state is now threaded through every `weaponOf` call.
- **A wounded pawn still lost its double-step.** The "only sliders are affected"
  simplification hadn't been applied to pawn movement.
- **The check-shot log was misleading:** it printed `35 base · Open file ×2 = 35`
  because the ×0.5 check multiplier was applied but never itemised.
- **A shooter killed by its own splash lost its cooldown**, and could crash the
  rook-battery lookup against a piece no longer on the board.
- **The move list was missing from the UI entirely** — tracked in state, never
  rendered.

Verified after fixing: 16/16 rules regression, a 300-ply random soak with 73
shots and no throw, board/HP/cooldown invariants intact, and every previewed
shot matching what actually fires across all five weapons and both arcs.

---

## Not implemented

No AI, no netcode, no accounts, no menus. Desktop only (no touch, assumes ≥980px).
First load needs network access to esm.sh and unpkg; in-browser Babel is fine for
a single-file MVP but is not how you would ship this.

Every balance number is in the exported `CONFIG` at the top of `index.html`.
`window.CA` exposes the rules engine in the console for retuning.
