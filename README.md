# PromptLab Extension

PromptLab은 ChatGPT 사용자가 모호한 프롬프트를 더 명확한 프롬프트로 개선할 수 있도록 돕는 Chrome 확장 프로그램입니다. 확장 프로그램은 연구 및 제품 개선을 위해 익명 프롬프트 품질 메타데이터와 사용자의 만족도 평가를 기록합니다.

## 운영 구조

- Chrome 확장 프로그램은 `https://chatgpt.com/*` 및 `https://chat.openai.com/*`에서 실행됩니다.
- 백엔드 API는 Render에서 실행됩니다: `https://promptlab-server.onrender.com`.
- OpenAI API 호출은 백엔드 서버에서만 수행됩니다.
- `SUPABASE_URL` 및 `SUPABASE_SERVICE_ROLE_KEY`가 설정되어 있으면 세션 로그는 Supabase에 저장됩니다.
- 로그에는 프롬프트 전문을 저장하지 않습니다. 서버는 해시, 글자 수, 분석 점수, 가이드라인 메타데이터, 만족도 점수만 저장합니다.

## 서버 환경 변수

Render에 다음 환경 변수를 설정합니다.

```bash
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4.1-mini
SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
NODE_ENV=production
```

API 키를 확장 프로그램 코드에 넣지 마세요. `.env` 파일을 커밋하지 마세요.

## 로컬 개발

```bash
cd server
npm install
npm run dev
```

로컬 서버 기본 주소는 `http://localhost:3000`입니다. Supabase 환경 변수가 설정되어 있지 않으면 로그는 `server/logs/prompt_sessions.json`에 저장됩니다.

## API

- `GET /health`: 서버 상태를 확인합니다.
- `POST /api/improve`: `user_id`, `session_id`, `original_prompt`, `task_category`를 사용해 프롬프트를 개선합니다.
- `POST /api/log`: 익명 세션 메타데이터와 만족도 평가를 저장합니다.
- `GET /api/logs/export/json`: 저장된 로그를 JSON으로 내보냅니다.
- `GET /api/logs/export/csv`: 저장된 로그를 CSV로 내보냅니다.

## 개인정보 보호

자세한 내용은 [PRIVACY.md](./PRIVACY.md)를 참고하세요.

---

# PromptLab Extension

PromptLab is a Chrome extension that helps ChatGPT users rewrite vague prompts into clearer prompts, then records anonymous prompt-quality metadata and satisfaction ratings for research and product improvement.

## Production Architecture

- Chrome extension runs on `https://chatgpt.com/*` and `https://chat.openai.com/*`.
- Backend API runs on Render: `https://promptlab-server.onrender.com`.
- OpenAI API calls are made only from the backend server.
- Session logs are stored in Supabase when `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are configured.
- Full prompt text is not stored in logs. The server stores hashes, lengths, analysis scores, guideline metadata, and satisfaction scores.

## Server Environment Variables

Set these in Render:

```bash
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4.1-mini
SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
NODE_ENV=production
```

Do not put API keys in the extension code. Do not commit `.env`.

## Local Development

```bash
cd server
npm install
npm run dev
```

Local server defaults to `http://localhost:3000`. If Supabase variables are not configured, logs are written to `server/logs/prompt_sessions.json`.

## APIs

- `GET /health`: checks server status.
- `POST /api/improve`: improves a prompt using `user_id`, `session_id`, `original_prompt`, and `task_category`.
- `POST /api/log`: stores anonymous session metadata and satisfaction rating.
- `GET /api/logs/export/json`: exports stored logs as JSON.
- `GET /api/logs/export/csv`: exports stored logs as CSV.

## Privacy

See [PRIVACY.md](./PRIVACY.md).
