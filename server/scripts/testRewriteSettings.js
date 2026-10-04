const assert = require('node:assert/strict');
const { normalizeRewriteSettings, buildPreferencePolicy } = require('../rewriteSettings');
const { _test } = require('../rag');

async function main() {
  assert.deepEqual(normalizeRewriteSettings(), { mode: 'balanced', instructions: '' });
  assert.deepEqual(normalizeRewriteSettings({ mode: 'light', instructions: '  Use TypeScript.  ' }), { mode: 'light', instructions: 'Use TypeScript.' });
  for (const invalid of ['light', [], { mode: 'unknown' }, { instructions: true }, { instructions: 'x'.repeat(601) }]) {
    assert.throws(() => normalizeRewriteSettings(invalid), { status: 400, code: 'invalid_rewrite_settings' });
  }
  const light = normalizeRewriteSettings({ mode: 'light' });
  assert.deepEqual(_test.getQualityIssues('웹 서비스 아이디어 추천해줘', '웹 서비스 아이디어를 추천해줘.', light), []);
  const longRewrite = 'Explain the tradeoffs and practical implementation steps. '.repeat(12);
  assert.equal(_test.shouldCompactShortRewrite('Explain API caching', longRewrite, normalizeRewriteSettings()), true);
  assert.equal(_test.shouldCompactShortRewrite('Explain API caching', longRewrite, normalizeRewriteSettings({ mode: 'detailed' })), false);
  const settings = normalizeRewriteSettings({ mode: 'detailed', instructions: 'Use TypeScript and provide 3 examples.' });
  assert.ok(!(_test.getQualityIssues('Explain caching', 'Explain caching with 3 examples.', settings).includes('invented_exact_count')));
  assert.ok(buildPreferencePolicy(settings).includes('original prompt take precedence'));

  const requests = [];
  const responses = ['잘못된 언어의 개선 프롬프트입니다.', '잘못된 언어의 개선 프롬프트입니다.', 'Explain caching with 3 TypeScript examples and tradeoffs.'];
  const client = { chat: { completions: { create: async (request) => {
    requests.push(request);
    return { choices: [{ message: { content: responses.shift() } }] };
  } } } };
  const result = await _test.reviseGeneratedPayloadIfNeeded({
    client,
    model: 'gpt-6-luna',
    payload: { improved_prompt: '한국어로 작성된 결과', improvement_type: 'clarify_goal' },
    originalPrompt: 'Explain caching',
    clientLanguage: 'ko-KR',
    attachmentContext: { has_attachment: false },
    rewriteSettings: settings
  });
  assert.match(result.improved_prompt, /TypeScript/);
  assert.equal(requests.length, 3);
  for (const request of requests) {
    assert.equal(request.model, 'gpt-6-luna');
    assert.equal(request.reasoning_effort, 'low');
    assert.equal(request.temperature, undefined);
    assert.match(request.messages[0].content, /Selected rewrite mode: detailed/);
    assert.ok(request.messages[1].content.includes(settings.instructions));
  }
  console.log('[PASS] rewrite settings: validation, modes, explicit preferences, and all revision paths');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
