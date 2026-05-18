# PromptLab Extension

PromptLab은 ChatGPT에서 작성한 프롬프트를 더 명확하고 구체적인 프롬프트로 개선해 주는 Chrome 확장 프로그램입니다. 사용자는 ChatGPT 입력창에 작성한 프롬프트를 PromptLab으로 분석하고, 개선된 프롬프트와 개선 전후의 품질 신호를 확인한 뒤 원하는 버전을 입력창에 적용할 수 있습니다.

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

## 데이터 처리

PromptLab은 프롬프트 개선 기능을 제공하기 위해 사용자가 입력한 프롬프트를 백엔드 서버로 전송합니다. 백엔드 서버는 개선된 프롬프트 생성을 위해 OpenAI API를 사용할 수 있습니다.

프롬프트 개선에는 저장소의 가이드라인 문서가 사용되며, 기본 가이드라인은 OpenAI의 Prompting 및 Prompt Engineering 관련 공개 문서를 바탕으로 구성되어 있습니다. 이 가이드라인은 원본 요청에 답변하기 위한 기준이 아니라, 원본 요청을 더 명확한 실행 프롬프트로 다시 작성하기 위한 기준으로 사용됩니다.

로그에는 프롬프트 전문을 저장하지 않습니다. 저장되는 정보는 익명 사용자 ID, 세션 ID, 작업 카테고리, 개선 전후 분석 메타데이터, 프롬프트 해시, 글자 수, 만족도 점수 등 제한적인 익명 메타데이터입니다.

자세한 내용은 [PRIVACY.md](./PRIVACY.md)를 참고하세요.

## 동작 환경

- Chrome 확장 프로그램은 `https://chatgpt.com/*` 및 `https://chat.openai.com/*`에서 동작합니다.
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

주요 API:

- `GET /health`: 서버 상태 확인
- `POST /api/improve`: 프롬프트 개선
- `POST /api/log`: 익명 세션 메타데이터와 만족도 평가 저장
- `GET /api/logs/export/json`: 저장된 로그를 JSON으로 내보내기
- `GET /api/logs/export/csv`: 저장된 로그를 CSV로 내보내기

---

# PromptLab Extension

PromptLab is a Chrome extension that helps ChatGPT users turn vague prompts into clearer and more specific prompts. Users can analyze a prompt written in the ChatGPT input box, review the improved prompt and before/after quality signals, and apply the version they prefer back into the input box.

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

## Data Handling

PromptLab sends the prompt entered by the user to the backend server to provide the prompt improvement feature. The backend server may use the OpenAI API to generate the improved prompt.

Prompt improvement uses guideline documents in this repository. The default guidelines are based on OpenAI's public Prompting and Prompt Engineering documentation. These guidelines are used to rewrite the original request into a clearer executable prompt, not to answer the original request directly.

PromptLab logs do not store full prompt text. Stored data is limited to anonymous metadata such as anonymous user ID, session ID, task category, before/after analysis metadata, prompt hashes, character lengths, and satisfaction ratings.

See [PRIVACY.md](./PRIVACY.md) for details.

## Runtime Environment

- The Chrome extension runs on `https://chatgpt.com/*` and `https://chat.openai.com/*`.
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

Main APIs:

- `GET /health`: Check server status
- `POST /api/improve`: Improve a prompt
- `POST /api/log`: Store anonymous session metadata and satisfaction rating
- `GET /api/logs/export/json`: Export stored logs as JSON
- `GET /api/logs/export/csv`: Export stored logs as CSV
