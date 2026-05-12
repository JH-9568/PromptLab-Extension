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
