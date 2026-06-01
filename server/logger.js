const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const LOG_DIR = path.join(__dirname, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'prompt_sessions.json');
const SUPABASE_TABLE = 'prompt_sessions';
const ANALYSIS_KEYS = [
  'has_goal',
  'has_context',
  'has_format',
  'has_constraint',
  'has_reference'
];

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
    original_prompt_hash: originalPrompt ? hashText(originalPrompt) : rest.original_prompt_hash,
    improved_prompt_hash: improvedPrompt ? hashText(improvedPrompt) : rest.improved_prompt_hash,
    original_prompt_length: originalPrompt ? String(originalPrompt).length : rest.original_prompt_length,
    improved_prompt_length: improvedPrompt ? String(improvedPrompt).length : rest.improved_prompt_length
  };
}

function normalizeLoggedAnalysis(analysis) {
  if (!analysis || typeof analysis !== 'object') return analysis;

  const normalized = { ...analysis };
  const score = Number(normalized.specificity_score);

  normalized.specificity_score = Number.isFinite(score)
    ? score
    : ANALYSIS_KEYS.filter((key) => Boolean(normalized[key])).length * 20;

  return normalized;
}

function isSupabaseConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function toLogEntry(payload) {
  const stripped = stripFullPrompts(payload);
  const improvementType = stripped.improvement_type || stripped.retrieved_guidelines?.improvement?.type;
  const improvementReason = stripped.improvement_reason || stripped.retrieved_guidelines?.improvement?.reason;
  const retrievedGuidelines = stripped.retrieved_guidelines && typeof stripped.retrieved_guidelines === 'object'
    ? {
        ...stripped.retrieved_guidelines,
        target_platform: stripped.retrieved_guidelines.target_platform || stripped.target_platform,
        improvement: stripped.retrieved_guidelines.improvement || {
          type: improvementType,
          reason: improvementReason
        }
      }
    : stripped.retrieved_guidelines;

  return {
    user_id: stripped.user_id,
    session_id: stripped.session_id,
    task_category: stripped.task_category,
    target_platform: stripped.target_platform,
    provider: stripped.provider,
    improvement_type: improvementType,
    improvement_reason: improvementReason,
    used_improved: stripped.used_improved,
    satisfaction_score: stripped.satisfaction_score,
    before_analysis: normalizeLoggedAnalysis(stripped.before_analysis),
    after_analysis: normalizeLoggedAnalysis(stripped.after_analysis),
    guideline_files: stripped.guideline_files,
    retrieved_guidelines: retrievedGuidelines,
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

function supabaseBaseUrl() {
  const rawUrl = String(process.env.SUPABASE_URL || '').trim();
  const parsed = new URL(rawUrl);
  parsed.pathname = parsed.pathname.replace(/\/rest\/v1\/?.*$/, '').replace(/\/+$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

function supabaseUrl(query = '') {
  const baseUrl = supabaseBaseUrl();
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
  const logEntry = toLogEntry(payload);

  try {
    const [entry] = await requestSupabase(supabaseUrl(), {
      method: 'POST',
      headers: supabaseHeaders('return=representation'),
      body: JSON.stringify(logEntry)
    });

    return entry;
  } catch (error) {
    if (!/improvement_(type|reason)|schema cache|column/i.test(error.message)) {
      throw error;
    }

    const {
      improvement_type: improvementType,
      improvement_reason: improvementReason,
      target_platform: targetPlatform,
      ...legacyEntry
    } = logEntry;

    const [entry] = await requestSupabase(supabaseUrl(), {
      method: 'POST',
      headers: supabaseHeaders('return=representation'),
      body: JSON.stringify(legacyEntry)
    });

    return {
      ...entry,
      improvement_type: improvementType,
      improvement_reason: improvementReason,
      target_platform: targetPlatform
    };
  }
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
    ...toLogEntry(payload)
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
    'target_platform',
    'provider',
    'improvement_type',
    'improvement_reason',
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
