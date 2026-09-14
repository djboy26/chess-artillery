/* Draw-rules check: stalemate, threefold repetition and the fifty-move rule
   must be exactly chess. Built like chesscheck.cjs — the rules layer is sliced
   out of index.html, no browser, no DOM. */
const fs=require('fs'), path=require('path');
// usage: node drawcheck.cjs [--games N] [--seed S]   · exit code 1 on any violation
const ARGS=process.argv.slice(2);
const argOf=(k,d)=>{const i=ARGS.indexOf(k); return i>=0&&ARGS[i+1]!==undefined?ARGS[i+1]:d;};
const GAMES=Number(argOf('--games',100))||100;
if (argOf('--seed',null)!==null) { let s=(Number(argOf('--seed'))>>>0)||1;
  Math.random=()=>{ s=(s+0x6D2B79F5)|0; let t=Math.imul(s^(s>>>15),1|s); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; }; }
const HTML=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
const START=HTML.indexOf('export const CONFIG'), END=HTML.indexOf('  9. PIECE GEOMETRY');
let src=HTML.slice(START,HTML.lastIndexOf('/*',END)).replace('export const CONFIG','const CONFIG');
const NAMES=['CONFIG','newGame','beginTurn','advanceTurn','legalMoves','applyMove','inCheck',
 'projectMove','findKing','mkSq','sqName','positionKey','targetOptions','resolveShot','canFire'];
const CA=new Function(`${src}\n;return {${NAMES.join(',')}};`)();
const {CONFIG,newGame,beginTurn,advanceTurn,legalMoves,applyMove,inCheck,mkSq,sqName,
       positionKey,targetOptions,resolveShot,canFire}=CA;

const SETTINGS={captureDamage:true,friendlyFire:true,assistMode:false,sound:false,
  shotClock:false,autoFlip:true,checkShots:true};
const boot=()=>{const st=newGame(SETTINGS); beginTurn(st); return st;};

const bugs=[];
const fail=(k,d)=>{ if(bugs.length<20) bugs.push(k+': '+JSON.stringify(d)); };
const ok=(cond,k,d)=>{ if(!cond) fail(k,d); };
const notes=[];

/* ── building a position by hand ─────────────────────────────────────────── */
const sqOf=n=>mkSq(n.charCodeAt(0)-97, Number(n[1])-1);
/** spec entries are ['e4','w','q']; extra fields (halfmove, ply, ep…) go in over. */
function position(spec, turn, over){
  const st=newGame(SETTINGS);
  st.board=new Array(64).fill(null); st.pieces={};
  let n=0;
  for (const [name,color,type] of spec){
    const id=color+type+(n++);
    st.pieces[id]={id,type,color,sq:sqOf(name),hp:CONFIG.HP[type],maxHp:CONFIG.HP[type],
      cooldown:0,hasMoved:true,promotedFrom:null};
    st.board[sqOf(name)]=id;
  }
  st.turn=turn; st.castling={wk:false,wq:false,bk:false,bq:false};
  Object.assign(st, over||{});
  return st;
}
/** find the legal move from → to for the side to move; null if it is not offered. */
const moveTo=(st,from,to)=>legalMoves(st,st.turn)
  .find(m=>sqName(m.from)===from && sqName(m.to)===to) || null;
/** play one ply and hand the turn over. */
function play(st,from,to,promote){
  const m=moveTo(st,from,to);
  if (!m) { fail('expected-move-not-offered',{from,to,turn:st.turn}); return false; }
  applyMove(st,m,promote||'q'); advanceTurn(st); return true;
}

/*═══════════════════════════════════════════════════════════════════════════
  A. THREEFOLD REPETITION — what counts as "the same position"
═══════════════════════════════════════════════════════════════════════════*/

