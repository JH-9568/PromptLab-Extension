const GOAL_PATTERNS = [
  /목표|목적|원해|해줘|주세요|줘|알려줘|알려드릴까요|찾아|보내줘|고쳐|수정|작성|분석|요약|설명|비교|차이|차이점|추천|선택|적합|개선|만들|방법|어떻게|뭐가\s*나음|뭐가|어떤\s*게\s*나음|무엇|어떤\s*부분|제시|제안|설계/i,
  /\b(goal|objective|want|need|create|write|fix|debug|analyze|summarize|explain|compare|difference|versus|vs\.?|suggest|recommend|choose|choice|suitable|fit|design|improve|remove|delete|deduplicate|tips?|how|can|whether)\b/i
];

const CONTEXT_PATTERNS = [
  /배경|상황|맥락|대상|타깃|타겟|고객|사용자|유저|현재|기존|프로젝트|문제|초보자|입문자|학생|개발자|실무자|웹사이트|웹서비스|서비스|비즈니스/i,
  /\b(context|background|audience|target|customer|user|current|existing|project|problem|scenario|business)\b/i
];

const FORMAT_PATTERNS = [
  /형식|포맷|표\s*형태|목록으로|불릿|단계별|번호로|문단으로|항목별|아이디어별|전략별|방법별|분석\s*(방법|기법)별|분석\s*기법|목표별|목적별|사례별|기법별|기준별|활용\s*사례|인사이트|전처리|시각화|장단점|차이점|비교|용도별|적합한\s*용도|함께\s*(설명|비교|정리|제시)|포함해\s*(설명|비교|정리|제시)|평가해?\s*(설명|정리|제시)|측면에서\s*평가|json|markdown|코드블록|섹션으로/i,
  /\b(format|table|list|bullet|step-by-step|by idea|by strategy|by method|by goal|by criteria|pros?\s+and\s+cons?|compare|comparison|evaluate|evaluation|use cases?|by use case|json|markdown|section)\b/i
];

const CONSTRAINT_PATTERNS = [
  /제약|조건|반드시|하지 마|제외|길이|분량|톤|마감|간결하게|간단히|자세히|구체적|한국어로|영어로|이해할 수 있게|실용적|실행\s*(가능|난이도|계획|방법|방식)|난이도|우선\s*순위|우선으로|정확도|개발\s*생산성|생산성|비용|가격|사용량|품질|기준|관점|평가|지속\s*가능성|핵심\s*기능|차별화|차별점|수익화|수익\s*모델|비즈니스\s*모델|비즈니스\s*목적|사용자\s*경험|사회적\s*영향|영향|예상\s*효과|기대\s*효과|효과|성과|인사이트|활용\s*사례|전처리|시각화|한계|리스크|위험|주의|고려\s*사항|지표|측정|성공\s*기준|각\s*(\d+|[한두세네다섯여섯일곱여덟아홉열])\s*항목\s*이내|보안|확장성/i,
  /\b(constraint|must|avoid|exclude|limit|tone|deadline|concise|briefly|accuracy|productivity|cost|price|usage|quality|criteria|criterion|perspective|practical|feasible|priority|difficulty|differentiation|moneti[sz]ation|expected effect|expected impact|outcome|limitation|risk|caution|consideration|metric|kpi|success criteria|secure|security|scalable|scalability|in korean|in english)\b/i
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
