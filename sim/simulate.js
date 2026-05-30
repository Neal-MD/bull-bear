// ============================================================
// 불앤베어 헤드리스 밸런스 시뮬레이터 (worker_threads 병렬판)
// index.html 의 순수 게임 로직 포팅 + 전략 AI
// 사용: node sim/simulate.js [조합당판수] [워커수]
//   메인이 18개(6국×3난이도) 조합을 워커들에 분배 → 병렬 실행 → 결과 병합
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
  korea:  { flag:'🇰🇷', name:'한국', volMod:0,  divMod:-50, startMod:0,    swanChance:0.08, swanSteps:2, sig:{worldAmplify:true, sectorBoost:['tech','auto']}, co:{tech:'삼성전자',phone:'SK텔레콤',auto:'현대차',shop:'쿠팡',bank:'KB금융',game:'스마일게이트'} },
  usa:    { flag:'🇺🇸', name:'미국', volMod:-1, divMod:50,  startMod:500,  swanChance:0.04, swanSteps:2, sig:{}, co:{tech:'엔비디아',phone:'애플',auto:'테슬라',shop:'아마존',bank:'JP모건',game:'EA게임즈'} },
  japan:  { flag:'🇯🇵', name:'일본', volMod:-1, divMod:30,  startMod:200,  swanChance:0.04, swanSteps:2, sig:{compressBig:true}, co:{tech:'키옥시아',phone:'소니',auto:'도요타',shop:'유니클로',bank:'미쓰비시UFJ',game:'닌텐도'} },
  china:  { flag:'🇨🇳', name:'중국', volMod:1,  divMod:-30, startMod:-200, swanChance:0.14, swanSteps:2, sig:{}, co:{tech:'SMIC',phone:'샤오미',auto:'BYD',shop:'알리바바',bank:'공상은행',game:'텐센트'} },
  taiwan: { flag:'🇹🇼', name:'대만', volMod:0,  divMod:0,   startMod:0,    swanChance:0.08, swanSteps:2, sig:{techAmplify:true}, co:{tech:'TSMC',phone:'미디어텍',auto:'폭스콘',shop:'유니프레지던트',bank:'캐세이금융',game:'유니솔트'} },
  india:  { flag:'🇮🇳', name:'인도', volMod:1,  divMod:-50, startMod:-500, swanChance:0.10, swanSteps:2, sig:{growthDrift:0.25}, co:{tech:'인포시스',phone:'에어텔',auto:'타타모터스',shop:'릴라이언스리테일',bank:'HDFC은행',game:'나자라'} },
};

const PRICE_STEPS = [0,500,1000,1500,2000,2500,3000,3500,4000,4500,5000,5500];
const MAX_PRICE = 5500, MIN_PRICE = 0, MAX_SHARES = 6;
const DIVERSIFY_BONUS = 1100;

