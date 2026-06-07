// ============================================================
// 불앤베어 — 메뉴 옵션 전(全) 조합 밸런스 스윕 (worker_threads 병렬)
// 목적:
//   1) "사고 싶어도 현금이 없어 강제 패스(못 삼)" 지표를 측정 (기존 시뮬엔 없던 지표)
//   2) 시작자금을 한 턴 행동 수에 비례 스케일(ON) vs 미적용(OFF) 비교
//   3) 메뉴에서 고를 수 있는 옵션 조합을 폭넓게 병렬 검증
// 사용: node sim/sweep.js [조합당판수] [scale=on|off] [워커수]
// ============================================================
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');

// ---------------- 게임 상수 (index.html 과 동일) ----------------
const SECTORS = [
  { slot:'tech',  ico:'💻', type:'growth' },
  { slot:'phone', ico:'📱', type:'mid'    },
  { slot:'auto',  ico:'🚗', type:'mid'    },
  { slot:'shop',  ico:'🛒', type:'divid'  },
  { slot:'bank',  ico:'🏦', type:'divid'  },
  { slot:'game',  ico:'🎮', type:'growth' },
];
const COUNTRIES = {
  korea:  { name:'한국', volMod:0,  divMod:-50, startMod:0,    swanChance:0.08, swanSteps:2, sig:{worldAmplify:true, sectorBoost:['tech','auto']} },
  usa:    { name:'미국', volMod:-1, divMod:50,  startMod:500,  swanChance:0.04, swanSteps:2, sig:{} },
  japan:  { name:'일본', volMod:-1, divMod:30,  startMod:200,  swanChance:0.04, swanSteps:2, sig:{compressBig:true} },
  china:  { name:'중국', volMod:1,  divMod:-30, startMod:-200, swanChance:0.14, swanSteps:2, sig:{} },
  taiwan: { name:'대만', volMod:0,  divMod:0,   startMod:0,    swanChance:0.08, swanSteps:2, sig:{techAmplify:true} },
  india:  { name:'인도', volMod:1,  divMod:-50, startMod:-500, swanChance:0.10, swanSteps:2, sig:{growthDrift:0.25} },
};
const PRICE_STEPS = [0,500,1000,1500,2000,2500,3000,3500,4000,4500,5000,5500];
const MAX_PRICE = 5500, MAX_SHARES = 6, DIVERSIFY_BONUS = 1100;
const EVENTS = [
  { ico:'🤖', who:['tech'],  steps:3, chain:{who:'game',steps:1} },
  { ico:'📉', who:['tech'],  steps:-2, chain:null },
  { ico:'📱', who:['phone'], steps:2, chain:null },
  { ico:'🔋', who:['phone'], steps:-2, chain:null },
  { ico:'🏁', who:['auto'],  steps:2, chain:null },
  { ico:'⛽', who:['auto'],  steps:-1, chain:null },
  { ico:'⚡', who:['auto'],  steps:2, chain:{who:'tech',steps:1} },
  { ico:'🎁', who:['shop'],  steps:2, chain:null },
  { ico:'📦', who:['shop'],  steps:-1, chain:null },
  { ico:'📈', who:['bank'],  steps:1, chain:null },
  { ico:'⚠️', who:['bank'],  steps:-2, chain:null },
  { ico:'🏆', who:['game'],  steps:3, chain:{who:'tech',steps:1} },
  { ico:'📵', who:['game'],  steps:-2, chain:null },
  { ico:'🎒', who:['game'],  steps:2, chain:null },
  { ico:'📈', who:'all',     steps:1, chain:null },
  { ico:'📉', who:'all',     steps:-1, chain:null },
  { ico:'💰', who:['tech','game'], steps:1, chain:null },
  { ico:'😱', who:'all',     steps:-1, chain:null },
  { ico:'🎉', who:['bank'], steps:0, divMul:2, kind:'div' },
  { ico:'🎉', who:['shop'], steps:0, divMul:2, kind:'div' },
  { ico:'🎉', who:['auto'], steps:0, divMul:1.5, kind:'div' },
  { ico:'📃', who:['bank'], steps:0, divMul:0.5, kind:'div' },
  { ico:'📃', who:['shop'], steps:0, divMul:0.5, kind:'div' },
  { ico:'🚫', who:['game'], steps:0, divMul:0, kind:'div' },
  { ico:'🚫', who:['tech'], steps:0, divMul:0, kind:'div' },
  { ico:'💝', who:'all',    steps:0, divMul:1.5, kind:'div' },
];
const ACTIONS = [{id:'cut'},{id:'avg'},{id:'info'},{id:'ins'},{id:'extra'},{id:'div'},{id:'flip'},{id:'cash'}];
const GOALS = [
  { nm:'분산 투자왕', reward:3000, check:(p)=>Object.values(p.shares).filter(n=>n>0).length>=4 },
  { nm:'균형 투자', reward:3000, check:(p,st)=>{const g=st.companies.filter(c=>c.type==='growth').reduce((s,c)=>s+p.shares[c.id],0); const d=st.companies.filter(c=>c.type==='divid').reduce((s,c)=>s+p.shares[c.id],0); return g>=2&&d>=2;} },
  { nm:'배당 수집가', reward:3000, check:(p,st)=>st.companies.filter(c=>c.type==='divid').reduce((s,c)=>s+(p.shares[c.id]||0),0)>=4 },
  { nm:'현금 부자', reward:3000, check:(p)=>p.cash>=8000 },
  { nm:'성장 투자자', reward:4000, check:(p,st)=>st.companies.filter(c=>c.type==='growth').reduce((s,c)=>s+(p.shares[c.id]||0),0)>=4 },
  { nm:'장기 투자자', reward:3000, check:(p)=>(p._maxHoldStreak||0)>=10 },
];
const TOTAL_ROUNDS = 12, DEFAULT_ACTIONS = 2;

