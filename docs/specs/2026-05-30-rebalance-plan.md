# 밸런스 & 나라 개성 리디자인 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 나라마다 뚜렷이 다른 개성(변동성·배당·시그니처)을 주고, 난이도를 맛보기→판단→리스크관리로 재설계하며, 몰빵↔분산 모순을 범용 레버 A+B+C로 깨고, 죽은 목표·기록저장 버그를 고친다. 모든 변경을 시뮬레이터에 거울처럼 반영해 54,000판으로 재검증한다.

**Architecture:** 게임 로직은 현재 `index.html`(브라우저)과 `sim/simulate.js`(Node)에 이중 존재한다. Task 0에서 Node 측 로직을 `sim/engine.js` 모듈로 추출(러너/체크가 공유)하고, 이후 모든 메커니즘은 **`engine.js`와 `index.html` 양쪽에 동일하게** 적용한다. 단위 검증은 `sim/checks.js`(결정적 어서션), 통합/밸런스 검증은 54k 시뮬.

**Tech Stack:** 단일 HTML(인라인 JS, 외부 의존성 0 유지) · Node 22 worker_threads · 테스트 프레임워크 없음 → Node 어서션 스크립트 + 시뮬 지표.

**근거 스펙:** `docs/specs/2026-05-30-rebalance-design.md` (섹션 1·2·3 ✅승인). 기준선: `DEV_NOTES.md > 시뮬레이션 재검증(54k)`.

---

## 🎛️ 파라미터 표 (초기값 — Task 9에서 시뮬로 튜닝)

전역 상수:
- `MAX_SHARES = 8` (기존 15)
- `DIVERSIFY_BONUS = 800` (배당 라운드에 서로 다른 4종↑ 보유 시 지급)

나라별(기존 `COUNTRIES`에 필드 추가):

| 나라 | volMod | divMod | swanChance | swanSteps | sig (시그니처 플래그) |
|---|---|---|---|---|---|
| korea  | 0  | **-50** | 0.10 | 3 | `{ worldAmplify:true, sectorBoost:['tech','auto'] }` |
| usa    | -1 | +50 | 0.04 | 2 | `{}` (배당왕 = divMod로 표현) |
| japan  | -1 | +30 | 0.04 | 2 | `{ compressBig:true }` |
| china  | +1 | **-30** | 0.20 | 3 | `{}` (블랙스완 강버전) |
| taiwan | 0  | 0  | 0.10 | 3 | `{ techAmplify:true }` |
| india  | +1 | -50 | 0.12 | 3 | `{ growthDrift:0.4 }` |

(startMod 유지: usa+500, japan+200, china-200, india-500, korea/taiwan 0)

배당 표시 등급(💰 개수, 선택 화면용): usa 3, japan 3, taiwan 2, korea 1, china 1, india 1.

난이도(`PRESETS`에 필드 추가):

| preset | buyLimit | forecastLen | divEvery | startCash | coachOn | downsideBuffer | forecastFog |
|---|---|---|---|---|---|---|---|
| easy   | 5 | 3 | 1 | 25000 | true  | **1** | false |
| normal | 3 | 2 | 1 | 20000 | false | 0 | false |
| hard   | 2 | 1 | **2** | 15000 | false | 0 | **true** |

---

## 🎯 목표 지표 (Task 9 합격 기준)
- 전략 승률: **몰빵 ≤ 42%**, 분산·예보추종이 몰빵과 ±10%p 이내(어느 것도 45% 초과 금지), 무작위 최저 유지.
- 목표카드 6종 **모두 달성률 > 0%**.
- 상장폐지 발생률: 중국·인도 < 80%, 그 외 < 65% (현재 77~95% → 하향).
- 압승률(≥2만) < 45%, 접전률(≤5천) > 10% (현재 ~56%/~5%).
- 고급 인당 배당 ≥ 표준의 50% (현재 32%).

---

## Task 0: 시뮬 로직을 engine.js 모듈로 추출 (회귀 가드)