const EVENTS = [
  { ico:'🤖', tx:'AI 붐! 반도체 호황',         who:['tech'],  steps:3, chain:{who:'game',steps:1} },
  { ico:'📉', tx:'반도체 공급 과잉',           who:['tech'],  steps:-2, chain:null },
  { ico:'📱', tx:'신형 휴대폰 대히트!',         who:['phone'], steps:2, chain:null },
  { ico:'🔋', tx:'배터리 결함 리콜',           who:['phone'], steps:-2, chain:null },
  { ico:'🏁', tx:'신차 출시 흥행!',            who:['auto'],  steps:2, chain:null },
  { ico:'⛽', tx:'기름값 폭등, 자동차 수요↓',   who:['auto'],  steps:-1, chain:null },
  { ico:'⚡', tx:'전기차 판매 신기록',          who:['auto'],  steps:2, chain:{who:'tech',steps:1} },
  { ico:'🎁', tx:'블랙프라이데이 대박',         who:['shop'],  steps:2, chain:null },
  { ico:'📦', tx:'물류 차질로 매출 부진',       who:['shop'],  steps:-1, chain:null },
  { ico:'📈', tx:'금리 인상으로 은행 이익↑',    who:['bank'],  steps:1, chain:null },
  { ico:'⚠️', tx:'금융 부실 우려',             who:['bank'],  steps:-2, chain:null },
  { ico:'🏆', tx:'게임 신작 대박!',            who:['game'],  steps:3, chain:{who:'tech',steps:1} },
  { ico:'📵', tx:'게임 서버 장애',             who:['game'],  steps:-2, chain:null },
  { ico:'🎒', tx:'방학 시작, 게임 호황',        who:['game'],  steps:2, chain:null },
  { ico:'📈', tx:'경기 호황!',                 who:'all',     steps:1, chain:null },
  { ico:'📉', tx:'경기 침체',                  who:'all',     steps:-1, chain:null },
  { ico:'💰', tx:'외국인 매수 급증',           who:['tech','game'], steps:1, chain:null },
  { ico:'😱', tx:'세계 증시 동반 하락',         who:'all',     steps:-1, chain:null },
  { ico:'🎉', tx:'은행 사상 최대 실적! 배당 2배', who:['bank'], steps:0, divMul:2, kind:'div' },
  { ico:'🎉', tx:'쇼핑몰 분기 호조! 배당 2배',    who:['shop'], steps:0, divMul:2, kind:'div' },
  { ico:'🎉', tx:'자동차 흑자 전환! 배당 1.5배',  who:['auto'], steps:0, divMul:1.5, kind:'div' },
  { ico:'📃', tx:'은행 충당금 적립, 배당 절반',   who:['bank'], steps:0, divMul:0.5, kind:'div' },
  { ico:'📃', tx:'쇼핑몰 실적 부진, 배당 절반',   who:['shop'], steps:0, divMul:0.5, kind:'div' },
  { ico:'🚫', tx:'게임사 적자 전환, 배당 중단',   who:['game'], steps:0, divMul:0, kind:'div' },
  { ico:'🚫', tx:'반도체 적자, 배당 중단',       who:['tech'], steps:0, divMul:0, kind:'div' },
  { ico:'💝', tx:'경기 좋아 모두 배당 추가!',    who:'all',    steps:0, divMul:1.5, kind:'div' },
];

const ACTIONS = [
  { id:'cut' }, { id:'avg' }, { id:'info' }, { id:'ins' },
  { id:'extra' }, { id:'div' }, { id:'flip' }, { id:'cash' },
];

// 목표카드 — index.html 원본 그대로 (B1 버그 포함: space/toy/bakery 는 존재 안 함)
const GOALS = [
  { nm:'분산 투자왕', reward:5000, check:(p)=>Object.values(p.shares).filter(n=>n>0).length>=4 },
  { nm:'모험가', reward:4000, check:(p,st)=>{ const g=(st.companies).filter(c=>c.type==='growth').reduce((s,c)=>s+(p.shares[c.id]||0),0); return g>=3; } },
  { nm:'안전 제일', reward:2500, check:(p,st)=>{ const has=(st.companies).filter(c=>p.shares[c.id]>0); return has.length>0 && has.every(c=>c.type==='divid'); } },
  { nm:'현금 부자',  reward:2000, check:(p)=>p.cash>=8000 },
  { nm:'대박 노리기', reward:3500, check:(p,st)=>st.companies.some(c=>st.prices[c.id]>=4000 && p.shares[c.id]>0) },
  { nm:'균형 투자',  reward:3000, check:(p,st)=>{const g=st.companies.filter(c=>c.type==='growth').reduce((s,c)=>s+p.shares[c.id],0); const d=st.companies.filter(c=>c.type==='divid').reduce((s,c)=>s+p.shares[c.id],0); return g>=2&&d>=2;} },
];

const TOTAL_ROUNDS = 12, ACTIONS_PER_TURN = 2;

const PRESETS = {
  easy:   { buyLimit:5, forecastLen:3, divEvery:1, startCash:25000, downsideBuffer:1, forecastFog:false },
  normal: { buyLimit:3, forecastLen:2, divEvery:1, startCash:20000, downsideBuffer:0, forecastFog:false },
  hard:   { buyLimit:2, forecastLen:1, divEvery:2, startCash:15000, downsideBuffer:0, forecastFog:true },
};

