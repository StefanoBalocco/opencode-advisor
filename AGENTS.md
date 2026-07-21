# AGENTS.md

This file governs OpenCode agent behavior in this repository.

## What this repo is

An OpenCode plugin package (`@stefanobalocco/opencode-advisor`) that provides
a single feature from the root entry:

- **Advisor** — `advisor()` tool that consults a strategic model

## Architecture

One entry point (`plugin.ts`). The plugin factory registers a single hidden
internal agent (`opencode-advisor:advisor`) in the `config` hook, with its
own system prompt, model, temperature, and fixed read-only permission policy.
The feature uses the v1 plugin `client` to create an ephemeral session and
prompt it by agent name. No direct model or system override is passed in the
prompt body; the hidden agent supplies all parameters.

### Plugin tuple options

Accepts an optional Advisor profile object:

```json
["@stefanobalocco/opencode-advisor", { "model": "anthropic/claude-opus-4-7", "temperature": 0 }]
```

When omitted, defaults are used.

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

**File reference**: instead of a literal prompt, use `{file:path}` to load
content from a file. The path is relative to the project directory, or
absolute if it starts with `/`. The file is read once during plugin
initialization (not on config-hook re-invocation). An empty `{file:}` is
rejected with a syntax error that names `{file:}` and states the path is empty
— no resolved path is shown. A missing, unreadable, or directory target fails
with both the original reference and the resolved path in the error. Non-exact
forms (whitespace, missing `}`, inline text) are literal prompts and never
I/O.

### Fixed permission allowlist

Non-configurable. The hidden agent receives:

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

The advisor:

1. Fetches transcript via `client.session.messages()` (v1 REST client)
2. Creates an ephemeral session via `client.session.create()`
3. Prompts via `client.session.prompt()` with `body.agent` set to the
   hidden agent; no `body.model`, `body.system`, or `body.tools`
4. Extracts text parts from the response
5. Deletes the ephemeral session in `finally`
6. A recursion guard prevents concurrent nested calls

### Development

```bash
pnpm install
pnpm run build
pnpm run tests
```

Development uses the configured build scripts. Source is `plugin.ts`, compiled
to `plugin.js`. The published package entry is `plugin.js`.