**Files:**
- Create: `sim/engine.js`
- Modify: `sim/simulate.js` (러너만 남김)

- [ ] **Step 1: engine.js 생성** — 현재 `sim/simulate.js`의 상수·헬퍼·전략·`playGame`·`runCell`을 그대로 옮기고 맨 끝에 export 추가:

```js
module.exports = {
  SECTORS, COUNTRIES, EVENTS, ACTIONS, GOALS, PRESETS,
  PRICE_STEPS, MAX_PRICE, MIN_PRICE, MAX_SHARES, TOTAL_ROUNDS, ACTIONS_PER_TURN,
  buildCompanies, shuffle, movePrice, netWorth, stockValue, totalShares,
  isEventRelevant, drawPair, analyzeAdvice, STRATS, STRAT_NAMES,
  maybeUseCard, takeTurn, resolveRound, playGame, runCell,
};
```
(worker 분기 코드는 engine.js에 넣지 않는다 — 순수 로직만.)

- [ ] **Step 2: simulate.js를 러너로 축소** — 상단에 `const E = require('./engine');` 후, worker/main 분기와 리포트 생성만 남기고 `runCell`은 `E.runCell` 사용. 워커는 `E.runCell(country,preset,N)` 호출.

- [ ] **Step 3: 회귀 실행** — Run: `node sim/simulate.js 3000`
Expected: 5만4천판 완료, 전략 승률 몰빵 ≈ 61~62% / 무작위 ≈ 4~5% (리팩터 전과 동일 범위). 결과를 `sim/results-3x.md`와 비교해 ±1.5%p 이내면 통과.

- [ ] **Step 4: 커밋**
```bash
git add sim/engine.js sim/simulate.js
git commit -m "refactor(sim): split engine.js module from runner (회귀 동일 확인)"
```

---

## Task 1: 데이터 모델 확장 (engine.js + index.html)

**Files:**
- Modify: `sim/engine.js` (COUNTRIES, PRESETS, MAX_SHARES, 신규 상수)
- Modify: `index.html` (동일 위치: COUNTRIES, PRESETS, MAX_SHARES 정의부)
- Create: `sim/checks.js`

