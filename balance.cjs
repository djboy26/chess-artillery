/**
 * Headless balance harness for CHESS ARTILLERY.
 *
 * Extracts the pure rules layer out of index.html (CONFIG through TURN FLOW —
 * everything before the three.js/React sections) and plays bot-vs-bot games in
 * Node. No browser, no WebGL, ~10ms a game, so balance can be re-measured after
 * every tuning change.
 *
 *   node balance.cjs [games]
 */
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// ── slice out the logic-only region ──────────────────────────────────────────
const START = HTML.indexOf('export const CONFIG');
const END = HTML.indexOf('  9. PIECE GEOMETRY');
if (START < 0 || END < 0) throw new Error('could not locate the rules region in index.html');
let src = HTML.slice(START, HTML.lastIndexOf('/*', END));
src = src.replace('export const CONFIG', 'const CONFIG');

const NAMES = ['CONFIG','newGame','beginTurn','advanceTurn','legalMoves','legalMovesFor','applyMove',
  'pieceMoves','attacked','inCheck','simulateShot','resolveShot','applyDamage','killPiece',
  'isCrippled','slideRange','sectorCenters','aimAt','canFire','canMovePiece','sqName','sqOfWorld',
  'worldOf','mkSq','fileOf','rankOf','buildSAN','weaponOf','findKing','positionKey','targetOptions',
  'damageProfile','gunsLive','kingArmed','fireCheckShots','batteryPartner','lineState','pawnIsChained',
  'relRank','squareTint','fullTurn','pieceCount','pickMove','pickShot'];

const CA = new Function(`${src}\n;return {${NAMES.join(',')}};`)();
const { CONFIG, boot0 } = CA;
const bootGame = () => {
  const st = CA.newGame({
    captureDamage: CONFIG.CAPTURE_DAMAGE_DEFAULT,
    friendlyFire: CONFIG.FRIENDLY_FIRE_DEFAULT,
    checkShots: CONFIG.CHECK_SHOTS_DEFAULT,
    shotClock: false, autoFlip: true,
    assistMode: false, sound: false,
  });
  CA.beginTurn(st);
  return st;
};

const { mkSq, fileOf, rankOf, worldOf, weaponOf, damageProfile, targetOptions,
        canFire, legalMoves, applyMove, advanceTurn, resolveShot, findKing, lineState } = CA;
// The bot itself lives in the game (section 8b), so the opponent a player faces
// and the one these numbers describe are the same code.
const { pickMove, pickShot } = CA;

const TYPES = ['p','n','b','r','q','k'];

function playGame(maxPlies = 220) {
  const g = bootGame();
  const st = { shots:{}, dmg:{}, kills:{}, lost:{}, alive:{}, ready:{}, withTarget:{}, withSquares:{},
               battery:0, checkShots:0, eligible:0, used:0, capRecoilDeaths:0, epKills:0 };
  for (const t of TYPES) { st.shots[t]=0; st.dmg[t]=0; st.kills[t]=0; st.lost[t]=0; st.alive[t]=0;
    st.ready[t]=0; st.withTarget[t]=0; st.withSquares[t]=0; }
  let plies = 0;
  while (!g.gameOver && plies < maxPlies) {
    const before = {}; for (const id in g.pieces) before[id] = g.pieces[id].type;
    // NEW TURN SHAPE: fire first (optional), then move — the move ends the turn.
    if (Object.values(g.pieces).some(q => canFire(g, q))) st.eligible++;
    // DIAGNOSTIC: how often does each piece type even HAVE a usable shot?
    for (const q of Object.values(g.pieces)) {
      if (!canFire(g, q)) continue;
      st.ready[q.type]++;
      const w = weaponOf(q, g);
      const arcs = w.arcBand === 'both' ? ['flat','lob'] : [w.arcBand === 'lob' ? 'lob' : 'flat'];
      let hasClear = false, hasAnyTarget = false;
      for (const arc of arcs) for (const o of targetOptions(g, q.id, arc)) {
        if (o.status === 'clear' || w.prongs > 0) {
          if (o.sim.hits.some(h => g.pieces[h.id] && g.pieces[h.id].color !== q.color)) hasClear = true;
          if (w.prongs > 0) {
            const R = CONFIG.BONUS.KNIGHT_PRONG_RADIUS;
            if (Object.values(g.pieces).some(z => z.color !== q.color && z.type !== 'k' &&
                (()=>{const [x,,zz]=worldOf(z.sq);
                      return Math.hypot(x-o.sim.impact.x, zz-o.sim.impact.z) <= R;})())) hasClear = true;
          }
        }
        hasAnyTarget = true;
      }
      if (hasClear) st.withTarget[q.type]++;
      if (hasAnyTarget) st.withSquares[q.type]++;
    }
    const shot = pickShot(g);
    if (shot) {
      const t = shot.p.type;
      const hp = {}; for (const id in g.pieces) hp[id] = g.pieces[id].hp;
      const n0 = Object.keys(g.pieces).length, L = g.log.length;
      g.turnState.firedId = shot.p.id;
      resolveShot(g, shot.p.id, shot.o.sim);
      st.shots[t]++; st.used++;
      let dealt = 0;
      for (const id in hp) { const c = g.pieces[id]; dealt += c ? hp[id]-c.hp : hp[id]; }
      st.dmg[t] += Math.max(0, dealt);
      st.kills[t] += n0 - Object.keys(g.pieces).length;
      if (g.log.slice(L).some(l => /Battery fired/.test(l.text))) st.battery++;
    }
    const mv = pickMove(g);
    if (mv) applyMove(g, mv, 'q');
    for (const id in before) if (!g.pieces[id]) st.lost[before[id]]++;
    const L2 = g.log.length;
    advanceTurn(g); plies++;
    st.checkShots += g.log.slice(L2).filter(l => /check shot →/.test(l.text)).length;
    st.epKills += g.log.slice(L2).filter(l => /EN PASSANT/.test(l.text)).length;
  }
  for (const id in g.pieces) st.alive[g.pieces[id].type]++;
  const wk = findKing(g,'w'), bk = findKing(g,'b');
  return { plies, over: g.gameOver ? g.gameOver.reason : 'timeout',
           winner: g.gameOver ? g.gameOver.winner : null,
           wkHp: wk ? wk.hp : 0, bkHp: bk ? bk.hp : 0, ...st };
}

