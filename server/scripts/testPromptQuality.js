require('dotenv').config();

const fs = require('fs');
const path = require('path');

const { generateImprovedPrompt } = require('../rag');

const guidelineContent = fs.readFileSync(path.join(__dirname, '../guidelines/general.md'), 'utf8');

const cases = [
  {
    name: 'english_prompt_with_korean_ui',
    originalPrompt: 'Recommend a web service idea that helps people manage forgetfulness.',
    clientLanguage: 'ko-KR',
    mustNotMatch: /[가-힣]/,
    mustMatchAll: [
      /web\s*service/i,
      /forgetfulness|memory/i,
      /user|feature|differentiation|benefit|implementation/i
    ]
  },
  {
    name: 'web_service_ideas',
    originalPrompt: '웹 서비스 아이디어 추천해줘',
    mustNotMatch: /먼저|사용자에게|물어|질문|알려\s*주시면|제공해\s*주시면/,
    mustMatchAll: [
      /웹\s*서비스|서비스/,
      /아이디어/,
      /선정\s*기준|추천\s*이유|대상\s*사용자|해결.*문제|문제.*해결|수익화|예시|실행\s*난이도|난이도/
    ]
  },
  {
    name: 'forgetfulness_web_service',
    originalPrompt: '건망증을 해결할수있는 웹사이트 아이디어 추천해봐',
    mustNotMatch: /^건망증을 해결할수있는 웹사이트 아이디어 추천해봐\.\s*각\s*아이디어|건망증을\s*문제/,
    mustMatchAll: [
      /건망증/,
      /웹\s*(서비스|사이트)|웹서비스|웹사이트/,
      /대상\s*사용자|타깃\s*사용자|목표\s*사용자|사용자층|사용자\s*맞춤|알림|사용자/,
      /핵심\s*기능|주요\s*기능|기능|차별화|차별점|보안/,
      /수익화|수익\s*모델|비즈니스\s*모델|실행\s*난이도|구현\s*난이도|난이도|기대\s*효과|효과|한계/
    ]
  },
  {
    name: 'space_travel_concept_web_service',
    originalPrompt: '우주, 여행같은 느낌의 웹서비스 추천해봐',
    mustNotMatch: /문제\s*를?\s*줄이는|문제\s*해결|같은\s*느낌의\s*로|의\s*로/,
    mustMatchAll: [
      /우주/,
      /여행/,
      /웹\s*(서비스|사이트)|웹서비스|웹사이트/,
      /콘셉트|컨셉|분위기|경험|감성|주제|테마/,
      /대상\s*사용자|타깃\s*사용자|목표\s*사용자|사용자층|타깃|타겟/,
      /핵심\s*(경험|기능)|차별화/,
      /수익화|수익\s*모델|비즈니스\s*모델|실행\s*난이도|구현\s*난이도|난이도/
    ]
  },
  {
    name: 'trash_pickup_idea_seed_web_service',
    originalPrompt: '쓰레기 줍기 같은 아이디어는 어때? 웹서비스 만들건데',
    mustNotMatch: /같은\s*는\s*어때|는\s*어때\?\s*만들건데|문제\s*를?\s*줄이는/,
    mustMatchAll: [
      /쓰레기\s*줍기/,
      /웹\s*(서비스|사이트)|웹서비스|웹사이트/,
      /발전|방향|기획|제안/,
      /대상\s*사용자|타깃\s*사용자|목표\s*사용자|사용자층|사용자\s*참여|참여/,
      /핵심\s*기능|참여\s*유도|사용자\s*참여.*기능|참여.*높이는\s*기능|차별화/,
      /수익화|수익\s*모델|비즈니스\s*모델|실행\s*난이도|구현\s*난이도|난이도/
    ]
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
    mustMatchAll: [
      /구독/,
      /결제/,
      /구조|흐름|단계|설계|아키텍처/,
      /주의|웹훅|상태|예시|핵심|보안|고려/
    ]
  },
  {
    name: 'user_log_analysis',
    originalPrompt: '사용자 로그 데이터를 분석하려고 하는데 어떤 분석을 하면 좋을까?',
    mustNotMatch: /먼저|사용자에게|물어|질문|알려\s*주시면|제공해\s*주시면/,
    mustMatchAll: [
      /분석/,
      /로그|데이터/,
      /인사이트|목적|목표|우선순위|필요한\s*데이터|지표|장단점|적용\s*사례/
    ]
  },
  {
    name: 'promptlab_growth',
    originalPrompt: 'PromptLab 사용자 수를 늘리고 싶어',
    mustNotMatch: /먼저|사용자에게|물어|질문|알려\s*주시면|제공해\s*주시면/,
    mustMatchAll: [
      /PromptLab/,
      /사용자/,
      /성장|전략|획득|채널/,
      /우선순위|실행\s*(계획|방안)|지표|리스크|마케팅\s*채널|예상\s*효과/
    ]
  },
  {
    name: 'art_overconsumption_ideas',
    originalPrompt: '과소비와 과시 문제를 예술적 요소를 활용해 해결할 수 있는 실용적인 아이디어를 제안해줘.',
    mustNotMatch: /^과소비와 과시 문제를 예술적 요소로 해결할 수 있는 실용적이고 실행 가능한 아이디어를 제안해줘\.?$/,
    mustMatchAll: [
      /과소비|과시/,
      /예술/,
      /작동\s*원리|실행\s*방식|실행\s*방법|실천\s*방법|적용\s*방법/,
      /기대\s*효과|효과|성과/,
      /한계|리스크|주의|현실|지속\s*가능성|평가|사회적\s*영향|영향/
    ]
  }
];

