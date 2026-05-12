const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const LOG_DIR = path.join(__dirname, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'prompt_sessions.json');

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

async function readLogs() {
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
    'original_prompt_hash',
    'improved_prompt_hash',
    'original_prompt_length',
    'improved_prompt_length',
    'before_analysis',
    'after_analysis'
  ];

  const rows = logs.map((log) => columns.map((column) => escapeCsvValue(log[column])).join(','));
  return [columns.join(','), ...rows].join('\n');
}

module.exports = {
  appendLog,
  readLogs,
  logsToCsv
};