function run(n) {
  const a = { games:0, plies:0, shots:{}, dmg:{}, kills:{}, lost:{}, alive:{},
              endings:{}, winners:{w:0,b:0,draw:0}, battery:0, checkShots:0,
              wkHp:0, bkHp:0, eligible:0, used:0, epKills:0 };
  for (const t of TYPES) { a.shots[t]=0; a.dmg[t]=0; a.kills[t]=0; a.lost[t]=0; a.alive[t]=0;
    a.ready=a.ready||{}; a.withTarget=a.withTarget||{}; a.ready[t]=0; a.withTarget[t]=0; }
  for (let i=0;i<n;i++) {
    const r = playGame();
    a.games++; a.plies += r.plies;
    for (const t of TYPES) { a.shots[t]+=r.shots[t]; a.dmg[t]+=r.dmg[t];
      a.kills[t]+=r.kills[t]; a.lost[t]+=r.lost[t]; a.alive[t]+=r.alive[t];
      a.ready[t]+=r.ready[t]; a.withTarget[t]+=r.withTarget[t]; }
    a.endings[r.over] = (a.endings[r.over]||0)+1;
    a.winners[r.winner||'draw']++;
    a.battery+=r.battery; a.checkShots+=r.checkShots; a.epKills+=r.epKills;
    a.wkHp+=r.wkHp; a.bkHp+=r.bkHp; a.eligible+=r.eligible; a.used+=r.used;
  }
  return a;
}

const START_COUNT = { p:16, n:4, b:4, r:4, q:2, k:2 };
// Exported so balance-guard.cjs can reuse the same bot and the same rules slice.
module.exports = { run, playGame, CONFIG, TYPES, START_COUNT, CA };

// ── command line: print the readable report ──────────────────────────────────
if (require.main === module) {
// ── optional CONFIG overrides so tuning can be swept without editing the game ──
// e.g.  node balance.cjs 30 "WEAPONS.p.sectorHalfDeg=42,WEAPONS.p.maxRange=4"
if (process.argv[3]) {
  for (const kv of process.argv[3].split(',')) {
    const [k, v] = kv.split('=');
    const parts = k.trim().split('.');
    let o = CONFIG;
    for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
    o[parts[parts.length-1]] = isNaN(Number(v)) ? v : Number(v);
  }
  console.log('overrides: ' + process.argv[3]);
}

const N = Number(process.argv[2]) || 40;
const t0 = Date.now();
const a = run(N);
const G = a.games;

console.log(`\nCHESS ARTILLERY — ${G} bot games, ${Date.now()-t0}ms\n`);
console.log(`avg length      ${(a.plies/G).toFixed(1)} plies`);
console.log(`shot use rate   ${(100*a.used/Math.max(1,a.eligible)).toFixed(0)}% of turns where a shot was available`);
console.log(`check shots     ${(a.checkShots/G).toFixed(1)}/game`);
console.log(`battery fired   ${(a.battery/G).toFixed(2)}/game`);
console.log(`en passant      ${(a.epKills/G).toFixed(2)}/game`);
console.log(`king HP at end  W ${(a.wkHp/G).toFixed(0)}  B ${(a.bkHp/G).toFixed(0)}`);
console.log(`\nendings:`);
for (const [k,v] of Object.entries(a.endings).sort((x,y)=>y[1]-x[1]))
  console.log(`  ${String(v).padStart(3)}  ${k}`);
console.log(`winners: W ${a.winners.w}  B ${a.winners.b}  draw ${a.winners.draw}`);

console.log(`\n piece  shots/g  share  dmg/shot  kills/g  survival`);
const totalShots = TYPES.reduce((s,t)=>s+a.shots[t],0);
for (const t of TYPES) {
  const sh = a.shots[t]/G;
  const share = totalShots ? 100*a.shots[t]/totalShots : 0;
  const dps = a.shots[t] ? a.dmg[t]/a.shots[t] : 0;
  const surv = 100*(a.alive[t]/G)/START_COUNT[t];
  console.log(` ${t}      ${sh.toFixed(2).padStart(6)}  ${share.toFixed(0).padStart(4)}%  `
    + `${dps.toFixed(1).padStart(8)}  ${(a.kills[t]/G).toFixed(2).padStart(7)}  ${surv.toFixed(0).padStart(6)}%`);
}
console.log(`
 piece   ready/g  had a live target  hit-rate when ready`);
for (const t of TYPES) {
  const rd = a.ready[t]/G, wt = a.withTarget[t]/G;
  const pct = rd ? 100*wt/rd : 0;
  console.log(` ${t}      ${rd.toFixed(1).padStart(7)}  ${wt.toFixed(1).padStart(17)}  ${pct.toFixed(0).padStart(18)}%`);
}
console.log('');
}