// ---------------- 메뉴에서 고를 수 있는 옵션 값 ----------------
const OPT = {
  players:        [2,3,4],
  country:        Object.keys(COUNTRIES),     // 6
  actionsPerTurn: [1,2,3],                    // 한 턴 행동 수
  buyLimit:       [2,3,5],                    // 한 턴 같은 회사 매수
  forecastLen:    [1,2,3],                    // 예보 길이
  divEvery:       [1,2,3],                    // 배당 주기
  startCash:      [20000,25000,30000,35000],  // 시작 자금
  // coachOn 은 추천 표시일 뿐 — 게임 메커니즘/밸런스에 영향 없음 → 스윕 제외
};

// ---------------- 시작자금 스케일 (index.html 과 동일 규칙) ----------------
// 기본(2)보다 많으면 그만큼 더 줌. 3행동=×1.5. 줄이진 않음(1·2행동=×1). 500원 단위 반올림.
function scaleCash(startCash, actionsPerTurn){
  return Math.round((startCash * Math.max(1, actionsPerTurn / DEFAULT_ACTIONS)) / 500) * 500;
}

// ---------------- 헬퍼 ----------------
function buildCompanies(countryKey){
  const country=COUNTRIES[countryKey];
  return SECTORS.map(s=>{
    const baseStart=s.type==='growth'?2500:s.type==='divid'?1500:2000; // 시작가 분산 + 절벽(500)에서 멀리
    const baseDiv=s.type==='growth'?100:s.type==='divid'?250:150;
    return { id:s.slot, ico:s.ico, sector:s.slot, type:s.type,
      start:Math.max(500,baseStart+country.startMod), div:Math.max(0,baseDiv+country.divMod), volMod:country.volMod };
  });
}
function shuffle(a){ a=[...a]; for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; }
function movePrice(price, steps){
  let idx=PRICE_STEPS.indexOf(price);
  if(idx<0) idx=PRICE_STEPS.reduce((b,v,i)=>Math.abs(v-price)<Math.abs(PRICE_STEPS[b]-price)?i:b,0);
  idx=Math.max(0,Math.min(PRICE_STEPS.length-1,idx+steps));
  return PRICE_STEPS[idx];
}
function moveWithFloor(price, steps){ let a=movePrice(price,steps); if(a===0&&price>500)a=500; return a; }
function netWorth(p,prices,co){ let s=p.cash; co.forEach(c=>s+=p.shares[c.id]*prices[c.id]); return s; }
function stockValue(p,prices,co){ let s=0; co.forEach(c=>s+=p.shares[c.id]*prices[c.id]); return s; }
function totalShares(p,co){ let s=0; co.forEach(c=>s+=p.shares[c.id]); return s; }
function isEventRelevant(ev,prices,co){ return ev.who==='all'?co.some(c=>prices[c.id]>0):ev.who.some(cid=>prices[cid]>0); }
function drawPair(deck,prices,co){
  if(deck.length<2){ const f=shuffle([...EVENTS,...EVENTS]); while(f.length)deck.push(f.pop()); }
  const one=()=>{ for(let i=0;i<20&&deck.length;i++){ const c=deck.pop(); if(isEventRelevant(c,prices,co))return c; } return null; };
  const a=one(); let b=one();
  if(b&&a&&b.ico===a.ico&&b.steps===a.steps&&deck.length){ const c=one(); if(c){ deck.push(b); b=c; } }
  return [a,b].filter(Boolean);
}
function analyzeAdvice(forecast,co,prices,opt){
  const fog=opt&&opt.fog; const adv={}; co.forEach(c=>adv[c.id]={score:0});
  const evs=[]; forecast.forEach((slot,i)=>slot.forEach((ev,j)=>{ if(fog&&j===1)return; evs.push(ev); }));
  evs.forEach(ev=>{
    const t=ev.who==='all'?co.map(c=>c.id):ev.who;
    t.forEach(cid=>{ if(!adv[cid])return; if(ev.kind==='div'){ if(ev.divMul>1)adv[cid].score+=1; else if(ev.divMul<1)adv[cid].score-=0.5; } else adv[cid].score+=ev.steps; });
    if(ev.chain&&ev.who!=='all'&&adv[ev.chain.who]) adv[ev.chain.who].score+=ev.chain.steps;
  });
  co.forEach(c=>{ const a=adv[c.id]; a.dir=a.score>0?'buy':a.score<0?'sell':null; });
  return adv;
}

