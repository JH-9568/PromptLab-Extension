# General Prompt Guidelines

Source basis: OpenAI Prompting, Prompt Engineering, and GPT-5.5 Prompt Guidance.
- https://developers.openai.com/api/docs/guides/prompt-guidance?model=gpt-5.5
- https://platform.openai.com/docs/guides/prompting
- https://platform.openai.com/docs/guides/prompt-engineering
- https://help.openai.com/en/articles/6654000-best-practices-for-prompt-engineering-with-the-openai-api
- https://help.openai.com/en/articles/10032626-prompt-engineering-best-practices-for-chatgpt

Rewrite every prompt so it is clear, direct, and specific. Put the main instruction first, then add the context the model needs to complete the task.

- Define the exact goal, user intent, target outcome, audience, and success criteria.
- Separate instructions from source material or user-provided context with clear labels or delimiters.
- Include relevant available context, background, assumptions, evidence, tools, and source material.
- Specify the expected output shape, such as bullets, table, JSON, Markdown, code, checklist, or concise prose.
- Include constraints, exclusions, validation rules, language, tone, length, and quality criteria.
- Add examples, source text, references, evidence, rubrics, or acceptance criteria when they would reduce ambiguity.
- For reasoning-capable models, keep the prompt simple and direct. Ask for conclusions, evidence, checks, and caveats instead of requesting hidden chain-of-thought.
- Ask the model to identify missing information or assumptions when the request cannot be completed confidently.
- Make the rewritten prompt ready to paste and run; do not answer the original request.