// ---------------- 헬퍼 ----------------
function buildCompanies(countryKey){
  const country = COUNTRIES[countryKey];
  return SECTORS.map(s=>{
    const baseStart = s.type==='growth'?2000 : s.type==='divid'?1000 : 1500;
    const baseDiv = s.type==='growth' ? 100 : s.type==='divid' ? 250 : 150;
    return { id:s.slot, ico:s.ico, nm:country.co[s.slot], sector:s.slot, type:s.type,
      start:Math.max(500, baseStart+country.startMod), div:Math.max(0, baseDiv+country.divMod), volMod:country.volMod };
  });
}
function shuffle(a){ a=[...a]; for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; }
function movePrice(price, steps){
  let idx = PRICE_STEPS.indexOf(price);
  if(idx<0) idx = PRICE_STEPS.reduce((best,v,i)=>Math.abs(v-price)<Math.abs(PRICE_STEPS[best]-price)?i:best,0);
  idx = Math.max(0, Math.min(PRICE_STEPS.length-1, idx+steps));
  return PRICE_STEPS[idx];
}
// 소프트 바닥: 한 번에 0원(상폐)으로 직행하지 않음. 이미 500원이던 회사만 상폐 가능(경고 라운드).
function moveWithFloor(price, steps){
  let after = movePrice(price, steps);
  if(after===0 && price>500) after=500;
  return after;
}
function netWorth(p, prices, companies){ let s=p.cash; companies.forEach(c=>s+=p.shares[c.id]*prices[c.id]); return s; }
function stockValue(p, prices, companies){ let s=0; companies.forEach(c=>s+=p.shares[c.id]*prices[c.id]); return s; }
function totalShares(p, companies){ let s=0; companies.forEach(c=>s+=p.shares[c.id]); return s; }
function isEventRelevant(ev, prices, companies){
  if(ev.who==='all') return companies.some(c=>prices[c.id]>0);
  return ev.who.some(cid=>prices[cid]>0);
}
function drawPair(deck, prices, companies){
  if(deck.length<2){ const fresh=shuffle([...EVENTS,...EVENTS]); while(fresh.length) deck.push(fresh.pop()); }
  const drawOne=()=>{ for(let i=0;i<20&&deck.length;i++){ const card=deck.pop(); if(isEventRelevant(card,prices,companies)) return card; } return null; };
  const a=drawOne(); let b=drawOne();
  if(b&&a&&b.tx===a.tx&&deck.length){ const c=drawOne(); if(c){ deck.push(b); b=c; } }
  return [a,b].filter(Boolean);
}
function analyzeAdvice(forecast, companies, prices, opt){
  const fog = opt && opt.fog;
  const advice={}; companies.forEach(c=>advice[c.id]={score:0});
  const allEvents=[];
  forecast.forEach((slot,i)=>slot.forEach((ev,evIndex)=>{ if(fog && evIndex===1) return; allEvents.push({ev,slot:i}); }));
  allEvents.forEach(({ev})=>{
    const targets = ev.who==='all' ? companies.map(c=>c.id) : ev.who;
    targets.forEach(cid=>{
      if(!advice[cid]) return;
      if(ev.kind==='div'){ if(ev.divMul>1) advice[cid].score+=1; else if(ev.divMul<1) advice[cid].score-=0.5; }
      else advice[cid].score+=ev.steps;
    });
    if(ev.chain && ev.who!=='all' && advice[ev.chain.who]) advice[ev.chain.who].score+=ev.chain.steps;
  });
  companies.forEach(c=>{ const a=advice[c.id]; a.dir = a.score>0?'buy' : a.score<0?'sell' : null; });
  return advice;
}

