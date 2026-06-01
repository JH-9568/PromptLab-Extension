require('dotenv').config();

const fs = require('fs/promises');
const path = require('path');
const cors = require('cors');
const express = require('express');

const { appendLog, logsToCsv, readLogs } = require('./logger');
const { analyzePrompt } = require('./promptAnalyzer');
const { generateImprovedPrompt } = require('./rag');

const app = express();
const PORT = process.env.PORT || 3000;
const GUIDELINE_DIR = path.join(__dirname, 'guidelines');
const CATEGORY_FILES = {
  study: 'study.md',
  coding: 'coding.md',
  writing: 'writing.md',
  summary: 'summary.md',
  analysis: 'analysis.md'
};

app.use(cors());
app.use(express.json({ limit: '1mb' }));

async function readGuidelineFile(fileName) {
  return fs.readFile(path.join(GUIDELINE_DIR, fileName), 'utf8');
}

async function loadGuidelines(taskCategory) {
  const files = ['general.md'];
  if (CATEGORY_FILES[taskCategory]) {
    files.push(CATEGORY_FILES[taskCategory]);
  }

  const contents = await Promise.all(files.map(async (fileName) => {
    const content = await readGuidelineFile(fileName);
    return `# ${fileName}\n${content}`;
  }));

  return {
    files,
    content: contents.join('\n\n')
  };
}

function requireString(value, fieldName) {
  if (typeof value !== 'string' || !value.trim()) {
    return `${fieldName} is required.`;
  }
  return null;
}

function hideSpecificityScoreForClient(analysis) {
  if (!analysis || typeof analysis !== 'object') return analysis;
  return {
    ...analysis,
    specificity_score: ''
  };
}

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.post('/api/improve', async (req, res, next) => {
  try {
    const {
      user_id: userId,
      session_id: sessionId,
      original_prompt: originalPrompt,
      task_category: taskCategory = 'general',
      client_language: clientLanguage = '',
      attachment_context: attachmentContext = {}
    } = req.body || {};

    const validationErrors = [
      requireString(userId, 'user_id'),
      requireString(sessionId, 'session_id'),
      requireString(originalPrompt, 'original_prompt')
    ].filter(Boolean);

    if (validationErrors.length > 0) {
      return res.status(400).json({ error: 'Invalid request body.', details: validationErrors });
    }

    const normalizedCategory = String(taskCategory || 'general').toLowerCase();
    const guidelines = await loadGuidelines(normalizedCategory);
    const generation = await generateImprovedPrompt({
      originalPrompt,
      taskCategory: normalizedCategory,
      clientLanguage,
      guidelineContent: guidelines.content,
      attachmentContext
    });
    const beforeAnalysis = generation.before_analysis || analyzePrompt(originalPrompt);
    const afterAnalysis = generation.after_analysis || analyzePrompt(generation.improved_prompt);

    return res.json({
      user_id: userId,
      session_id: sessionId,
      task_category: normalizedCategory,
      guideline_files: guidelines.files,
      retrieved_guidelines: {
        category: normalizedCategory,
        files: guidelines.files,
        improvement: {
          type: generation.improvement_type,
          reason: generation.improvement_reason
        },
        attachment_context: generation.attachment_context
      },
      attachment_context: generation.attachment_context,
      improved_prompt: generation.improved_prompt,
      improvement_type: generation.improvement_type,
      improvement_reason: generation.improvement_reason,
      provider: generation.provider,
      fallback_reason: generation.fallback_reason,
      before_analysis: hideSpecificityScoreForClient(beforeAnalysis),
      after_analysis: hideSpecificityScoreForClient(afterAnalysis)
    });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/log', async (req, res, next) => {
  try {
    const entry = await appendLog(req.body || {});
    return res.status(201).json({ ok: true, log: entry });
  } catch (error) {
    return next(error);
  }
});

app.get('/api/logs/export/json', async (req, res, next) => {
  try {
    const logs = await readLogs();
    res.setHeader('Content-Disposition', 'attachment; filename="prompt_sessions.json"');
    return res.json(logs);
  } catch (error) {
    return next(error);
  }
});

app.get('/api/logs/export/csv', async (req, res, next) => {
  try {
    const logs = await readLogs();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="prompt_sessions.csv"');
    return res.send(`${logsToCsv(logs)}\n`);
  } catch (error) {
    return next(error);
  }
});

app.use((error, req, res, next) => {
  console.error(error);
  const status = error.status || 500;
  return res.status(status).json({
    error: status === 502 ? 'OpenAI prompt improvement failed.' : 'Internal server error.',
    code: error.code,
    message: process.env.NODE_ENV === 'production' && status !== 502 ? undefined : error.message
  });
});

app.listen(PORT, () => {
  console.log(`PromptLab server listening on port ${PORT}`);
});
