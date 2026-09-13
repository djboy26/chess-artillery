/**
 * Balance drift guard for CHESS ARTILLERY.
 *
 * Plays a FIXED, seeded set of bot games (the same bot as balance.cjs) and
 * compares the headline balance numbers to balance-baseline.json — the numbers
 * a human last approved. Same code ⇒ same games ⇒ same numbers, so any drift
 * is caused by a code change, never by luck.
 *
 *   node balance-guard.cjs               compare to the baseline (exit 1 on drift)
 *   node balance-guard.cjs --rebaseline  replace the baseline — balance tasks ONLY
 *   node balance-guard.cjs --games 200   more games (slower, steadier)
 */
const fs = require('fs');
const path = require('path');

const ARGS = process.argv.slice(2);
const flag = k => ARGS.includes(k);
const argOf = (k, d) => { const i = ARGS.indexOf(k); return i >= 0 && ARGS[i + 1] !== undefined ? ARGS[i + 1] : d; };
const GAMES = Number(argOf('--games', 120)) || 120;
const SEED = (Number(argOf('--seed', 20260913)) >>> 0) || 1;
const BASELINE = path.join(__dirname, 'balance-baseline.json');

// What counts as drift. Percentages are compared in absolute points; game
// length is compared relatively. Approved by the project owner; change only on request.
const TOLERANCE = { points: 8, pliesPct: 20 };

// Seeded PRNG (mulberry32) installed BEFORE the harness loads, so every
// Math.random() call in the bot and in the rules layer is reproducible.
let seedState = SEED;
Math.random = () => {
  seedState = (seedState + 0x6D2B79F5) | 0;
  let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const { run, TYPES, START_COUNT } = require('./balance.cjs');
const NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

function measure(n) {
  const a = run(n);
  const G = a.games;
  const pct = (x, y) => (y ? Math.round(1000 * x / y) / 10 : 0);
  const totalShots = TYPES.reduce((s, t) => s + a.shots[t], 0);
  const m = {
    games: G, seed: SEED,
    whiteWinPct: pct(a.winners.w, G),
    blackWinPct: pct(a.winners.b, G),
    drawPct: pct(a.winners.draw, G),
    avgPlies: Math.round(10 * a.plies / G) / 10,
    shotShare: {}, survival: {},
  };
  for (const t of TYPES) {
    m.shotShare[t] = pct(a.shots[t], totalShots);
    m.survival[t] = pct(a.alive[t], G * START_COUNT[t]);
  }
  return m;
}

function compare(base, cur) {
  const drifts = [];
  const pt = (label, b, c) => {
    const d = c - b;
    if (Math.abs(d) > TOLERANCE.points)
      drifts.push(`${label}: ${b}% → ${c}% (${d > 0 ? '+' : ''}${d.toFixed(1)} points, tolerance ±${TOLERANCE.points})`);
  };
  pt('white win rate', base.whiteWinPct, cur.whiteWinPct);
  pt('draw rate', base.drawPct, cur.drawPct);
  for (const t of TYPES) {
    pt(`${NAMES[t]} share of shots`, base.shotShare[t], cur.shotShare[t]);
    pt(`${NAMES[t]} survival`, base.survival[t], cur.survival[t]);
  }
  const rel = base.avgPlies ? 100 * (cur.avgPlies - base.avgPlies) / base.avgPlies : 0;
  if (Math.abs(rel) > TOLERANCE.pliesPct)
    drifts.push(`average game length: ${base.avgPlies} → ${cur.avgPlies} plies (${rel > 0 ? '+' : ''}${rel.toFixed(0)}%, tolerance ±${TOLERANCE.pliesPct}%)`);
  return drifts;
}

function table(base, cur) {
  const row = (label, b, c) => `  ${label.padEnd(22)} ${String(b).padStart(7)}   ${String(c).padStart(7)}`;
  const lines = [`  ${'metric'.padEnd(22)} ${'approved'.padStart(7)}   ${'now'.padStart(7)}`];
  lines.push(row('white win %', base.whiteWinPct, cur.whiteWinPct));
  lines.push(row('draw %', base.drawPct, cur.drawPct));
  lines.push(row('avg plies', base.avgPlies, cur.avgPlies));
  for (const t of TYPES) lines.push(row(`${NAMES[t]} shot share %`, base.shotShare[t], cur.shotShare[t]));
  for (const t of TYPES) lines.push(row(`${NAMES[t]} survival %`, base.survival[t], cur.survival[t]));
  return lines.join('\n');
}

const t0 = Date.now();
const cur = measure(GAMES);
const secs = ((Date.now() - t0) / 1000).toFixed(0);

if (flag('--rebaseline')) {
  const out = { approvedAt: new Date().toISOString(), tolerance: TOLERANCE, ...cur };
  fs.writeFileSync(BASELINE, JSON.stringify(out, null, 2) + '\n');
  console.log(`Balance baseline REPLACED (${GAMES} games, ${secs}s). These numbers are now the approved ones:`);
  console.log(table(cur, cur));
  console.log('\nCommit balance-baseline.json with the change that justified it.');
  process.exit(0);
}

if (!fs.existsSync(BASELINE)) {
  console.log('BALANCE GUARD: no baseline found. Run "node balance-guard.cjs --rebaseline" once to approve the current numbers.');
  process.exit(1);
}

const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
const notes = [];
if (base.games !== cur.games || base.seed !== cur.seed)
  notes.push(`note: baseline was ${base.games} games / seed ${base.seed}; this run is ${cur.games} / ${cur.seed}, so small differences are expected.`);

const drifts = compare(base, cur);
console.log(`BALANCE GUARD: ${GAMES} seeded games in ${secs}s (baseline approved ${base.approvedAt || 'unknown'})`);
console.log(table(base, cur));
for (const n of notes) console.log('  ' + n);
if (drifts.length) {
  console.log('\nBALANCE DRIFT — the game now plays differently from what was approved:');
  for (const d of drifts) console.log('  • ' + d);
  console.log('\nIf this task was NOT about balance, the change has a side effect: find and remove it.');
  console.log('If the task WAS about balance, run "node balance-guard.cjs --rebaseline" and commit the new baseline.');
  process.exit(1);
}
console.log('\nBalance within tolerance of the approved numbers.');
