# victron-vrm-mcp — Evaluation suite

Multi-tool scenario evaluations used to measure LLM-driven workflows against the server. Each `*.xml` file is self-contained: a user question, the minimal tool plan that answers it, and an expected-behavior summary.

Conventions:
- `<question>`: natural-language user turn.
- `<expected_tools>`: ordered list of tool calls an assistant should make. Arguments are illustrative; the grader should accept any semantically equivalent arguments.
- `<expected_behavior>`: what the final assistant response must contain (key facts / phrases / derived values).
- `<safety>`: explicit safety expectations — when the confirm gate must kick in, when the server must refuse, etc.

Run manually against a live Claude client connected to victron-vrm-mcp. Not part of CI (LLM-driven).
