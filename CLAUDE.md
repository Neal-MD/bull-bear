# CLAUDE.md

이 파일은 Claude Code가 이 프로젝트에서 작업할 때 참고하는 컨텍스트입니다.

---

## 프로젝트 개요

**불앤베어 꼬마투자단**: 가족이 함께 즐기는 주식 투자 보드게임. 초3 + 부모님 대상 금융 교육.

게임 자체는 단일 `index.html` 파일이고, 브라우저에서 그냥 열면 작동합니다. 빌드 도구, npm, 의존성 일절 없음.

---

## 핵심 설계 원칙 (반드시 지켜주세요)

이 게임은 단순 오락이 아니라 **교육 도구**입니다. 코드를 수정할 때 다음 원칙을 깨지 마세요:

### 1. 교육적 정확성 > 게임 재미
- 게임 메커니즘이 실제 주식 시장의 잘못된 인식을 심으면 안 됩니다.
- 예: "예보 카드는 게임 장치일 뿐, 진짜 시장에선 미래를 알 수 없다"는 메시지를 인앱 문서/규칙서에 반드시 유지.
- 투자 도우미 추천도 "정답이 아님"을 명시.

### 2. 초3 아이가 이해할 수 있어야 함
- UI 텍스트는 어려운 한자어·영어 약어 자제 (예: "ROI" X, "수익률" 또는 "얼마 벌었어요" O)
- 카드·이벤트 설명은 한 줄에 의미가 전달되어야 함
- 색깔로 의미 구분 (초록=상승/긍정, 빨강=하락/위험, 노랑=배당/주목)

### 3. 가족이 함께하는 분위기
- 한 기기를 돌려가며 플레이(pass-and-play). 멀티 디바이스 동기화 X (의도적 단순함)
- 라운드 결과 화면에서 모든 플레이어의 자산 변화가 보여야 함 (긴장감)
- 비밀 목표 카드는 본인에게만 보임 (pass 스크린으로 보호)

### 4. 밸런스는 시즌2 균형점 (시뮬레이션으로 검증됨)
자세한 근거: `docs/DEV_HISTORY.md`. 핵심:
- 우주/성장주를 과하게 강력하게 만들지 마세요 (시즌1·4·5의 실수)
- 안정주(배당주)를 무적으로 만들지 마세요 (시즌3의 실수)
- 추가 변수를 넣을 때 "위험-보상 균형"을 반드시 확인

### 5. 단순함을 지키세요
- 새 규칙을 추가할 때 초3이 이해할 수 있는지 먼저 자문
- 액면분할은 의도적으로 뺐음 (너무 복잡 → 5,500원 멈춤으로 단순화)
- 새 기능을 추가하면 인앱 도우미(`DOCS.rules`)에도 한 줄로 반영

---

## 코드 구조 (단일 파일)

`index.html` 내부 JavaScript는 다음 순서로 구성됨:

```
1. DATA 정의
   - SECTORS         : 6개 섹터 (tech/phone/auto/shop/bank/game)
   - COUNTRIES       : 6개 나라 + 각 나라 회사 매핑·성격
   - buildCompanies(country) : 선택된 나라의 회사 배열 생성
   - COMPANIES       : 현재 활성 회사 (let, 게임 시작 시 재할당)
   - EVENTS          : 26종 이벤트 (주가 ~18 + 배당 ~8)
   - ACTIONS         : 8종 대응카드
   - GOALS           : 6종 비밀 목표
   - PRESETS         : 난이도 프리셋 3종

2. UTIL
   - shuffle, won, movePrice, isAlive, isEventRelevant, drawPair

3. SETUP
   - renderSetup, setCount, setPreset, setOpt, setCountry, countryDetailHTML
   - startGame, showPassScreen, beginTurn, undoTurn

4. TURN UI
   - renderTurn, miniRankHTML, tradeCardHTML, handCardHTML, coachPanelHTML
   - forecastHTML, miniEvHTML, isLastRoundForecast

5. GAME ACTIONS
   - buy, sell, doPass, drawCard, useCard, chooseStock, pickStock, showGoal, toggleCoach

6. ROUND RESOLUTION
   - endTurn, resolveRound (이벤트 실행·배당·상폐 정리), advanceRound

7. EVENT REVEAL
   - showEventReveal

8. ADVICE
   - analyzeAdvice (투자 도우미 추천 생성)

9. INSIGHTS & HISTORY
   - generateInsights (그 판 데이터 기반 교육 메시지)
   - saveGameRecord, showHistory, clearHistory (localStorage)

10. DOCS
    - DOCS 객체 (rules/concepts/income 인앱 요약본)
    - showDoc

11. INIT
    - renderSetup() 호출
```