// ---------------- 전략 AI ----------------
function affordableBuyables(G,p,state){
  return G.companies.filter(c=> G.prices[c.id]>0 && p.cash>=G.prices[c.id]
    && (state.buyCount[c.id]||0)<state.maxBuy && p.shares[c.id]<MAX_SHARES);
}
const STRATS = {
  random(G,p,state,adv){
    const buys=affordableBuyables(G,p,state);
    const holds=G.companies.filter(c=>p.shares[c.id]>0);
    const pool=[];
    buys.forEach(c=>pool.push({type:'buy',cid:c.id}));
    holds.forEach(c=>pool.push({type:'sell',cid:c.id}));
    pool.push({type:'pass'});
    return pool[Math.floor(Math.random()*pool.length)];
  },
  forecaster(G,p,state,adv){
    const warn=G.companies.find(c=>p.shares[c.id]>0 && adv[c.id].dir==='sell' && G.prices[c.id]>0);
    if(warn && !state.soldThisTurn) { state.soldThisTurn=true; return {type:'sell',cid:warn.id}; }
    const buys=affordableBuyables(G,p,state).filter(c=>adv[c.id].score>0)
      .sort((a,b)=>adv[b.id].score-adv[a.id].score);
    if(buys.length) return {type:'buy',cid:buys[0].id};
    return {type:'pass'};
  },
  gambler(G,p,state,adv){
    if(!state.target){
      const ranked=[...G.companies].filter(c=>G.prices[c.id]>0).sort((a,b)=>adv[b.id].score-adv[a.id].score);
      state.target = ranked.length?ranked[0].id:null;
    }
    const t=state.target;
    if(t && G.prices[t]>0 && p.cash>=G.prices[t] && (state.buyCount[t]||0)<state.maxBuy && p.shares[t]<MAX_SHARES)
      return {type:'buy',cid:t};
    return {type:'pass'};
  },
  diversifier(G,p,state,adv){
    const buys=affordableBuyables(G,p,state).sort((a,b)=>p.shares[a.id]-p.shares[b.id]);
    if(buys.length) return {type:'buy',cid:buys[0].id};
    return {type:'pass'};
  },
  dividend(G,p,state,adv){
    const buys=affordableBuyables(G,p,state)
      .sort((a,b)=>(b.type==='divid')-(a.type==='divid') || b.div-a.div);
    if(buys.length) return {type:'buy',cid:buys[0].id};
    return {type:'pass'};
  },
};
const STRAT_NAMES = Object.keys(STRATS);

function maybeUseCard(G,p,state,adv){
  let i=p.hand.findIndex(c=>c.id==='extra');
  if(i>=0){ p.hand.splice(i,1); state.actionsLeft++; return true; }
  i=p.hand.findIndex(c=>c.id==='flip');
  if(i>=0){
    let eff=0; G.companies.forEach(c=>{ if(p.shares[c.id]>0) eff+=adv[c.id].score*p.shares[c.id]; });
    if(eff<0){ p.hand.splice(i,1); G.flipNext=true; state.actionsLeft--; return true; }
  }
  i=p.hand.findIndex(c=>c.id==='cash');
  if(i>=0 && p.cash<1500){ p.hand.splice(i,1); p.cash+=3000; state.maxBuy=5; state.actionsLeft--; return true; }
  i=p.hand.findIndex(c=>c.id==='div');
  if(i>=0 && totalShares(p,G.companies)>=8){ let t=0; G.companies.forEach(c=>t+=p.shares[c.id]*100); p.hand.splice(i,1); p.cash+=t; state.actionsLeft--; return true; }
  return false;
}

function takeTurn(G,p){
  const adv=analyzeAdvice(G.forecast, G.companies, G.prices, {fog: !!G.opts.forecastFog});
  const state={ actionsLeft:ACTIONS_PER_TURN, buyCount:{}, maxBuy:G.opts.buyLimit, soldThisTurn:false, target:null };
  let guard=0;
  while(state.actionsLeft>0 && guard++<12){
    if(maybeUseCard(G,p,state,adv)) continue;
    const move=STRATS[p.strat](G,p,state,adv);
    if(!move || move.type==='end') break;
    if(move.type==='pass'){ p.cash+=500; state.actionsLeft--; }
    else if(move.type==='buy'){
      const pr=G.prices[move.cid];
      if(pr<=0||p.cash<pr||(state.buyCount[move.cid]||0)>=state.maxBuy||p.shares[move.cid]>=MAX_SHARES) break;
      p.cash-=pr; p.shares[move.cid]++; state.buyCount[move.cid]=(state.buyCount[move.cid]||0)+1; state.actionsLeft--;
    }
    else if(move.type==='sell'){
      if(p.shares[move.cid]<=0) break;
      let price=G.prices[move.cid];
      if(p.insured[move.cid]){ price=Math.max(price,p.insured[move.cid]); delete p.insured[move.cid]; }
      p.cash+=price; p.shares[move.cid]--; state.actionsLeft--;
    }
  }
}

