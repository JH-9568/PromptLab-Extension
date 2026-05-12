# PromptLab Extension

## Server MVP

```bash
cd server
npm install
npm run dev
```

The server runs on `http://localhost:3000` by default.

Optional OpenAI settings can be added in `server/.env`:

```bash
PORT=3000
OPENAI_API_KEY=your_api_key
OPENAI_MODEL=gpt-4o-mini
```

Without `OPENAI_API_KEY`, `POST /api/improve` uses the built-in rule-based fallback prompt improver.

### APIs

- `POST /api/improve`: improves a prompt using `user_id`, `session_id`, `original_prompt`, and `task_category`.
- `POST /api/log`: appends analysis metadata to `server/logs/prompt_sessions.json` without storing full prompts.
- `GET /api/logs/export/json`: exports logs as JSON.
- `GET /api/logs/export/csv`: exports logs as CSV.
