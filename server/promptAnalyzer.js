const GOAL_PATTERNS = [
  /목표|목적|원해|해줘|주세요|줘|알려줘|알려드릴까요|찾아|보내줘|고쳐|수정|작성|분석|요약|설명|비교|차이|추천|개선|만들|방법|어떻게|뭐가|무엇|어떤\s*부분|제시|제안|설계/i,
  /\b(goal|objective|want|need|create|write|fix|debug|analyze|summarize|explain|compare|suggest|recommend|design|improve|remove|delete|deduplicate|tips?|how|can|whether)\b/i
];

const CONTEXT_PATTERNS = [
  /배경|상황|맥락|대상|사용자|현재|기존|프로젝트|문제|초보자|입문자|학생|개발자|실무자|웹사이트|서비스/i,
  /\b(context|background|audience|user|current|existing|project|problem|scenario)\b/i
];

const FORMAT_PATTERNS = [
  /형식|포맷|표\s*형태|목록으로|불릿|단계별|번호로|문단으로|json|markdown|코드블록|섹션으로/i,
  /\b(format|table|list|bullet|step-by-step|json|markdown|section)\b/i
];

const CONSTRAINT_PATTERNS = [
  /제약|조건|반드시|하지 마|제외|길이|분량|톤|마감|간결하게|자세히|한국어로|영어로|이해할 수 있게|실용적|실행\s*가능|우선순위|보안|확장성/i,
  /\b(constraint|must|avoid|exclude|limit|tone|deadline|concise|briefly|practical|feasible|priority|secure|security|scalable|scalability|in korean|in english)\b/i
];

const REFERENCE_PATTERNS = [
  /참고\s*자료|첨부|아래\s*내용|위\s*내용|아래\s*데이터|위\s*데이터|링크|출처|근거|파일\s*내용/i,
  /\b(reference material|attached|below|above|link|source text|source material|evidence)\b/i
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
  result.specificity_score = matchedSignals * 20;

  return result;
}

module.exports = {
  analyzePrompt
};
