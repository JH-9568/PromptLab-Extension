const GOAL_PATTERNS = [
  /목표|목적|원해|해줘|고쳐|수정|작성|분석|요약|설명|비교|추천|개선|만들/i,
  /\b(goal|objective|want|need|create|write|fix|debug|analyze|summarize|explain|compare|improve)\b/i
];

const CONTEXT_PATTERNS = [
  /배경|상황|맥락|대상|사용자|현재|기존|프로젝트|문제/i,
  /\b(context|background|audience|user|current|existing|project|problem|scenario)\b/i
];

const FORMAT_PATTERNS = [
  /형식|포맷|표|목록|불릿|단계|json|markdown|코드블록|섹션/i,
  /\b(format|table|list|bullet|step|json|markdown|csv|section)\b/i
];

const CONSTRAINT_PATTERNS = [
  /제약|조건|반드시|하지 마|포함|제외|길이|분량|톤|언어|마감/i,
  /\b(constraint|must|should|avoid|include|exclude|limit|tone|language|deadline)\b/i
];

const REFERENCE_PATTERNS = [
  /참고|예시|샘플|기준|첨부|아래|위 내용|링크|문서/i,
  /\b(reference|example|sample|attached|below|above|link|doc|source)\b/i
];

function matchesAny(prompt, patterns) {
  return patterns.some((pattern) => pattern.test(prompt));
}

function countWords(value) {
  return String(value || '').trim().split(/\s+/).filter(Boolean).length;
}

function calculateSpecificityScore(result, prompt) {
  const weights = countWords(prompt) <= 20
    ? {
      has_goal: 35,
      has_context: 10,
      has_format: 25,
      has_constraint: 25,
      has_reference: 5
    }
    : {
      has_goal: 25,
      has_context: 20,
      has_format: 20,
      has_constraint: 20,
      has_reference: 15
    };

  return Object.entries(weights).reduce((score, [key, weight]) => (
    score + (result[key] ? weight : 0)
  ), 0);
}

function analyzePrompt(prompt = '') {
  const normalizedPrompt = String(prompt).trim();

  const result = {
    has_goal: matchesAny(normalizedPrompt, GOAL_PATTERNS),
    has_context: matchesAny(normalizedPrompt, CONTEXT_PATTERNS),
    has_format: matchesAny(normalizedPrompt, FORMAT_PATTERNS),
    has_constraint: matchesAny(normalizedPrompt, CONSTRAINT_PATTERNS),
    has_reference: matchesAny(normalizedPrompt, REFERENCE_PATTERNS)
  };

  result.specificity_score = calculateSpecificityScore(result, normalizedPrompt);

  return result;
}

module.exports = {
  analyzePrompt
};
