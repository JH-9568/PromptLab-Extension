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
    .replace(/제공해\s*드리겠습니다/g, '제공해주세요')
    .replace(/제공해\s*드립니다/g, '제공해주세요')
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
  return /보고서|리포트|레포트|과제|글|essay|report/i.test(prompt)
    && /오늘|지금|급|어케|어떻게|뭐부터|시작|작성|써야|써야함|써야 함|쓸건데|쓸 건데|해야|해야함|해야 함/i.test(prompt);
}

function isTextRevisionRequest(prompt) {
  return /문장|글|표현|말투|text|sentence/i.test(prompt)
    && /자연스럽|고쳐|수정|다듬|교정|rewrite|revise|polish/i.test(prompt);
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

  const isTestRequest = /테스트|test|qa|검증|확인|실행/.test(lowerPrompt);
  const isPlanRequest = /계획|plan|체크리스트|checklist/.test(lowerPrompt);
  const isTopicSelectionRequest = /주제|topic|아이디어|프로젝트/.test(lowerPrompt)
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

  if (!process.env.OPENAI_API_KEY) {
    return buildGeneratedResult({
      improvedPrompt: buildFallbackPrompt({ originalPrompt, taskCategory, guidelines, clientLanguage: normalizedClientLanguage }),
      originalPrompt,
      provider: 'fallback'
    });
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.3,
      response_format: { type: 'json_object' },
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
            'has_goal: the prompt states a task, intent, desired result, or request.',
            'has_context: the prompt provides background, situation, audience, domain, source context, or user-specific information.',
            'has_format: the prompt specifies output shape such as bullets, table, list, steps, JSON, Markdown, code, or section structure.',
            'has_constraint: the prompt includes requirements, exclusions, quality criteria, tone, length, language, deadline, feasibility, originality, or validation conditions.',
            'Treat success criteria, quality standards, verification rules, safety limits, stop rules, feasibility, creativity, originality, specificity, and "do not" rules as constraints.',
            'has_reference: the prompt includes examples, source text, links, attached material, evidence, prior content, rubric, or criteria to follow.',
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
    if (parsedPayload) return parsedPayload;

    return buildGeneratedResult({
      improvedPrompt: buildFallbackPrompt({ originalPrompt, taskCategory, guidelines, clientLanguage: normalizedClientLanguage }),
      originalPrompt,
      provider: 'fallback',
      fallbackReason: 'invalid_openai_json'
    });
  } catch (error) {
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
