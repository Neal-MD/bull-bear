---
description: 변경사항을 스테이징하고 커밋 (push는 안 함)
argument-hint: [커밋 메시지(선택)]
---

현재 변경사항을 커밋해줘. (push는 하지 말 것)

1. `git status` 와 `git diff` 로 무엇이 바뀌었는지 확인
2. 바뀐 내용을 사람이 보기 좋게 한두 줄로 요약해서 보여줘
3. 커밋 메시지 결정:
   - "$ARGUMENTS" 가 있으면 그걸 제목으로 사용
   - 없으면 변경 내용에 맞는 **한국어 커밋 메시지**를 생성
4. `git add -A` 후 커밋. 메시지 끝에 아래 라인 포함:

   ```
   Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
   ```
5. ⚠️ push는 하지 마. 배포까지 하려면 `/push` 또는 `/deploy` 를 쓰라고 안내.
