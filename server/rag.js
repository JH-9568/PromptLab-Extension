const OpenAI = require('openai');

function sanitizeImprovedPrompt(value) {
  return String(value || '')
    .replace(/```[a-zA-Z]*\n?/g, '')
    .replace(/```/g, '')
    .replace(/^\s*#+\s+/gm, '')
    .replace(/^\s*(개선된\s*프롬프트|improved\s*prompt)\s*:\s*/i, '')
    .trim();
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

function buildFallbackPrompt({ originalPrompt, taskCategory, guidelines }) {
  const categoryLabel = taskCategory || 'general';
  const prompt = String(originalPrompt || '').trim();
  const lowerPrompt = prompt.toLowerCase();

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

async function generateImprovedPrompt({ originalPrompt, taskCategory, guidelines }) {
  if (isLowInformationPrompt(originalPrompt)) {
    return {
      improved_prompt: buildClarificationPrompt(),
      provider: 'rule_based'
    };
  }

  if (isWritingPlanRequest(String(originalPrompt || '').trim())) {
    return {
      improved_prompt: buildWritingPlanPrompt({ originalPrompt }),
      provider: 'rule_based'
    };
  }

  if (isTextRevisionRequest(String(originalPrompt || '').trim())) {
    return {
      improved_prompt: buildTextRevisionPrompt(),
      provider: 'rule_based'
    };
  }

  if (!process.env.OPENAI_API_KEY) {
    return {
      improved_prompt: buildFallbackPrompt({ originalPrompt, taskCategory, guidelines }),
      provider: 'fallback'
    };
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.3,
      messages: [
        {
          role: 'system',
          content: [
            '너는 프롬프트 개선 도우미다.',
            '원본 요청에 답하지 말고, 원본 요청을 더 명확하고 구체적인 프롬프트로 다시 작성하라.',
            'retrieved guidelines는 답변 생성 기준이 아니라 프롬프트 rewrite 기준으로만 사용하라.',
            'task category는 참고 정보일 뿐이며, 원본 요청의 실제 의도를 가장 우선하라.',
            '원본 요청이 짧거나 구어체이면 그대로 감싸지 말고 의도를 추론해 자연스러운 실행 프롬프트로 확장하라.',
            '원본 요청이 짧고 단순한 경우에는 1~3문장 수준으로만 개선하라.',
            '모든 요청에 goal, context, format, constraint, reference를 억지로 포함하지 말고 실제로 도움이 되는 요소만 추가하라.',
            '개선된 프롬프트는 원본보다 명확해야 하지만 원본의 작업 규모를 과도하게 키우지 마라.',
            '원본에 부족한 정보가 있어도 중괄호 placeholder를 만들지 말고, 현재 정보만으로 자연스럽게 실행 가능한 프롬프트로 작성하라.',
            '원본 요청이 인사말뿐이거나 작업 목표가 없으면 답변하지 말고, 필요한 정보를 확인한 뒤 최종 프롬프트를 작성하도록 요청하는 프롬프트로 다시 작성하라.',
            '원본 요청에 보고서, 과제, 글쓰기와 함께 "어케", "어떻게", "뭐부터", "오늘", "급" 같은 표현이 있으면 정보 요청만 하지 말고, 제한된 시간 안에 작성하도록 돕는 단계별 작성 계획 프롬프트로 확장하라.',
            '출력은 개선된 프롬프트만 하라.',
            '설명, 제목, 마크다운, 섹션 구분, markdown code fence를 출력하지 마라.'
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

    return {
      improved_prompt: sanitizeImprovedPrompt(response.choices?.[0]?.message?.content) || buildFallbackPrompt({ originalPrompt, taskCategory, guidelines }),
      provider: 'openai'
    };
  } catch (error) {
    console.warn(`OpenAI prompt improvement failed, using fallback: ${error.message}`);
    return {
      improved_prompt: buildFallbackPrompt({ originalPrompt, taskCategory, guidelines }),
      provider: 'fallback',
      fallback_reason: error.code || error.status || 'openai_error'
    };
  }
}

module.exports = {
  generateImprovedPrompt
};
