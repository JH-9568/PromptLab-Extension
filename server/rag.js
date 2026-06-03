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
    before_analysis: mergePromptAnalysis(null, originalPrompt, attachmentContext),
    after_analysis: mergePromptAnalysis(null, improvedPrompt, attachmentContext),
    improvement_type: normalizeImprovementType(parsed.improvement_type),
    improvement_reason: normalizeImprovementReason(parsed.improvement_reason),
    attachment_context: normalizeAttachmentContext(attachmentContext),
    provider: 'openai'
  };
}

function isReasoningModel(model) {
  return /^(gpt-5|o[134])\b/i.test(String(model || ''));
}

function getPromptImprovementTokenLimit() {
  const configuredLimit = Number(process.env.OPENAI_MAX_COMPLETION_TOKENS);
  return Number.isFinite(configuredLimit) && configuredLimit > 0 ? configuredLimit : 900;
}

function getPromptImprovementModel() {
  const model = String(process.env.OPENAI_REWRITE_MODEL || process.env.OPENAI_PROMPT_MODEL || 'gpt-4.1-mini').trim();
  return model || 'gpt-4.1-mini';
}

function createPromptImprovementSchema() {
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
      }
    },
    required: [
      'improved_prompt',
      'improvement_type',
      'improvement_reason'
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
    max_completion_tokens: getPromptImprovementTokenLimit(),
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

function normalizeComparisonToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/(해주세요|해줘|줘)$/g, '')
    .replace(/(적인|적이고|적으로|적)$/g, '')
    .replace(/(하고|하게|하기|해서|하며|하면|해)$/g, '')
    .replace(/(으로|로|에서|에게|한테|부터|까지|처럼|보다|과|와|의|을|를|은|는|이|가|도|만|좀)$/g, '')
    .trim();
}

function getComparableTokens(value) {
  const stopwords = new Set([
    '수',
    '있는',
    '있게',
    '위해',
    '위한',
    '관련',
    '더',
    '좋은',
    '명확',
    '구체',
    '실용',
    '실행',
    '가능',
    'actionable',
    'clear',
    'specific',
    'practical'
  ]);

  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .map(normalizeComparisonToken)
    .filter((token) => token.length >= 2 && !stopwords.has(token));
}

function countNewGuidanceMarkers(originalPrompt, improvedPrompt) {
  const original = String(originalPrompt || '');
  const improved = String(improvedPrompt || '');
  const guidanceMarkers = [
    /기준|관점|판단\s*근거|선정\s*기준|평가/i,
    /우선순위|중요도|먼저\s*할\s*일/i,
    /항목별|구조|흐름|단계|계획|전략|채널/i,
    /장단점|차이점|비교|트레이드오프/i,
    /예시|사례|샘플/i,
    /실행\s*방식|실행\s*방법|실행\s*계획|실천\s*방법|적용\s*방법/i,
    /기대\s*효과|효과|성과|측정\s*지표|성공\s*기준/i,
    /현실적\s*한계|한계|리스크|도전\s*과제|주의\s*점|고려\s*사항/i,
    /인사이트|원인|해결책|해결하는\s*문제|문제\s*해결|차별화|수익화|개선\s*방향|적합한\s*용도/i,
    /criteria|perspective|decision\s+basis|selection\s+criteria|evaluation/i,
    /priority|importance|first\s+steps?/i,
    /by\s+item|structure|flow|steps?|plan|strategy|channel/i,
    /pros?\s+and\s+cons?|differences?|compare|trade-?offs?/i,
    /examples?|samples?|cases?/i,
    /execution\s+approach|implementation\s+approach|practical\s+steps?|application\s+method/i,
    /expected\s+outcomes?|effect|impact|success\s+criteria|metrics?/i,
    /limitations?|risks?|considerations?|cautions?/i,
    /insights?|causes?|solutions?|problem\s+solved|differentiation|moneti[sz]ation|improvement\s+direction|suitable\s+use/i
  ];

  return guidanceMarkers
    .filter((pattern) => pattern.test(improved) && !pattern.test(original))
    .length;
}