function computeSteps(ev, G){
  let steps = G.flipNext ? -ev.steps : ev.steps;
  if(steps === 0) return 0;
  const sig = G.country.sig || {};
  if(ev.who==='all' && sig.worldAmplify) steps += Math.sign(steps);
  if(Array.isArray(ev.who) && sig.sectorBoost && steps>0 && ev.who.some(w=>sig.sectorBoost.includes(w))) steps += 1;
  if(Array.isArray(ev.who) && sig.techAmplify && ev.who.includes('tech')) steps += Math.sign(steps);
  if(steps>0) steps = Math.max(1, steps + G.country.volMod);
  else        steps = Math.min(-1, steps - G.country.volMod);
  if(steps<0) steps = Math.min(-1, steps + (G.opts.downsideBuffer||0));
  if(sig.compressBig && Math.abs(steps)>=2) steps = Math.sign(steps);
  return steps;
}

function maybeBlackSwan(G){
  const chance = G.country.swanChance || 0;
  if(Math.random() >= chance) return null;
  const alive = G.companies.filter(c=>G.prices[c.id]>0);
  if(!alive.length) return null;
  const victim = alive[Math.floor(Math.random()*alive.length)];
  const before = G.prices[victim.id];
  G.prices[victim.id] = moveWithFloor(before, -(G.country.swanSteps||2));
  return { cid:victim.id, before, after:G.prices[victim.id] };
}
function applyGrowthDrift(G){
  const sig = G.country.sig||{};
  if(!sig.growthDrift || Math.random() >= sig.growthDrift) return [];
  const out=[];
  G.companies.forEach(c=>{ if(G.prices[c.id]>0 && G.prices[c.id]<MAX_PRICE){ const before=G.prices[c.id]; G.prices[c.id]=movePrice(before,1); out.push({cid:c.id,before,after:G.prices[c.id]}); } });
  return out;
}

function resolveRound(G, players){
  const events=G.forecast[0]||[];
  G.prevPrices={...G.prices};
  const changes=[];
  const flip=G.flipNext;
  const divMul={}; G.companies.forEach(c=>divMul[c.id]=1);
  events.forEach(ev=>{
    if(ev.kind==='div'){ const targets=ev.who==='all'?G.companies.map(c=>c.id):ev.who; targets.forEach(cid=>divMul[cid]=ev.divMul); return; }
    const steps = computeSteps(ev, G);
    if(steps===0) return;
    const applyTo=ev.who==='all'?G.companies.map(c=>c.id):ev.who;
    applyTo.forEach(cid=>{ if(G.prices[cid]<=0) return; const before=G.prices[cid]; G.prices[cid]=moveWithFloor(G.prices[cid],steps); changes.push({cid,before,after:G.prices[cid]}); });
    if(ev.chain && ev.who!=='all'){ const cid=ev.chain.who; let cs=flip?-ev.chain.steps:ev.chain.steps; if(G.prices[cid]>0){ const before=G.prices[cid]; G.prices[cid]=moveWithFloor(G.prices[cid],cs); changes.push({cid,before,after:G.prices[cid],chain:true}); } }
  });
  G.flipNext=false;
  applyGrowthDrift(G).forEach(ch=>changes.push({...ch, drift:true}));
  const swan = maybeBlackSwan(G);
  if(swan) changes.push({...swan, swan:true});
  const divThisRound=(G.round % G.opts.divEvery===0);
  players.forEach(p=>{ let total=0;
    if(divThisRound){
      G.companies.forEach(c=>{ if(p.shares[c.id]>0&&c.div>0&&G.prices[c.id]>0) total+=Math.round(p.shares[c.id]*c.div*divMul[c.id]); });
      const distinct = G.companies.filter(c=>p.shares[c.id]>0).length;
      if(distinct>=4) total += DIVERSIFY_BONUS;
    }
    if(total>0){ p.cash+=total; p.divReceived+=total; }
  });
  changes.forEach(ch=>{ if(ch.after===0 && !G.log.delisted.includes(ch.cid)) G.log.delisted.push(ch.cid);
                        if(ch.after===MAX_PRICE && ch.before<MAX_PRICE) G.log.ceilingHits++; });
  players.forEach(p=>p.history.push(netWorth(p,G.prices,G.companies)));
  const justDelisted=changes.filter(ch=>ch.after===0).map(ch=>ch.cid);
  if(justDelisted.length){
    for(let i=0;i<G.forecast.length;i++){
      G.forecast[i]=G.forecast[i].filter(ev=> ev.who==='all'?true:ev.who.some(cid=>G.prices[cid]>0));
      while(G.forecast[i].length<2){ const fresh=drawPair(G.eventDeck,G.prices,G.companies); if(!fresh.length) break; G.forecast[i].push(fresh[0]); if(G.forecast[i].length<2&&fresh[1]) G.forecast[i].push(fresh[1]); }
    }
  }
}

