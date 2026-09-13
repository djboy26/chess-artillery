/**
 * PostToolUse hook: after any edit to index.html, run a quick chess-rules fuzz
 * and hand the result straight back to the agent. Clean → a short note.
 * Violations → the agent is told to fix them before anything else.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
let input = {};
try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch {}
const ti = input.tool_input || {};
const fp = String(ti.file_path || ti.notebook_path || '');
if (!/index\.html$/i.test(fp)) process.exit(0);

const r = spawnSync(process.execPath, [path.join(ROOT, 'chesscheck.cjs'), '--games', '15'], { cwd: ROOT, encoding: 'utf8' });
const out = ((r.stdout || '') + (r.stderr || '')).trim();

if (r.status === 0) {
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse',
    additionalContext: 'Quick chess-rules fuzz after your edit: clean (15 games). Run "node gate.cjs" before you finish.' } }));
} else {
  console.log(JSON.stringify({ decision: 'block',
    reason: 'Quick chess-rules fuzz after your edit found RULE VIOLATIONS. Fix them before anything else:\n' + out.split('\n').slice(-14).join('\n') }));
}
process.exit(0);
