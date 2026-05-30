---
description: 한 번에 커밋 + push + 배포 확인 (게임 수정이 끝났을 때)
argument-hint: [커밋 메시지(선택)]
---

게임 수정이 끝났으니 커밋부터 배포 확인까지 한 번에 해줘.

1. `git status` / `git diff` 로 변경 확인 후 한두 줄 요약
2. 커밋: "$ARGUMENTS" 있으면 제목으로 사용, 없으면 한국어로 자동 생성.
   `git add -A` 후 커밋, 메시지 끝에 아래 라인 포함:

   ```
   Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
   ```
3. `git push origin main`
4. GitHub Pages 빌드 상태 확인:
   `gh api repos/Neal-MD/bull-bear/pages/builds/latest --jq '.status + " @ " + .created_at'`
5. 라이브 URL **https://neal-md.github.io/bull-bear/** 에 반영됐는지 확인 (빌드 중이면 잠깐 대기 후 재확인)
6. "아이패드에서 새로고침하면 반영됩니다" 안내로 마무리
