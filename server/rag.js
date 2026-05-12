const OpenAI = require('openai');

function section(title, body) {
  if (!body) return '';
  return `## ${title}\n${body}`;
}

function buildFallbackPrompt({ originalPrompt, taskCategory, guidelines }) {
  const categoryLabel = taskCategory || 'general';
  const compactGuidelines = guidelines
    .replace(/^#+\s+/gm, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 14)
    .join('\n- ');

  return [
    `${categoryLabel} 작업을 수행해줘. 아래 원본 요청의 의도를 유지하되, 부족한 맥락은 합리적으로 가정하고 불확실한 부분은 별도 확인 질문으로 정리해줘.`,
    '',
    '목표:',
    '- 원본 요청에서 사용자가 달성하려는 결과를 먼저 파악한다.',
    '- 필요한 배경, 제약 조건, 참고 기준을 명시하고 실행 가능한 답변을 제공한다.',
    '',
    section('원본 요청', originalPrompt),
    '',
    section('답변 기준', compactGuidelines ? `- ${compactGuidelines}` : '- 목표, 맥락, 형식, 제약, 참고 자료를 명확히 포함한다.'),
    '',
    '출력 요구사항:',
    '- 핵심 답변을 먼저 제시한다.',
    '- 필요한 경우 단계별 절차, 예시, 검증 방법을 포함한다.',
    '- 불확실한 가정과 추가로 필요한 정보를 마지막에 분리해서 적는다.'
  ].filter(Boolean).join('\n');
}

async function generateImprovedPrompt({ originalPrompt, taskCategory, guidelines }) {
  if (!process.env.OPENAI_API_KEY) {
    return {
      improved_prompt: buildFallbackPrompt({ originalPrompt, taskCategory, guidelines }),
      provider: 'fallback'
    };
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: 0.3,
    messages: [
      {
        role: 'system',
        content: 'You improve user prompts. Preserve intent, add specificity, and return only the improved prompt.'
      },
      {
        role: 'user',
        content: [
          `Task category: ${taskCategory || 'general'}`,
          '',
          'Guidelines:',
          guidelines,
          '',
          'Original prompt:',
          originalPrompt
        ].join('\n')
      }
    ]
  });

  return {
    improved_prompt: response.choices?.[0]?.message?.content?.trim() || buildFallbackPrompt({ originalPrompt, taskCategory, guidelines }),
    provider: 'openai'
  };
}

module.exports = {
  generateImprovedPrompt
};