function playGame(countryKey, presetKey, strats){
  const opts=PRESETS[presetKey];
  const companies=buildCompanies(countryKey);
  const prices={}; companies.forEach(c=>prices[c.id]=c.start);
  const goalDeck=shuffle(GOALS);
  const players=[];
  for(let i=0;i<3;i++){
    const shares={}; companies.forEach(c=>shares[c.id]=0);
    players.push({ name:'P'+i, strat:strats[i], cash:opts.startCash, shares, goal:goalDeck[i%goalDeck.length],
      hand:[], insured:{}, divReceived:0, history:[opts.startCash] });
  }
  let actionDeck=shuffle([...ACTIONS,...ACTIONS]);
  players.forEach(p=>{ p.hand=[actionDeck.pop(), actionDeck.pop()]; });
  const eventDeck=shuffle([...EVENTS,...EVENTS,...EVENTS]);
  const forecast=[];
  for(let i=0;i<opts.forecastLen;i++) forecast.push(drawPair(eventDeck, prices, companies));
  const G={ opts, country:COUNTRIES[countryKey], companies, prices, prevPrices:{...prices}, eventDeck, actionDeck, forecast, round:1, flipNext:false,
            log:{ delisted:[], ceilingHits:0 } };
  for(G.round=1; G.round<=TOTAL_ROUNDS; G.round++){
    players.forEach(p=>takeTurn(G,p));
    resolveRound(G, players);
    if(G.round<TOTAL_ROUNDS){ G.forecast.shift(); G.forecast.push(drawPair(G.eventDeck, G.prices, G.companies)); }
  }
  const st={companies, prices:G.prices};
  const results=players.map(p=>{
    const base=netWorth(p,G.prices,companies);
    const goalMet=p.goal.check(p,st);
    const bonus=goalMet?p.goal.reward:0;
    return { strat:p.strat, base, goalMet, goalName:p.goal.nm, bonus, total:base+bonus,
             sv:stockValue(p,G.prices,companies), div:p.divReceived, cash:p.cash, start:opts.startCash };
  });
  results.sort((a,b)=>b.total-a.total);
  return { results, delisted:G.log.delisted.length, ceilingHits:G.log.ceilingHits };
}

