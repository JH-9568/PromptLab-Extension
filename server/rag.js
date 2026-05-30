const OpenAI = require('openai');

const { analyzePrompt } = require('./promptAnalyzer');

const ANALYSIS_KEYS = [
  'has_goal',
  'has_context',
  'has_format',
  'has_constraint',
  'has_reference'
];

const IMPROVEMENT_TYPES = new Set([
  'minimal_cleanup',
  'clarify_goal',
  'add_context_request',
  'add_output_structure',
  'add_constraints',
  'add_examples_or_references',
  'ask_clarifying_question',
  'already_strong'
]);

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

function countWords(value) {
  return String(value || '').trim().split(/\s+/).filter(Boolean).length;
}

function calculateSpecificityScore(analysis) {
  return ANALYSIS_KEYS
    .filter((key) => analysis[key])
    .length * 20;
}

function normalizePromptAnalysis(value) {
  const source = value && typeof value === 'object' ? value : {};
  const analysis = {};

  for (const key of ANALYSIS_KEYS) {
    analysis[key] = Boolean(source[key]);
  }

  analysis.specificity_score = calculateSpecificityScore(analysis);

  return analysis;
}

function mergePromptAnalysis(modelAnalysis, prompt) {
  const modelResult = normalizePromptAnalysis(modelAnalysis);
  const localResult = analyzePrompt(prompt);
  const merged = {};

  for (const key of ANALYSIS_KEYS) {
    merged[key] = Boolean(modelResult[key] || localResult[key]);
  }

  merged.specificity_score = calculateSpecificityScore(merged);
  return merged;
}

function parseGenerationPayload(content, originalPrompt) {
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
    before_analysis: mergePromptAnalysis(parsed.before_analysis, originalPrompt),
    after_analysis: mergePromptAnalysis(parsed.after_analysis, improvedPrompt),
    improvement_type: normalizeImprovementType(parsed.improvement_type),
    improvement_reason: normalizeImprovementReason(parsed.improvement_reason),
    provider: 'openai'
  };
}

function isReasoningModel(model) {
  return /^(gpt-5|o[134])\b/i.test(String(model || ''));
}

function createPromptImprovementSchema() {
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
      improved_prompt: {
        type: 'string',
        description: 'The single rewritten prompt to show to the user.'
      },
      improvement_type: {
        type: 'string',
        enum: Array.from(IMPROVEMENT_TYPES)
      },
      improvement_reason: {
        type: 'string',
        description: 'One concise reason explaining the most important edit. Keep it under 120 Korean characters or 30 English words.'
      },
      before_analysis: analysisSchema,
      after_analysis: analysisSchema
    },
    required: [
      'improved_prompt',
      'improvement_type',
      'improvement_reason',
      'before_analysis',
      'after_analysis'
    ]
  };
}

async function createJsonChatCompletion({ client, model, messages }) {
  const request = {
    model,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'prompt_improvement',
        strict: true,
        schema: createPromptImprovementSchema()
      }
    },
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
    improvement_type: isLowInformationPrompt(originalPrompt) ? 'ask_clarifying_question' : 'minimal_cleanup',
    improvement_reason: isLowInformationPrompt(originalPrompt)
      ? '원문 정보가 부족해 필요한 정보를 먼저 묻도록 개선했습니다.'
      : '서버 fallback으로 원문의 의도를 유지하는 최소 개선을 적용했습니다.',
    provider,
    ...(fallbackReason ? { fallback_reason: fallbackReason } : {})
  };
}

function normalizeImprovementType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return IMPROVEMENT_TYPES.has(normalized) ? normalized : 'minimal_cleanup';
}