- [ ] **Step 1: checks.js에 실패 테스트 작성**
```js
const E = require('./engine');
let fail = 0;
const ok = (cond, msg) => { if(!cond){ console.error('✗', msg); fail++; } else console.log('✓', msg); };

// 데이터 모델
ok(E.MAX_SHARES === 8, 'MAX_SHARES is 8');
ok(E.COUNTRIES.korea.divMod === -50, 'korea divMod -50 (저배당)');
ok(E.COUNTRIES.taiwan.sig && E.COUNTRIES.taiwan.sig.techAmplify, 'taiwan techAmplify');
ok(E.COUNTRIES.korea.sig && E.COUNTRIES.korea.sig.worldAmplify, 'korea worldAmplify');
ok(typeof E.COUNTRIES.china.swanChance === 'number', 'china swanChance defined');
ok(E.PRESETS.easy.downsideBuffer === 1, 'easy downsideBuffer 1');
ok(E.PRESETS.hard.forecastFog === true, 'hard forecastFog');
ok(E.PRESETS.hard.divEvery === 2, 'hard divEvery 2');

console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: 실패 확인** — Run: `node sim/checks.js`
Expected: FAIL (MAX_SHARES 15, divMod 등 미반영).

- [ ] **Step 3: engine.js 수정** — 파라미터 표대로:
  - `const MAX_SHARES = 8;`
  - 직후 `const DIVERSIFY_BONUS = 800;`
  - COUNTRIES 각 항목에 `swanChance/swanSteps/sig/divTier` 추가, divMod를 표대로 변경(korea -50, china -30, india -50).
  - PRESETS 각 항목에 `coachOn/downsideBuffer/forecastFog` 추가, hard.divEvery 2로.
  - exports에 `DIVERSIFY_BONUS` 추가.

- [ ] **Step 4: index.html 동일 반영** — `index.html`의 `COUNTRIES`(L293~332), `PRESETS`(L423~427), `MAX_SHARES`(L355)에 같은 값 적용. `const DIVERSIFY_BONUS = 800;`도 추가(MAX_SHARES 근처). 단, index.html의 COUNTRIES는 `flavor`도 쓰므로 기존 필드 보존하며 신규 필드만 추가.

- [ ] **Step 5: 통과 확인** — Run: `node sim/checks.js` → Expected: ALL PASS.

- [ ] **Step 6: 커밋**
```bash
git add sim/engine.js index.html sim/checks.js
git commit -m "feat(balance): 나라/난이도 데이터 모델 확장 + 상한 8주 (engine·index 동기)"
```

---

## Task 2: 이벤트 step 계산 통합 + 나라 시그니처 (computeSteps)

집중 위험·나라 개성을 step 계산 한 곳에 모은다.

**Files:** Modify `sim/engine.js`, `index.html` (resolveRound), `sim/checks.js`

- [ ] **Step 1: checks.js에 테스트 추가** (직전 `console.log(fail...)` 위에 삽입)
```js
// computeSteps 시그니처
const mk = (country)=>({ country:E.COUNTRIES[country], opts:E.PRESETS.normal, flipNext:false });
ok(E.computeSteps({who:['tech'],steps:1}, mk('taiwan')) === 2, 'taiwan: tech +1 → +2 (증폭)');
ok(E.computeSteps({who:'all',steps:1},   mk('korea'))  === 2, 'korea: all +1 → +2 (세계증폭)');
ok(E.computeSteps({who:['tech'],steps:1},mk('korea'))  === 2, 'korea: tech +1 → +2 (섹터강세)');
ok(E.computeSteps({who:['tech'],steps:3},mk('japan'))  === 1, 'japan: +3 → +1 (큰사건 압축)');
ok(E.computeSteps({who:['tech'],steps:-2},mk('japan')) === -1, 'japan: -2 → -1 (압축)');
ok(E.computeSteps({who:['tech'],steps:-2},{country:E.COUNTRIES.usa,opts:E.PRESETS.easy,flipNext:false}) === -1, 'easy buffer: usa -2 완화');
```

- [ ] **Step 2: 실패 확인** — Run: `node sim/checks.js` → Expected: FAIL (`computeSteps` 미정의).

- [ ] **Step 3: engine.js에 computeSteps 추가** (resolveRound 위)
```js
function computeSteps(ev, G){
  let steps = G.flipNext ? -ev.steps : ev.steps;
  if(steps === 0) return 0;
  const sig = G.country.sig || {};
  // 한국: 세계경기(all) 증폭
  if(ev.who==='all' && sig.worldAmplify) steps += Math.sign(steps);
  // 한국: tech/auto 호재 강세
  if(Array.isArray(ev.who) && sig.sectorBoost && steps>0 && ev.who.some(w=>sig.sectorBoost.includes(w))) steps += 1;
  // 대만: tech 사건 증폭(양방향)
  if(Array.isArray(ev.who) && sig.techAmplify && ev.who.includes('tech')) steps += Math.sign(steps);
  // 나라 변동성
  if(steps>0) steps = Math.max(1, steps + G.country.volMod);
  else        steps = Math.min(-1, steps - G.country.volMod);
  // 초급: 하락 완충
  if(steps<0) steps = Math.min(-1, steps + (G.opts.downsideBuffer||0));
  // 일본: 큰 사건 압축
  if(sig.compressBig && Math.abs(steps)>=2) steps = Math.sign(steps);
  return steps;
}
```
exports에 `computeSteps` 추가.

- [ ] **Step 4: resolveRound가 computeSteps 사용하도록 교체** (engine.js + index.html 동일). 기존 인라인 step 계산 블록
```js
let steps=flip?-ev.steps:ev.steps;
const volMod=G.companies[0]?.volMod||0;
if(steps>0) steps=Math.max(1,steps+volMod); else if(steps<0) steps=Math.min(-1,steps-volMod);
```
를 다음으로 교체:
```js
const steps = computeSteps(ev, G);
if(steps===0 && ev.kind!=='div') return;
```
체인도 동일 정책 유지(체인은 단순 ±, 시그니처 미적용 — 의도). index.html은 `G.country`가 게임 상태에 있으므로 `computeSteps(ev, G)` 그대로 사용 가능(이미 `G.country` 존재).

- [ ] **Step 5: 통과 확인** — Run: `node sim/checks.js` → Expected: ALL PASS.

- [ ] **Step 6: 커밋**
```bash
git add sim/engine.js index.html sim/checks.js
git commit -m "feat(flavor): 나라 시그니처 step 계산 통합 (대만증폭/한국출렁/일본압축/초급완충)"
```

---

## Task 3: 성장 드리프트(인도) + 블랙스완(레버 A)

**Files:** Modify `sim/engine.js`, `index.html` (resolveRound), `sim/checks.js`

- [ ] **Step 1: checks.js에 테스트 추가**
```js
// 블랙스완: 100% 확률로 강제 시 한 종목 하락
{
  const G = { country:{...E.COUNTRIES.china, swanChance:1, swanSteps:3}, companies:E.buildCompanies('china'),
              prices:{}, opts:E.PRESETS.normal };
  G.companies.forEach(c=>G.prices[c.id]=3000);
  const ev = E.maybeBlackSwan(G);
  ok(ev && G.prices[ev.cid] < 3000, '블랙스완: 한 종목 하락 발생');
}
{
  const G = { country:{...E.COUNTRIES.usa, swanChance:0}, companies:E.buildCompanies('usa'), prices:{}, opts:E.PRESETS.normal };
  G.companies.forEach(c=>G.prices[c.id]=3000);
  ok(E.maybeBlackSwan(G) === null, '블랙스완: 확률 0이면 미발생');
}
```

- [ ] **Step 2: 실패 확인** — Run: `node sim/checks.js` → FAIL (`maybeBlackSwan` 미정의).

- [ ] **Step 3: engine.js에 함수 추가**
```js
// 레버 A — 만능 깜짝사건(예보에 없는 충격). 위험국일수록 swanChance↑
function maybeBlackSwan(G){
  const chance = G.country.swanChance || 0;
  if(Math.random() >= chance) return null;
  const alive = G.companies.filter(c=>G.prices[c.id]>0);
  if(!alive.length) return null;
  const victim = alive[Math.floor(Math.random()*alive.length)];
  const before = G.prices[victim.id];
  G.prices[victim.id] = movePrice(before, -(G.country.swanSteps||2));
  return { cid:victim.id, before, after:G.prices[victim.id] };
}
// 인도 성장 드리프트 — 매 라운드 확률적으로 살아있는 전 종목 +1
function applyGrowthDrift(G){
  const sig = G.country.sig||{};
  if(!sig.growthDrift || Math.random() >= sig.growthDrift) return [];
  const out=[];
  G.companies.forEach(c=>{ if(G.prices[c.id]>0 && G.prices[c.id]<MAX_PRICE){ const before=G.prices[c.id]; G.prices[c.id]=movePrice(before,1); out.push({cid:c.id,before,after:G.prices[c.id]}); } });
  return out;
}
```
exports에 둘 다 추가.

- [ ] **Step 4: resolveRound에 연결** (engine.js + index.html) — 기본 이벤트 적용 직후, 배당 계산 **전**에:
```js
// 인도 성장 드리프트
applyGrowthDrift(G).forEach(ch=>changes.push({...ch, drift:true}));
// 레버 A 블랙스완
const swan = maybeBlackSwan(G);
if(swan){ changes.push({...swan, swan:true}); }
```
(`changes`에 합류시켜 상장폐지/천장 추적·표시에 자연 반영. index.html은 추가로 `G.lastChanges`에 `swan` 정보 보관 → Task 7에서 연출.)

- [ ] **Step 5: 통과 확인** — Run: `node sim/checks.js` → ALL PASS.

- [ ] **Step 6: 커밋**
```bash
git add sim/engine.js index.html sim/checks.js
git commit -m "feat(balance): 레버A 블랙스완 + 인도 성장 드리프트"
```

---

## Task 4: 분산 보너스(레버 C) + 상한 8주(레버 B) 적용 검증

레버 B(MAX_SHARES=8)는 Task 1에서 상수만 바꿈 → 여기서 매수 로직이 실제로 8에서 막히는지 + 레버 C 지급을 검증.

**Files:** Modify `sim/engine.js`, `index.html` (resolveRound 배당부, buy), `sim/checks.js`

- [ ] **Step 1: checks.js 테스트 추가**
```js
// 레버 C — 4종↑ 보유 시 배당 라운드 분산 보너스
{
  const companies=E.buildCompanies('usa');
  const G={ opts:{...E.PRESETS.normal}, companies, prices:{}, country:{...E.COUNTRIES.usa,swanChance:0,sig:{}},
            forecast:[[]], round:1, flipNext:false, log:{delisted:[],ceilingHits:0} };
  companies.forEach(c=>G.prices[c.id]=2000);
  // 4종 보유 플레이어 vs 1종 보유 플레이어
  const mkP=(shareMap)=>{ const shares={}; companies.forEach(c=>shares[c.id]=shareMap[c.id]||0); return {name:'x',cash:0,shares,insured:{},divReceived:0,history:[0]}; };
  const pDiv = mkP({tech:1,shop:1,bank:1,auto:1});
  const pConc= mkP({tech:4});
  E.resolveRound(G, [pDiv, pConc]);
  ok(pDiv.divReceived >= E.DIVERSIFY_BONUS, '분산(4종) 보너스 지급');
  ok(pConc.divReceived < pDiv.divReceived, '집중(1종)은 분산 보너스 없음');
}
```

- [ ] **Step 2: 실패 확인** — Run: `node sim/checks.js` → FAIL (보너스 미지급).

- [ ] **Step 3: resolveRound 배당부 수정** (engine.js + index.html) — 기존 플레이어 배당 루프에서 보너스 추가:
```js
players.forEach(p=>{
  let total=0;
  if(divThisRound){
    G.companies.forEach(c=>{ if(p.shares[c.id]>0&&c.div>0&&G.prices[c.id]>0) total+=Math.round(p.shares[c.id]*c.div*divMul[c.id]); });
    const distinct = G.companies.filter(c=>p.shares[c.id]>0).length;
    if(distinct>=4) total += DIVERSIFY_BONUS; // 레버 C
  }
  if(total>0){ p.cash+=total; if('dividendCount' in p) p.dividendCount++; p.divReceived = (p.divReceived||0)+total; G.log&&G.log.divTotals&&(G.log.divTotals[p.name]=(G.log.divTotals[p.name]||0)+total); }
});
```
(index.html은 `p.dividendCount`·`G.log.divTotals` 존재 → 유지. engine.js는 divReceived만.)

- [ ] **Step 4: 통과 확인** — Run: `node sim/checks.js` → ALL PASS. 추가로 index.html 매수 상한: 브라우저에서 한 회사 8주까지만 매수되는지 수동 확인(스모크).

- [ ] **Step 5: 커밋**
```bash
git add sim/engine.js index.html sim/checks.js
git commit -m "feat(balance): 레버C 분산 보너스 + 레버B 상한8주 검증"
```

---

## Task 5: 난이도 장치 — 고급 예보 안개(forecastFog)

초급 완충(Task 2)·고급 divEvery2(Task 1)는 반영됨. 여기서 **고급 예보 안개**(슬롯 사건 2개 중 index1 방향 숨김)를 AI/표시·분석에 적용.

**Files:** Modify `sim/engine.js` (analyzeAdvice + takeTurn 전달), `index.html` (analyzeAdvice·forecast 표시), `sim/checks.js`

- [ ] **Step 1: checks.js 테스트 추가**
```js
// forecastFog: 분석이 index1 사건 방향을 무시
{
  const companies=E.buildCompanies('korea');
  const prices={}; companies.forEach(c=>prices[c.id]=2000);
  const slot=[ {who:['tech'],steps:3}, {who:['bank'],steps:2} ]; // index1=bank 숨김 대상
  const advFog = E.analyzeAdvice([slot], companies, prices, {fog:true});
  const advAll = E.analyzeAdvice([slot], companies, prices, {fog:false});
  ok(advAll.bank.score === 2 && advFog.bank.score === 0, 'fog: index1(bank) 방향 숨김');
  ok(advFog.tech.score === 3, 'fog: index0(tech)은 그대로');
}
```

- [ ] **Step 2: 실패 확인** — Run: `node sim/checks.js` → FAIL.

- [ ] **Step 3: analyzeAdvice에 fog 파라미터** (engine.js + index.html)
```js
function analyzeAdvice(forecast, companies, prices, opt){
  const fog = opt && opt.fog;
  const advice={}; companies.forEach(c=>advice[c.id]={score:0});
  const allEvents=[];
  forecast.forEach((slot,i)=>slot.forEach((ev,evIndex)=>{ if(fog && evIndex===1) return; allEvents.push({ev,slot:i}); }));
  /* ...이하 기존 동일... */
}
```

- [ ] **Step 4: 호출부에 fog 전달** — engine.js `takeTurn`:
```js
const adv=analyzeAdvice(G.forecast, G.companies, G.prices, {fog: !!G.opts.forecastFog});
```
index.html은 `coachPanelHTML`/`tradeCardHTML`의 `analyzeAdvice()` 호출에 `{fog: !!G.setupOpts.forecastFog}` 전달.

- [ ] **Step 5: index.html 예보 표시에 안개 적용** — `miniEvHTML`/`forecastHTML`에서 hard일 때 슬롯의 index1 사건은 방향(▲▼·효과)을 숨기고 "❓ 방향 비밀"로 렌더. (회사/아이콘은 표시.)

- [ ] **Step 6: 통과 확인** — Run: `node sim/checks.js` → ALL PASS.

- [ ] **Step 7: 커밋**
```bash
git add sim/engine.js index.html sim/checks.js
git commit -m "feat(difficulty): 고급 예보 안개(방향 일부 숨김) 분석·표시 반영"
```

---

## Task 6: 버그 수정 — B1 죽은 목표 재정의 + B2 localStorage

**Files:** Modify `sim/engine.js` (GOALS), `index.html` (GOALS + storage), `sim/checks.js`

- [ ] **Step 1: checks.js 테스트 추가**
```js
// B1: 모험가/안전 제일이 현재 섹터로 달성 가능
{
  const companies=E.buildCompanies('korea');
  const prices={}; companies.forEach(c=>prices[c.id]=2000);
  const st={companies, prices};
  const G_adv = E.GOALS.find(g=>g.nm==='모험가');
  const G_saf = E.GOALS.find(g=>g.nm==='안전 제일');
  const pAdv={cash:0,shares:{tech:2,game:1,phone:0,auto:0,shop:0,bank:0}};
  const pSaf={cash:0,shares:{shop:2,bank:1,tech:0,phone:0,auto:0,game:0}};
  ok(G_adv.check(pAdv, st) === true, '모험가: 성장주 3주↑ 달성 가능');
  ok(G_saf.check(pSaf, st) === true, '안전 제일: 배당주만 보유 달성 가능');
}
```

- [ ] **Step 2: 실패 확인** — Run: `node sim/checks.js` → FAIL (space/toy/bakery 참조).

- [ ] **Step 3: GOALS 재정의** (engine.js + index.html 동일) — 두 항목 교체:
```js
{ ico:'🚀', nm:'모험가', desc:'성장주(💻반도체·🎮게임) 합쳐 3주 이상 보유', reward:4000,
  check:(p,st)=>{ const g=(st?.companies||COMPANIES).filter(c=>c.type==='growth').reduce((s,c)=>s+(p.shares[c.id]||0),0); return g>=3; } },
{ ico:'🛡️', nm:'안전 제일', desc:'배당주(🛒쇼핑·🏦은행)만 보유', reward:2500,
  check:(p,st)=>{ const comps=(st?.companies||COMPANIES); const has=comps.filter(c=>p.shares[c.id]>0); return has.length>0 && has.every(c=>c.type==='divid'); } },
