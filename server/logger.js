const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const LOG_DIR = path.join(__dirname, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'prompt_sessions.json');
const SUPABASE_TABLE = 'prompt_sessions';

function hashText(value = '') {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function stripFullPrompts(payload) {
  const {
    original_prompt: originalPrompt,
    improved_prompt: improvedPrompt,
    ...rest
  } = payload;

  return {
    ...rest,
    original_prompt_hash: originalPrompt ? hashText(originalPrompt) : undefined,
    improved_prompt_hash: improvedPrompt ? hashText(improvedPrompt) : undefined,
    original_prompt_length: originalPrompt ? String(originalPrompt).length : undefined,
    improved_prompt_length: improvedPrompt ? String(improvedPrompt).length : undefined
  };
}

function isSupabaseConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function toLogEntry(payload) {
  const stripped = stripFullPrompts(payload);
  return {
    user_id: stripped.user_id,
    session_id: stripped.session_id,
    task_category: stripped.task_category,
    provider: stripped.provider,
    used_improved: stripped.used_improved,
    satisfaction_score: stripped.satisfaction_score,
    before_analysis: stripped.before_analysis,
    after_analysis: stripped.after_analysis,
    guideline_files: stripped.guideline_files,
    retrieved_guidelines: stripped.retrieved_guidelines,
    original_prompt_hash: stripped.original_prompt_hash,
    improved_prompt_hash: stripped.improved_prompt_hash,
    original_prompt_length: stripped.original_prompt_length,
    improved_prompt_length: stripped.improved_prompt_length
  };
}

function supabaseHeaders(prefer) {
  const headers = {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json'
  };

  if (prefer) headers.Prefer = prefer;
  return headers;
}

function supabaseUrl(query = '') {
  const baseUrl = process.env.SUPABASE_URL.replace(/\/$/, '');
  return `${baseUrl}/rest/v1/${SUPABASE_TABLE}${query}`;
}

async function requestSupabase(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = data?.message || data?.error || text || `Supabase returned ${response.status}`;
    throw new Error(message);
  }

  return data;
}

async function readSupabaseLogs() {
  return requestSupabase(supabaseUrl('?select=*&order=created_at.desc'), {
    method: 'GET',
    headers: supabaseHeaders()
  });
}

async function appendSupabaseLog(payload) {
  const [entry] = await requestSupabase(supabaseUrl(), {
    method: 'POST',
    headers: supabaseHeaders('return=representation'),
    body: JSON.stringify(toLogEntry(payload))
  });

  return entry;
}

async function readLogs() {
  if (isSupabaseConfigured()) {
    return readSupabaseLogs();
  }

  try {
    const content = await fs.readFile(LOG_FILE, 'utf8');
    if (!content.trim()) return [];
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function appendLog(payload) {
  if (isSupabaseConfigured()) {
    return appendSupabaseLog(payload);
  }

  await fs.mkdir(LOG_DIR, { recursive: true });
  const logs = await readLogs();
  const entry = {
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    ...stripFullPrompts(payload)
  };

  logs.push(entry);
  await fs.writeFile(LOG_FILE, `${JSON.stringify(logs, null, 2)}\n`);
  return entry;
}

function escapeCsvValue(value) {
  if (value === undefined || value === null) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function logsToCsv(logs) {
  const columns = [
    'id',
    'created_at',
    'user_id',
    'session_id',
    'task_category',
    'provider',
    'used_improved',
    'satisfaction_score',
    'original_prompt_hash',
    'improved_prompt_hash',
    'original_prompt_length',
    'improved_prompt_length',
    'before_analysis',
    'after_analysis',
    'guideline_files',
    'retrieved_guidelines'
  ];

  const rows = logs.map((log) => columns.map((column) => escapeCsvValue(log[column])).join(','));
  return [columns.join(','), ...rows].join('\n');
}

module.exports = {
  appendLog,
  readLogs,
  logsToCsv
};
