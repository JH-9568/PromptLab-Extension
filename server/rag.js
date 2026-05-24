const OpenAI = require('openai');

const { analyzePrompt } = require('./promptAnalyzer');

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
    .replace(
      /[가-힣A-Za-z0-9\s/·,()]+?(?:을|를)?\s*(?:구체적으로\s*)?알려주시면\s*그에\s*맞는\s*([가-힣A-Za-z0-9\s/·,()]+?)(?:을|를)?\s*(목록\s*형태로\s*)?제공해\s*드립니다\.?/g,
      ' 필요한 정보가 불명확하면 먼저 확인 질문을 하고, 그에 맞는 $1를 $2제안해주세요.'
    )
    .replace(
      /[가-힣A-Za-z0-9\s/·,()]+?(?:을|를)?\s*(?:구체적으로\s*)?알려주시면\s*([가-힣A-Za-z0-9\s/·,()]+?)(?:을|를)?\s*제공해\s*드립니다\.?/g,
      ' 필요한 정보가 불명확하면 먼저 확인 질문을 하고, $1를 제안해주세요.'
    )
    .replace(
      /[^.!?。]*알려주시면[^.!?。]*(?:드릴|제공|작성|정리|설명)[^.!?。]*[.!?。]?/g,
      ' 필요한 정보가 불명확하면 먼저 확인 질문을 하고, 가능한 범위에서 바로 사용할 수 있는 결과를 제안해주세요.'
    )
    .replace(/제공해\s*드리겠습니다/g, '제공해주세요')
    .replace(/제공해\s*드립니다/g, '제공해주세요')
    .replace(/제안을\s*드릴\s*수\s*있습니다/g, '제안해주세요')
    .replace(/작성해\s*드리겠습니다/g, '작성해주세요')
    .replace(/정리해\s*드리겠습니다/g, '정리해주세요')
    .replace(/\s+/g, ' ')
    .trim();
}

const ANALYSIS_KEYS = [
  'has_goal',
  'has_context',
  'has_format',
  'has_constraint',
  'has_reference'
];

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

async function createJsonChatCompletion({ client, model, temperature, messages }) {
  const request = {
    model,
    response_format: { type: 'json_object' },
    messages
  };

  if (isReasoningModel(model)) {
    request.reasoning_effort = process.env.OPENAI_REASONING_EFFORT || 'low';
  } else {
    request.temperature = temperature;
  }

  return client.chat.completions.create(request);
}

