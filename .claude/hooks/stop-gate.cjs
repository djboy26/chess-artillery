/**
 * Stop hook: an agent may not finish a session in this project while the gate
 * is red. Exit 2 blocks the stop and hands the gate output back to the agent.
 * After MAX_BLOCKS consecutive red stops the session is allowed to end, loudly,
 * so a human can look — this prevents an endless loop.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const COUNT = path.join(ROOT, '.claude', 'stop-count');
const MAX_BLOCKS = 3;

try { JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch {}

const r = spawnSync(process.execPath, [path.join(ROOT, 'gate.cjs')], { cwd: ROOT, encoding: 'utf8' });
const out = ((r.stdout || '') + (r.stderr || '')).trim();

if (r.status === 0) {
  try { fs.unlinkSync(COUNT); } catch {}
  process.exit(0);
}

let n = 0;
try { n = Number(fs.readFileSync(COUNT, 'utf8')) || 0; } catch {}
n += 1;
try { fs.writeFileSync(COUNT, String(n)); } catch {}

const tail = out.split('\n').slice(-25).join('\n');
if (n > MAX_BLOCKS) {
  try { fs.unlinkSync(COUNT); } catch {}
  console.error(`GATE STILL RED after ${MAX_BLOCKS} attempts. Letting the session end so a human can look. Do not ship or merge this state.\n\n${tail}`);
  process.exit(0);
}
console.error(`The gate is RED (attempt ${n} of ${MAX_BLOCKS}). You may not finish until it is green. Fix the cause below, then run: node gate.cjs\n\n${tail}`);
process.exit(2);
