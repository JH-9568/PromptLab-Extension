require('dotenv').config();

const { generateImprovedPrompt } = require('../rag');

const cases = [
  {
    name: 'web_service_ideas',
    originalPrompt: '웹 서비스 아이디어 추천해줘',
    mustNotMatch: /먼저|사용자에게|물어|질문|알려\s*주시면|제공해\s*주시면/,
    mustMatch: /웹\s*서비스|아이디어/
  },
  {
    name: 'very_vague_this',
    originalPrompt: '이거 설명해줘',
    mustMatch: /답변하지\s*말고|물어|질문|무엇|어떤|주제|내용/
  },
  {
    name: 'nextjs_subscription',
    originalPrompt: 'Next.js로 만든 SaaS 서비스에 구독 결제를 붙이려고 한다. 처음 구현하는 입장에서 어떤 구조로 설계하는 게 좋은지 알려줘.',
    mustNotMatch: /먼저|사용자에게|물어|질문|알려\s*주시면|제공해\s*주시면/,
    mustMatch: /구독|결제|구조|웹훅|상태|흐름|아키텍처/
  },
  {
    name: 'user_log_analysis',
    originalPrompt: '사용자 로그 데이터를 분석하려고 하는데 어떤 분석을 하면 좋을까?',
    mustNotMatch: /먼저|사용자에게|물어|질문|알려\s*주시면|제공해\s*주시면/,
    mustMatch: /분석|인사이트|로그|데이터/
  },
  {
    name: 'promptlab_growth',
    originalPrompt: 'PromptLab 사용자 수를 늘리고 싶어',
    mustNotMatch: /먼저|사용자에게|물어|질문|알려\s*주시면|제공해\s*주시면/,
    mustMatch: /PromptLab|사용자|성장|전략|우선순위|실행/
  }
];

async function main() {
  let failed = 0;

  for (const testCase of cases) {
    const result = await generateImprovedPrompt({
      originalPrompt: testCase.originalPrompt,
      taskCategory: 'general',
      clientLanguage: 'ko',
      guidelineContent: '',
      attachmentContext: { has_attachment: false, attachment_count: 0 }
    });

    const output = result.improved_prompt;
    const failures = [];

    if (testCase.mustMatch && !testCase.mustMatch.test(output)) {
      failures.push(`missing expected pattern ${testCase.mustMatch}`);
    }

    if (testCase.mustNotMatch && testCase.mustNotMatch.test(output)) {
      failures.push(`matched forbidden pattern ${testCase.mustNotMatch}`);
    }

    if (failures.length > 0) failed += 1;

    console.log(`\n[${failures.length ? 'FAIL' : 'PASS'}] ${testCase.name}`);
    console.log(`Original: ${testCase.originalPrompt}`);
    console.log(`Rewrite: ${output}`);
    console.log(`Type: ${result.improvement_type}`);
    console.log(`Reason: ${result.improvement_reason}`);
    console.log(`Before score: ${result.before_analysis.specificity_score}`);
    console.log(`After score: ${result.after_analysis.specificity_score}`);

    for (const failure of failures) {
      console.log(`- ${failure}`);
    }
  }

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
