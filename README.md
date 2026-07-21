# OpenCode Advisor Plugin

First-class `advisor()` tool and `/btw` command for OpenCode, powered by
hidden internal agents with fixed read-only permissions.

## Install

Add the package to your `opencode.json` plugin array:

```json
{
  "plugin": ["@stefanobalocco/opencode-advisor"]
}
```

No further configuration is required. If you do not already have a
`command.btw`, the root plugin registers a default `/btw` slash command. If you
already have `command.btw` defined in your configuration, the plugin leaves it
entirely untouched: it neither overwrites the definition nor intercepts
execution.

### Configuring the model

Defaults to `deepseek/deepseek-v4-pro`. Override via plugin tuple options:

**Shared profile** (applies same config to both Advisor and BTW):

```json
{
  "plugin": [
    ["@stefanobalocco/opencode-advisor", { "model": "anthropic/claude-opus-4-7", "temperature": 0 }]
  ]
}
```

**Split profiles** (per-feature overrides):

```json
{
  "plugin": [
    ["@stefanobalocco/opencode-advisor", {
      "advisor": { "options": { "reasoningEffort": "high" } },
      "btw": { "prompt": "Answer concisely and in Italian." }
    }]
  ]
}
```

A split section can be omitted; the omitted feature uses its defaults.
Shared and split forms cannot be mixed.

### Overriding the default `/btw` command

The plugin registers `/btw` with `{ "template": "$ARGUMENTS" }` when no user
definition exists. To override (for example, to add a custom description or
change the template), define `command.btw` in your `opencode.json`:

```json
{
  "command": {
    "btw": { "template": "$ARGUMENTS", "description": "Ask a background question" }
  }
}
```

## Profile fields

| Field       | Type              | Default                                                              |
|-------------|-------------------|----------------------------------------------------------------------|
| `model`     | `"provider/model"` | `agent.plan.model`, then global `model`, else `deepseek/deepseek-v4-pro` |
| `variant`   | string            | absent                                                               |
| `prompt`    | string            | built-in default (replaces, does NOT append)                         |
| `temperature` | finite number   | 0                                                                    |
| `top_p`     | finite number     | absent                                                               |
| `options`   | JSON-safe object  | absent                                                               |

Providing `prompt` replaces the default system prompt entirely. It does not
append.

The `model` value must be in `provider/model` format with a non-empty
provider and model segment.

The `options` object supports arbitrary JSON-safe values (null, boolean,
finite number, string, arrays, nested plain objects). It passes
provider-specific properties like `reasoningEffort`.

No environment variables are read. Configuration is entirely through the
plugin tuple.

## Fixed tool and permission policy

Both Advisor and BTW receive the same non-configurable permission allowlist:

| Tool / Action   | Policy |
|-----------------|--------|
| `read`          | allow  |
| `glob`          | allow  |
| `grep`          | allow  |
| `webfetch`      | allow  |
| `websearch`     | allow  |
| `skill`         | allow  |
| `edit`          | deny   |
| All other tools | deny   |

**Bash commands** — only these are allowed:

| Command pattern          | Policy |
|--------------------------|--------|
| `wc *`                   | allow  |
| `git log *`              | allow  |
| `git diff *`             | allow  |
| `git show *`             | allow  |
| `rtk wc *`               | allow  |
| `rtk git log *`          | allow  |
| `rtk git diff *`         | allow  |
| `rtk git show *`         | allow  |
| All other bash commands  | deny   |

No write access, no LSP, no task/todo, no MCP tools. This policy cannot be
overridden.

## How advisor works

1. The `advisor()` tool appears in the executor's tool list.
2. The executor calls it (no arguments needed).
3. The plugin fetches the session transcript via the v1 REST client,
   excluding the calling message.
4. An ephemeral session is created and prompted by the
   `opencode-advisor:advisor` hidden agent.
5. The hidden agent supplies its own model, system prompt, temperature, and
   fixed permissions.
6. The response text is returned as the tool result.
7. The ephemeral session is deleted.

The hidden agent uses only read-only tools to inspect the workspace and
public web. It cannot edit files or run arbitrary shell commands.

## How /btw works

1. User types `/btw <question>`.
2. The plugin acknowledges immediately with `[BTW] question...`.
3. A background ephemeral session is created and prompted by the
   `opencode-advisor:btw` hidden agent with the transcript and question.
4. The response is appended to the main session as a non-reply card,
   without interrupting the running agent.
5. Errors produce a visible failure card.

## Requirements

- OpenCode >= 1.4.9 (plugin API)
- Provider authentication via `/connect` in OpenCode

OpenCode loads the compiled plugin. There is no separate `./btw` export; the
root plugin provides both features.

## Development

```bash
pnpm install
pnpm run build         # compiles plugin.ts and plugin.test.ts
pnpm run tests         # runs AVA with c8 coverage (100% threshold)
```

Development uses the configured build scripts. Source is `plugin.ts`, compiled
to `plugin.js`. The published package entry is `plugin.js`.

## License

MIT
