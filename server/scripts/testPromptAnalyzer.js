const assert = require('assert');

const { analyzePrompt } = require('../promptAnalyzer');

function printAnalysis(label, prompt, analysis) {
  console.log(`\n${label}`);
  console.log(`Prompt: ${prompt}`);
  console.log(`Score: ${analysis.specificity_score}`);
  console.log(`Signals: ${JSON.stringify({
    has_goal: analysis.has_goal,
    has_context: analysis.has_context,
    has_format: analysis.has_format,
    has_constraint: analysis.has_constraint,
    has_reference: analysis.has_reference
  })}`);
}

const original = 'Cursor랑 Claude 중 뭐가 나음?';
const improved = 'Cursor와 Claude를 정확도와 개발 생산성 우선으로 비교해 장단점·적합한 용도 추천해줘.';

const originalAnalysis = analyzePrompt(original);
const improvedAnalysis = analyzePrompt(improved);

printAnalysis('Original comparison prompt', original, originalAnalysis);
printAnalysis('Improved comparison prompt', improved, improvedAnalysis);

assert.strictEqual(originalAnalysis.specificity_score, 20);
assert.ok(
  improvedAnalysis.specificity_score > originalAnalysis.specificity_score,
  'Improved comparison prompt should score higher than the original.'
);
assert.ok(improvedAnalysis.has_goal, 'Improved comparison prompt should have a goal.');
assert.ok(improvedAnalysis.has_format, 'Improved comparison prompt should have comparison output structure.');
assert.ok(improvedAnalysis.has_constraint, 'Improved comparison prompt should have decision criteria.');

const comparisonCases = [
  {
    prompt: 'Cursor와 Claude의 차이점과 장단점을 항목별로 간단히 비교해줘.',
    expected: ['has_goal', 'has_format', 'has_constraint']
  },
  {
    prompt: 'ChatGPT와 Claude를 비용, 사용량, 품질 기준으로 비교하고 적합한 용도를 추천해줘.',
    expected: ['has_goal', 'has_format', 'has_constraint']
  },
  {
    prompt: 'Gemini랑 Claude 중 어떤 게 나음?',
    expected: ['has_goal']
  }
];

for (const testCase of comparisonCases) {
  const analysis = analyzePrompt(testCase.prompt);
  printAnalysis('Comparison detection case', testCase.prompt, analysis);

  for (const key of testCase.expected) {
    assert.ok(analysis[key], `${testCase.prompt} should set ${key}.`);
  }
}

const improvementScoreCases = [
  {
    name: 'forgetfulness web service idea',
    original: '건망증을 해결할수있는 웹사이트 아이디어 추천해봐',
    improved: '건망증 문제를 줄이는 웹서비스 아이디어를 추천해줘. 아이디어별 대상 사용자, 핵심 기능, 차별화 포인트, 수익화 가능성, 실행 난이도를 함께 비교해줘.',
    expectedImprovedSignals: ['has_goal', 'has_context', 'has_format', 'has_constraint']
  },
  {
    name: 'overconsumption art idea',
    original: '과소비와 과시 문제를 예술적 요소를 활용해 해결할 수 있는 실용적인 아이디어를 제안해줘.',
    improved: '과소비와 과시 문제를 예술적 요소로 해결하는 실용적 아이디어를 제안하고, 구체적 실행 방법과 예상 사회적 효과, 잠재적 한계까지 함께 설명해줘.',
    expectedImprovedSignals: ['has_goal', 'has_context', 'has_format', 'has_constraint']
  },
  {
    name: 'user log analysis',
    original: '사용자 로그 데이터를 분석하려고 하는데 어떤 분석을 하면 좋을까?',
    improved: '사용자 로그 데이터를 분석할 때 사용자 행동 패턴, 이탈 원인, 전환율 개선 등 주요 목표별로 적합한 분석 기법과 핵심 지표를 추천하고, 각 분석이 비즈니스에 미치는 효과와 한계도 함께 설명해줘.',
    expectedImprovedSignals: ['has_goal', 'has_context', 'has_format', 'has_constraint']
  }
];

for (const testCase of improvementScoreCases) {
  const originalCaseAnalysis = analyzePrompt(testCase.original);
  const improvedCaseAnalysis = analyzePrompt(testCase.improved);

  printAnalysis(`Original ${testCase.name}`, testCase.original, originalCaseAnalysis);
  printAnalysis(`Improved ${testCase.name}`, testCase.improved, improvedCaseAnalysis);

  assert.ok(
    improvedCaseAnalysis.specificity_score > originalCaseAnalysis.specificity_score,
    `${testCase.name} should score higher after improvement.`
  );

  for (const key of testCase.expectedImprovedSignals) {
    assert.ok(improvedCaseAnalysis[key], `${testCase.name} should set ${key}.`);
  }
}

console.log('\n[PASS] promptAnalyzer comparison scoring tests');
