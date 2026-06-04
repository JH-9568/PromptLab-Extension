const assert = require('assert');

const { _test } = require('../rag');

const englishPrompt = 'Recommend a web service idea that helps people manage forgetfulness.';
const koreanPrompt = '건망증을 관리하는 웹서비스 아이디어를 추천해줘.';

async function main() {
  assert.strictEqual(
    _test.shouldUseKorean(englishPrompt, 'ko-KR'),
    false,
    'An English prompt must not be rewritten in Korean just because the UI language is Korean.'
  );
  assert.strictEqual(
    _test.shouldUseKorean(koreanPrompt, 'en-US'),
    true,
    'A Korean prompt must remain Korean even when the UI language is English.'
  );
  assert.strictEqual(
    _test.hasPromptLanguageMismatch(
      englishPrompt,
      '건망증 관리를 돕는 웹서비스 아이디어를 제안해줘.'
    ),
    true,
    'A Korean rewrite of an English prompt must be detected as a language mismatch.'
  );
  assert.strictEqual(
    _test.hasPromptLanguageMismatch(
      englishPrompt,
      'Propose a web service idea that helps people manage forgetfulness.'
    ),
    false,
    'An English rewrite of an English prompt must not be marked as a mismatch.'
  );
  assert.strictEqual(
    _test.hasPromptLanguageMismatch(
      koreanPrompt,
      'Propose a web service idea that helps people manage forgetfulness.'
    ),
    true,
    'An English rewrite of a Korean prompt must be detected as a language mismatch.'
  );

  let repairRequest;
  const fakeClient = {
    chat: {
      completions: {
        create: async (request) => {
          repairRequest = request;
          return {
            choices: [{
              message: {
                content: 'Recommend analyses for user activity logs, including key metrics, expected insights, and product applications.'
              }
            }]
          };
        }
      }
    }
  };
  const repairedPrompt = await _test.repairPromptLanguage({
    client: fakeClient,
    model: 'gpt-4.1-mini',
    originalPrompt: 'What analyses should I perform on user activity logs?',
    improvedPrompt: '사용자 활동 로그에서 수행할 분석을 추천해 주세요.'
  });

  assert.ok(!/[가-힣]/.test(repairedPrompt), 'Language repair must return an English prompt for an English original.');
  assert.ok(
    repairRequest.messages[0].content.includes('Do not use Korean or Hangul characters.'),
    'Language repair must explicitly forbid Korean for a non-Korean original.'
  );

  console.log('[PASS] prompt language preservation tests');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