**주요 전역 변수:**
- `G` — 현재 게임 상태 객체 (플레이어·주가·예보·라운드·로그 등 모두)
- `COMPANIES` — 현재 활성 회사 배열 (나라 선택에 따라 매번 재구성됨, `let`임에 주의)

---

## 자주 하는 작업 가이드

### 새 이벤트 카드 추가
`EVENTS` 배열에 객체 추가:
```js
{ ico:'🎬', tx:'이벤트 설명', who:['섹터id'], steps:2, chain:null }
// 또는 배당 이벤트
{ ico:'🎉', tx:'배당 이벤트', who:['섹터id'], steps:0, divMul:2, kind:'div' }
```
`who`는 섹터 ID 배열 또는 `'all'`. 추가 후 다른 이벤트와 톤·강도 균형 확인.

### 새 나라 추가
`COUNTRIES` 객체에 새 키 추가. 6개 섹터(tech/phone/auto/shop/bank/game) 회사명 모두 채워야 함. `volMod`/`divMod`/`startMod`로 성격 차별화.

### 새 대응카드 추가
`ACTIONS`에 추가하고 `useCard(i)` switch에 핸들러 추가. 카드 효과가 강력하면 출현 빈도(actionDeck 복제 수) 조정.

### 새 목표 카드 추가
`GOALS`에 `{ico, nm, desc, reward, check:(p, st)=>boolean}` 추가. 보상은 +2000~+5000 범위 권장.

### 밸런스 변경 시
**반드시 `docs/DEV_HISTORY.md`에 변경 이력 기록.** 시즌별 시뮬레이션 데이터가 미래의 의사결정 근거가 됩니다.

---

## 사용자(따님) 환경

- **기기**: 아이패드 (사파리 → 홈 화면 추가로 풀스크린 앱처럼 사용)
- **호스팅**: GitHub Pages (`https://neal-md.github.io/bull-bear/`)
- **플레이어**: 아빠, 엄마, 큰딸(초3) 3인 가족
- **플레이 빈도**: 주말 등 가족 시간

UI 변경 시 아이패드 세로 화면(약 820×1180px)에서 잘 보이는지 우선 확인. 데스크탑은 보조.

---

## 절대 하지 말아야 할 것

1. **외부 라이브러리 추가하지 마세요.** React, Vue, Tailwind 등. 게임은 의도적으로 의존성 0입니다. 추가하면 아이패드 오프라인·단순 호스팅의 장점이 깨집니다.
2. **빌드 단계 추가하지 마세요.** `npm run build` 없이 그냥 브라우저에서 열려야 합니다.
3. **`localStorage` 외 저장소 쓰지 마세요.** 외부 DB는 가족 게임에 과합니다.
4. **개인정보 수집 코드 넣지 마세요.** 가족 사용 도구입니다.
5. **이벤트·카드 효과 변경 시 시뮬레이션 없이 배포하지 마세요.** `docs/DEV_HISTORY.md`의 시뮬레이션 패턴을 참고해 머릿속으로라도 1~2판 돌려보세요.

---

## 작업 시작 전 체크리스트

새 기능을 추가하기 전:
- [ ] 초3 아이가 이해할 수 있는가?
- [ ] 교육적으로 옳은가? (실제 주식과 모순되지 않는가?)
- [ ] 기존 밸런스를 무너뜨리지 않는가?
- [ ] 단일 HTML 파일 구조를 유지할 수 있는가?
- [ ] UI 추가라면 아이패드 세로 화면에 들어가는가?

수정 후:
- [ ] 인앱 문서(`DOCS.rules`)에 반영
- [ ] `docs/DEV_HISTORY.md`에 변경 이력 추가
- [ ] 브라우저에서 한 판 끝까지 돌려보기

---

## 관련 문서

- `docs/DEV_HISTORY.md` — 시뮬레이션 데이터, 패치 이력, 설계 결정 근거 (가장 중요)
- `docs/RULES.html` — 인쇄용 규칙서 (게임 변경 시 동기화)
- `docs/TEXTBOOK.html` — 학습 교재 (개념 변경 시 동기화)
- `docs/INCOME_GUIDE.html` — 근로/금융소득 해설서

---

## 사용자 커뮤니케이션 톤

이 프로젝트의 주인은 한국어 사용자이며, 솔직하고 직설적인 피드백을 선호합니다. 작업 결과를 보고할 때:
- 추가한 기능을 자랑하기보다 "이게 의도대로 작동할지" 짚어주세요
- 트레이드오프를 솔직하게 말하세요
- 발견한 위험·한계를 숨기지 마세요
- 이모지는 절제하되, 명확성을 위해 필요한 곳엔 사용