// ---------------- 전략 AI ----------------
function buyCandidates(G,p,state){ // 살 수 있으면(돈 충분) 후보
  return G.companies.filter(c=>G.prices[c.id]>0 && p.cash>=G.prices[c.id] && (state.buyCount[c.id]||0)<state.maxBuy && p.shares[c.id]<MAX_SHARES);
}
function wantCandidates(G,p,state){ // 돈 빼고 "사고 싶을 수 있는" 후보 (살아있고 상한·매수제한 미달)
  return G.companies.filter(c=>G.prices[c.id]>0 && (state.buyCount[c.id]||0)<state.maxBuy && p.shares[c.id]<MAX_SHARES);
}
const STRATS = {
  random(G,p,state){ const b=buyCandidates(G,p,state); const h=G.companies.filter(c=>p.shares[c.id]>0); const pool=[]; b.forEach(c=>pool.push({type:'buy',cid:c.id})); h.forEach(c=>pool.push({type:'sell',cid:c.id})); pool.push({type:'pass'}); return pool[Math.floor(Math.random()*pool.length)]; },
  forecaster(G,p,state,adv){ const w=G.companies.find(c=>p.shares[c.id]>0&&adv[c.id].dir==='sell'&&G.prices[c.id]>0); if(w&&!state.soldThisTurn){state.soldThisTurn=true;return{type:'sell',cid:w.id};} const b=buyCandidates(G,p,state).filter(c=>adv[c.id].score>0).sort((a,b)=>adv[b.id].score-adv[a.id].score); if(b.length)return{type:'buy',cid:b[0].id}; return{type:'pass'}; },
  gambler(G,p,state,adv){ if(!state.target){ const r=[...G.companies].filter(c=>G.prices[c.id]>0).sort((a,b)=>adv[b.id].score-adv[a.id].score); state.target=r.length?r[0].id:null; } const t=state.target; if(t&&G.prices[t]>0&&p.cash>=G.prices[t]&&(state.buyCount[t]||0)<state.maxBuy&&p.shares[t]<MAX_SHARES)return{type:'buy',cid:t}; return{type:'pass'}; },
  diversifier(G,p,state){ const b=buyCandidates(G,p,state).sort((a,b)=>p.shares[a.id]-p.shares[b.id]); if(b.length)return{type:'buy',cid:b[0].id}; return{type:'pass'}; },
  dividend(G,p,state){ const b=buyCandidates(G,p,state).sort((a,b)=>(b.type==='divid')-(a.type==='divid')||b.div-a.div); if(b.length)return{type:'buy',cid:b[0].id}; return{type:'pass'}; },
};
const STRAT_NAMES = Object.keys(STRATS);

