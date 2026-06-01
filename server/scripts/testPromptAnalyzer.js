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

console.log('\n[PASS] promptAnalyzer comparison scoring tests');
