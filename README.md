# OpenCode Advisor Plugin

First-class `advisor()` tool for OpenCode, powered by a hidden internal agent
with fixed read-only permissions.

## Install

Add the package to your `opencode.json` plugin array:

```json
{
  "plugin": ["@stefanobalocco/opencode-advisor"]
}
```

No further configuration is required.

### Configuring the model

Defaults to `deepseek/deepseek-v4-pro`. Override via plugin tuple options:

```json
{
  "plugin": [
    ["@stefanobalocco/opencode-advisor", { "model": "anthropic/claude-opus-4-7", "temperature": 0 }]
  ]
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

**File reference syntax**: instead of a literal prompt, you may write
`{file:path}` to load prompt content from a file. The path is relative to the
project root (the `directory` property of the plugin input), or absolute if it
starts with `/`. The file is read once, asynchronously during plugin
initialization — repeated `config` hook invocations do not re-read. A syntax
error like `{file:}` (empty path) causes a load error that names `{file:}` and
states the path is empty — no resolved path appears in the message. A missing,
unreadable, or directory target causes a load error that includes both the
original reference and the resolved absolute path. Non-exact forms
(leading/trailing space, missing closing brace, inline text) are treated as
literal prompts and never trigger I/O.

The `model` value must be in `provider/model` format with a non-empty
provider and model segment.

The `options` object supports arbitrary JSON-safe values (null, boolean,
finite number, string, arrays, nested plain objects). It passes
provider-specific properties like `reasoningEffort`.

No environment variables are read. Configuration is entirely through the
plugin tuple.

## Fixed tool and permission policy

The hidden agent receives this non-configurable permission allowlist:

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

## Requirements

- OpenCode >= 1.4.9 (plugin API)
- Provider authentication via `/connect` in OpenCode

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