function maybeUseCard(G,p,state,adv){
  let i=p.hand.findIndex(c=>c.id==='extra'); if(i>=0){ p.hand.splice(i,1); state.actionsLeft++; return true; }
  i=p.hand.findIndex(c=>c.id==='flip'); if(i>=0){ let e=0; G.companies.forEach(c=>{ if(p.shares[c.id]>0)e+=adv[c.id].score*p.shares[c.id]; }); if(e<0){ p.hand.splice(i,1); G.flipNext=true; state.actionsLeft--; return true; } }
  i=p.hand.findIndex(c=>c.id==='cash'); if(i>=0&&p.cash<1500){ p.hand.splice(i,1); p.cash+=3000; state.maxBuy=5; state.actionsLeft--; return true; }
  i=p.hand.findIndex(c=>c.id==='div'); if(i>=0&&totalShares(p,G.companies)>=8){ let t=0; G.companies.forEach(c=>t+=p.shares[c.id]*100); p.hand.splice(i,1); p.cash+=t; state.actionsLeft--; return true; }
  return false;
}

function takeTurn(G,p,M){
  const adv=analyzeAdvice(G.forecast,G.companies,G.prices,{fog:!!G.opts.forecastFog});
  const state={ actionsLeft:G.opts.actionsPerTurn, buyCount:{}, maxBuy:G.opts.buyLimit, soldThisTurn:false, target:null };
  let guard=0;
  while(state.actionsLeft>0 && guard++<14){
    if(maybeUseCard(G,p,state,adv)) continue;
    const move=STRATS[p.strat](G,p,state,adv);
    if(!move||move.type==='end') break;
    M.actions++;
    if(move.type==='pass'){
      // 강제 패스 판정: 돈 빼면 사고 싶은 후보가 있는데(want) 돈 없어 못 사는가(아무 것도 살 수 없음)?
      const want=wantCandidates(G,p,state);
      const afford=buyCandidates(G,p,state);
      if(afford.length===0){
        M.noBuy++;
        if(want.length>0){ M.cashStuck++; p._stuckTurn=true; } // 사고 싶어도 현금 부족
      }
      p.cash+=500; state.actionsLeft--;
    } else if(move.type==='buy'){
      const pr=G.prices[move.cid];
      if(pr<=0||p.cash<pr||(state.buyCount[move.cid]||0)>=state.maxBuy||p.shares[move.cid]>=MAX_SHARES) break;
      p.cash-=pr; p.shares[move.cid]++; state.buyCount[move.cid]=(state.buyCount[move.cid]||0)+1; state.actionsLeft--;
    } else if(move.type==='sell'){
      if(p.shares[move.cid]<=0) break;
      let price=G.prices[move.cid];
      if(p.insured[move.cid]){ price=Math.max(price,p.insured[move.cid]); delete p.insured[move.cid]; }
      p.cash+=price; p.shares[move.cid]--; state.actionsLeft--;
    }
  }
}

function computeSteps(ev,G){
  let steps=G.flipNext?-ev.steps:ev.steps; if(steps===0)return 0;
  const sig=G.country.sig||{};
  if(ev.who==='all'&&sig.worldAmplify) steps+=Math.sign(steps);
  if(Array.isArray(ev.who)&&sig.sectorBoost&&steps>0&&ev.who.some(w=>sig.sectorBoost.includes(w))) steps+=1;
  if(Array.isArray(ev.who)&&sig.techAmplify&&ev.who.includes('tech')) steps+=Math.sign(steps);
  if(steps>0) steps=Math.max(1,steps+G.country.volMod); else steps=Math.min(-1,steps-G.country.volMod);
  if(steps<0) steps=Math.min(-1,steps+(G.opts.downsideBuffer||0));
  if(sig.compressBig&&Math.abs(steps)>=2) steps=Math.sign(steps);
  return steps;
}
function maybeBlackSwan(G){ const ch=G.country.swanChance||0; if(Math.random()>=ch)return null; const a=G.companies.filter(c=>G.prices[c.id]>0); if(!a.length)return null; const v=a[Math.floor(Math.random()*a.length)]; G.prices[v.id]=moveWithFloor(G.prices[v.id],-(G.country.swanSteps||2)); return{cid:v.id,after:G.prices[v.id]}; }
function applyGrowthDrift(G){ const sig=G.country.sig||{}; if(!sig.growthDrift||Math.random()>=sig.growthDrift)return[]; const out=[]; G.companies.forEach(c=>{ if(G.prices[c.id]>0&&G.prices[c.id]<MAX_PRICE){ G.prices[c.id]=movePrice(G.prices[c.id],1); out.push({cid:c.id,after:G.prices[c.id]}); } }); return out; }