```
(index.html은 `st`가 게임 상태 `G`이고 `COMPANIES` 전역 존재 → `(st&&st.companies)||COMPANIES` 형태로 안전 처리. engine.js는 항상 st.companies 전달됨.)

- [ ] **Step 4: B2 — index.html 저장소를 localStorage로** — `saveGameRecord`/`showHistory`/`confirmClear`의 `window.storage.get/set/delete`를 동기 localStorage로 교체:
```js
// 저장
localStorage.setItem('game-history', JSON.stringify(list));
// 로드
const raw = localStorage.getItem('game-history'); let list = raw ? JSON.parse(raw) : [];
// 삭제
localStorage.removeItem('game-history');
```
`async/await`·`window.storage` 의존 제거(함수는 동기로 단순화). 예외는 try/catch 유지.

- [ ] **Step 5: 통과 확인** — Run: `node sim/checks.js` → ALL PASS. 브라우저 스모크: 한 판 끝낸 뒤 "지난 기록 보기"에 기록이 남는지 확인.

- [ ] **Step 6: 커밋**
```bash
git add sim/engine.js index.html sim/checks.js
git commit -m "fix: B1 죽은 목표(모험가·안전제일) 재정의 + B2 기록저장 localStorage"
```

---

## Task 7: UI 노출 — 나라 선택 화면 배지·아이용 카피 + 깜짝/안개 연출

**Files:** Modify `index.html` (renderSetup의 country-grid·country-detail, showEventReveal, CSS), 데이터의 kid/tip/divTier 사용

- [ ] **Step 1: 나라 데이터에 표시용 텍스트 추가** — index.html COUNTRIES 각 항목에 `kid`(선택화면 한 줄), `tip`(규칙용), `divTier`(💰 개수) 추가. 문구는 스펙 섹션1 표 사용. 예 korea: `kid:'만능손! 반도체·자동차 잘해요. 잘되면 확 세지만 세계 흔들리면 출렁. 용돈은 짠 대신 회사를 키워요.', tip:'한 곳에 다 걸지 말기', divTier:1`.

- [ ] **Step 2: country-btn / country-detail 렌더 수정** — 선택 버튼에 변동성 배지(🛡️/🌶️는 volMod·sig로 산출)와 배당 배지(`'💰'.repeat(c.divTier)`) 표시. `countryDetailHTML`에 `c.kid` 한 줄 노출.
```js
function dividendBadge(c){ return '💰'.repeat(c.divTier||1); }
function riskBadge(c){ const s=c.sig||{}; if(c.volMod<0||s.compressBig) return '🛡️'; if(c.volMod>0||s.worldAmplify||s.techAmplify||(c.swanChance>=0.15)) return '🌶️'; return '🌤️'; }
```
country-btn 내부에 `<div class="ct-badge">${riskBadge(c)} ${dividendBadge(c)}</div>` 추가, `.ct-badge{font-size:11px;opacity:.85;}` CSS.

- [ ] **Step 3: 블랙스완/드리프트 연출** — `showEventReveal`에서 `G.lastChanges.changes`에 `swan:true`인 항목이 있으면 상단에 빨강 강조 배너 "❗깜짝 사건! 아무도 몰랐던 일이 터졌어요" + 해당 회사/하락 표시. `drift:true`는 "🌱 (인도) 천천히 자랐어요" 작은 표기.

- [ ] **Step 4: 스모크 확인** — 브라우저로 `index.html` 열어: ① 나라 선택 화면에 배지·아이용 한 줄 보임 ② 중국으로 한 판 돌려 깜짝 사건 배너가 가끔 뜸. (자동 테스트 없음 — 육안.)

- [ ] **Step 5: 커밋**
```bash
git add index.html
git commit -m "feat(ui): 나라 선택 배지·아이용 설명 + 깜짝사건/성장 드리프트 연출"
```

---

## Task 8: 문서 갱신 — 인앱 규칙 + STOCK_MARKET.md

**Files:** Modify `index.html` (DOCS.rules·concepts), `docs/STOCK_MARKET.md`

- [ ] **Step 1: 인앱 규칙(DOCS.rules) 갱신** — 나라 선택 설명에 "나라마다 변동성·배당·특기가 달라요" + 각 나라 `tip` 한 줄. 새 규칙 반영: 한 회사 최대 **8주**, 4종↑ 보유 시 분산 보너스, 가끔 예보에 없는 깜짝 사건, 고급은 예보 일부 비공개.

- [ ] **Step 2: STOCK_MARKET.md 등급표 갱신** — 표를 3축(변동성·배당💰·시그니처)과 일치시키고, 한국=저배당·성장, 대만≠한국(칩 증폭) 반영.

- [ ] **Step 3: 커밋**
```bash
git add index.html docs/STOCK_MARKET.md
git commit -m "docs: 인앱 규칙·STOCK_MARKET를 신 메커니즘과 일치"
```

---

## Task 9: 54,000판 재검증 + 튜닝 루프

**Files:** Run `sim/simulate.js`; 필요 시 `sim/engine.js`·`index.html` 파라미터 동시 조정

- [ ] **Step 1: 시뮬이 신 메커니즘을 반영하는지 확인** — `sim/engine.js`의 `playGame`/`resolveRound`/`takeTurn`이 Task 2~6 변경을 모두 포함하는지 점검(특히 computeSteps·blackSwan·growthDrift·diversifyBonus·fog·새 GOALS). 누락 시 추가.

- [ ] **Step 2: 재검증 실행** — Run: `node sim/simulate.js 3000 | tee sim/results-after.md`
Expected: 54,000판 완료.

- [ ] **Step 3: 목표 지표 대조** — `sim/results-after.md`를 "🎯 목표 지표"와 비교:
  - 몰빵 ≤42% / 분산·예보추종 45% 이하 & 몰빵과 ±10%p / 무작위 최저
  - 목표 6종 모두 >0%
  - 상폐율·압승율 하향, 접전율·고급배당 상향

- [ ] **Step 4: 미달 시 튜닝** — 아래 노브를 **engine.js·index.html 동시** 조정 후 Step 2 반복:
  - 몰빵 여전히 강함 → swanChance↑(전 나라 +0.03~0.05) 또는 MAX_SHARES 8→6 또는 DIVERSIFY_BONUS↑.
  - 분산이 과도하게 1위 → DIVERSIFY_BONUS↓ 또는 swanSteps↓.
  - 상폐 과다 → 위험국 volMod 영향 완화/0원 직전 바닥(별도 검토).
  - 고급 배당 부족 → hard.divEvery 2 유지 + 배당단가 보정.

- [ ] **Step 5: 합격 시 DEV_NOTES에 "시뮬레이션 #2(after)" 기록** — before/after 표(전략 승률·목표 달성·상폐·압승·접전·고급배당)와 최종 채택 파라미터 표를 추가.

- [ ] **Step 6: 최종 커밋 & 배포**
```bash
git add sim/ index.html docs/
git commit -m "balance: 54k 재검증 통과 — 최종 파라미터 확정 (몰빵↔분산 균형)"
```
이후 `/deploy`로 아이패드 반영.

---

## 실행 순서 메모
- Task 0 → 1 → 2 → 3 → 4 → 5 → 6 (엔진/로직) → 7 → 8 (UI/문서) → 9 (검증·튜닝).
- 각 Task는 `engine.js`와 `index.html`을 **항상 같이** 바꾼다(둘 중 하나만 바꾸면 재검증이 거짓이 됨).
- `node sim/checks.js`는 매 Task 후 전체 통과해야 한다(누적).