function hasMeaningfulGuidanceExpansion(originalPrompt, improvedPrompt) {
  const markerCount = countNewGuidanceMarkers(originalPrompt, improvedPrompt);
  return markerCount >= 2;
}

function isProblemSolvingIdeaPrompt(value) {
  const text = String(value || '');
  return /아이디어|추천|제안|ideas?|recommend|suggest|proposal/i.test(text)
    && /해결|문제|개선|줄이|늘리|성장|과소비|과시|solve|problem|improve|increase|grow|growth/i.test(text);
}

function isGrowthPrompt(value) {
  return /사용자\s*수|유저\s*수|늘리|성장|확보|획득|users?|growth|grow|increase|acquire|acquisition/i.test(String(value || ''));
}

function isWebServiceIdeaPrompt(value) {
  return /웹\s*(서비스|사이트)|웹서비스|웹사이트|web\s*(service|site)/i.test(String(value || ''))
    && /아이디어|추천|제안|ideas?|recommend|suggest|proposal/i.test(String(value || ''));
}

function hasWebServiceIdeaLens(value) {
  const text = String(value || '');
  const lensPatterns = [
    /대상\s*사용자|타깃|타겟|고객|사용자층|target\s+user|audience|customer/i,
    /핵심\s*기능|주요\s*기능|core\s+feature|key\s+feature/i,
    /차별화|경쟁|독창|differentiation|unique|competitive/i,
    /수익화|비즈니스\s*모델|moneti[sz]ation|business\s+model/i,
    /실행\s*난이도|난이도|구현\s*난이도|implementation\s+difficulty|difficulty/i
  ];

  return lensPatterns.filter((pattern) => pattern.test(text)).length >= 4;
}

function hasExplicitQuantity(value) {
  return /\d+\s*(개|가지|명|문장|단계|항목|items?|steps?|examples?|ideas?|ways?|methods?)|[한두세네다섯여섯일곱여덟아홉열]\s*(개|가지|문장|단계|항목)/i.test(String(value || ''));
}

function hasInventedExactCount(originalPrompt, improvedPrompt) {
  return !hasExplicitQuantity(originalPrompt) && hasExplicitQuantity(improvedPrompt);
}

function normalizeAppendComparison(value) {
  return trimTerminalPunctuation(value)
    .replace(/\s+/g, '')
    .toLowerCase();
}

function hasAppendStyleRewrite(originalPrompt, improvedPrompt) {
  const original = String(originalPrompt || '').trim();
  const improved = String(improvedPrompt || '').trim();
  if (original.length < 12 || improved.length <= original.length) return false;

  const normalizedOriginal = normalizeAppendComparison(original);
  const normalizedImproved = normalizeAppendComparison(improved);
  const suffixPattern = /^[.!?。！？]\s*(각|아이디어별|전략별|방법별|분석\s*방법별|목표별|전체\s*흐름|핵심|구체적|예상|기대|실행|주의|장단점|비교|선정\s*기준|판단\s*기준)/i;

  if (normalizedImproved.startsWith(normalizedOriginal)) {
    const suffix = improved.slice(Math.min(original.length, improved.length)).trim();
    return suffixPattern.test(suffix);
  }

  const firstSentence = improved.split(/[.!?。！？]/)[0] || improved;
  const normalizedOriginalStem = normalizeAppendComparison(stripKoreanRequestEnding(original));
  const normalizedFirstSentence = normalizeAppendComparison(firstSentence);
  const suffixAfterFirstSentence = improved.slice(firstSentence.length).trim();

  return normalizedOriginalStem.length >= 12
    && normalizedFirstSentence.startsWith(normalizedOriginalStem)
    && suffixPattern.test(suffixAfterFirstSentence);
}