// A position repeats only when the pieces, the side to move, the castling
// rights and the en passant possibility are ALL identical. Each of the four,
// on its own, must be enough to tell two positions apart.
{
  const base=()=>position([['e1','w','k'],['e8','b','k'],['a1','w','r'],['h8','b','r']],'w');

  const a=base(), b=base();
  ok(positionKey(a)===positionKey(b),'identical-positions-differ',{a:positionKey(a),b:positionKey(b)});

  // 1. the pieces
  const moved=base(); moved.board[sqOf('a1')]=null;
  moved.board[sqOf('a2')]=moved.pieces['wr2'].id; moved.pieces['wr2'].sq=sqOf('a2');
  ok(positionKey(moved)!==positionKey(a),'different-pieces-counted-as-same-position',{});

  // 2. the side to move
  const black=base(); black.turn='b';
  ok(positionKey(black)!==positionKey(a),'side-to-move-ignored-by-repetition',{});

  // 3. the castling rights — each of the four on its own
  for (const right of ['wk','wq','bk','bq']) {
    const c=base(); c.castling[right]=true;
    ok(positionKey(c)!==positionKey(a),'castling-right-ignored-by-repetition',{right});
  }

  // 4. the en passant possibility
  const ep=base(); ep.ep=sqOf('e3');
  ok(positionKey(ep)!==positionKey(a),'en-passant-ignored-by-repetition',{});
  const ep2=base(); ep2.ep=sqOf('d3');
  ok(positionKey(ep2)!==positionKey(ep),'different-en-passant-squares-counted-as-same',{});
}

// The draw must land on the THIRD sighting of a position, not the second.
// Knights out and back: the opening position returns after every four plies.
{
  const st=boot();
  const shuffle=[['b1','c3'],['b8','c6'],['c3','b1'],['c6','b8']];
  for (const [from,to] of shuffle) play(st,from,to);          // 2nd sighting
  ok(!st.gameOver,'repetition-draw-fired-on-the-second-sighting',{over:st.gameOver});
  for (const [from,to] of shuffle) { if (st.gameOver) break; play(st,from,to); }
  ok(st.gameOver && st.gameOver.reason==='threefold repetition' && st.gameOver.winner===null,
     'third-sighting-did-not-draw',{over:st.gameOver});
}

/*═══════════════════════════════════════════════════════════════════════════
  B. STALEMATE — no moves and no check is a draw, never a loss
═══════════════════════════════════════════════════════════════════════════*/
{
  // Black king a8, white queen c7: every flight square covered, a8 itself is not.
  const st=position([['a8','b','k'],['c7','w','q'],['e1','w','k']],'b');
  ok(legalMoves(st,'b').length===0 && !inCheck(st,'b'),'stalemate-setup-wrong',
     {moves:legalMoves(st,'b').length,check:inCheck(st,'b')});
  beginTurn(st);
  ok(st.gameOver && st.gameOver.reason==='stalemate' && st.gameOver.winner===null,
     'stalemate-not-a-draw',{over:st.gameOver});
}
{
  // The control: no moves WITH check is checkmate, and it is a loss.
  const st=position([['a8','b','k'],['h8','w','q'],['b6','w','k']],'b');
  beginTurn(st);
  ok(st.gameOver && st.gameOver.reason==='checkmate' && st.gameOver.winner==='w',
     'checkmate-not-a-win',{over:st.gameOver});
}

