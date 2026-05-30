---
description: origin/main에 push하고 GitHub Pages 배포 반영 확인
---

커밋된 내용을 원격에 push하고, 아이패드용 라이브 페이지에 반영되는지 확인해줘.

1. 커밋 안 된 변경이 있으면 알려주고 — 먼저 커밋할지 물어봐 (`/commit` 안내)
2. `git push origin main`
3. GitHub Pages 빌드 상태 확인:
   `gh api repos/Neal-MD/bull-bear/pages/builds/latest --jq '.status + " @ " + .created_at'`
4. 라이브 URL **https://neal-md.github.io/bull-bear/** 에 최신 내용이 반영됐는지 확인
   (예: 방금 바꾼 부분이 `curl -s <url>` 결과에 보이는지). 빌드 중이면 잠깐 기다렸다 재확인.
5. 완료되면 "아이패드 사파리에서 새로고침(또는 pull-to-refresh)하면 반영됩니다" 라고 안내.
