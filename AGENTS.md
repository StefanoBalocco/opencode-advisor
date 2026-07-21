# AGENTS.md

This file governs OpenCode agent behavior in this repository.

## What this repo is

An OpenCode plugin package (`@stefanobalocco/opencode-advisor`) that provides
two features from a single root entry:

- **Advisor** — `advisor()` tool that consults a strategic model
- **BTW** — `/btw` slash command for one-shot background questions

## Architecture

One entry point (`plugin.ts`). The plugin factory registers two hidden
internal agents (`opencode-advisor:advisor`, `opencode-advisor:btw`) in the
`config` hook, each with its own system prompt, model, temperature, and fixed
read-only permission policy. Both features use the v1 plugin `client` to
create ephemeral sessions and prompt them by agent name. No direct model or
system override is passed in prompt bodies; the hidden agent supplies all
parameters.

The plugin registers a default `command.btw` only when the user has not already
defined one. If the user already has `command.btw`, the plugin leaves it
entirely untouched — it neither overwrites the definition nor intercepts
execution. A closure-level boolean (`ownsBtwCommand`) set during the `config`
hook gates the `command.execute.before` handler accordingly.

### Plugin tuple options

Two valid shapes:

**A. Shared profile** — applied to both Advisor and BTW:

```json
["@stefanobalocco/opencode-advisor", { "model": "anthropic/claude-opus-4-7", "temperature": 0 }]
```

**B. Split profiles** — per-feature overrides:

```json
["@stefanobalocco/opencode-advisor", { "advisor": { "options": { "reasoningEffort": "high" } }, "btw": { "prompt": "Answer concisely." } }]
```

A split section can be omitted; the omitted feature uses its defaults. Shared
and split forms cannot be mixed.

#### Profile fields

| Field | Type | Default |
|-------|------|---------|
| `model` | `"provider/model"` | `agent.plan.model`, then global `model`, else `deepseek/deepseek-v4-pro` |
| `variant` | string | absent |
| `prompt` | string | built-in default (replaces, does NOT append) |
| `temperature` | finite number | 0 |
| `top_p` | finite number | absent |
| `options` | JSON-safe object | absent |

Providing `prompt` replaces the entire default system prompt. It is not
appended.

### Fixed permission allowlist

Non-configurable. Both hidden agents receive:

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

No write access, no LSP, no task/todo, no MCP tools, and only the Bash
commands listed above.

### Session lifecycle

Both features:

1. Fetch transcript via `client.session.messages()` (v1 REST client)
2. Create ephemeral session via `client.session.create()`
3. Prompt via `client.session.prompt()` with `body.agent` set to the
   appropriate hidden agent; no `body.model`, `body.system`, or `body.tools`
4. Extract text parts from the response
5. Delete ephemeral session in `finally`
6. Recursion guards prevent concurrent nested calls

BTW additionally appends a result card to the main session via
`client.session.prompt({ noReply: true })`.

### Development

```bash
pnpm install
pnpm run build
pnpm run tests
```

Development uses the configured build scripts. Source is `plugin.ts`, compiled
to `plugin.js`. The published package entry is `plugin.js`.