/*═══════════════════════════════════════════════════════════════════════════
  C. THE FIFTY-MOVE COUNTER — resets, and fires at the right moment
═══════════════════════════════════════════════════════════════════════════*/
const LIMIT=CONFIG.FIFTY_MOVE_PLIES;
{
  // a quiet move counts
  const st=position([['e1','w','k'],['e8','b','k'],['g1','w','n']],'w',{halfmove:7});
  play(st,'g1','f3');
  ok(st.halfmove===8,'quiet-move-did-not-advance-the-counter',{halfmove:st.halfmove});
}
{
  // a pawn move resets
  const st=position([['e1','w','k'],['e8','b','k'],['d2','w','p']],'w',{halfmove:40});
  play(st,'d2','d3');
  ok(st.halfmove===0,'pawn-move-did-not-reset-the-counter',{halfmove:st.halfmove});
}
{
  // a two-square pawn move resets
  const st=position([['e1','w','k'],['e8','b','k'],['d2','w','p']],'w',{halfmove:40});
  play(st,'d2','d4');
  ok(st.halfmove===0,'double-pawn-move-did-not-reset-the-counter',{halfmove:st.halfmove});
}
{
  // a capture resets, even when no pawn is involved
  const st=position([['e1','w','k'],['e8','b','k'],['a1','w','r'],['a7','b','r']],'w',{halfmove:40});
  play(st,'a1','a7');
  ok(st.halfmove===0,'capture-did-not-reset-the-counter',{halfmove:st.halfmove});
}
{
  // en passant is a capture and a pawn move
  const st=position([['e1','w','k'],['e8','b','k'],['e5','w','p'],['d7','b','p']],'b',{halfmove:40});
  play(st,'d7','d5');
  ok(st.halfmove===0,'black-pawn-move-did-not-reset-the-counter',{halfmove:st.halfmove});
  st.halfmove=40;
  play(st,'e5','d6');
  ok(st.halfmove===0,'en-passant-did-not-reset-the-counter',{halfmove:st.halfmove});
}
{
  // promotion resets
  const st=position([['e1','w','k'],['e8','b','k'],['b7','w','p']],'w',{halfmove:40});
  play(st,'b7','b8','q');
  ok(st.halfmove===0,'promotion-did-not-reset-the-counter',{halfmove:st.halfmove});
}
{
  // castling is a quiet king move — it must NOT reset the counter
  const st=position([['e1','w','k'],['h1','w','r'],['e8','b','k']],'w',{halfmove:40});
  st.castling.wk=true; st.pieces['wk0'].hasMoved=false; st.pieces['wr1'].hasMoved=false;
  play(st,'e1','g1');
  ok(st.halfmove===41,'castling-reset-the-counter',{halfmove:st.halfmove});
}
{
  // the draw fires exactly at the limit and not one ply early
  const st=position([['e1','w','k'],['e8','b','k'],['g1','w','n'],['g8','b','n']],'w',
    {halfmove:LIMIT-2, ply:40});
  play(st,'g1','f3');
  ok(!st.gameOver,'fifty-move-draw-fired-early',{halfmove:st.halfmove,over:st.gameOver});
  ok(st.halfmove===LIMIT-1,'counter-off-by-one',{halfmove:st.halfmove});
  play(st,'g8','f6');
  ok(st.halfmove===LIMIT,'counter-did-not-reach-the-limit',{halfmove:st.halfmove});
  ok(st.gameOver && st.gameOver.reason==='the fifty-move rule' && st.gameOver.winner===null,
     'fifty-move-draw-did-not-fire-at-the-limit',{halfmove:st.halfmove,over:st.gameOver});
}

/*═══════════════════════════════════════════════════════════════════════════
  D. A MATE IS A MATE — the counters never steal a finished game
═══════════════════════════════════════════════════════════════════════════*/
{
  // Qh1–h8 is mate AND the hundredth quiet ply. Chess says checkmate.
  const st=position([['a8','b','k'],['b6','w','k'],['h1','w','q']],'w',{halfmove:LIMIT-1,ply:40});
  play(st,'h1','h8');
  ok(st.halfmove===LIMIT,'mate-test-setup-wrong',{halfmove:st.halfmove});
  ok(st.gameOver && st.gameOver.reason==='checkmate' && st.gameOver.winner==='w',
     'fifty-move-rule-overrode-checkmate',{over:st.gameOver});
}

/*═══════════════════════════════════════════════════════════════════════════
  E. RANDOM GAMES — every ending must be explained, and explained truthfully
═══════════════════════════════════════════════════════════════════════════*/
const REASONS=new Set(['checkmate','stalemate','threefold repetition','the fifty-move rule',
  "White's king was destroyed","Black's king was destroyed"]);
const tally={};
let played=0, finished=0;

