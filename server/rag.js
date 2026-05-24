const OpenAI = require('openai');

const { analyzePrompt } = require('./promptAnalyzer');

const ANALYSIS_KEYS = [
  'has_goal',
  'has_context',
  'has_format',
  'has_constraint',
  'has_reference'
];

function sanitizeImprovedPrompt(value) {
  return String(value || '')
    .replace(/```[a-zA-Z]*\n?/g, '')
    .replace(/```/g, '')
    .replace(/^\s*#+\s+/gm, '')
    .replace(/^\s*(개선된\s*프롬프트|improved\s*prompt)\s*:\s*/i, '')
    .trim();
}

function normalizeInstructionVoice(value) {
  return String(value || '')
    .replace(/제공해\s*드리겠습니다/g, '제공해주세요')
    .replace(/제공해\s*드립니다/g, '제공해주세요')
    .replace(/작성해\s*드리겠습니다/g, '작성해주세요')
    .replace(/정리해\s*드리겠습니다/g, '정리해주세요')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePromptAnalysis(value) {
  const source = value && typeof value === 'object' ? value : {};
  const analysis = {};

  for (const key of ANALYSIS_KEYS) {
    analysis[key] = Boolean(source[key]);
  }

  analysis.specificity_score = ANALYSIS_KEYS
    .filter((key) => analysis[key])
    .length * 20;

  return analysis;
}

function parseGenerationPayload(content) {
  const rawContent = String(content || '').trim();
  if (!rawContent) return null;

  const jsonText = rawContent
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  const parsed = JSON.parse(jsonText);
  if (!parsed || typeof parsed !== 'object') return null;

  const improvedPrompt = normalizeInstructionVoice(sanitizeImprovedPrompt(parsed.improved_prompt));
  if (!improvedPrompt) return null;

  return {
    improved_prompt: improvedPrompt,
    before_analysis: normalizePromptAnalysis(parsed.before_analysis),
    after_analysis: normalizePromptAnalysis(parsed.after_analysis),
    provider: 'openai'
  };
}

function isReasoningModel(model) {
  return /^(gpt-5|o[134])\b/i.test(String(model || ''));
}

async function createJsonChatCompletion({ client, model, messages }) {
  const request = {
    model,
    response_format: { type: 'json_object' },
    max_completion_tokens: 1800,
    messages
  };

  if (isReasoningModel(model)) {
    request.reasoning_effort = process.env.OPENAI_REASONING_EFFORT || 'low';
  } else {
    request.temperature = 0.3;
  }

  return client.chat.completions.create(request);
}

function buildGeneratedResult({ improvedPrompt, originalPrompt, provider, fallbackReason }) {
  const normalizedImprovedPrompt = normalizeInstructionVoice(improvedPrompt);
  return {
    improved_prompt: normalizedImprovedPrompt,
    before_analysis: analyzePrompt(originalPrompt),
    after_analysis: analyzePrompt(normalizedImprovedPrompt),
    provider,
    ...(fallbackReason ? { fallback_reason: fallbackReason } : {})
  };
}

function shouldAllowOpenAIFallback() {
  return String(process.env.ALLOW_OPENAI_FALLBACK || '').toLowerCase() === 'true';
}

function createOpenAIError(message, cause, fallbackReason) {
  const error = new Error(message);
  error.status = 502;
  error.code = fallbackReason || cause?.code || cause?.status || 'openai_error';
  error.cause = cause;
  return error;
}

function normalizeClientLanguage(value) {
  return String(value || '').split(',')[0].trim() || 'auto';
}

function getTargetLanguageLabel(clientLanguage) {
  const normalized = normalizeClientLanguage(clientLanguage);
  if (normalized === 'auto') return 'the same language as the original prompt';

  const languageCode = normalized.split('-')[0];
  try {
    const displayNames = new Intl.DisplayNames(['en'], { type: 'language' });
    return displayNames.of(languageCode) || normalized;
  } catch {
    return normalized;
  }
}

function hasKoreanText(value) {
  return /[가-힣]/.test(String(value || ''));
}

function isLowInformationPrompt(value) {
  const compactPrompt = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s~!?.。,，ㅋㅠㅜㅡ\-_/\\|"'`()[\]{}:;]/g, '');

  return !compactPrompt
    || /^(ㅎㅇ)+$/.test(compactPrompt)
    || /^(hi|hello|hey|yo|sup)$/.test(compactPrompt)
    || /^(안녕|안녕하세요|하이|헬로|반가워|반갑습니다)$/.test(compactPrompt);
}

function countWords(value) {
  return String(value || '').trim().split(/\s+/).filter(Boolean).length;
}

function buildRewritePolicy(originalPrompt) {
  const text = String(originalPrompt || '');
  const wordCount = countWords(text);
  const hasExplicitCount = /\d+\s*(개|가지|명|문장|단계|항목|items?|steps?|examples?)|[한두세네다섯여섯일곱여덟아홉열]\s*(개|가지|문장|단계|항목)/i.test(text);
  const hasExplicitFormat = /목록|리스트|불릿|번호|표|테이블|json|markdown|bullet|list|table/i.test(text);

  return [
    'Preserve the user intent and scope. Improve the prompt; do not answer it.',
    'Keep useful ambiguity when the user is only asking a rough question. Do not over-specify hidden requirements.',
    'Do not invent exact counts, output formats, examples, categories, sections, checklists, legal/tax analysis, or implementation detail that the user did not ask for.',
    'Do not preview or guess the answer content. If the user asks to find, search, or send something, keep that retrieval intent without adding assumed subtopics or examples.',
    hasExplicitCount ? 'The user requested a quantity; preserve it.' : 'The user did not request a quantity; do not add one.',
    hasExplicitFormat ? 'The user requested an output format; preserve it.' : 'The user did not request a specific output format; do not force one.',
    wordCount <= 20
      ? 'For short informal prompts, produce a compact 1-2 sentence rewrite.'
      : 'For detailed prompts, preserve the requested depth and only tighten wording or structure where it helps.'
  ].join(' ');
}

function buildFallbackPrompt({ originalPrompt, clientLanguage }) {
  if (isLowInformationPrompt(originalPrompt)) {
    return hasKoreanText(originalPrompt) || /^ko\b/i.test(normalizeClientLanguage(clientLanguage))
      ? '제가 원하는 답변을 받을 수 있도록 주제, 목표, 원하는 출력 형식, 중요한 조건을 간단히 질문한 뒤 최종 프롬프트를 작성해주세요.'
      : 'Ask me briefly for the topic, goal, desired output format, and important constraints, then write a final usable prompt.';
  }

  return String(originalPrompt || '').trim();
}

async function generateImprovedPrompt({ originalPrompt, taskCategory, clientLanguage }) {
  const normalizedClientLanguage = normalizeClientLanguage(clientLanguage);

  if (!process.env.OPENAI_API_KEY) {
    if (!shouldAllowOpenAIFallback()) {
      throw createOpenAIError('OPENAI_API_KEY is not configured.', null, 'missing_openai_api_key');
    }

    return buildGeneratedResult({
      improvedPrompt: buildFallbackPrompt({ originalPrompt, clientLanguage: normalizedClientLanguage }),
      originalPrompt,
      provider: 'fallback'
    });
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    const response = await createJsonChatCompletion({
      client,
      model,
      messages: [
        {
          role: 'system',
          content: [
            'You are an expert prompt engineer.',
            'Your job is to rewrite user prompts so they are clearer, more usable, and faithful to the original intent.',
            `Target output language: ${getTargetLanguageLabel(normalizedClientLanguage)}.`,
            buildRewritePolicy(originalPrompt),
            'Task category is only a hint; prioritize the original prompt.',
            'Write the improved prompt as a user instruction addressed to an AI assistant.',
            'Avoid assistant-voice phrases such as "I will", "제가", "드리겠습니다", or "알려주시면".',
            'Evaluate the original and improved prompts with these boolean fields: has_goal, has_context, has_format, has_constraint, has_reference.',
            'Return only valid JSON with this exact shape:',
            '{"improved_prompt":"...","before_analysis":{"has_goal":true,"has_context":false,"has_format":false,"has_constraint":false,"has_reference":false},"after_analysis":{"has_goal":true,"has_context":false,"has_format":true,"has_constraint":true,"has_reference":false}}'
          ].join(' ')
        },
        {
          role: 'user',
          content: [
            `Task category: ${taskCategory || 'general'}`,
            '',
            'Original prompt:',
            originalPrompt,
            '',
            'Rewrite the original prompt only. Do not add output formats, counts, examples, or subtopics that are not present in the original prompt.'
          ].join('\n')
        }
      ]
    });

    const parsedPayload = parseGenerationPayload(response.choices?.[0]?.message?.content);
    if (parsedPayload) return parsedPayload;

    if (!shouldAllowOpenAIFallback()) {
      throw createOpenAIError('OpenAI returned invalid JSON for prompt improvement.', null, 'invalid_openai_json');
    }

    return buildGeneratedResult({
      improvedPrompt: buildFallbackPrompt({ originalPrompt, clientLanguage: normalizedClientLanguage }),
      originalPrompt,
      provider: 'fallback',
      fallbackReason: 'invalid_openai_json'
    });
  } catch (error) {
    if (!shouldAllowOpenAIFallback()) {
      console.warn(`OpenAI prompt improvement failed: ${error.message}`);
      throw createOpenAIError('OpenAI prompt improvement failed.', error);
    }

    console.warn(`OpenAI prompt improvement failed, using fallback: ${error.message}`);
    return buildGeneratedResult({
      improvedPrompt: buildFallbackPrompt({ originalPrompt, clientLanguage: normalizedClientLanguage }),
      originalPrompt,
      provider: 'fallback',
      fallbackReason: error.code || error.status || 'openai_error'
    });
  }
}

module.exports = {
  generateImprovedPrompt
};
