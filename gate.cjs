/**
 * THE GATE — one command, one verdict.
 *
 * Runs the chess-rules fuzz and the balance drift guard. Green means safe to
 * ship. Red means do not ship, and the output above the verdict says why.
 *
 *   node gate.cjs           skips the run if nothing relevant changed since the last green
 *   node gate.cjs --force   always run
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = __dirname;
const INPUTS = ['index.html', 'chesscheck.cjs', 'balance.cjs', 'balance-guard.cjs', 'balance-baseline.json', 'gate.cjs'];
const STAMP = path.join(ROOT, '.claude', 'gate-pass');
const force = process.argv.includes('--force');

const fingerprint = () => {
  const h = crypto.createHash('sha256');
  for (const f of INPUTS) {
    const p = path.join(ROOT, f);
    h.update(f);
    h.update(fs.existsSync(p) ? fs.readFileSync(p) : '<missing>');
  }
  return h.digest('hex');
};

const FP = fingerprint();
let stamp = null;
try { stamp = fs.readFileSync(STAMP, 'utf8').trim(); } catch {}
if (!force && stamp === FP) {
  console.log('GATE: green — nothing relevant has changed since the last green run.');
  process.exit(0);
}

const STEPS = [
  ['Chess rules fuzz', 'chesscheck.cjs'],
  ['Balance drift guard', 'balance-guard.cjs'],
];
const t0 = Date.now();
const failed = [];
for (const [label, script] of STEPS) {
  console.log(`\n── ${label} ──`);
  const r = spawnSync(process.execPath, [path.join(ROOT, script)], { cwd: ROOT, encoding: 'utf8' });
  process.stdout.write(r.stdout || '');
  process.stderr.write(r.stderr || '');
  if (r.status !== 0) failed.push(label);
}
const secs = ((Date.now() - t0) / 1000).toFixed(0);

if (failed.length) {
  try { fs.unlinkSync(STAMP); } catch {}
  console.log(`\nGATE: RED — ${failed.join(' and ')} failed (${secs}s). Do not ship. Fix the cause shown above, then run the gate again.`);
  process.exit(1);
}
fs.mkdirSync(path.dirname(STAMP), { recursive: true });
fs.writeFileSync(STAMP, FP);
console.log(`\nGATE: green — chess rules hold and balance is within tolerance (${secs}s).`);