// ---------------- 한 조합(셀) 집계 ----------------
function runCell(country, preset, N){
  const cell={ games:0, delistGames:0, delistTotal:0, ceiling:0, gapSum:0, close:0, blowout:0,
    winnerSum:0, loserSum:0, strat:{}, lossPlayers:0, brokePlayers:0, divSum:0, finalNWsum:0, playerCount:0 };
  STRAT_NAMES.forEach(s=>cell.strat[s]={games:0,wins:0});
  const strat={}; STRAT_NAMES.forEach(s=>strat[s]={games:0,wins:0,totalSum:0});
  const goal={}; GOALS.forEach(g=>goal[g.nm]={appear:0,met:0});
  let cw={sum:0,games:0,delistGames:0};
  for(let g=0; g<N; g++){
    const strats=shuffle(STRAT_NAMES).slice(0,3);
    const r=playGame(country, preset, strats);
    cell.games++;
    if(r.delisted>0){ cell.delistGames++; cw.delistGames++; }
    cell.delistTotal+=r.delisted; cell.ceiling+=r.ceilingHits;
    const win=r.results[0], lose=r.results[r.results.length-1];
    const gap=win.total-lose.total;
    cell.gapSum+=gap; if(gap<=5000) cell.close++; if(gap>=20000) cell.blowout++;
    cell.winnerSum+=win.total; cell.loserSum+=lose.total;
    r.results.forEach(res=>{
      cell.strat[res.strat].games++; strat[res.strat].games++; strat[res.strat].totalSum+=res.total;
      cell.playerCount++; cell.divSum+=res.div; cell.finalNWsum+=res.base;
      if(res.total<res.start) cell.lossPlayers++;
      if(res.base<5000) cell.brokePlayers++;
      goal[res.goalName].appear++; if(res.goalMet) goal[res.goalName].met++;
    });
    cell.strat[win.strat].wins++; strat[win.strat].wins++;
    cw.sum+=r.results.reduce((s,x)=>s+x.base,0)/3; cw.games++;
  }
  return { key:country+'|'+preset, country, cell, strat, goal, cw, games:cell.games };
}