async function analyzePromptPairWithOpenAI({ client, model, originalPrompt, improvedPrompt }) {
  const response = await createJsonChatCompletion({
    client,
    model,
    temperature: 0,
    messages: [
      {
        role: 'system',
        content: [
          'You are a prompt structure evaluator.',
          'Your only job is to evaluate whether each prompt contains five structural fields.',
          'Evaluate semantic meaning, not exact keywords. Be consistent and do not under-score prompts that clearly imply a field.',
          'Return only valid JSON. Do not rewrite, answer, explain, or add markdown.',
          'Scoring fields:',
          'has_goal: true when the prompt states a task, intent, desired result, decision, recommendation request, or problem to solve.',
          'has_context: true when the prompt provides background, situation, audience, domain, source context, business goal, user role, project state, or why the task matters.',
          'has_format: true when the prompt specifies output shape such as bullets, table, list, ranking, comparison, steps, JSON, Markdown, code, report paragraph, or section structure.',
          'has_constraint: true when the prompt includes requirements, exclusions, quality criteria, tone, length, language, deadline, feasibility, originality, monetization, differentiation, validation conditions, or decision criteria.',
          'has_reference: true when the prompt includes or asks the assistant to use examples, existing services/products, search results, source text, links, attached material, evidence, prior content, benchmark cases, rubric, or criteria to follow.',
          'Korean examples: "웹 서비스로 돈을 벌 계획" implies has_context=true. "돈을 많이 벌 수 있는", "수익성이 높은", "현실적인", or "차별점" imply has_constraint=true. "검색해서 이미 있거나 잘 되는 서비스 예시" implies has_reference=true.',
          'Return this exact JSON shape:',
          '{"before_analysis":{"has_goal":true,"has_context":false,"has_format":false,"has_constraint":false,"has_reference":false},"after_analysis":{"has_goal":true,"has_context":false,"has_format":true,"has_constraint":true,"has_reference":false}}'
        ].join(' ')
      },
      {
        role: 'user',
        content: [
          'Original prompt:',
          originalPrompt,
          '',
          'Improved prompt:',
          improvedPrompt
        ].join('\n')
      }
    ]
  });

  const parsed = JSON.parse(String(response.choices?.[0]?.message?.content || '{}'));
  return {
    before_analysis: normalizePromptAnalysis(parsed.before_analysis),
    after_analysis: normalizePromptAnalysis(parsed.after_analysis)
  };
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

function isKoreanLanguage(value) {
  return /^ko\b/i.test(normalizeClientLanguage(value));
}

function shouldUseKoreanRules(prompt, clientLanguage) {
  return isKoreanLanguage(clientLanguage) || hasKoreanText(prompt);
}

function isLowInformationPrompt(value) {
  const prompt = String(value || '').trim();
  const compactPrompt = prompt
    .toLowerCase()
    .replace(/[\s~!?.。,，ㅋㅠㅜㅡ\-_/\\|"'`()[\]{}:;]/g, '');

  if (!compactPrompt) return true;

  return /^(ㅎㅇ)+$/.test(compactPrompt)
    || /^(hi|hello|hey|yo|sup)$/.test(compactPrompt)
    || /^(안녕|안녕하세요|하이|헬로|반가워|반갑습니다)$/.test(compactPrompt);
}

function buildEnglishClarificationPrompt() {
  return [
    'Help me turn my rough request into a clearer prompt.',
    'Ask briefly for the topic, goal, desired output format, and any important constraints, then rewrite my answers into a ready-to-use final prompt.'
  ].join(' ');
}

function buildClarificationPrompt() {
  return [
    '제가 원하는 답변을 받을 수 있도록 질문을 구체화하려고 합니다.',
    '주제, 목표, 원하는 출력 형식, 반드시 지켜야 할 조건을 간단히 질문한 뒤, 답변을 바탕으로 바로 사용할 수 있는 최종 프롬프트를 작성해주세요.'
  ].join(' ');
}

function isWritingPlanRequest(prompt) {
  const text = String(prompt || '');
  if (isSpecificAnalysisRequest(text)) return false;

  return /보고서|리포트|레포트|과제|글|essay|report/i.test(text)
    && /오늘|지금|급|어케|어떻게|뭐부터|시작|써야|써야함|써야 함|쓸건데|쓸 건데|해야|해야함|해야 함/i.test(text);
}

function isSpecificAnalysisRequest(prompt) {
  return /csv|첨부|데이터|h1|h2|h3|가설|검증|분석|표|그래프|인과관계|관찰\s*연구|한계|문단\s*형태/i.test(String(prompt || ''));
}

function isTextRevisionRequest(prompt) {
  return /문장|글|표현|말투|text|sentence/i.test(prompt)
    && /자연스럽|고쳐|수정|다듬|교정|rewrite|revise|polish/i.test(prompt);
}

function isPaymentQuestion(prompt) {
  return /결제|결재|카드|PG|페이먼트|payment|checkout|stripe|토스페이먼츠|포트원|아임포트|수익|돈|입금|정산|계좌/i.test(String(prompt || ''));
}

function isShortPrompt(prompt) {
  return countWords(prompt) <= 20;
}

function countWords(value) {
  return String(value || '').trim().split(/\s+/).filter(Boolean).length;
}

function splitSentences(value) {
  return String(value || '')
    .split(/(?<=[.!?。])\s+|(?<=다\.)\s+|(?<=요\.)\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function isOverExpandedRewrite(originalPrompt, improvedPrompt) {
  const originalWords = countWords(originalPrompt);
  if (originalWords > 20) return false;

  const improved = String(improvedPrompt || '');
  const sentenceCount = splitSentences(improved).length;
  const improvedWords = countWords(improved);

  return sentenceCount > 3 || improvedWords > Math.max(55, originalWords * 5);
}

function buildTextRevisionPrompt() {
  return '입력한 문장의 의미는 유지하면서 더 자연스럽고 매끄러운 표현으로 고쳐주세요. 어색한 부분이 있다면 수정 이유를 간단히 설명해주세요.';
}

function buildEnglishTextRevisionPrompt() {
  return 'Rewrite the input text so it sounds natural and polished while keeping the original meaning. Briefly explain any important changes.';
}

function buildWritingPlanPrompt({ originalPrompt }) {
  const prompt = String(originalPrompt || '').trim();
  const subject = prompt
    .replace(/오늘|지금|급하게|급|어케|어떻게|뭐부터|시작|쓸건데|쓸 건데|써야함|써야 함|해야함|해야 함|해야|써야|쓸|씀|함/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const subjectWords = subject.split(/\s+/).filter(Boolean);
  const target = /보고서|리포트|레포트|report/i.test(subject) && subjectWords.length > 1
    ? subject
    : '보고서';

  return [
    `오늘 안에 ${target}를 작성해야 합니다.`,
    '주제나 요구사항이 아직 충분히 정리되지 않은 상황이라고 가정하고, 자료 정리, 목차 구성, 초안 작성, 검토 순서로 단계별 작성 계획을 간결하게 제안해주세요.',
    '바로 사용할 수 있는 기본 목차 템플릿도 함께 제시해주세요.'
  ].join(' ');
}

function buildEnglishFallbackPrompt({ originalPrompt, taskCategory }) {
  const categoryLabel = taskCategory || 'general';
  const prompt = String(originalPrompt || '').trim();
  const lowerPrompt = prompt.toLowerCase();
  const subject = prompt
    .replace(/\b(please|can you|could you|help me|write|create|make|do|fix|improve)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim() || prompt;

  if (isLowInformationPrompt(prompt)) {
    return buildEnglishClarificationPrompt();
  }

  if (isTextRevisionRequest(prompt)) {
    return buildEnglishTextRevisionPrompt();
  }

  if (/report|essay|assignment|paper|writing/i.test(prompt) && /today|urgent|how|start|where|what/i.test(prompt)) {
    return [
      'I need to work on a report today.',
      'Suggest a concise step-by-step writing plan from organizing materials to outlining, drafting, and reviewing.',
      'Include a simple outline template I can use right away.'
    ].join(' ');
  }

  const isTestRequest = /test|qa|verify|check|validate/i.test(lowerPrompt);
  const isPlanRequest = /plan|checklist|steps/i.test(lowerPrompt);

  if (isTestRequest) {
    return `${subject} needs to be tested. Create a concise QA checklist with expected behavior, key test cases, edge cases, and how to record results.`;
  }

  if (isPlanRequest) {
    return `Create a concise action plan for ${subject}. Include the goal, key steps, risks, and completion criteria.`;
  }

  const categoryTemplates = {
    study: `Help me learn ${subject}. Explain the key concepts with simple examples and step-by-step guidance.`,
    coding: `Help me solve ${subject}. Summarize possible causes, the fix, and how to verify it.`,
    writing: `Help me write about ${subject}. Create a clear draft with a natural structure and focused message.`,
    summary: `Summarize ${subject}. Keep only the key points and important facts, and do not invent details.`,
    analysis: `Analyze ${subject}. Cover the key evidence, pros and cons, risks, and final recommendation.`,
    etc: `Help me with ${subject}. Make the goal and task clear, then provide a useful result I can act on.`,
    general: `Help me with ${subject}. Make the goal and task clear, then provide a useful result I can act on.`
  };

  return categoryTemplates[categoryLabel] || categoryTemplates.general;
}

function buildFallbackPrompt({ originalPrompt, taskCategory, guidelines, clientLanguage }) {
  const categoryLabel = taskCategory || 'general';
  const prompt = String(originalPrompt || '').trim();
  const lowerPrompt = prompt.toLowerCase();

  if (!shouldUseKoreanRules(prompt, clientLanguage)) {
    return buildEnglishFallbackPrompt({ originalPrompt, taskCategory, guidelines });
  }

  if (isLowInformationPrompt(prompt)) {
    return buildClarificationPrompt();
  }

  if (isWritingPlanRequest(prompt)) {
    return buildWritingPlanPrompt({ originalPrompt: prompt });
  }

  if (isTextRevisionRequest(prompt)) {
    return buildTextRevisionPrompt();
  }

  if (isPaymentQuestion(prompt)) {
    return [
      '웹사이트에 결제 기능을 추가하면 고객이 결제한 돈이 어떤 과정을 거쳐 내 계좌로 입금되는지 설명해주세요.',
      'PG사 연동, 정산 계좌 설정, 수수료, 정산 주기, 사업자등록 필요 여부를 초보자도 이해할 수 있게 간단히 정리해주세요.'
    ].join(' ');
  }

  if (isSpecificAnalysisRequest(prompt)) {
    return prompt;
  }

  const isTestRequest = /테스트|test|qa|검증|확인|실행/.test(lowerPrompt);
  const isPlanRequest = /계획|plan|체크리스트|checklist/.test(lowerPrompt);
  const isTopicSelectionRequest = !isSpecificAnalysisRequest(prompt)
    && /주제|topic|아이디어|프로젝트/.test(lowerPrompt)
    && /정하|선정|추천|고르|찾|어케|어떻게|뭘|뭐/.test(lowerPrompt);
  const subject = prompt
    .replace(/할거다|할 거다|하려고\s*합니다|하려고|해줘|해주세요|작성|만들어줘|테스트|실행테스트/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || prompt;
  const courseMatch = prompt.match(/([가-힣A-Za-z0-9\s]+?)\s*강의/);
  const courseName = courseMatch?.[1]?.trim().split(/\s+/).pop() || '';

  if (isTopicSelectionRequest) {
    const projectContext = /텀프로젝트|term project|프로젝트/.test(lowerPrompt)
      ? '텀프로젝트'
      : '프로젝트';
    const domain = courseName || subject.replace(/주제|정하고싶은데|정하고 싶은데|어케할까|어떻게 할까|텀프로젝트|프로젝트/g, ' ').trim();
    const target = domain ? `${domain} 강의의 ${projectContext}` : projectContext;

    return [
      `${target} 주제를 정하려고 합니다.`,
      '수업 수준, 사용 가능한 데이터, 분석 방법, 평가 기준을 고려해서 적합한 프로젝트 주제 후보를 제안해주세요.',
      '각 후보별 장단점과 가장 추천하는 주제를 간단히 비교해주세요.'
    ].join(' ');
  }

  if (isTestRequest) {
    const target = subject.includes('프롬프트랩') || subject.toLowerCase().includes('promptlab')
      ? 'PromptLab의 프롬프트 실행 기능'
      : subject;

    return [
      `${target}을 테스트하려고 합니다.`,
      '정상 동작 기준, 주요 테스트 항목, 예외 상황, 결과 기록 방법을 QA 체크리스트 형식으로 간결하게 정리해주세요.'
    ].join(' ');
  }

  if (isPlanRequest) {
    return [
      `${subject}에 대한 실행 계획을 작성해주세요.`,
      '목표, 단계별 작업, 예상 리스크, 완료 기준을 체크리스트 형식으로 간결하게 정리해주세요.'
    ].join(' ');
  }

  const categoryTemplates = {
    study: `${subject}을 학습하려고 합니다. 핵심 개념, 쉬운 예시, 단계별 설명을 중심으로 초보자도 이해할 수 있게 설명해주세요.`,
    coding: `${subject} 문제를 해결하려고 합니다. 가능한 원인, 수정 방향, 검증 방법을 개발자가 바로 적용할 수 있게 정리해주세요.`,
    writing: `${subject}에 대한 글을 작성하려고 합니다. 핵심 메시지가 잘 드러나도록 자연스러운 구성과 문장으로 초안을 작성해주세요.`,
    summary: `${subject}을 요약하려고 합니다. 핵심 내용과 중요한 사실을 간결하게 정리하고, 원문에 없는 내용은 추측하지 말아주세요.`,
    analysis: `${subject}을 분석하려고 합니다. 핵심 근거, 장단점, 리스크, 최종 의견을 구조적으로 정리해주세요.`,
    etc: `${subject}에 대한 요청을 수행해주세요. 목표와 필요한 작업을 명확히 반영해서 바로 실행 가능한 결과를 작성해주세요.`,
    general: `${subject}에 대한 요청을 수행해주세요. 목표와 필요한 작업을 명확히 반영해서 바로 실행 가능한 결과를 작성해주세요.`
  };

  return categoryTemplates[categoryLabel] || categoryTemplates.general;
}

async function generateImprovedPrompt({ originalPrompt, taskCategory, guidelines, clientLanguage }) {
  const normalizedClientLanguage = normalizeClientLanguage(clientLanguage);
  const useKoreanRules = shouldUseKoreanRules(originalPrompt, normalizedClientLanguage);

  if (useKoreanRules && isLowInformationPrompt(originalPrompt)) {
    return buildGeneratedResult({
      improvedPrompt: buildClarificationPrompt(),
      originalPrompt,
      provider: 'rule_based'
    });
  }

  if (useKoreanRules && isWritingPlanRequest(String(originalPrompt || '').trim())) {
    return buildGeneratedResult({
      improvedPrompt: buildWritingPlanPrompt({ originalPrompt }),
      originalPrompt,
      provider: 'rule_based'
    });
  }

  if (useKoreanRules && isTextRevisionRequest(String(originalPrompt || '').trim())) {
    return buildGeneratedResult({
      improvedPrompt: buildTextRevisionPrompt(),
      originalPrompt,
      provider: 'rule_based'
    });
  }

  if (useKoreanRules && isShortPrompt(originalPrompt) && isPaymentQuestion(originalPrompt)) {
    return buildGeneratedResult({
      improvedPrompt: buildFallbackPrompt({
        originalPrompt,
        taskCategory,
        guidelines,
        clientLanguage: normalizedClientLanguage
      }),
      originalPrompt,
      provider: 'rule_based'
    });
  }

  if (!process.env.OPENAI_API_KEY) {
    if (!shouldAllowOpenAIFallback()) {
      throw createOpenAIError('OPENAI_API_KEY is not configured.', null, 'missing_openai_api_key');
    }

    return buildGeneratedResult({
      improvedPrompt: buildFallbackPrompt({ originalPrompt, taskCategory, guidelines, clientLanguage: normalizedClientLanguage }),
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
      temperature: 0.3,
      messages: [
        {
          role: 'system',
          content: [
            'You are a prompt improvement assistant.',
            'Do not answer the original request. Rewrite it into a clearer, more specific prompt and evaluate prompt structure.',
            `Target output language: ${getTargetLanguageLabel(normalizedClientLanguage)}.`,
            'Write the improved prompt in the target output language unless the original prompt explicitly asks for another language.',
            'Use the retrieved guidelines only as rewrite guidance, not as answer-generation guidance.',
            'The task category is only a hint. Prioritize the actual intent of the original prompt.',
            'If the original request is short or informal, infer the likely intent and make it naturally actionable.',
            'If the original request is short and simple, keep the improved prompt to 1-3 sentences.',
            'For very short requests under 20 words, prefer a compact 1-2 sentence rewrite unless the request clearly needs structure.',
            'For short informal questions, do not add numbered sections, checklists, legal disclaimers, country-by-country comparisons, tax analysis, or many subtopics unless the original prompt explicitly asks for them.',
            'Do not turn a broad casual question into a comprehensive professional report request.',
            'For already specific prompts, preserve the user intent and tighten wording instead of adding new sections or unnecessary detail.',
            'Write the improved prompt as a user instruction addressed to an AI assistant.',
            'Do not write in the assistant voice. Avoid phrases like "I will", "I can", "제가", "드리겠습니다", "알려주시면", or "제공해 드리겠습니다".',
            'If important information is missing, ask the AI assistant to handle that uncertainty or request clarification, but still phrase it as the user prompt.',
            'Do not force goal, context, format, constraint, and reference into every prompt. Add only what is genuinely useful.',
            'The improved prompt should be clearer than the original, but it must not unnecessarily expand the task scope.',
            'If information is missing, do not use curly-brace placeholders. Write a natural prompt using the available information.',
            'If the original request is only a greeting or has no task goal, rewrite it as a prompt that asks for the missing information and then asks for a final usable prompt.',
            'For report, assignment, or writing requests that ask how to start or mention urgency, rewrite them as concise step-by-step planning prompts.',
            'Evaluate both the original prompt and improved prompt using these five boolean fields:',
            'Evaluate semantic meaning, not exact keywords. Be consistent and do not under-score prompts that clearly imply a field.',
            'has_goal: true when the prompt states a task, intent, desired result, decision, recommendation request, or problem to solve.',
            'has_context: true when the prompt provides background, situation, audience, domain, source context, business goal, user role, project state, or why the task matters.',
            'has_format: true when the prompt specifies output shape such as bullets, table, list, ranking, comparison, steps, JSON, Markdown, code, report paragraph, or section structure.',
            'has_constraint: true when the prompt includes requirements, exclusions, quality criteria, tone, length, language, deadline, feasibility, originality, monetization, differentiation, validation conditions, or decision criteria.',
            'Treat success criteria, quality standards, verification rules, safety limits, stop rules, feasibility, creativity, originality, specificity, and "do not" rules as constraints.',
            'has_reference: true when the prompt includes or asks the assistant to use examples, existing services/products, search results, source text, links, attached material, evidence, prior content, benchmark cases, rubric, or criteria to follow.',
            'For example, "search for existing successful services and include examples/differentiation" means has_reference=true and has_constraint=true.',
            'Korean scoring examples: "웹 서비스로 돈을 벌 계획" means has_context=true; "돈을 많이 벌 수 있는", "수익성이 높은", "현실적인", "차별점" mean has_constraint=true; "검색해서 이미 있거나 잘 되는 서비스 예시" means has_reference=true.',
            'Return only valid JSON with this exact shape:',
            '{"improved_prompt":"...","before_analysis":{"has_goal":true,"has_context":false,"has_format":false,"has_constraint":false,"has_reference":false},"after_analysis":{"has_goal":true,"has_context":false,"has_format":true,"has_constraint":true,"has_reference":false}}',
            'Do not include explanations, titles, Markdown headings, section labels, or code fences.'
          ].join(' ')
        },
        {
          role: 'user',
          content: [
            `Task category: ${taskCategory || 'general'}`,
            '',
            'Prompt rewrite guidelines:',
            guidelines,
            '',
            'Original prompt:',
            originalPrompt,
            '',
            'Rewrite the original prompt only. Do not answer it.'
          ].join('\n')
        }
      ]
    });

    const parsedPayload = parseGenerationPayload(response.choices?.[0]?.message?.content);
    if (parsedPayload) {
      if (isOverExpandedRewrite(originalPrompt, parsedPayload.improved_prompt)) {
        const compactImprovedPrompt = buildFallbackPrompt({
          originalPrompt,
          taskCategory,
          guidelines,
          clientLanguage: normalizedClientLanguage
        });

        return buildGeneratedResult({
          improvedPrompt: compactImprovedPrompt,
          originalPrompt,
          provider: 'rule_based',
          fallbackReason: 'overexpanded_openai_rewrite'
        });
      }

      try {
        const pairAnalysis = await analyzePromptPairWithOpenAI({
          client,
          model,
          originalPrompt,
          improvedPrompt: parsedPayload.improved_prompt
        });

        return {
          ...parsedPayload,
          before_analysis: pairAnalysis.before_analysis,
          after_analysis: pairAnalysis.after_analysis
        };
      } catch (analysisError) {
        console.warn(`OpenAI prompt analysis failed, using generation analysis: ${analysisError.message}`);
        return parsedPayload;
      }
    }

    if (shouldAllowOpenAIFallback()) {
      return buildGeneratedResult({
        improvedPrompt: buildFallbackPrompt({ originalPrompt, taskCategory, guidelines, clientLanguage: normalizedClientLanguage }),
        originalPrompt,
        provider: 'fallback',
        fallbackReason: 'invalid_openai_json'
      });
    }

    throw createOpenAIError('OpenAI returned invalid JSON for prompt improvement.', null, 'invalid_openai_json');
  } catch (error) {
    if (!shouldAllowOpenAIFallback()) {
      console.warn(`OpenAI prompt improvement failed: ${error.message}`);
      throw createOpenAIError('OpenAI prompt improvement failed.', error);
    }

    console.warn(`OpenAI prompt improvement failed, using fallback: ${error.message}`);
    return buildGeneratedResult({
      improvedPrompt: buildFallbackPrompt({ originalPrompt, taskCategory, guidelines, clientLanguage: normalizedClientLanguage }),
      originalPrompt,
      provider: 'fallback',
      fallbackReason: error.code || error.status || 'openai_error'
    });
  }
}

module.exports = {
  generateImprovedPrompt
};