function isUnderImprovedRewrite(originalPrompt, improvedPrompt) {
  if (!isGenerallyAnswerablePrompt(originalPrompt)) return false;

  const markerCount = countNewGuidanceMarkers(originalPrompt, improvedPrompt);
  if (isProblemSolvingIdeaPrompt(originalPrompt) && markerCount < 3) return true;
  if (isGrowthPrompt(originalPrompt) && markerCount < 3) return true;
  if (hasMeaningfulGuidanceExpansion(originalPrompt, improvedPrompt)) return false;

  if (countWords(originalPrompt) <= 20 && markerCount < 2) return true;

  const originalTokens = getComparableTokens(originalPrompt);
  if (originalTokens.length < 4) return false;

  const improvedTokens = getComparableTokens(improvedPrompt);
  if (improvedTokens.length === 0) return false;

  const improvedTokenSet = new Set(improvedTokens);
  const sharedTokenCount = originalTokens.filter((token) => improvedTokenSet.has(token)).length;
  const overlapRatio = sharedTokenCount / originalTokens.length;
  const addedTokenCount = improvedTokens.filter((token) => !originalTokens.includes(token)).length;

  const originalLength = countKoreanAwareLength(originalPrompt);
  const improvedLength = countKoreanAwareLength(improvedPrompt);
  const lengthLimit = hasKoreanText(improvedPrompt)
    ? Math.max(originalLength + 35, originalLength * 1.65)
    : Math.max(originalLength + 10, originalLength * 1.5);

  return overlapRatio >= 0.7 && addedTokenCount <= 3 && improvedLength <= lengthLimit;
}

function getQualityIssues(originalPrompt, improvedPrompt) {
  const issues = [];

  if (isGenerallyAnswerablePrompt(originalPrompt) && hasClarificationFirstRewrite(improvedPrompt)) {
    issues.push('clarification_first_for_answerable_prompt');
  }

  if (shouldCompactShortRewrite(originalPrompt, improvedPrompt)) {
    issues.push('over_expanded_short_prompt');
  }

  if (hasInventedExactCount(originalPrompt, improvedPrompt)) {
    issues.push('invented_exact_count');
  }

  if (hasAppendStyleRewrite(originalPrompt, improvedPrompt)) {
    issues.push('append_style_rewrite');
  }

  if (isWebServiceIdeaPrompt(originalPrompt) && !hasWebServiceIdeaLens(improvedPrompt)) {
    issues.push('weak_web_service_idea_rewrite');
  }

  if (isUnderImprovedRewrite(originalPrompt, improvedPrompt)) {
    issues.push('under_improved_rewrite');
  }

  return issues;
}