// ============================================================
// 워커 모드: 배정받은 조합들 실행 후 결과 전송
// ============================================================
if(!isMainThread){
  const { configs, N } = workerData;
  const out = configs.map(([country,preset])=>runCell(country,preset,N));
  parentPort.postMessage(out);
} else {
  // ============================================================
  // 메인 모드: 조합 분배 → 병렬 실행 → 병합 → 리포트
  // ============================================================
  const N = parseInt(process.argv[2]||'3000',10);
  const countries=Object.keys(COUNTRIES);
  const presets=Object.keys(PRESETS);
  const allConfigs=[];
  for(const c of countries) for(const p of presets) allConfigs.push([c,p]);

  const numWorkers = parseInt(process.argv[3]|| String(Math.min(allConfigs.length, Math.max(2, (os.cpus().length||4)-1))), 10);
  // 라운드로빈 분배
  const chunks=Array.from({length:numWorkers},()=>[]);
  allConfigs.forEach((cfg,i)=>chunks[i%numWorkers].push(cfg));

  const t0=Date.now();
  console.error(`▶ ${N}판/조합 × ${allConfigs.length}조합 = ${(N*allConfigs.length).toLocaleString()}판 | 워커 ${numWorkers}개 병렬`);

  const results=[];
  let done=0;
  chunks.filter(c=>c.length).forEach(chunk=>{
    const w=new Worker(__filename, { workerData:{ configs:chunk, N } });
    w.on('message', cells=>{ results.push(...cells); });
    w.on('error', e=>{ console.error('worker error', e); });
    w.on('exit', ()=>{ if(++done===chunks.filter(c=>c.length).length) finish(); });
  });

  function finish(){
    // 병합
    const agg={};
    const stratGlobal={}; STRAT_NAMES.forEach(s=>stratGlobal[s]={games:0,wins:0,totalSum:0});
    const goalGlobal={}; GOALS.forEach(g=>goalGlobal[g.nm]={appear:0,met:0});
    const countryWealth={}; countries.forEach(c=>countryWealth[c]={sum:0,games:0,delistGames:0});
    let totalGames=0;
    results.forEach(r=>{
      agg[r.key]=r.cell; totalGames+=r.games;
      STRAT_NAMES.forEach(s=>{ stratGlobal[s].games+=r.strat[s].games; stratGlobal[s].wins+=r.strat[s].wins; stratGlobal[s].totalSum+=r.strat[s].totalSum; });
      GOALS.forEach(g=>{ goalGlobal[g.nm].appear+=r.goal[g.nm].appear; goalGlobal[g.nm].met+=r.goal[g.nm].met; });
      countryWealth[r.country].sum+=r.cw.sum; countryWealth[r.country].games+=r.cw.games; countryWealth[r.country].delistGames+=r.cw.delistGames;
    });

    const secs=((Date.now()-t0)/1000).toFixed(2);
    const pct=(a,b)=>b? (100*a/b).toFixed(1)+'%':'—';
    const won=n=>Math.round(n).toLocaleString('en-US');
    let out='';
    out+=`# 시뮬레이션 결과 (병렬)\n\n`;
    out+=`- 조합당 ${N}판 × ${allConfigs.length}조합 = 총 ${totalGames.toLocaleString()}판 · 워커 ${numWorkers}개 · ${secs}초\n`;
    out+=`- 3인 게임, 매 게임 5개 전략 중 3개 무작위 배정 (전략별 공정 승률 = 33.3%)\n\n`;

    out+=`## 1. 전략별 전역 승률\n\n| 전략 | 참가게임 | 승리 | 승률 | 평균최종자산 |\n|---|---|---|---|---|\n`;
    const order=[...STRAT_NAMES].sort((a,b)=>stratGlobal[b].wins/stratGlobal[b].games - stratGlobal[a].wins/stratGlobal[a].games);
    order.forEach(s=>{ const x=stratGlobal[s]; out+=`| ${s} | ${x.games} | ${x.wins} | ${pct(x.wins,x.games)} | ${won(x.totalSum/x.games)}원 |\n`; });

    out+=`\n## 2. 목표카드 달성률 (B1 버그 검증)\n\n| 목표 | 등장 | 달성 | 달성률 |\n|---|---|---|---|\n`;
    GOALS.forEach(g=>{ const x=goalGlobal[g.nm]; out+=`| ${g.nm} | ${x.appear} | ${x.met} | ${pct(x.met,x.appear)} |\n`; });

    out+=`\n## 3. 나라별 평균 부 & 위험\n\n| 나라 | 평균 최종 주식자산(인당) | 상장폐지 발생 게임 비율 |\n|---|---|---|\n`;
    countries.forEach(c=>{ const x=countryWealth[c]; out+=`| ${COUNTRIES[c].name} | ${won(x.sum/x.games)}원 | ${pct(x.delistGames, x.games)} |\n`; });

    out+=`\n## 4. 조합별 상세\n\n| 나라 | 난이도 | 상폐게임% | 천장도달/판 | 접전%(≤5천) | 압승%(≥2만) | 평균격차 | 손실플레이어% | 평균인당배당 |\n|---|---|---|---|---|---|---|---|---|\n`;
    const presetLabel={easy:'초급',normal:'표준',hard:'고급'};
    for(const country of countries){ for(const preset of presets){ const c=agg[country+'|'+preset]; if(!c) continue;
      out+=`| ${COUNTRIES[country].name} | ${presetLabel[preset]} | ${pct(c.delistGames,c.games)} | ${(c.ceiling/c.games).toFixed(2)} | ${pct(c.close,c.games)} | ${pct(c.blowout,c.games)} | ${won(c.gapSum/c.games)}원 | ${pct(c.lossPlayers,c.playerCount)} | ${won(c.divSum/c.playerCount)}원 |\n`;
    }}

    out+=`\n## 5. 난이도별 요약 (전 나라 평균)\n\n| 난이도 | 상폐게임% | 접전% | 압승% | 평균격차 | 손실플레이어% | 평균인당배당 | 평균인당최종자산 |\n|---|---|---|---|---|---|---|---|\n`;
    presets.forEach(preset=>{ let g=0,dl=0,cl=0,bl=0,gap=0,loss=0,pc=0,div=0,nw=0;
      countries.forEach(country=>{ const c=agg[country+'|'+preset]; if(!c) return; g+=c.games; dl+=c.delistGames; cl+=c.close; bl+=c.blowout; gap+=c.gapSum; loss+=c.lossPlayers; pc+=c.playerCount; div+=c.divSum; nw+=c.finalNWsum; });
      out+=`| ${presetLabel[preset]} | ${pct(dl,g)} | ${pct(cl,g)} | ${pct(bl,g)} | ${won(gap/g)}원 | ${pct(loss,pc)} | ${won(div/pc)}원 | ${won(nw/pc)}원 |\n`;
    });

    console.log(out);
    console.error(`✔ 완료: ${totalGames.toLocaleString()}판 / ${secs}초`);
  }
}