function resolveRound(G,players){
  const events=G.forecast[0]||[]; const changes=[]; const flip=G.flipNext;
  const divMul={}; G.companies.forEach(c=>divMul[c.id]=1);
  events.forEach(ev=>{
    if(ev.kind==='div'){ const t=ev.who==='all'?G.companies.map(c=>c.id):ev.who; t.forEach(cid=>divMul[cid]=ev.divMul); return; }
    const steps=computeSteps(ev,G); if(steps===0)return;
    const t=ev.who==='all'?G.companies.map(c=>c.id):ev.who;
    const marketWide=ev.who==='all'; // 전체 악재로는 상폐 금지(500서 막힘)
    t.forEach(cid=>{ if(G.prices[cid]<=0)return; let after=moveWithFloor(G.prices[cid],steps); if(marketWide&&after===0)after=500; G.prices[cid]=after; changes.push({cid,after:G.prices[cid]}); });
    if(ev.chain&&ev.who!=='all'){ const cid=ev.chain.who; const cs=flip?-ev.chain.steps:ev.chain.steps; if(G.prices[cid]>0){ G.prices[cid]=moveWithFloor(G.prices[cid],cs); changes.push({cid,after:G.prices[cid]}); } }
  });
  G.flipNext=false;
  applyGrowthDrift(G).forEach(ch=>changes.push(ch));
  const swan=maybeBlackSwan(G); if(swan)changes.push(swan);
  const divThis=(G.round%G.opts.divEvery===0);
  players.forEach(p=>{ let total=0; if(divThis){ G.companies.forEach(c=>{ if(p.shares[c.id]>0&&c.div>0&&G.prices[c.id]>0) total+=Math.round(p.shares[c.id]*c.div*divMul[c.id]); }); const d=G.companies.filter(c=>p.shares[c.id]>0).length; if(d>=4)total+=DIVERSIFY_BONUS; } if(total>0){ p.cash+=total; p.divReceived+=total; } });
  changes.forEach(ch=>{ if(ch.after===0&&!G.log.delisted.includes(ch.cid))G.log.delisted.push(ch.cid); });
  const justDel=changes.filter(ch=>ch.after===0).map(ch=>ch.cid);
  if(justDel.length){ for(let i=0;i<G.forecast.length;i++){ G.forecast[i]=G.forecast[i].filter(ev=>ev.who==='all'?true:ev.who.some(cid=>G.prices[cid]>0)); while(G.forecast[i].length<2){ const f=drawPair(G.eventDeck,G.prices,G.companies); if(!f.length)break; G.forecast[i].push(f[0]); if(G.forecast[i].length<2&&f[1])G.forecast[i].push(f[1]); } } }
}

