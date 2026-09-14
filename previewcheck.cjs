/* Damage-preview fuzz: the aim HUD must promise exactly what the shot lands.
   Promise 4 in CLAUDE.md — shotPreview() computes, resolveShot consumes. */
const fs=require('fs'), path=require('path');
// usage: node previewcheck.cjs [--games N] [--seed S]   · exit code 1 on any mismatch
const ARGS=process.argv.slice(2);
const argOf=(k,d)=>{const i=ARGS.indexOf(k); return i>=0&&ARGS[i+1]!==undefined?ARGS[i+1]:d;};
const GAMES=Number(argOf('--games',100))||100;
if (argOf('--seed',null)!==null) { let s=(Number(argOf('--seed'))>>>0)||1;
  Math.random=()=>{ s=(s+0x6D2B79F5)|0; let t=Math.imul(s^(s>>>15),1|s); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; }; }
const HTML=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
const START=HTML.indexOf('export const CONFIG'), END=HTML.indexOf('  9. PIECE GEOMETRY');
let src=HTML.slice(START,HTML.lastIndexOf('/*',END)).replace('export const CONFIG','const CONFIG');
const NAMES=['CONFIG','newGame','beginTurn','advanceTurn','legalMoves','applyMove','sqName',
 'targetOptions','shotPreview','resolveShot','canFire','weaponOf','worldOf','sqOfWorld'];
const CA=new Function(`${src}\n;return {${NAMES.join(',')}};`)();
const {newGame,beginTurn,advanceTurn,legalMoves,applyMove,sqName,
       targetOptions,shotPreview,resolveShot,canFire}=CA;
const boot=()=>{const st=newGame({captureDamage:true,friendlyFire:true,assistMode:false,sound:false,
  shotClock:false,autoFlip:true,checkShots:true}); beginTurn(st); return st;};

let games=0, shots=0, piecesCompared=0;
const bugs=[];
const record=(k,d)=>{ if(bugs.length<12) bugs.push(k+': '+JSON.stringify(d)); };

for (let gi=0; gi<GAMES; gi++) {
  const g=boot(); games++;
  for (let i=0;i<200 && !g.gameOver;i++) {
    const side=g.turn;
    if (!legalMoves(g,side).length) break;

    // ── the shot, fully audited ──────────────────────────────────────────
    const shooters=Object.values(g.pieces).filter(q=>canFire(g,q));
    if (shooters.length) {
      const q=shooters[(Math.random()*shooters.length)|0];
      const opts=targetOptions(g, q.id, Math.random()<0.5?'lob':'flat');
      if (opts.length) {
        const opt=opts[(Math.random()*opts.length)|0];

        // 1. what the HUD promises for this exact shot
        const promised=new Map();
        for (const h of shotPreview(g, q.id, opt.sim)) {
          const e=promised.get(h.id) || {dmg:0, lethal:false, notes:[]};
          e.dmg += h.dmg; e.lethal = e.lethal || h.lethal; e.notes.push(h.note||'direct');
          promised.set(h.id, e);
        }
        // 2. the board exactly as it was when the trigger was pulled
        const before=new Map();
        for (const id of Object.keys(g.pieces))
          before.set(id, {hp:g.pieces[id].hp, type:g.pieces[id].type,
                          color:g.pieces[id].color, sq:g.pieces[id].sq});

        // 3. fire
        const shooter={type:q.type, color:q.color, sq:q.sq};
        g.turnState.firedId=q.id;
        resolveShot(g, q.id, opt.sim);
        shots++;

        // 4. every piece on the board, promised against actual
        for (const [id,b] of before) {
          piecesCompared++;
          const after=g.pieces[id];
          const actualDmg = after ? b.hp-after.hp : b.hp;
          const actualDied = !after;
          const p = promised.get(id) || {dmg:0, lethal:false, notes:[]};
          // a promise beyond the target's remaining HP simply kills it
          const wantDmg = Math.min(p.dmg, b.hp);
          const wantDied = p.dmg >= b.hp && p.dmg > 0;
          const where={ game:gi, ply:g.ply,
            shooter:shooter.color+shooter.type+' '+sqName(shooter.sq),
            target:opt.sq!=null?sqName(opt.sq):'?',
            victim:b.color+b.type+' '+sqName(b.sq), notes:p.notes.join('+') };
          if (actualDmg !== wantDmg)
            record('damage-mismatch', {...where, promised:wantDmg, actual:actualDmg, hpBefore:b.hp});
          if (actualDied !== wantDied)
            record(actualDied?'unpromised-kill':'promised-kill-missing',
                   {...where, promised:p.dmg, hpBefore:b.hp});
          if (p.lethal && p.dmg>0 && !actualDied)
            record('lethal-flag-lied', {...where, promised:p.dmg, hpBefore:b.hp});
          if (actualDmg>0 && p.dmg===0)
            record('unpromised-damage', {...where, actual:actualDmg});
        }
        // 5. the preview may not promise damage to a piece that is not there
        for (const id of promised.keys())
          if (!before.has(id)) record('preview-hit-a-ghost', {game:gi, ply:g.ply, id});
      }
    }
    if (g.gameOver) break;

    const fresh=legalMoves(g,side);
    if (!fresh.length) break;
    applyMove(g, fresh[(Math.random()*fresh.length)|0], 'q');
    advanceTurn(g);
  }
}
console.log(`\ngames ${games} · shots audited ${shots} · piece outcomes compared ${piecesCompared}`);
console.log(bugs.length ? 'BUGS:\n  '+bugs.join('\n  ') : 'THE PREVIEW NEVER LIED');
if (bugs.length) process.exitCode=1;
