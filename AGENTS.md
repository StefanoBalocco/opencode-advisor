# AGENTS.md

This file governs OpenCode agent behavior in this repository. See [README.md](README.md) for installation and user configuration.

## Repository purpose

`@stefanobalocco/opencode-advisor` provides one feature: the `advisor()` tool, which consults a strategic model.

## Architecture

`plugin.ts` is the only source entry point. Its factory registers the hidden `opencode-advisor:advisor` subagent in the `config` hook with its own prompt, model, temperature, and fixed read-only permission policy.

The `advisor()` tool uses the v1 plugin client to:

1. Fetch the current transcript.
2. Create an ephemeral session.
3. Prompt the hidden agent by name without passing `model`, `system`, or `tools` in the prompt body.
4. Extract text parts from the response.
5. Delete the ephemeral session in `finally`.

A recursion guard rejects concurrent nested calls.

## Configuration invariants

The optional profile object is validated at plugin initialization. Model resolution uses the first available value: profile `model`, `agent.plan.model`, global `model`, then the `deepseek/deepseek-v4-pro` fallback.

A supplied `prompt`, including an empty string, replaces the built-in prompt. `temperature` falls back to `0`. `top_p`, `variant`, and `options` are set only when supplied. Profile `options` accepts JSON-safe plain objects and is cloned before registration.

The plugin does not read environment variables.

## Fixed permissions

The hidden agent always receives this policy:

```json
{
  "*": "deny",
  "read": "allow",
  "glob": "allow",
  "grep": "allow",
  "webfetch": "allow",
  "websearch": "allow",
  "skill": "allow",
  "edit": "deny",
  "bash": {
    "*": "deny",
    "wc *": "allow",
    "git log *": "allow",
    "git diff *": "allow",
    "git show *": "allow",
    "rtk wc *": "allow",
    "rtk git log *": "allow",
    "rtk git diff *": "allow",
    "rtk git show *": "allow"
  }
}
```

No write access, LSP, task or todo tools, MCP tools, or arbitrary Bash commands are available.

## Development

```bash
npm install
npm run build
npm run tests
```

The build compiles `plugin.ts` and `plugin.test.ts` to JavaScript. The published package entry is `plugin.js`.
