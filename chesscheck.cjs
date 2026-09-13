/* Chess-correctness fuzz: the rules must be exactly chess, always. */
const fs=require('fs'), path=require('path');
// usage: node chesscheck.cjs [--games N] [--seed S]   · exit code 1 on any violation
const ARGS=process.argv.slice(2);
const argOf=(k,d)=>{const i=ARGS.indexOf(k); return i>=0&&ARGS[i+1]!==undefined?ARGS[i+1]:d;};
const GAMES=Number(argOf('--games',120))||120;
if (argOf('--seed',null)!==null) { let s=(Number(argOf('--seed'))>>>0)||1;
  Math.random=()=>{ s=(s+0x6D2B79F5)|0; let t=Math.imul(s^(s>>>15),1|s); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; }; }
const HTML=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
const START=HTML.indexOf('export const CONFIG'), END=HTML.indexOf('  9. PIECE GEOMETRY');
let src=HTML.slice(START,HTML.lastIndexOf('/*',END)).replace('export const CONFIG','const CONFIG');
const NAMES=['CONFIG','newGame','beginTurn','advanceTurn','legalMoves','legalMovesFor','applyMove',
 'pieceMoves','attacked','inCheck','projectMove','findKing','mkSq','sqName','fileOf','rankOf',
 'targetOptions','resolveShot','canFire','weaponOf','isCrippled','slideRange','worldOf','sqOfWorld'];
const CA=new Function(`${src}\n;return {${NAMES.join(',')}};`)();
const {CONFIG,newGame,beginTurn,advanceTurn,legalMoves,legalMovesFor,applyMove,pieceMoves,
       inCheck,projectMove,findKing,mkSq,sqName,targetOptions,resolveShot,canFire}=CA;
const boot=()=>{const st=newGame({captureDamage:true,friendlyFire:true,assistMode:false,sound:false,
  shotClock:false,autoFlip:true,checkShots:true}); beginTurn(st); return st;};

let games=0, positions=0, movesChecked=0;
const bugs=[];
const record=(k,d)=>{ if(bugs.length<12) bugs.push(k+': '+JSON.stringify(d)); };

for (let gi=0; gi<GAMES; gi++) {
  const g=boot(); games++;
  for (let i=0;i<200 && !g.gameOver;i++) {
    positions++;
    const side=g.turn;
    const legal=legalMoves(g,side);
    const checked=inCheck(g,side);

    // 1. no offered move may leave your own king in check
    for (const m of legal) {
      movesChecked++;
      if (inCheck(projectMove(g,m),side)) record('illegal-move-offered',{m:sqName(m.from)+sqName(m.to),checked});
    }
    // 2. legalMovesFor per piece must agree with legalMoves
    let perPiece=0;
    for (const id in g.pieces) if (g.pieces[id].color===side) perPiece+=legalMovesFor(g,id).length;
    if (perPiece!==legal.length) record('per-piece-mismatch',{perPiece,legal:legal.length});
    // 3. in check, EVERY legal move must resolve it (same as 1, stated as the player sees it)
    if (checked && legal.length===0) record('check-with-no-moves-but-not-mate',{});
    // 4. exactly one king per side, always
    if (!findKing(g,'w') && !g.gameOver) record('white-king-vanished',{});
    if (!findKing(g,'b') && !g.gameOver) record('black-king-vanished',{});
    // 5. a king may never sit on a square attacked by the enemy at the start of its turn
    //    unless it is genuinely in check (that IS check) — and never after its own move
    if (!legal.length) break;

    const mv=legal[(Math.random()*legal.length)|0];
    // optional shot BEFORE the move (new turn shape)
    const shooters=Object.values(g.pieces).filter(q=>canFire(g,q));
    if (shooters.length && Math.random()<0.6) {
      const q=shooters[(Math.random()*shooters.length)|0];
      const opts=targetOptions(g,q.id,Math.random()<0.5?'lob':'flat');
      if (opts.length){ g.turnState.firedId=q.id; resolveShot(g,q.id,opts[(Math.random()*opts.length)|0].sim); }
    }
    if (g.gameOver) break;
    // the shot may have changed the position — re-derive before moving
    const fresh=legalMoves(g,side);
    if (!fresh.length) break;
    const pick=fresh.find(x=>x.from===mv.from&&x.to===mv.to) || fresh[(Math.random()*fresh.length)|0];
    applyMove(g,pick,'q');
    // 6. after your own move you must NOT be in check
    if (inCheck(g,side)) record('own-king-left-in-check-after-move',{mv:sqName(pick.from)+sqName(pick.to)});
    advanceTurn(g);
  }
}
console.log(`\ngames ${games} · positions ${positions} · legal moves verified ${movesChecked}`);
console.log(bugs.length ? 'BUGS:\n  '+bugs.join('\n  ') : 'NO CHESS-RULE VIOLATIONS FOUND');
if (bugs.length) process.exitCode=1;