function buildRewritePolicy(originalPrompt) {
  const text = String(originalPrompt || '');
  const wordCount = countWords(text);
  const hasExplicitCount = hasExplicitQuantity(text);
  const hasExplicitFormat = /단계별|목록|리스트|불릿|번호|섹션|문단|요약|표|테이블|json|markdown|bullet|list|table|step|section/i.test(text);

  return [
    'Rewrite the user prompt; do not answer it.',
    'Return only the improved prompt.',
    'Preserve the original intent and scope.',
    'Treat the five analysis fields as measurement metadata only. They are not a checklist to maximize.',
    'Make the prompt clearer and easier for an AI assistant to execute.',
    'Do not merely polish wording. A good rewrite should visibly improve the expected answer while staying within the original intent.',
    'Do not simply append requirements to the original sentence. Integrate added requirements into a natural rewritten prompt.',
    'Keep it concise, but add enough useful answer design that the rewrite feels meaningfully better than the original.',
    'Never make a weak rewrite that only adds generic adjectives such as clearer, specific, practical, actionable, or executable.',
    'If the original is already understandable, add two or three natural answer-quality requirements, such as output structure, criteria, priorities, constraints, examples, assumptions, tradeoffs, edge cases, success metrics, execution steps, expected effects, or limitations.',
    'You may add examples, constraints, comparison criteria, output structure, or evaluation criteria when they are a natural extension of the original task.',
    'Do not invent private facts, user background, exact numbers, deadlines, budget, location, file contents, target audience, or business details not present in the original prompt.',
    'Do not add named tools, technologies, platforms, or methods unless the original prompt mentions them or the task clearly asks for tool/method examples.',
    'For recommendation, planning, problem-solving, or idea-generation prompts, add useful lenses such as feasibility, differentiation, priority, execution plan, expected impact, constraints, examples, or risks when they directly improve answer usefulness.',
    'If the original prompt asks for tips, methods, explanations, recommendations, or how-to guidance, do not turn it into a clarification-first prompt unless it is impossible to answer generally.',
    'If the prompt is too vague to improve safely, rewrite it as an instruction for the assistant to ask one concise clarifying question.',
    hasExplicitCount ? 'The user requested a quantity; preserve it.' : 'The user did not request a quantity; do not add one.',
    hasExplicitFormat ? 'The user requested an output format; preserve it.' : 'The user did not request a specific output format; do not force one.',
    wordCount <= 20
      ? 'For short prompts, keep the rewrite to 1 or 2 sentences and under about 220 Korean characters or 55 English words. Add two to four aligned answer requirements when the prompt is generally answerable. Do not turn it into a questionnaire.'
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

function trimTerminalPunctuation(value) {
  return String(value || '').trim().replace(/[.!?。！？\s]+$/g, '');
}

function stripKoreanRequestEnding(value) {
  return trimTerminalPunctuation(value)
    .replace(/\s*(알려|설명|추천|제안|정리|작성)\s*해?\s*(줘|봐|주세요)?$/i, '')
    .trim();
}

function extractKoreanWebServiceIdeaSubject(value) {
  const subject = stripKoreanRequestEnding(value)
    .replace(/웹\s*(서비스|사이트)|웹서비스|웹사이트/gi, '')
    .replace(/아이디어/gi, '')
    .replace(/해결할\s*수\s*있는|해결할수있는|해결하기\s*위한|위한/gi, '')
    .replace(/같은\s*느낌의?|느낌의?|컨셉의?|콘셉트의?|테마의?|분위기의?|감성의?/gi, '')
    .replace(/[,，]\s*/g, '와 ')
    .replace(/\s*(을|를|에\s*대한)\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return subject;
}

function hasKoreanProblemSolvingIntent(value) {
  return /해결|문제|줄이|개선|완화|불편|예방|관리|도움/i.test(String(value || ''));
}

function hasKoreanConceptIntent(value) {
  return /느낌|컨셉|콘셉트|테마|분위기|감성|스타일|세계관|무드/i.test(String(value || ''));
}

function buildKoreanWebServiceIdeaRewrite(basePrompt) {
  const subject = extractKoreanWebServiceIdeaSubject(basePrompt);

  if (!subject) {
    return '실현 가능한 웹서비스 아이디어를 추천해줘. 아이디어별 대상 사용자, 해결하는 문제, 차별화 포인트, 수익화 가능성, 실행 난이도를 함께 비교해줘.';
  }

  if (hasKoreanProblemSolvingIntent(basePrompt) && !hasKoreanConceptIntent(basePrompt)) {
    return `${subject} 문제를 줄이는 웹서비스 아이디어를 추천해줘. 아이디어별 대상 사용자, 핵심 기능, 차별화 포인트, 수익화 가능성, 실행 난이도를 함께 비교해줘.`;
  }

  return `${subject} 콘셉트를 살린 웹서비스 아이디어를 추천해줘. 아이디어별 대상 사용자, 핵심 경험, 차별화 포인트, 수익화 가능성, 실행 난이도를 함께 비교해줘.`;
}

function buildKoreanGrowthRewrite(basePrompt) {
  const serviceMatch = basePrompt.match(/^(.+?)\s*(사용자\s*수|유저\s*수)/i);
  const serviceName = serviceMatch?.[1]?.trim();

  if (serviceName) {
    return `${serviceName}의 사용자 수를 늘리기 위한 성장 전략을 제안해줘. 전략별 우선순위, 실행 계획, 필요한 지표, 예상 리스크를 함께 설명해줘.`;
  }

  return `${basePrompt}. 성장 전략별 우선순위, 실행 계획, 필요한 지표, 예상 리스크를 함께 설명해줘.`;
}

function buildKoreanAnalysisRewrite(basePrompt) {
  const subject = stripKoreanRequestEnding(basePrompt)
    .replace(/어떤\s*분석을\s*하면\s*좋을까.*$/i, '')
    .replace(/하려고\s*하는데.*$/i, '')
    .replace(/\s*(을|를)\s*분석$/i, '')
    .trim();

  if (subject) {
    return `${subject}에 적합한 분석 방법을 추천해줘. 분석 방법별 목적, 필요한 데이터, 기대 인사이트, 우선순위를 함께 설명해줘.`;
  }

  return `${basePrompt}. 분석 방법별 목적, 필요한 데이터, 기대 인사이트, 우선순위를 함께 설명해줘.`;
}

function buildKoreanIdeaRewrite(basePrompt, requirementText) {
  const subject = stripKoreanRequestEnding(basePrompt)
    .replace(/\s*(을|를)\s*$/g, '')
    .replace(/예술적\s*요소를\s*활용해\s*해결할\s*수\s*있는\s*실용적인\s*아이디어/i, '예술적 요소로 완화하는 아이디어')
    .replace(/해결할\s*수\s*있는\s*실용적인\s*아이디어/i, '완화하는 아이디어')
    .trim();

  if (!subject) {
    return `아이디어를 추천해줘. ${requirementText}`;
  }

  return `${subject}를 추천해줘. ${requirementText}`;
}

function buildKoreanHowToRewrite(basePrompt) {
  const task = stripKoreanRequestEnding(basePrompt)
    .replace(/처음\s*구현하는\s*입장에서\s*어떤\s*구조로\s*설계하는\s*게\s*좋은지/i, '처음 구현할 때 참고할 설계 구조를')
    .replace(/어떤\s*구조로\s*설계하는\s*게\s*좋은지/i, '설계 구조를')
    .trim();

  if (!task) {
    return '실행 방법을 알려줘. 전체 흐름, 핵심 단계, 주의할 점, 간단한 예시를 함께 설명해줘.';
  }

  return `${task} 알려줘. 전체 흐름, 핵심 단계, 주의할 점, 간단한 예시를 함께 설명해줘.`;
}

function buildMeaningfulFallbackRewrite(originalPrompt, clientLanguage) {
  const useKorean = hasKoreanText(originalPrompt) || /^ko\b/i.test(normalizeClientLanguage(clientLanguage));
  const basePrompt = trimTerminalPunctuation(originalPrompt);

  if (!basePrompt) return '';

  if (useKorean) {
    if (/웹\s*(서비스|사이트)|웹서비스|웹사이트|서비스/i.test(basePrompt) && /아이디어|추천|제안/i.test(basePrompt)) {
      return buildKoreanWebServiceIdeaRewrite(basePrompt);
    }

    if (/사용자\s*수|유저\s*수|늘리|성장/i.test(basePrompt)) {
      return buildKoreanGrowthRewrite(basePrompt);
    }

    if (/분석/i.test(basePrompt)) {
      return buildKoreanAnalysisRewrite(basePrompt);
    }

    if (/아이디어|추천|제안/i.test(basePrompt) && /해결|문제|개선|줄이|늘리|성장/i.test(basePrompt)) {
      return buildKoreanIdeaRewrite(
        basePrompt,
        '아이디어별 작동 원리, 실행 방식, 기대 효과, 현실적 한계를 함께 설명해줘.'
      );
    }

    if (/아이디어|추천|제안/i.test(basePrompt)) {
      return buildKoreanIdeaRewrite(
        basePrompt,
        '선정 기준, 추천 이유, 간단한 예시, 실행 난이도를 함께 설명해줘.'
      );
    }

    if (/비교|차이|중\s*뭐|뭐가\s*나|어떤\s*게\s*나|선택/i.test(basePrompt)) {
      return `${basePrompt}. 판단 기준, 장단점, 적합한 상황, 최종 추천을 함께 비교해줘.`;
    }

    if (/방법|어떻게|구현|설계|붙이|만들|작성|해결/i.test(basePrompt)) {
      return buildKoreanHowToRewrite(basePrompt);
    }

    return `${stripKoreanRequestEnding(basePrompt)}에 대해 핵심 기준, 이유, 예시, 주의할 점을 함께 설명해줘.`;
  }

  if (/\b(web\s+service|service)\b/i.test(basePrompt) && /\b(ideas?|recommend|suggest|proposal)\b/i.test(basePrompt)) {
    return `${basePrompt}. For each idea, include the target user, problem solved, differentiation point, monetization potential, and implementation difficulty.`;
  }

  if (/\b(users?|growth|grow|increase)\b/i.test(basePrompt)) {
    return `${basePrompt}. Include strategy priorities, execution plan, required metrics, and expected risks.`;
  }

  if (/\b(analy[sz]e|analysis)\b/i.test(basePrompt)) {
    return `${basePrompt}. Include each analysis type's purpose, required data, expected insights, and priority.`;
  }

  if (/\b(ideas?|recommend|suggest|proposal)\b/i.test(basePrompt) && /\b(solve|problem|improve|increase|grow|growth)\b/i.test(basePrompt)) {
    return `${basePrompt}. For each idea, include how it works, execution approach, expected effect, and realistic limitations.`;
  }

  if (/\b(ideas?|recommend|suggest|proposal)\b/i.test(basePrompt)) {
    return `${basePrompt}. Include selection criteria, reasons, simple examples, and implementation difficulty.`;
  }

  if (/\b(compare|difference|versus|vs\.?|which|choose|choice)\b/i.test(basePrompt)) {
    return `${basePrompt}. Compare decision criteria, pros and cons, suitable situations, and a final recommendation.`;
  }

  if (/\b(how|method|implement|design|build|write|solve)\b/i.test(basePrompt)) {
    return `${basePrompt}. Include the overall flow, key steps, cautions, and a simple example.`;
  }

  return `${basePrompt}. Include key criteria, reasons, examples, and cautions.`;
}

function shouldCompactShortRewrite(originalPrompt, improvedPrompt) {
  const originalWordCount = countWords(originalPrompt);
  if (originalWordCount > 20) return false;

  const originalLength = countKoreanAwareLength(originalPrompt);
  const improvedLength = countKoreanAwareLength(improvedPrompt);
  const hardLimit = hasKoreanText(improvedPrompt) ? 220 : 55;
  const expansionLimit = Math.max(originalLength * 4, hardLimit);
  const toolPatterns = [
    /excel/i,
    /google sheets/i,
    /python|pandas/i,
    /command[- ]?line|uniq|awk|명령줄/i,
    /vba|office add-?in|graph api|power automate/i
  ];
  const mentionedToolCount = toolPatterns.filter((pattern) => pattern.test(improvedPrompt)).length;
  const originalMentionedToolCount = toolPatterns.filter((pattern) => pattern.test(originalPrompt)).length;
  const hasInventedToolPileup = mentionedToolCount >= 3 && originalMentionedToolCount === 0;

  return improvedLength > expansionLimit || hasInventedToolPileup;
}

async function compactShortRewrite({ client, model, originalPrompt, improvedPrompt, clientLanguage, attachmentContext, qualityIssues = [] }) {
  const useKorean = hasKoreanText(originalPrompt) || /^ko\b/i.test(normalizeClientLanguage(clientLanguage));
  const isWeakRewrite = qualityIssues.includes('under_improved_rewrite')
    || qualityIssues.includes('append_style_rewrite')
    || qualityIssues.includes('weak_web_service_idea_rewrite');
  const maxInstruction = useKorean
    ? (isWeakRewrite ? '220자 이내의 한국어 1~2문장' : '120자 이내의 한국어 한 문장')
    : (isWeakRewrite ? '1 or 2 English sentences under 55 words' : 'one English sentence under 30 words');
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
          'Do not just append a second sentence to the original. Rewrite the prompt naturally so the added requirements feel integrated.',
          isWeakRewrite
            ? 'Keep two to four directly relevant answer-quality requirements.'
            : 'Keep one directly relevant answer-quality requirement when it improves usefulness.',
          isWeakRewrite
            ? 'The current rewrite is too similar to the original. Do not merely add generic adjectives. Add two to four aligned answer requirements such as examples, constraints, output structure, evaluation criteria, execution approach, expected effect, priority, tradeoff, limitation, or decision basis.'
            : 'Remove unnecessary expansion while preserving one useful answer-quality requirement.',
          qualityIssues.includes('append_style_rewrite')
            ? 'The current rewrite reads like the original sentence plus appended requirements. Rewrite it as a natural integrated prompt instead.'
            : '',
          qualityIssues.includes('weak_web_service_idea_rewrite')
            ? 'For web service idea prompts, include target users, core features, differentiation, monetization potential, and implementation difficulty when they fit the original request.'
            : '',
          qualityIssues.includes('invented_exact_count')
            ? 'The current rewrite added an arbitrary exact quantity. Remove the exact quantity unless the original prompt requested one.'
            : '',
          'Do not write in assistant-answer voice. Write as a user instruction to an AI assistant.',
          'For generally answerable requests, do not ask the user for missing details first.',
          'If the over-expanded rewrite asks for missing details but the original topic is clear, rewrite it into an immediately answerable prompt.',
          'Do not turn a how-to request into a yes/no question.',
          'If the original asks for a method, keep it as a request for a practical method.',
          'Keep safe examples, constraints, structure, tradeoffs, and edge cases when they naturally fit the original intent.',
          'Remove unsupported private facts, arbitrary exact counts, and unrelated named tools or platforms.',
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
          isWeakRewrite ? 'Weak rewrite:' : 'Over-expanded rewrite:',
          improvedPrompt,
          '',
          isWeakRewrite ? 'Improve it meaningfully now.' : 'Compact it now.'
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
    attachmentContext,
    qualityIssues
  });

  if (!revisedPrompt) return payload;

  const shouldUseMeaningfulFallback = (qualityIssues.includes('under_improved_rewrite') && isUnderImprovedRewrite(originalPrompt, revisedPrompt))
    || hasAppendStyleRewrite(originalPrompt, revisedPrompt)
    || (isWebServiceIdeaPrompt(originalPrompt) && !hasWebServiceIdeaLens(revisedPrompt))
    || hasInventedExactCount(originalPrompt, revisedPrompt);

  const finalRevisedPrompt = shouldUseMeaningfulFallback
    ? buildMeaningfulFallbackRewrite(originalPrompt, clientLanguage)
    : revisedPrompt;

  if (!finalRevisedPrompt) return payload;

  return {
    ...payload,
    improved_prompt: finalRevisedPrompt,
    after_analysis: mergePromptAnalysis(null, finalRevisedPrompt, attachmentContext),
    improvement_type: payload.improvement_type === 'ask_clarifying_question'
      ? 'clarify_goal'
      : qualityIssues.includes('under_improved_rewrite')
        || qualityIssues.includes('invented_exact_count')
        || qualityIssues.includes('append_style_rewrite')
        || qualityIssues.includes('weak_web_service_idea_rewrite')
        ? 'add_output_structure'
      : payload.improvement_type,
    improvement_reason: qualityIssues.includes('clarification_first_for_answerable_prompt')
      ? '2차 검토에서 답변 가능한 요청이 추가 질문으로 바뀌지 않도록 수정했습니다.'
      : qualityIssues.includes('invented_exact_count')
        ? '2차 검토에서 임의 개수를 제거하고 답변 구조를 보강했습니다.'
      : qualityIssues.includes('append_style_rewrite')
        ? '2차 검토에서 덧붙이기식 문장을 자연스러운 개선 프롬프트로 재작성했습니다.'
      : qualityIssues.includes('weak_web_service_idea_rewrite')
        ? '2차 검토에서 웹서비스 아이디어 답변에 필요한 평가 축을 보강했습니다.'
      : qualityIssues.includes('under_improved_rewrite')
        ? '2차 검토에서 단순 표현 수정이 아니라 답변 기준이나 실행 관점을 보강했습니다.'
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
    const model = getPromptImprovementModel();
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