function playGame(cfg, strats, scaleOn){
  const opts={ actionsPerTurn:cfg.actionsPerTurn, buyLimit:cfg.buyLimit, forecastLen:cfg.forecastLen,
    divEvery:cfg.divEvery, downsideBuffer:cfg.downsideBuffer||0, forecastFog:cfg.forecastFog||false };
  const startCash = scaleOn ? scaleCash(cfg.startCash, cfg.actionsPerTurn) : cfg.startCash;
  const companies=buildCompanies(cfg.country);
  const prices={}; companies.forEach(c=>prices[c.id]=c.start);
  const goalDeck=shuffle(GOALS);
  const players=[];
  for(let i=0;i<cfg.players;i++){ const shares={}; companies.forEach(c=>shares[c.id]=0);
    players.push({ strat:strats[i], cash:startCash, shares, goal:goalDeck[i%goalDeck.length], hand:[], insured:{}, divReceived:0, history:[startCash], _stuckTurn:false, _holdStreak:{}, _maxHoldStreak:0 }); }
  let actionDeck=shuffle([...ACTIONS,...ACTIONS]);
  players.forEach(p=>{ p.hand=[actionDeck.pop(),actionDeck.pop()]; });
  const eventDeck=shuffle([...EVENTS,...EVENTS,...EVENTS]);
  const forecast=[]; for(let i=0;i<opts.forecastLen;i++) forecast.push(drawPair(eventDeck,prices,companies));
  const G={ opts, country:COUNTRIES[cfg.country], companies, prices, eventDeck, actionDeck, forecast, round:1, flipNext:false, log:{delisted:[]} };
  const M={ actions:0, noBuy:0, cashStuck:0, stuckPlayerTurns:0, playerTurns:0 };
  for(G.round=1; G.round<=TOTAL_ROUNDS; G.round++){
    players.forEach(p=>{ p._stuckTurn=false; takeTurn(G,p,M); M.playerTurns++; if(p._stuckTurn)M.stuckPlayerTurns++; });
    resolveRound(G,players);
    players.forEach(p=>{ let best=p._maxHoldStreak; companies.forEach(c=>{ if(p.shares[c.id]>0){ p._holdStreak[c.id]=(p._holdStreak[c.id]||0)+1; if(p._holdStreak[c.id]>best)best=p._holdStreak[c.id]; } else p._holdStreak[c.id]=0; }); p._maxHoldStreak=best; });
    if(G.round<TOTAL_ROUNDS){ G.forecast.shift(); G.forecast.push(drawPair(G.eventDeck,G.prices,G.companies)); }
  }
  const st={companies,prices:G.prices};
  const results=players.map(p=>{ const base=netWorth(p,G.prices,companies); const met=p.goal.check(p,st); return { strat:p.strat, base, total:base+(met?p.goal.reward:0), div:p.divReceived, start:startCash, goalName:p.goal.nm, goalMet:met }; });
  results.sort((a,b)=>b.total-a.total);
  return { results, delisted:G.log.delisted.length, M, startCash };
}

// ---------------- 한 조합(셀) 집계 ----------------
function runCell(cfg, N, scaleOn){
  const cell={ games:0, delistGames:0, gapSum:0, close:0, blowout:0, lossPlayers:0, playerCount:0, divSum:0,
    actions:0, noBuy:0, cashStuck:0, stuckPlayerTurns:0, playerTurns:0, startCashSum:0,
    strat:{} };
  STRAT_NAMES.forEach(s=>cell.strat[s]={games:0,wins:0});
  const goal={}; GOALS.forEach(g=>goal[g.nm]={appear:0,met:0});
  for(let g=0; g<N; g++){
    const strats=shuffle(STRAT_NAMES).slice(0,cfg.players);
    const r=playGame(cfg, strats, scaleOn);
    cell.games++; cell.startCashSum+=r.startCash;
    if(r.delisted>0) cell.delistGames++;
    const win=r.results[0], lose=r.results[r.results.length-1];
    const gap=win.total-lose.total; cell.gapSum+=gap; if(gap<=5000)cell.close++; if(gap>=20000)cell.blowout++;
    r.results.forEach(res=>{ cell.strat[res.strat].games++; cell.playerCount++; cell.divSum+=res.div; if(res.total<res.start)cell.lossPlayers++;
      goal[res.goalName].appear++; if(res.goalMet)goal[res.goalName].met++; });
    cell.strat[win.strat].wins++;
    cell.actions+=r.M.actions; cell.noBuy+=r.M.noBuy; cell.cashStuck+=r.M.cashStuck;
    cell.stuckPlayerTurns+=r.M.stuckPlayerTurns; cell.playerTurns+=r.M.playerTurns;
  }
  return { cfg, cell, goal };
}

// ---------------- 조합 enumerate ----------------
function enumerate(){
  const out=[];
  for(const players of OPT.players)
  for(const country of OPT.country)
  for(const actionsPerTurn of OPT.actionsPerTurn)
  for(const buyLimit of OPT.buyLimit)
  for(const forecastLen of OPT.forecastLen)
  for(const divEvery of OPT.divEvery)
  for(const startCash of OPT.startCash)
    out.push({ players, country, actionsPerTurn, buyLimit, forecastLen, divEvery, startCash });
  return out;
}

