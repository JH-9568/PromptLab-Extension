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
    '{주제 입력}에 대해 도움을 받고 싶습니다.',
    '목표는 {원하는 결과 입력}입니다.',
    '현재 상황이나 배경은 {맥락 입력}입니다.',
    '답변은 {원하는 형식 입력} 형식으로 작성해주세요.',
    '반드시 지켜야 할 조건은 {제약 조건 입력}입니다.',
    '정보가 부족한 부분은 임의로 단정하지 말고 확인이 필요한 항목으로 따로 정리해주세요.'
  ].join(' ');
}

function isWritingPlanRequest(prompt) {
  return /보고서|리포트|레포트|과제|글|essay|report/i.test(prompt)
    && /오늘|지금|급|어케|어떻게|뭐부터|시작|작성|써야|써야함|써야 함|쓸건데|쓸 건데|해야|해야함|해야 함/i.test(prompt);
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
    '보고서 주제는 {주제 입력}입니다.',
    '분량은 {분량 입력}이고, 제출 형식은 {제출 형식 입력}입니다.',
    '평가 기준이나 반드시 포함해야 할 내용은 {평가 기준/필수 내용 입력}입니다.',
    '자료 정리, 목차 구성, 초안 작성, 문장 다듬기, 최종 점검 순서로 단계별 작성 계획을 세워주세요.',
    '각 단계별 우선순위와 예상 소요 시간을 포함하고, 바로 사용할 수 있는 기본 목차 템플릿도 함께 제시해주세요.',
    '부족한 정보는 임의로 단정하지 말고 확인이 필요한 항목으로 따로 정리해주세요.'
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
      '각 주제별로 문제 정의, 활용 가능한 데이터, 분석 방법, 예상 결과물, 난이도, 장단점, 추천 이유를 비교해주세요.',
      '마지막에는 가장 추천하는 주제와 선택 이유, 바로 시작할 수 있는 진행 계획을 정리해주세요.',
      '불확실한 부분은 마지막에 필요한 확인 사항으로 따로 정리해주세요.'
    ].join(' ');
  }

  if (isTestRequest) {
    const target = subject.includes('프롬프트랩') || subject.toLowerCase().includes('promptlab')
      ? 'PromptLab의 프롬프트 실행 기능'
      : subject;

    return [
      `${target}을 테스트하려고 합니다.`,
      '사용자가 작성한 프롬프트가 정상적으로 실행되고, 입력값에 따라 LLM 응답이 올바르게 생성되는지 확인하기 위한 테스트 계획을 작성해주세요.',
      '테스트 목적, 주요 테스트 항목, 정상 동작 기준, 예외 상황, 오류 케이스, 결과 기록 양식을 포함하고, 개발팀이 바로 사용할 수 있는 QA 체크리스트 형식으로 정리해주세요.',
      '불확실한 부분은 마지막에 필요한 확인 사항으로 따로 정리해주세요.'
    ].join(' ');
  }

  if (isPlanRequest) {
    return [
      `${subject}에 대한 실행 계획을 작성해주세요.`,
      '목표, 범위, 필요한 준비물, 단계별 작업, 예상 리스크, 완료 기준을 포함해주세요.',
      '팀원이 바로 따라 할 수 있도록 체크리스트 형식으로 정리하고, 불확실한 부분은 마지막에 확인 사항으로 분리해주세요.'
    ].join(' ');
  }

  const categoryTemplates = {
    study: `${subject}을 학습하려고 합니다. 학습 목표, 필요한 배경 지식, 핵심 개념, 쉬운 예시, 단계별 설명, 이해 점검 질문을 포함해서 초보자도 따라갈 수 있게 설명해주세요. 불확실한 부분은 마지막에 필요한 확인 사항으로 정리해주세요.`,
    coding: `${subject} 문제를 해결하려고 합니다. 현재 동작, 기대 동작, 가능한 원인, 확인해야 할 코드나 설정, 수정 방향, 검증 방법을 포함해서 개발자가 바로 적용할 수 있게 정리해주세요. 정보가 부족하면 마지막에 필요한 확인 사항을 따로 적어주세요.`,
    writing: `${subject}에 대한 글을 작성하려고 합니다. 대상 독자, 글의 목적, 핵심 메시지, 적절한 톤, 구성, 길이 기준을 반영해서 바로 사용할 수 있는 초안을 작성해주세요. 추가 정보가 필요하면 마지막에 확인 사항으로 정리해주세요.`,
    summary: `${subject}을 요약하려고 합니다. 핵심 내용, 중요한 사실, 결정 사항, 리스크, 액션 아이템을 구분해서 정리하고, 원문에 없는 내용은 추측하지 말아주세요. 부족한 정보는 마지막에 확인 사항으로 적어주세요.`,
    analysis: `${subject}을 분석하려고 합니다. 분석 목적, 판단 기준, 핵심 근거, 대안, 장단점, 리스크, 최종 추천안을 포함해서 구조적으로 정리해주세요. 불확실한 부분은 마지막에 필요한 확인 사항으로 분리해주세요.`,
    etc: `${subject}에 대한 요청을 수행해주세요. 목표, 배경, 필요한 작업 범위, 출력 형식, 제약 조건, 완료 기준을 명확히 반영해서 바로 실행 가능한 결과를 작성해주세요. 불확실한 부분은 마지막에 필요한 확인 사항으로 정리해주세요.`,
    general: `${subject}에 대한 요청을 수행해주세요. 목표, 배경, 필요한 작업 범위, 출력 형식, 제약 조건, 완료 기준을 명확히 반영해서 바로 실행 가능한 결과를 작성해주세요. 불확실한 부분은 마지막에 필요한 확인 사항으로 정리해주세요.`
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
            '원본에 부족한 정보가 있으면 질문을 만들어내지 말고 {주제 입력}, {분량 입력}, {출력 형식 입력}처럼 사용자가 채울 수 있는 placeholder로 남겨라.',
            '원본 요청이 인사말뿐이거나 작업 목표가 없으면 답변하지 말고, 주제, 목표, 맥락, 출력 형식, 제약 조건을 채울 수 있는 프롬프트 템플릿으로 다시 작성하라.',
            '원본 요청에 보고서, 과제, 글쓰기와 함께 "어케", "어떻게", "뭐부터", "오늘", "급" 같은 표현이 있으면 정보 요청만 하지 말고, 제한된 시간 안에 작성하도록 돕는 단계별 작성 계획 프롬프트 템플릿으로 확장하라.',
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