function normalizeImprovementReason(value) {
  const reason = String(value || '').replace(/\s+/g, ' ').trim();
  return reason || '사용자의 원래 의도를 유지하면서 답변 가능성을 높이도록 개선했습니다.';
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

function buildRewritePolicy(originalPrompt) {
  const text = String(originalPrompt || '');
  const wordCount = countWords(text);
  const hasExplicitCount = /\d+\s*(개|가지|명|문장|단계|항목|items?|steps?|examples?)|[한두세네다섯여섯일곱여덟아홉열]\s*(개|가지|문장|단계|항목)/i.test(text);
  const hasExplicitFormat = /단계별|목록|리스트|불릿|번호|섹션|문단|요약|표|테이블|json|markdown|bullet|list|table|step|section/i.test(text);

  return [
    'Preserve the user intent and scope. Improve the prompt; do not answer it.',
    'Treat the five analysis fields as measurement metadata only. They are not a checklist to maximize.',
    'Keep useful ambiguity when the user is only asking a rough question. Do not over-specify hidden requirements.',
    'Apply prompt-engineering best practices selectively, not exhaustively. Choose only the one or two improvements that most help this specific prompt.',
    'Use your judgment. Add role, objective, context, output structure, examples, or constraints only when they are naturally implied by the original request or clearly make the prompt more usable.',
    'A good rewrite may be more specific than the original, but it must not become a different or larger task.',
    'Do not try to satisfy every prompt-engineering guideline at once. Avoid piling on role, context, format, constraints, examples, caveats, and success criteria in the same rewrite unless the user asked for that level of detail.',
    'If the original prompt is already clear, make a small meaningful improvement by adding at most one short directly relevant answer-quality requirement, such as examples, common mistakes, caveats, or actionable tips.',
    'For learning or explanation requests, simple examples are often useful, but add them only as a short requirement. Do not add a checklist unless the user asks for one.',
    'When adding answer-quality requirements, append a short phrase or sentence. Do not create a full rubric, nested structure, parenthetical schema, or detailed grading criteria unless requested.',
    'Do not return a rewrite that only changes wording, grammar, or synonyms.',
    'Do not invent exact counts, unrelated output formats, arbitrary categories, legal/tax analysis, or implementation detail that the user did not ask for.',
    'Do not invent user attributes, experience level, role seniority, target company type, industry, product, stack, location, deadline, or background. If these details would help, ask for them or use neutral bracketed placeholders.',
    'For vague prompts, prefer a rewrite that asks one or two clarifying questions before proceeding. Do not silently fill the missing details with assumptions.',
    'Do not use a clarification-first rewrite when the original prompt already names a concrete problem, task, or deliverable that can be answered generally. In that case, ask the assistant to state assumptions or mention what details would narrow the answer, then still provide useful general guidance.',
    'For how-to, possibility, recommendation, explanation, or option-comparison questions, do not make the assistant ask the user for environment details first. Rewrite the prompt so the assistant gives a useful general answer, states assumptions, compares common options, and mentions what extra details would refine the recommendation.',
    'For those answerable questions, the improved prompt must not include instructions like "ask me first", "before answering ask", "먼저 질문", "먼저 요청", or "먼저 물어". Put optional missing details at the end as "If needed, explain what information would make the answer more specific."',
    'Do not preview or guess the answer content. You may add generally useful answer-quality requirements, such as practical examples, common mistakes, caveats, or actionable tips, only when they directly fit the original request.',
    hasExplicitCount ? 'The user requested a quantity; preserve it.' : 'The user did not request a quantity; do not add one.',
    hasExplicitFormat ? 'The user requested an output format; preserve it.' : 'The user did not request a specific output format; do not force one.',
    wordCount <= 20
      ? 'For short prompts, keep the rewrite to 1-2 sentences and under about 180 Korean characters or 45 English words. Add at most one new answer-quality requirement. Do not add parenthetical lists, multiple options, or many subtopics.'
      : 'For detailed prompts, preserve the requested depth and improve clarity, structure, and answer quality where it helps.'
  ].join(' ');
}

function trimGuidelineContent(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.length > 6000 ? `${text.slice(0, 6000)}\n\n[Guidelines truncated]` : text;
}

function buildFallbackPrompt({ originalPrompt, clientLanguage }) {
  if (isLowInformationPrompt(originalPrompt)) {
    return hasKoreanText(originalPrompt) || /^ko\b/i.test(normalizeClientLanguage(clientLanguage))
      ? '제가 원하는 답변을 받을 수 있도록 주제, 목표, 원하는 출력 형식, 중요한 조건을 간단히 질문한 뒤 최종 프롬프트를 작성해주세요.'
      : 'Ask me briefly for the topic, goal, desired output format, and important constraints, then write a final usable prompt.';
  }

  return String(originalPrompt || '').trim();
}

async function generateImprovedPrompt({ originalPrompt, taskCategory, clientLanguage, guidelineContent }) {
  const normalizedClientLanguage = normalizeClientLanguage(clientLanguage);
  const trimmedGuidelineContent = trimGuidelineContent(guidelineContent);

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
            'You are a prompt editor inside a Chrome extension for ChatGPT.',
            'Your job is to rewrite one user prompt so it is more likely to produce a useful answer.',
            'Do not answer the prompt.',
            `Target output language: ${getTargetLanguageLabel(normalizedClientLanguage)}.`,
            buildRewritePolicy(originalPrompt),
            'Task category is only a hint; prioritize the original prompt.',
            'Write the improved prompt as a user instruction addressed to an AI assistant.',
            'The improved_prompt and improvement_reason must both use the same language as the original prompt unless the user explicitly asks for another language.',
            'Avoid assistant-voice phrases such as "I will", "제가", "드리겠습니다", or "알려주시면".',
            'Choose exactly one improvement_type: minimal_cleanup, clarify_goal, add_context_request, add_output_structure, add_constraints, add_examples_or_references, ask_clarifying_question, already_strong.',
            'Use ask_clarifying_question when the original prompt is too vague and adding invented context would be risky.',
            'When using ask_clarifying_question, the improved prompt must ask the assistant to request missing details from the user. It must not assign defaults such as beginner, senior, SaaS, no experience, or a specific technology unless the original prompt says so.',
            'Do not choose ask_clarifying_question for concrete troubleshooting, coding, debugging, comparison, or explanation prompts when the assistant can provide a generally useful answer from the information given.',
            'Do not choose ask_clarifying_question for prompts asking "how", "방법", "가능해", "can I", or "is there a way" when the topic is clear. These should usually become clarify_goal, add_output_structure, or add_constraints.',
            'For example, "지피티한테 워드를 직접 제어하게 하는방법이 있어?" should become a prompt asking for possible automation approaches, tradeoffs, and simple examples, with a final note about what environment details would refine the recommendation. It should not ask the assistant to request details before answering.',
            'Use already_strong only when the prompt is already answerable and specific; still return a lightly polished prompt.',
            'Use improvement_reason to explain the main edit for product analytics, not for user-facing persuasion.',
            'Evaluate the original and improved prompts with these boolean fields: has_goal, has_context, has_format, has_constraint, has_reference.',
            'has_goal means a clear task, question, desired result, decision, or problem to solve.',
            'has_context means background, situation, audience, domain, user role, project state, or reason the task matters.',
            'has_format means an explicit output shape such as list, table, bullets, sections, steps, JSON, Markdown, code, or paragraph style.',
            'has_constraint means requirements, exclusions, tone, length, language, quality criteria, deadline, feasibility, or decision criteria.',
            'has_reference means the prompt includes or asks the assistant to include/use examples, source text, links, attachments, evidence, prior content, rubrics, benchmarks, or material to follow.',
            'Korean analysis hints: "초보자", "입문자", "학생", "개발자", or "대상" indicate context/audience. "단계별", "목록", "표", "문단", "번호로", or "요약" indicate format. "쉽게", "간결하게", "자세히", "한국어로", "실용적인", or "이해할 수 있게" indicate constraints. "예시", "사례", "참고", "자료", "출처", or "근거" indicate reference.',
            trimmedGuidelineContent
              ? `Use these product guidelines as background, but do not mechanically apply every guideline:\n${trimmedGuidelineContent}`
              : ''
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
            'Rewrite the original prompt only. The rewrite must be meaningfully more useful than the original, not just a synonym or grammar polish. Keep short prompts compact. Do not add unrelated output formats, exact counts, parenthetical option lists, arbitrary examples, or unrelated subtopics.'
          ].join('\n')
        }
      ]
    });

    const parsedPayload = parseGenerationPayload(response.choices?.[0]?.message?.content, originalPrompt);
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