// ============================================================
if(!isMainThread){
  const { configs, N, scaleOn } = workerData;
  parentPort.postMessage(configs.map(cfg=>runCell(cfg,N,scaleOn)));
} else {
  const N = parseInt(process.argv[2]||'60',10);
  const scaleOn = (process.argv[3]||'on').toLowerCase()!=='off';
  const allConfigs = enumerate();
  const numWorkers = parseInt(process.argv[4]|| String(Math.max(2,(os.cpus().length||4)-1)),10);
  const chunks=Array.from({length:numWorkers},()=>[]);
  allConfigs.forEach((cfg,i)=>chunks[i%numWorkers].push(cfg));
  const t0=Date.now();
  console.error(`▶ 스케일 ${scaleOn?'ON':'OFF'} | ${allConfigs.length.toLocaleString()}조합 × ${N}판 = ${(allConfigs.length*N).toLocaleString()}판 | 워커 ${numWorkers}`);
  const cells=[]; let done=0; const active=chunks.filter(c=>c.length).length;
  chunks.filter(c=>c.length).forEach(chunk=>{
    const w=new Worker(__filename,{workerData:{configs:chunk,N,scaleOn}});
    w.on('message',cs=>cells.push(...cs));
    w.on('error',e=>console.error('worker',e));
    w.on('exit',()=>{ if(++done===active) finish(); });
  });
  function finish(){
    const secs=((Date.now()-t0)/1000).toFixed(2);
    const pct=(a,b)=>b?(100*a/b).toFixed(1)+'%':'—';
    const won=n=>Math.round(n).toLocaleString('en-US');
    // 그룹 집계 헬퍼
    function group(keyFn){
      const m={};
      cells.forEach(({cfg,cell})=>{ const k=keyFn(cfg); (m[k]=m[k]||{games:0,actions:0,cashStuck:0,noBuy:0,stuckPT:0,pt:0,blowout:0,close:0,gap:0,loss:0,pc:0,div:0,startCash:0,strat:{}});
        const x=m[k]; x.games+=cell.games; x.actions+=cell.actions; x.cashStuck+=cell.cashStuck; x.noBuy+=cell.noBuy;
        x.stuckPT+=cell.stuckPlayerTurns; x.pt+=cell.playerTurns; x.blowout+=cell.blowout; x.close+=cell.close;
        x.gap+=cell.gapSum; x.loss+=cell.lossPlayers; x.pc+=cell.playerCount; x.div+=cell.divSum; x.startCash+=cell.startCashSum;
        STRAT_NAMES.forEach(s=>{ x.strat[s]=x.strat[s]||{games:0,wins:0}; x.strat[s].games+=cell.strat[s].games; x.strat[s].wins+=cell.strat[s].wins; });
      });
      return m;
    }
    let out='';
    out+=`# 옵션 스윕 결과 — 시작자금 스케일 ${scaleOn?'ON':'OFF'}\n\n`;
    out+=`- ${allConfigs.length.toLocaleString()}개 옵션 조합 × ${N}판 = 총 ${(allConfigs.length*N).toLocaleString()}판 · ${secs}초\n`;
    out+=`- 측정 핵심: **현금부족 강제패스율**(사고 싶어도 돈 없어 패스한 행동 / 전체 행동), **막힘턴%**(그 턴에 한 번이라도 현금막힘 발생)\n\n`;

    // 전역 전략 승률
    const gAll=group(()=>'all')['all'];
    out+=`## 1. 전역 전략 승률 (몰빵 vs 분산 균형)\n\n| 전략 | 승률 |\n|---|---|\n`;
    [...STRAT_NAMES].sort((a,b)=>gAll.strat[b].wins/gAll.strat[b].games-gAll.strat[a].wins/gAll.strat[a].games)
      .forEach(s=>out+=`| ${s} | ${pct(gAll.strat[s].wins,gAll.strat[s].games)} |\n`);

    // 목표(비밀임무) 달성률 — 6종이 고른지
    const goalG={}; GOALS.forEach(g=>goalG[g.nm]={appear:0,met:0});
    cells.forEach(({goal})=>{ GOALS.forEach(g=>{ goalG[g.nm].appear+=goal[g.nm].appear; goalG[g.nm].met+=goal[g.nm].met; }); });
    out+=`\n## 1-2. 목표(비밀임무) 달성률 — 6종 균등성\n\n| 목표 | 보상 | 등장 | 달성률 |\n|---|---|---|---|\n`;
    GOALS.forEach(g=>{ const x=goalG[g.nm]; out+=`| ${g.nm} | ${won(g.reward)} | ${x.appear} | ${pct(x.met,x.appear)} |\n`; });

    // 행동수 × 시작자금 — 핵심 (현금막힘)
    out+=`\n## 2. ⭐ 행동수 × 시작자금별 현금부족 강제패스율 / 막힘턴%\n\n`;
    const byAC=group(c=>c.actionsPerTurn+'|'+c.startCash);
    out+=`| 행동수 | 시작자금(설정) | 강제패스율 | 막힘턴% | 압승% | 손실P% |\n|---|---|---|---|---|---|\n`;
    OPT.actionsPerTurn.forEach(ap=>OPT.startCash.forEach(sc=>{ const x=byAC[ap+'|'+sc]; if(!x)return;
      out+=`| ${ap}번 | ${won(sc)}원 | ${pct(x.cashStuck,x.actions)} | ${pct(x.stuckPT,x.pt)} | ${pct(x.blowout,x.games)} | ${pct(x.loss,x.pc)} |\n`; }));

    // 행동수만
    out+=`\n## 3. 행동수별 요약\n\n| 행동수 | 강제패스율 | 막힘턴% | 평균격차 | 압승% | 접전% | 손실P% | 인당배당 |\n|---|---|---|---|---|---|---|---|\n`;
    const byA=group(c=>c.actionsPerTurn);
    OPT.actionsPerTurn.forEach(ap=>{ const x=byA[ap]; if(!x)return;
      out+=`| ${ap}번 | ${pct(x.cashStuck,x.actions)} | ${pct(x.stuckPT,x.pt)} | ${won(x.gap/x.games)}원 | ${pct(x.blowout,x.games)} | ${pct(x.close,x.games)} | ${pct(x.loss,x.pc)} | ${won(x.div/x.pc)}원 |\n`; });

    // 나라별 (3행동 한정) 현금막힘
    out+=`\n## 4. 나라별 현금부족 강제패스율 (3행동 한정)\n\n| 나라 | 강제패스율 | 막힘턴% | 압승% | 상폐게임% |\n|---|---|---|---|---|\n`;
    const byC3={}; cells.forEach(({cfg,cell})=>{ if(cfg.actionsPerTurn!==3)return; const k=cfg.country; const x=byC3[k]=byC3[k]||{actions:0,cashStuck:0,stuckPT:0,pt:0,blowout:0,games:0,delist:0};
      x.actions+=cell.actions; x.cashStuck+=cell.cashStuck; x.stuckPT+=cell.stuckPlayerTurns; x.pt+=cell.playerTurns; x.blowout+=cell.blowout; x.games+=cell.games; x.delist+=cell.delistGames; });
    OPT.country.forEach(c=>{ const x=byC3[c]; if(!x)return; out+=`| ${COUNTRIES[c].name} | ${pct(x.cashStuck,x.actions)} | ${pct(x.stuckPT,x.pt)} | ${pct(x.blowout,x.games)} | ${pct(x.delist,x.games)} |\n`; });

    // 최악 조합 top 12 (강제패스율)
    out+=`\n## 5. 현금부족 강제패스율 최악 조합 Top 12\n\n| 강제패스율 | 막힘턴% | 인원 | 나라 | 행동 | 매수 | 예보 | 배당 | 시작자금 |\n|---|---|---|---|---|---|---|---|---|\n`;
    const scored=cells.map(({cfg,cell})=>({cfg, stuck:cell.actions?cell.cashStuck/cell.actions:0, turn:cell.playerTurns?cell.stuckPlayerTurns/cell.playerTurns:0}))
      .sort((a,b)=>b.stuck-a.stuck).slice(0,12);
    scored.forEach(s=>out+=`| ${(s.stuck*100).toFixed(1)}% | ${(s.turn*100).toFixed(1)}% | ${s.cfg.players}인 | ${COUNTRIES[s.cfg.country].name} | ${s.cfg.actionsPerTurn}번 | ${s.cfg.buyLimit}주 | ${s.cfg.forecastLen} | ${s.cfg.divEvery}R | ${won(s.cfg.startCash)}원 |\n`);

    console.log(out);
    console.error(`✔ ${(allConfigs.length*N).toLocaleString()}판 / ${secs}초 / 스케일 ${scaleOn?'ON':'OFF'}`);
  }
}
