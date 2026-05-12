# General Prompt Guidelines

Source basis: OpenAI Prompting and Prompt Engineering guides.
- https://platform.openai.com/docs/guides/prompting
- https://platform.openai.com/docs/guides/prompt-engineering
- https://help.openai.com/en/articles/6654000-how-to-use-prompt-engineering
- https://help.openai.com/en/articles/10032626-prompt-engineering-best-practices-for-chatgpt

Rewrite every prompt so it is clear, direct, and specific. Put the main instruction first, then add the context the model needs to complete the task.

- Define the exact goal, user intent, audience, and expected outcome.
- Separate instructions from source material or user-provided context with clear labels or delimiters.
- Include relevant background, constraints, assumptions, exclusions, tools, language, tone, length, and quality criteria.
- Specify the desired output format, such as bullets, table, JSON, Markdown, code, checklist, or concise prose.
- Add examples, source text, references, rubrics, or acceptance criteria when they would reduce ambiguity.
- For reasoning-capable models, keep the prompt simple and direct. Ask for conclusions, evidence, checks, and caveats instead of requesting hidden chain-of-thought.
- Ask the model to identify missing information or assumptions when the request cannot be completed confidently.
- Make the rewritten prompt ready to paste and run; do not answer the original request.
