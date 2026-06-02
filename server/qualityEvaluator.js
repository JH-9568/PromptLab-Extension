const OpenAI = require('openai');

const ANALYSIS_KEYS = [
  'has_goal',
  'has_context',
  'has_format',
  'has_constraint',
  'has_reference'
];

const pendingEvaluations = new Map();
const EVALUATION_TTL_MS = 1000 * 60 * 10;

function calculateSpecificityScore(analysis) {
  return ANALYSIS_KEYS.filter((key) => analysis[key]).length * 20;
}

function normalizeAnalysis(value, attachmentContext) {
  const source = value && typeof value === 'object' ? value : {};
  const analysis = {};

  for (const key of ANALYSIS_KEYS) {
    analysis[key] = Boolean(source[key]);
  }

  if (attachmentContext?.has_attachment) {
    analysis.has_reference = true;
  }

  analysis.specificity_score = calculateSpecificityScore(analysis);
  return analysis;
}

function normalizeQualityEval(value) {
  const source = value && typeof value === 'object' ? value : {};
  const clampScore = (score) => {
    const number = Number(score);
    if (!Number.isFinite(number)) return 3;
    return Math.max(1, Math.min(5, Math.round(number)));
  };

  return {
    intent_preservation: clampScore(source.intent_preservation),
    answerability: clampScore(source.answerability),
    clarity: clampScore(source.clarity),
    conciseness: clampScore(source.conciseness),
    over_expansion_risk: clampScore(source.over_expansion_risk),
    overall_quality: clampScore(source.overall_quality),
    reason: String(source.reason || '의미 기반 평가 결과입니다.').replace(/\s+/g, ' ').trim()
  };
}

function getEvaluationModel() {
  const model = String(process.env.OPENAI_EVAL_MODEL || process.env.OPENAI_REWRITE_MODEL || 'gpt-4.1-mini').trim();
  return model || 'gpt-4.1-mini';
}

function isReasoningModel(model) {
  return /^(gpt-5|o[134])\b/i.test(String(model || ''));
}

function createEvaluationSchema() {
  const analysisSchema = {
    type: 'object',
    additionalProperties: false,
    properties: Object.fromEntries(ANALYSIS_KEYS.map((key) => [key, { type: 'boolean' }])),
    required: ANALYSIS_KEYS
  };

  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      before_analysis: analysisSchema,
      after_analysis: analysisSchema,
      quality_eval: {
        type: 'object',
        additionalProperties: false,
        properties: {
          intent_preservation: { type: 'integer', minimum: 1, maximum: 5 },
          answerability: { type: 'integer', minimum: 1, maximum: 5 },
          clarity: { type: 'integer', minimum: 1, maximum: 5 },
          conciseness: { type: 'integer', minimum: 1, maximum: 5 },
          over_expansion_risk: { type: 'integer', minimum: 1, maximum: 5 },
          overall_quality: { type: 'integer', minimum: 1, maximum: 5 },
          reason: { type: 'string' }
        },
        required: [
          'intent_preservation',
          'answerability',
          'clarity',
          'conciseness',
          'over_expansion_risk',
          'overall_quality',
          'reason'
        ]
      }
    },
    required: ['before_analysis', 'after_analysis', 'quality_eval']
  };
}

async function evaluatePromptQuality({ originalPrompt, improvedPrompt, attachmentContext }) {
  if (!process.env.OPENAI_API_KEY) return null;

  const model = getEvaluationModel();
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const request = {
    model,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'prompt_quality_evaluation',
        strict: true,
        schema: createEvaluationSchema()
      }
    },
    max_completion_tokens: 900,
    messages: [
      {
        role: 'system',
        content: [
          'You are a semantic evaluator for a prompt rewriting product.',
          'Do not rewrite either prompt. Evaluate meaning and usefulness.',
          'Assess the five analysis fields semantically, not by keyword matching.',
          'has_goal: the prompt has a clear task, question, decision, or desired outcome.',
          'has_context: the prompt provides situation, domain, user role, audience, project state, or reason the task matters.',
          'has_format: the prompt asks for an output shape, structure, dimensions, sections, steps, comparison structure, list, table, or similar organization.',
          'has_constraint: the prompt states requirements, criteria, priorities, tone, length, exclusions, feasibility, quality bar, language, or decision lens.',
          'has_reference: the prompt asks to use attached/source/prior material, links, evidence, data, or referenced content.',
          'For quality_eval, score from 1 to 5. over_expansion_risk is 1 when there is little risk and 5 when the rewrite likely adds too much.',
          'The reason must be Korean and concise.'
        ].join(' ')
      },
      {
        role: 'user',
        content: [
          attachmentContext?.has_attachment
            ? `Attachment context: ${attachmentContext.attachment_count || 1} attachment(s) detected. Contents are unavailable.`
            : 'Attachment context: no attachment detected.',
          '',
          'Original prompt:',
          originalPrompt,
          '',
          'Improved prompt:',
          improvedPrompt
        ].join('\n')
      }
    ]
  };

  if (isReasoningModel(model)) {
    request.reasoning_effort = process.env.OPENAI_EVAL_REASONING_EFFORT || 'low';
  } else {
    request.temperature = 0;
  }

  const response = await client.chat.completions.create(request);
  const parsed = JSON.parse(response.choices?.[0]?.message?.content || '{}');

  return {
    before_analysis: normalizeAnalysis(parsed.before_analysis, attachmentContext),
    after_analysis: normalizeAnalysis(parsed.after_analysis, attachmentContext),
    quality_eval: {
      ...normalizeQualityEval(parsed.quality_eval),
      model
    }
  };
}

function evaluationKey(userId, sessionId) {
  return `${String(userId || '').trim()}::${String(sessionId || '').trim()}`;
}

function scheduleQualityEvaluation({ userId, sessionId, originalPrompt, improvedPrompt, attachmentContext }) {
  if (!userId || !sessionId || !originalPrompt || !improvedPrompt || !process.env.OPENAI_API_KEY) return;

  const key = evaluationKey(userId, sessionId);
  const promise = evaluatePromptQuality({ originalPrompt, improvedPrompt, attachmentContext })
    .catch((error) => {
      console.warn(`Prompt quality evaluation failed: ${error.message}`);
      return null;
    });

  pendingEvaluations.set(key, {
    createdAt: Date.now(),
    promise
  });

  setTimeout(() => {
    const pending = pendingEvaluations.get(key);
    if (pending && Date.now() - pending.createdAt >= EVALUATION_TTL_MS) {
      pendingEvaluations.delete(key);
    }
  }, EVALUATION_TTL_MS + 1000).unref?.();
}

async function takeQualityEvaluation({ userId, sessionId, timeoutMs = 1800 }) {
  const key = evaluationKey(userId, sessionId);
  const pending = pendingEvaluations.get(key);
  if (!pending) return null;

  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs));
  const result = await Promise.race([pending.promise, timeout]);

  if (result) {
    pendingEvaluations.delete(key);
  }

  return result;
}

module.exports = {
  scheduleQualityEvaluation,
  takeQualityEvaluation
};