function hasExplicitQuantity(value) {
  return /\d+\s*(개|가지|명|문장|단계|항목|items?|steps?|examples?|ideas?|ways?|methods?)|[한두세네다섯여섯일곱여덟아홉열]\s*(개|가지|문장|단계|항목)/i.test(String(value || ''));
}

function trimTerminalPunctuation(value) {
  return String(value || '').trim().replace(/[.!?。！？\s]+$/g, '');
}

function normalizeAppendComparison(value) {
  return trimTerminalPunctuation(value)
    .replace(/\s+/g, '')
    .toLowerCase();
}

function hasAppendStyleRewrite(originalPrompt, improvedPrompt) {
  const original = String(originalPrompt || '').trim();
  const improved = String(improvedPrompt || '').trim();
  const normalizedOriginal = normalizeAppendComparison(original);
  const normalizedImproved = normalizeAppendComparison(improved);
  if (normalizedOriginal.length < 12 || normalizedImproved.length <= normalizedOriginal.length) return false;
  if (normalizedImproved.startsWith(normalizedOriginal)) return true;

  const firstSentence = improved.split(/[.!?。！？]/)[0] || improved;
  const normalizedOriginalStem = normalizeAppendComparison(
    trimTerminalPunctuation(original)
      .replace(/\s*(알려|설명|추천|제안|정리|작성)\s*해?\s*(줘|봐|주세요)?$/i, '')
  );
  const normalizedFirstSentence = normalizeAppendComparison(firstSentence);

  return normalizedOriginalStem.length >= 12 && normalizedFirstSentence.startsWith(normalizedOriginalStem);
}

async function main() {
  let failed = 0;

  for (const testCase of cases) {
    const result = await generateImprovedPrompt({
      originalPrompt: testCase.originalPrompt,
      taskCategory: 'general',
      clientLanguage: testCase.clientLanguage || 'ko',
      guidelineContent,
      attachmentContext: { has_attachment: false, attachment_count: 0 }
    });

    const output = result.improved_prompt;
    const failures = [];

    if (testCase.mustMatch && !testCase.mustMatch.test(output)) {
      failures.push(`missing expected pattern ${testCase.mustMatch}`);
    }

    if (testCase.mustMatchAll) {
      for (const pattern of testCase.mustMatchAll) {
        if (!pattern.test(output)) {
          failures.push(`missing expected pattern ${pattern}`);
        }
      }
    }

    if (testCase.mustNotMatch && testCase.mustNotMatch.test(output)) {
      failures.push(`matched forbidden pattern ${testCase.mustNotMatch}`);
    }

    if (result.improvement_type !== 'ask_clarifying_question'
      && !hasExplicitQuantity(testCase.originalPrompt)
      && hasExplicitQuantity(output)) {
      failures.push('added an arbitrary exact quantity');
    }

    if (result.improvement_type !== 'ask_clarifying_question'
      && result.after_analysis.specificity_score <= result.before_analysis.specificity_score) {
      failures.push(`score did not increase (${result.before_analysis.specificity_score} -> ${result.after_analysis.specificity_score})`);
    }

    if (result.improvement_type !== 'ask_clarifying_question'
      && hasAppendStyleRewrite(testCase.originalPrompt, output)) {
      failures.push('rewrite reads like original prompt plus appended requirements');
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
