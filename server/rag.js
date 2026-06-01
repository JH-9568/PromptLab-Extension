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
    .replace(/알려\s*줄게/g, '알려줘')
    .replace(/알려줄게/g, '알려줘')
    .replace(/알려\s*드리겠습니다/g, '알려줘')
    .replace(/알려드리겠습니다/g, '알려줘')
    .replace(/제공해\s*드리겠습니다/g, '제공해주세요')
    .replace(/제공해\s*드립니다/g, '제공해주세요')
    .replace(/작성해\s*드리겠습니다/g, '작성해주세요')
    .replace(/정리해\s*드리겠습니다/g, '정리해주세요')
    .replace(/\s+/g, ' ')
    .trim();
}

function removeLanguageLeakage(prompt, originalPrompt) {
  let result = String(prompt || '').trim();

  if (hasKoreanText(originalPrompt)) {
    result = result
      .replace(/\s*If needed,?\s+explain what information would make the answer more specific\.?\s*$/i, '')
      .replace(/\s*If necessary,?\s+.*$/i, '')
      .replace(/\s*Ask for more details if needed\.?\s*$/i, '')
      .trim();
  }

  return result;
}

function countWords(value) {
  return String(value || '').trim().split(/\s+/).filter(Boolean).length;
}

function countKoreanAwareLength(value) {
  const text = String(value || '').trim();
  if (!text) return 0;
  return hasKoreanText(text) ? text.length : countWords(text);
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

function hasAttachmentContext(value) {
  return Boolean(value && typeof value === 'object' && value.has_attachment);
}

function normalizeAttachmentContext(value) {
  if (!hasAttachmentContext(value)) {
    return {
      has_attachment: false,
      attachment_count: 0
    };
  }

  const count = Number.isFinite(Number(value.attachment_count))
    ? Math.max(1, Math.min(Number(value.attachment_count), 10))
    : 1;

  return {
    has_attachment: true,
    attachment_count: count
  };
}

function mergePromptAnalysis(modelAnalysis, prompt, attachmentContext) {
  const analysis = normalizePromptAnalysis(analyzePrompt(prompt));
  if (hasAttachmentContext(attachmentContext)) {
    analysis.has_reference = true;
    analysis.specificity_score = calculateSpecificityScore(analysis);
  }
  return analysis;
}

function parseGenerationPayload(content, originalPrompt, attachmentContext) {
  const rawContent = String(content || '').trim();
  if (!rawContent) return null;

  const jsonText = rawContent
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  const parsed = JSON.parse(jsonText);
  if (!parsed || typeof parsed !== 'object') return null;

  const improvedPrompt = removeLanguageLeakage(
    normalizeInstructionVoice(sanitizeImprovedPrompt(parsed.improved_prompt)),
    originalPrompt
  );
  if (!improvedPrompt) return null;

  return {
    improved_prompt: improvedPrompt,
    before_analysis: mergePromptAnalysis(parsed.before_analysis, originalPrompt, attachmentContext),
    after_analysis: mergePromptAnalysis(parsed.after_analysis, improvedPrompt, attachmentContext),
    improvement_type: normalizeImprovementType(parsed.improvement_type),
    improvement_reason: normalizeImprovementReason(parsed.improvement_reason),
    attachment_context: normalizeAttachmentContext(attachmentContext),
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

async function createCompactChatCompletion({ client, model, messages }) {
  const request = {
    model,
    max_completion_tokens: 400,
    messages
  };

  if (isReasoningModel(model)) {
    request.reasoning_effort = process.env.OPENAI_REASONING_EFFORT || 'low';
  } else {
    request.temperature = 0.2;
  }

  return client.chat.completions.create(request);
}

function buildGeneratedResult({
  improvedPrompt,
  originalPrompt,
  provider,
  fallbackReason,
  attachmentContext,
  improvementType,
  improvementReason
}) {
  const normalizedImprovedPrompt = normalizeInstructionVoice(improvedPrompt);
  return {
    improved_prompt: normalizedImprovedPrompt,
    before_analysis: mergePromptAnalysis(null, originalPrompt, attachmentContext),
    after_analysis: mergePromptAnalysis(null, normalizedImprovedPrompt, attachmentContext),
    improvement_type: improvementType || (isLowInformationPrompt(originalPrompt) ? 'ask_clarifying_question' : 'minimal_cleanup'),
    improvement_reason: improvementReason || (isLowInformationPrompt(originalPrompt)
      ? '원문 정보가 부족해 필요한 정보를 먼저 묻도록 개선했습니다.'
      : '서버 fallback으로 원문의 의도를 유지하는 최소 개선을 적용했습니다.'),
    attachment_context: normalizeAttachmentContext(attachmentContext),
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

function isVeryVaguePrompt(value) {
  const compactPrompt = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s~!?.。,，ㅋㅠㅜㅡ\-_/\\|"'`()[\]{}:;]/g, '');

  return /^(이거|이것|저거|그거)?(알려줘|설명해줘|해줘|정리해줘|요약해줘)$/.test(compactPrompt)
    || /^(좋은거|괜찮은거|아무거나|뭐|무엇)(추천해줘|골라줘)$/.test(compactPrompt)
    || /^(tellme|tellmethis|explainthis|explainit|summarizethis|summarizeit|dothis|help)$/.test(compactPrompt);
}

function isGenerallyAnswerablePrompt(value) {
  return !isLowInformationPrompt(value) && !isVeryVaguePrompt(value);
}

function hasClarificationFirstRewrite(value) {
  const text = String(value || '').trim();
  return /답변하기\s*전|먼저\s*(사용자|질문|확인|요청)|사용자에게\s*(물어|질문|요청)|정보를\s*(요청|확인|질문)|구체적인\s*정보를\s*(요청|물어|질문)|세부\s*정보를\s*(요청|물어|질문)|추천하려면.*질문|묻는\s*질문|질문을\s*(해|작성|만들)|알려\s*주시면|제공해\s*주시면|ask\s+the\s+user|ask\s+me|before\s+answering|first\s+ask|request\s+more\s+details|provide\s+more\s+details/i.test(text);
}

function getQualityIssues(originalPrompt, improvedPrompt) {
  const issues = [];

  if (isGenerallyAnswerablePrompt(originalPrompt) && hasClarificationFirstRewrite(improvedPrompt)) {
    issues.push('clarification_first_for_answerable_prompt');
  }

  if (shouldCompactShortRewrite(originalPrompt, improvedPrompt)) {
    issues.push('over_expanded_short_prompt');
  }

  return issues;
}

function buildRewritePolicy(originalPrompt) {
  const text = String(originalPrompt || '');
  const wordCount = countWords(text);
  const hasExplicitCount = /\d+\s*(개|가지|명|문장|단계|항목|items?|steps?|examples?)|[한두세네다섯여섯일곱여덟아홉열]\s*(개|가지|문장|단계|항목)/i.test(text);
  const hasExplicitFormat = /단계별|목록|리스트|불릿|번호|섹션|문단|요약|표|테이블|json|markdown|bullet|list|table|step|section/i.test(text);

  return [
    'Rewrite the user prompt; do not answer it.',
    'Return only the improved prompt.',
    'Preserve the original intent and scope.',
    'Treat the five analysis fields as measurement metadata only. They are not a checklist to maximize.',
    'Make the prompt clearer and easier for an AI assistant to execute.',
    'Keep it concise. Add only the smallest amount of context, structure, or constraints needed.',
    'Strictly do not add specific tools, technologies, platforms, methods, categories, examples, counts, audience details, edge cases, or requirements that the original prompt did not mention.',
    'Use generic wording such as "practical method", "useful tips", "useful criteria", or "simple example" instead of inventing named tools or detailed subtopics.',
    'For recommendation or planning prompts, it is okay to add one generic quality lens such as feasibility, priority, differentiation, expected insight, or execution plan when it directly improves answer usefulness.',
    'If the original prompt asks for tips, methods, explanations, recommendations, or how-to guidance, do not turn it into a clarification-first prompt unless it is impossible to answer generally.',
    'If the prompt is too vague to improve safely, rewrite it as an instruction for the assistant to ask one concise clarifying question.',
    hasExplicitCount ? 'The user requested a quantity; preserve it.' : 'The user did not request a quantity; do not add one.',
    hasExplicitFormat ? 'The user requested an output format; preserve it.' : 'The user did not request a specific output format; do not force one.',
    wordCount <= 20
      ? 'For short prompts, keep the rewrite to 1 sentence and under about 120 Korean characters or 30 English words. This is a hard limit. Add at most one new answer-quality requirement. Do not add a colon, parenthetical lists, numbered questions, multiple options, or many subtopics.'
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

function buildVeryVaguePrompt({ originalPrompt, clientLanguage, attachmentContext }) {
  const useKorean = hasKoreanText(originalPrompt) || /^ko\b/i.test(normalizeClientLanguage(clientLanguage));

  if (hasAttachmentContext(attachmentContext)) {
    return useKorean
      ? '답변하지 말고, 첨부한 자료에서 어떤 부분을 설명하면 되는지 사용자에게 한 문장으로 물어봐.'
      : 'Do not answer yet; ask the user which part of the attached file they want explained.';
  }

  return useKorean
    ? '답변하지 말고, 사용자가 알고 싶은 주제나 내용을 한 문장으로 물어봐.'
    : 'Do not answer yet; ask the user what topic or content they want explained.';
}

function shouldCompactShortRewrite(originalPrompt, improvedPrompt) {
  const originalWordCount = countWords(originalPrompt);
  if (originalWordCount > 20) return false;

  const originalLength = countKoreanAwareLength(originalPrompt);
  const improvedLength = countKoreanAwareLength(improvedPrompt);
  const hardLimit = hasKoreanText(improvedPrompt) ? 80 : 30;
  const expansionLimit = Math.max(originalLength * 3, hardLimit);
  const toolListPattern = /excel|google sheets|python|pandas|command[- ]?line|uniq|awk|vba|office add-?in|graph api|power automate|명령줄|도구별|장단점|첫\/마지막|부분\s*키|지원동기|경험기술|성장|목표\s*사용자|대상\s*사용자|target\s+users?|자주\s*하는\s*실수|문장\s*예시|항목별/i;

  return improvedLength > expansionLimit || toolListPattern.test(improvedPrompt);
}

async function compactShortRewrite({ client, model, originalPrompt, improvedPrompt, clientLanguage, attachmentContext }) {
  const useKorean = hasKoreanText(originalPrompt) || /^ko\b/i.test(normalizeClientLanguage(clientLanguage));
  const maxInstruction = useKorean
    ? '80자 이내의 한국어 한 문장'
    : 'one English sentence under 18 words';
  const attachmentInstruction = hasAttachmentContext(attachmentContext)
    ? (useKorean
        ? '첨부가 감지되었으므로 필요하면 첨부 자료 참조만 짧게 포함하세요.'
        : 'An attachment is present, so include a short attachment reference only if needed.')
    : (useKorean
        ? '첨부가 없으므로 첨부 자료를 언급하지 마세요.'
        : 'No attachment is present, so do not mention attachments.');

  const response = await createCompactChatCompletion({
    client,
    model,
    messages: [
      {
        role: 'system',
        content: [
          'You compact over-expanded prompt rewrites.',
          'You are also a critic that fixes clarification-first rewrites when the original prompt is generally answerable.',
          'Return only the improved prompt, not an answer.',
          'Preserve the original user intent.',
          `Write in ${useKorean ? 'Korean' : 'English'}.`,
          `Keep it to ${maxInstruction}.`,
          'The compact prompt must still be meaningfully more useful than the original.',
          'Keep one directly relevant answer-quality requirement when it improves usefulness.',
          'Do not write in assistant-answer voice. Write as a user instruction to an AI assistant.',
          'For generally answerable requests, do not ask the user for missing details first.',
          'If the over-expanded rewrite asks for missing details but the original topic is clear, rewrite it into an immediately answerable prompt.',
          'Do not turn a how-to request into a yes/no question.',
          'If the original asks for a method, keep it as a request for a practical method.',
          'Remove invented tools, methods, categories, examples, tradeoffs, edge cases, and details not present in the original prompt.',
          'Remove generic meta-instructions about asking for more specificity unless the original prompt asks for them.',
          attachmentInstruction
        ].join(' ')
      },
      {
        role: 'user',
        content: [
          'Original prompt:',
          originalPrompt,
          '',
          'Over-expanded rewrite:',
          improvedPrompt,
          '',
          'Compact it now.'
        ].join('\n')
      }
    ]
  });

  const compactPrompt = removeLanguageLeakage(
    normalizeInstructionVoice(sanitizeImprovedPrompt(response.choices?.[0]?.message?.content)),
    originalPrompt
  );
  return compactPrompt || null;
}

async function reviseGeneratedPayloadIfNeeded({
  client,
  model,
  payload,
  originalPrompt,
  clientLanguage,
  attachmentContext
}) {
  const qualityIssues = getQualityIssues(originalPrompt, payload.improved_prompt);
  if (qualityIssues.length === 0) return payload;

  const revisedPrompt = await compactShortRewrite({
    client,
    model,
    originalPrompt,
    improvedPrompt: payload.improved_prompt,
    clientLanguage,
    attachmentContext
  });

  if (!revisedPrompt) return payload;

  return {
    ...payload,
    improved_prompt: revisedPrompt,
    after_analysis: mergePromptAnalysis(null, revisedPrompt, attachmentContext),
    improvement_type: payload.improvement_type === 'ask_clarifying_question'
      ? 'clarify_goal'
      : payload.improvement_type,
    improvement_reason: qualityIssues.includes('clarification_first_for_answerable_prompt')
      ? '2차 검토에서 답변 가능한 요청이 추가 질문으로 바뀌지 않도록 수정했습니다.'
      : payload.improvement_reason
  };
}

async function generateImprovedPrompt({ originalPrompt, taskCategory, clientLanguage, guidelineContent, attachmentContext }) {
  const normalizedClientLanguage = normalizeClientLanguage(clientLanguage);
  const trimmedGuidelineContent = trimGuidelineContent(guidelineContent);
  const normalizedAttachmentContext = normalizeAttachmentContext(attachmentContext);

  if (isVeryVaguePrompt(originalPrompt)) {
    return buildGeneratedResult({
      improvedPrompt: buildVeryVaguePrompt({
        originalPrompt,
        clientLanguage: normalizedClientLanguage,
        attachmentContext: normalizedAttachmentContext
      }),
      originalPrompt,
      attachmentContext: normalizedAttachmentContext,
      provider: 'rule',
      improvementType: 'ask_clarifying_question',
      improvementReason: '지시 대상이 불명확해 한 가지 핵심 정보를 먼저 묻도록 개선했습니다.'
    });
  }

  if (!process.env.OPENAI_API_KEY) {
    if (!shouldAllowOpenAIFallback()) {
      throw createOpenAIError('OPENAI_API_KEY is not configured.', null, 'missing_openai_api_key');
    }

    return buildGeneratedResult({
      improvedPrompt: buildFallbackPrompt({ originalPrompt, clientLanguage: normalizedClientLanguage }),
      originalPrompt,
      attachmentContext: normalizedAttachmentContext,
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
            `UI language hint: ${getTargetLanguageLabel(normalizedClientLanguage)}. Use this only when the original prompt has no clear language.`,
            buildRewritePolicy(originalPrompt),
            'Task category is only a hint; prioritize the original prompt.',
            'Write the improved prompt as a user instruction addressed to an AI assistant.',
            'The improved_prompt must use the same language as the original prompt unless the user explicitly asks for another language.',
            'The improvement_reason is internal analytics metadata and must always be written in Korean, regardless of the original prompt language.',
            'Avoid assistant-voice phrases such as "I will", "제가", "드리겠습니다", or "알려주시면".',
            'Choose exactly one improvement_type: minimal_cleanup, clarify_goal, add_context_request, add_output_structure, add_constraints, add_examples_or_references, ask_clarifying_question, already_strong.',
            'Use ask_clarifying_question when the original prompt is too vague and adding invented context would be risky.',
            'When using ask_clarifying_question, the improved prompt must ask the assistant to request only the one or two most important missing details. It must not assign defaults such as beginner, senior, SaaS, no experience, or a specific technology unless the original prompt says so.',
            'Do not choose ask_clarifying_question for concrete troubleshooting, coding, debugging, file-operation, comparison, or explanation prompts when the assistant can provide a generally useful answer from the information given.',
            'Do not choose ask_clarifying_question for prompts asking "how", "방법", "가능해", "can I", or "is there a way" when the topic is clear. These should usually become clarify_goal, add_output_structure, or add_constraints.',
            'For example, "지피티한테 워드를 직접 제어하게 하는방법이 있어?" should become a short prompt asking for Word automation methods, key tradeoffs, and a simple example without naming specific technologies. It should not ask the assistant to request details before answering.',
            'Use already_strong only when the prompt is already answerable and specific; still return a lightly polished prompt.',
            'Use improvement_reason to explain the main edit for product analytics, not for user-facing persuasion.',
            'Evaluate the original and improved prompts with these boolean fields: has_goal, has_context, has_format, has_constraint, has_reference.',
            'has_goal means a clear task, question, desired result, decision, or problem to solve.',
            'has_context means background, situation, audience, domain, user role, project state, or reason the task matters.',
            'has_format means an explicit requested output shape such as list, table, bullets, sections, step-by-step format, JSON, Markdown, code block, or paragraph style. File types such as CSV alone do not count as output format.',
            'has_constraint means actual requirements, exclusions, tone, length, language, deadline, feasibility, or decision criteria. A list of missing details to ask the user does not automatically count as constraints.',
            'has_reference means the prompt includes or asks the assistant to use source text, links, attachments, evidence, prior content, data, or material to follow. Asking for examples alone does not count as reference.',
            'Korean analysis hints: "초보자", "입문자", "학생", "개발자", or "대상" indicate context/audience. "단계별", "목록으로", "표 형태", "문단으로", "번호로" indicate format. "간결하게", "자세히", "한국어로", or "이해할 수 있게" indicate constraints. "첨부", "아래 내용", "원문", "출처", or "근거" indicate reference.',
            normalizedAttachmentContext.has_attachment
              ? `The UI detected ${normalizedAttachmentContext.attachment_count} attachment(s), but file contents and file names are not available. If the prompt refers to "this", "it", "이거", a document, image, file, summary, analysis, or review, treat that as referring to the attachment. Add a concise attachment-reference phrase in the same language as the original prompt, such as "using the attached file" for English or the natural equivalent in the original language. Do not ask the user to paste, upload, or provide the attached content again. Do not claim to know the contents. Treat has_reference as true.`
              : 'No attachment was detected by the UI.',
            trimmedGuidelineContent
              ? `Use these product guidelines as background, but do not mechanically apply every guideline:\n${trimmedGuidelineContent}`
              : ''
          ].join(' ')
        },
        {
          role: 'user',
          content: [
            `Task category: ${taskCategory || 'general'}`,
            normalizedAttachmentContext.has_attachment
              ? `Attachment context: ${normalizedAttachmentContext.attachment_count} attachment(s) are present. Contents and file names are unavailable.`
              : 'Attachment context: no attachment detected.',
            '',
            'Original prompt:',
            originalPrompt,
            '',
            'Rewrite the original prompt only. The rewrite must be meaningfully more useful than the original, not just a synonym or grammar polish. Keep short prompts compact. Do not add named tools, named methods, named platforms, exact counts, parenthetical option lists, arbitrary examples, long questionnaires, or unrelated subtopics unless they are already in the original prompt.'
          ].join('\n')
        }
      ]
    });

    const parsedPayload = parseGenerationPayload(response.choices?.[0]?.message?.content, originalPrompt, normalizedAttachmentContext);
    if (parsedPayload) {
      return reviseGeneratedPayloadIfNeeded({
        client,
        model,
        payload: parsedPayload,
        originalPrompt,
        clientLanguage: normalizedClientLanguage,
        attachmentContext: normalizedAttachmentContext
      });
    }

    if (!shouldAllowOpenAIFallback()) {
      throw createOpenAIError('OpenAI returned invalid JSON for prompt improvement.', null, 'invalid_openai_json');
    }

    return buildGeneratedResult({
      improvedPrompt: buildFallbackPrompt({ originalPrompt, clientLanguage: normalizedClientLanguage }),
      originalPrompt,
      attachmentContext: normalizedAttachmentContext,
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
      attachmentContext: normalizedAttachmentContext,
      provider: 'fallback',
      fallbackReason: error.code || error.status || 'openai_error'
    });
  }
}

module.exports = {
  generateImprovedPrompt
};
