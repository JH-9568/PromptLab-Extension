# PromptLab Extension

PromptLab은 ChatGPT, Gemini, Claude에서 작성한 프롬프트를 더 명확하고 구체적인 프롬프트로 개선해 주는 Chrome 확장 프로그램입니다. 사용자는 AI 입력창에 작성한 프롬프트를 PromptLab으로 분석하고, 개선된 프롬프트와 개선 전후의 품질 신호를 확인한 뒤 원하는 버전을 입력창에 적용할 수 있습니다.

## 주요 기능

<img width="1280" height="800" alt="promptlab-01-open" src="https://github.com/user-attachments/assets/506dab20-0b06-4fa4-88b5-dd161e53f8ae" />
<img width="1280" height="800" alt="promptlab-02-improve" src="https://github.com/user-attachments/assets/e6e9c0ef-0b76-476d-87b3-4b557d1e0b78" />
<img width="1280" height="800" alt="promptlab-03-insert" src="https://github.com/user-attachments/assets/b7aa50f0-57f6-4d03-a2e2-829ebc68029d" />
<img width="1280" height="800" alt="promptlab-04-rating" src="https://github.com/user-attachments/assets/eefc0f5f-30f2-4537-b639-96ca299276d7" />

## 사용 방법

1. Chrome에서 PromptLab 확장 프로그램을 설치합니다.
2. `https://chatgpt.com` 또는 `https://chat.openai.com`에 접속합니다.
3. ChatGPT 입력창에 개선하고 싶은 프롬프트를 작성합니다.
4. 화면에 표시되는 PromptLab 버튼을 눌러 패널을 엽니다.
5. `프롬프트 개선하기`를 눌러 개선 결과를 확인합니다.
6. 개선된 프롬프트가 마음에 들면 ChatGPT 입력창에 적용합니다.
7. ChatGPT 답변을 확인한 뒤 만족도 점수를 선택합니다.

## 현재 동작 방식

PromptLab은 백엔드에서 OpenAI API를 사용해 프롬프트를 다시 작성합니다. 현재 개선 로직은 다음 원칙을 따릅니다.

- 원문의 의도와 범위를 유지하면서 더 실행 가능한 프롬프트로 재작성합니다.
- 저장소의 가이드라인 문서는 참고 배경으로 사용하되, 모든 항목을 기계적으로 적용하지 않습니다.
- 짧은 프롬프트는 과하게 길어지지 않도록 제한하고, 필요한 답변 조건만 선별해 추가합니다.
- 원문이 너무 모호하면 답변을 강제로 만들지 않고 핵심 정보를 묻는 프롬프트로 바꿉니다.
- 개선 결과에는 `improvement_type`과 `improvement_reason` 메타데이터가 포함됩니다.
- 점수는 `goal`, `context`, `format`, `constraint`, `reference` 5개 신호를 기준으로 하며, 각 신호당 20점으로 계산됩니다.
- 첨부 파일이 감지되면 파일 내용은 읽지 않고 첨부 존재 여부와 개수만 백엔드에 전달합니다.
- 사용자가 만족도 평가를 제출하면, 서버는 개선 전후 품질을 비동기로 평가한 결과를 로그 메타데이터에 병합할 수 있습니다.

## 데이터 처리

PromptLab은 프롬프트 개선 기능을 제공하기 위해 사용자가 입력한 프롬프트를 백엔드 서버로 전송합니다. 백엔드 서버는 개선된 프롬프트 생성을 위해 OpenAI API를 사용할 수 있습니다.

프롬프트 개선에는 저장소의 가이드라인 문서가 참고 배경으로 사용됩니다. 기본 가이드라인은 OpenAI의 Prompting 및 Prompt Engineering 관련 공개 문서를 바탕으로 구성되어 있습니다. 이 가이드라인은 원본 요청에 답변하기 위한 기준이 아니라, 원본 요청을 더 명확한 실행 프롬프트로 다시 작성하기 위한 참고 기준으로 사용됩니다.

로그에는 프롬프트 전문을 저장하지 않습니다. 저장되는 정보는 익명 사용자 ID, 세션 ID, 작업 카테고리, 개선 전후 분석 메타데이터, 개선 유형 및 개선 이유 메타데이터, 첨부 감지 메타데이터, 비동기 품질평가 메타데이터, 프롬프트 해시, 글자 수, 만족도 점수 등 제한적인 익명 메타데이터입니다.

자세한 내용은 [PRIVACY.md](./PRIVACY.md)를 참고하세요.

## 동작 환경

- Chrome 확장 프로그램은 `https://chatgpt.com/*`, `https://chat.openai.com/*`, `https://gemini.google.com/*`, `https://claude.ai/*`에서 동작합니다.
- 백엔드 API는 `https://promptlab-server.onrender.com`에서 실행됩니다.
- OpenAI API 호출은 확장 프로그램이 아니라 백엔드 서버에서 수행됩니다.

## 개발자 참고

로컬 서버 실행:

```bash
cd server
npm install
npm run dev
```

로컬 서버 기본 주소는 `http://localhost:3000`입니다. Supabase 환경 변수가 설정되어 있지 않으면 로그는 `server/logs/prompt_sessions.json`에 저장됩니다.

주요 환경 변수:

- `OPENAI_API_KEY`: OpenAI API 키
- `OPENAI_REWRITE_MODEL` 또는 `OPENAI_PROMPT_MODEL`: 프롬프트 개선 모델. 기본값은 `gpt-4.1-mini`
- `OPENAI_MAX_COMPLETION_TOKENS`: 프롬프트 개선 응답 토큰 상한. 기본값은 `900`
- `OPENAI_REASONING_EFFORT`: reasoning 모델 사용 시 개선 호출의 reasoning effort. 기본값은 `low`
- `OPENAI_EVAL_MODEL`: 만족도 로그 시점에 실행되는 비동기 품질평가 모델. 기본값은 `OPENAI_REWRITE_MODEL` 또는 `gpt-4.1-mini`
- `OPENAI_EVAL_REASONING_EFFORT`: 비동기 품질평가용 reasoning effort. 기본값은 `low`
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`: Supabase 로그 저장 설정. 없으면 로컬 JSON 로그를 사용

주요 API:

- `GET /health`: 서버 상태 확인
- `POST /api/improve`: 프롬프트 개선
- `POST /api/log`: 익명 세션 메타데이터와 만족도 평가 저장
- `GET /api/logs/export/json`: 저장된 로그를 JSON으로 내보내기
- `GET /api/logs/export/csv`: 저장된 로그를 CSV로 내보내기

---

# PromptLab Extension

PromptLab is a Chrome extension that helps ChatGPT, Gemini, and Claude users turn vague prompts into clearer and more specific prompts. Users can analyze a prompt written in an AI input box, review the improved prompt and before/after quality signals, and apply the version they prefer back into the input box.

## Key Features

- Detects prompts written in the ChatGPT input box and sends improvement requests.
- Improves prompts using public prompt-writing guidance, including OpenAI Prompting and Prompt Engineering guides.
- Analyzes prompts based on goal, context, output format, constraints, and reference information.
- Shows before/after specificity scores for the prompt.
- Lets users insert the improved prompt directly into the ChatGPT input box.
- Lets users submit a satisfaction rating after receiving a ChatGPT response.
- Uses anonymous session metadata to evaluate prompt improvement quality.

## How To Use

1. Install the PromptLab Chrome extension.
2. Open `https://chatgpt.com` or `https://chat.openai.com`.
3. Write a prompt in the ChatGPT input box.
4. Click the PromptLab button shown on the page to open the panel.
5. Click `프롬프트 개선하기` to generate an improved prompt.
6. Apply the improved prompt to the ChatGPT input box if you want to use it.
7. After reviewing the ChatGPT response, select a satisfaction rating.

## Current Behavior

PromptLab rewrites prompts through the backend using the OpenAI API. The current improvement flow follows these rules:

- Preserve the original user intent and scope while making the prompt more executable.
- Use repository guideline documents as background guidance, not as a mechanical checklist.
- Keep short prompts compact and add only selected answer requirements that materially help.
- If the original prompt is too vague, rewrite it into a prompt that asks for the most important missing information.
- Return `improvement_type` and `improvement_reason` metadata with the improved prompt.
- Score prompts using five signals: `goal`, `context`, `format`, `constraint`, and `reference`. Each signal contributes 20 points.
- If attachments are detected, only attachment presence/count metadata is sent; file contents are not read by the extension.
- When the user submits a satisfaction rating, the server may merge an asynchronous semantic quality evaluation into the logged metadata.

## Data Handling

PromptLab sends the prompt entered by the user to the backend server to provide the prompt improvement feature. The backend server may use the OpenAI API to generate the improved prompt.

Prompt improvement uses guideline documents in this repository as background guidance. The default guidelines are based on OpenAI's public Prompting and Prompt Engineering documentation. These guidelines are used to rewrite the original request into a clearer executable prompt, not to answer the original request directly.

PromptLab logs do not store full prompt text. Stored data is limited to anonymous metadata such as anonymous user ID, session ID, task category, before/after analysis metadata, improvement type/reason metadata, attachment detection metadata, asynchronous quality evaluation metadata, prompt hashes, character lengths, and satisfaction ratings.

See [PRIVACY.md](./PRIVACY.md) for details.

## Runtime Environment

- The Chrome extension runs on `https://chatgpt.com/*`, `https://chat.openai.com/*`, `https://gemini.google.com/*`, and `https://claude.ai/*`.
- The backend API runs at `https://promptlab-server.onrender.com`.
- OpenAI API calls are made by the backend server, not by the extension.

## Developer Notes

Run the local server:

```bash
cd server
npm install
npm run dev
```

The local server defaults to `http://localhost:3000`. If Supabase environment variables are not configured, logs are written to `server/logs/prompt_sessions.json`.

Key environment variables:

- `OPENAI_API_KEY`: OpenAI API key
- `OPENAI_REWRITE_MODEL` or `OPENAI_PROMPT_MODEL`: Prompt rewrite model. Defaults to `gpt-4.1-mini`
- `OPENAI_MAX_COMPLETION_TOKENS`: Token cap for prompt improvement responses. Defaults to `900`
- `OPENAI_REASONING_EFFORT`: Reasoning effort for rewrite calls on reasoning models. Defaults to `low`
- `OPENAI_EVAL_MODEL`: Asynchronous quality evaluation model used when logging satisfaction. Defaults to `OPENAI_REWRITE_MODEL` or `gpt-4.1-mini`
- `OPENAI_EVAL_REASONING_EFFORT`: Reasoning effort for async quality evaluation. Defaults to `low`
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`: Supabase logging configuration. If absent, local JSON logs are used

Main APIs:

- `GET /health`: Check server status
- `POST /api/improve`: Improve a prompt
- `POST /api/log`: Store anonymous session metadata and satisfaction rating
- `GET /api/logs/export/json`: Export stored logs as JSON
- `GET /api/logs/export/csv`: Export stored logs as CSV