// Half the games are artillery games. The other half are played with the guns
// cold, because a random gunfight almost always ends with a dead king and the
// draw endings would then hardly ever be reached.
for (let gi=0; gi<GAMES; gi++) {
  const guns = gi%2===0;
  const g=newGame({...SETTINGS, checkShots:guns}); beginTurn(g); played++;
  for (let i=0;i<400 && !g.gameOver;i++) {
    const side=g.turn;
    // the counter may never run past its limit while the game is still live
    ok(g.halfmove<LIMIT,'counter-ran-past-the-limit-without-a-draw',
       {game:gi,ply:g.ply,halfmove:g.halfmove});

    const shooters=guns?Object.values(g.pieces).filter(q=>canFire(g,q)):[];
    if (shooters.length && Math.random()<0.5) {
      const q=shooters[(Math.random()*shooters.length)|0];
      const opts=targetOptions(g,q.id,Math.random()<0.5?'lob':'flat');
      if (opts.length){ g.turnState.firedId=q.id; resolveShot(g,q.id,opts[(Math.random()*opts.length)|0].sim); }
    }
    if (g.gameOver) break;
    const legal=legalMoves(g,side);
    if (!legal.length) { fail('turn-began-with-no-moves-and-no-ending',{game:gi,ply:g.ply}); break; }
    applyMove(g,legal[(Math.random()*legal.length)|0],'q');
    advanceTurn(g);
  }

  if (!g.gameOver) continue;
  finished++;
  const { winner, reason } = g.gameOver;
  tally[reason]=(tally[reason]||0)+1;
  if (!REASONS.has(reason)) { fail('unexplained-ending',{game:gi,reason}); continue; }

  const loser=g.turn;
  if (reason==='stalemate') {
    ok(winner===null,'stalemate-reported-as-a-win',{game:gi,winner});
    ok(legalMoves(g,loser).length===0 && !inCheck(g,loser),'stalemate-with-moves-or-check',
       {game:gi,moves:legalMoves(g,loser).length,check:inCheck(g,loser)});
  }
  if (reason==='checkmate') {
    ok(winner && winner!==loser,'checkmate-with-the-wrong-winner',{game:gi,winner,loser});
    ok(legalMoves(g,loser).length===0 && inCheck(g,loser),'checkmate-without-mate',
       {game:gi,moves:legalMoves(g,loser).length,check:inCheck(g,loser)});
  }
  if (reason==='threefold repetition') {
    ok(winner===null,'repetition-reported-as-a-win',{game:gi,winner});
    ok((g.posCounts[positionKey(g)]||0)>=CONFIG.REPETITION_DRAW,'repetition-draw-without-a-third-sighting',
       {game:gi,seen:g.posCounts[positionKey(g)]});
  }
  if (reason==='the fifty-move rule') {
    ok(winner===null,'fifty-move-rule-reported-as-a-win',{game:gi,winner});
    ok(g.halfmove>=LIMIT,'fifty-move-draw-fired-early',{game:gi,halfmove:g.halfmove});
  }
}

/*═══════════════════════════════════════════════════════════════════════════
  F. MEASUREMENT ONLY — does a piece killed by a SHOT reset the counter?
     This is a design question for the owner, not a rule, so it is reported
     and never failed.
═══════════════════════════════════════════════════════════════════════════*/
{
  const st=position([['e1','w','k'],['e8','b','k'],['a4','w','r'],['h4','b','p']],'w',
    {halfmove:40, ply:40});
  st.pieces['bp3'].hp=1;
  const before=st.halfmove;
  const opts=targetOptions(st,'wr2','flat');
  const shot=opts.find(o=>sqName(o.sq)==='h4');
  if (!shot) notes.push('shot-kill probe: the rook could not take the shot; not measured.');
  else {
    st.turnState.firedId='wr2';
    resolveShot(st,'wr2',shot.sim);
    const died=!st.pieces['bp3'];
    notes.push(died
      ? `shot-kill probe: the pawn was destroyed by a shot and the fifty-move counter ${
          st.halfmove===before ? 'did NOT reset (still '+st.halfmove+')' : 'reset to '+st.halfmove}.`
      : 'shot-kill probe: the pawn survived the shot; not measured.');
  }
}

console.log(`\ngames ${played} · finished ${finished} · endings ${
  Object.entries(tally).map(([r,n])=>`${r} ${n}`).join(' · ')||'none'}`);
for (const n of notes) console.log(n);
console.log(bugs.length ? 'BUGS:\n  '+bugs.join('\n  ') : 'NO DRAW-RULE VIOLATIONS FOUND');
if (bugs.length) process.exitCode=1;
