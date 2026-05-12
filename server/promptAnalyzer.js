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

function analyzePrompt(prompt = '') {
  const normalizedPrompt = String(prompt).trim();

  const result = {
    has_goal: matchesAny(normalizedPrompt, GOAL_PATTERNS),
    has_context: matchesAny(normalizedPrompt, CONTEXT_PATTERNS),
    has_format: matchesAny(normalizedPrompt, FORMAT_PATTERNS),
    has_constraint: matchesAny(normalizedPrompt, CONSTRAINT_PATTERNS),
    has_reference: matchesAny(normalizedPrompt, REFERENCE_PATTERNS)
  };

  const matchedSignals = Object.values(result).filter(Boolean).length;
  const lengthBonus = normalizedPrompt.length >= 80 ? 10 : normalizedPrompt.length >= 40 ? 5 : 0;

  result.specificity_score = Math.min(100, matchedSignals * 18 + lengthBonus);

  return result;
}

module.exports = {
  analyzePrompt
};
