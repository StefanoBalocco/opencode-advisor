# OpenCode Advisor Plugin

Adds an `advisor()` tool to OpenCode. The tool consults a hidden internal agent with fixed read-only permissions.

## Install

Add the package to the `plugin` array in `opencode.json`:

```json
{
  "plugin": ["@stefanobalocco/opencode-advisor"]
}
```

The plugin works without options.

## Configuration

Pass an optional profile object in the plugin tuple:

```json
{
  "plugin": [
    ["@stefanobalocco/opencode-advisor", { "model": "anthropic/claude-opus-4-7", "temperature": 0 }]
  ]
}
```

### Model resolution

The plugin uses the first available model, in this order:

1. The profile's `model` field.
2. `agent.plan.model` in the OpenCode configuration.
3. The global OpenCode `model` field.
4. The `deepseek/deepseek-v4-pro` fallback.

The `model` field must use `provider/model` format with non-empty provider and model segments.

### Profile fields

| Field | Type | When omitted |
| --- | --- | --- |
| `model` | `"provider/model"` | Uses the resolution order above. |
| `variant` | string | Not set. |
| `prompt` | string | Uses the built-in system prompt. |
| `temperature` | finite number | `0` |
| `top_p` | finite number | Not set. |
| `options` | JSON-safe object | Not set. |

A supplied `prompt` replaces the built-in system prompt. The `options` object accepts JSON-safe values, including null, booleans, finite numbers, strings, arrays, and nested plain objects. Use it for provider-specific settings such as `reasoningEffort`.

The plugin does not read environment variables. Configure it through the plugin tuple.

## Fixed permissions

The hidden agent uses this non-configurable permission policy:

| Tool or action | Policy |
| --- | --- |
| `read` | allow |
| `glob` | allow |
| `grep` | allow |
| `webfetch` | allow |
| `websearch` | allow |
| `skill` | allow |
| `edit` | deny |
| All other tools | deny |

Only these Bash commands are allowed:

| Command pattern | Policy |
| --- | --- |
| `wc *` | allow |
| `git log *` | allow |
| `git diff *` | allow |
| `git show *` | allow |
| `rtk wc *` | allow |
| `rtk git log *` | allow |
| `rtk git diff *` | allow |
| `rtk git show *` | allow |
| All other Bash commands | deny |

This policy cannot be overridden. The hidden agent cannot write files, use LSP, invoke tasks or todos, access MCP tools, or run arbitrary shell commands.

## How it works

1. The executor receives the `advisor()` tool.
2. The executor calls it without arguments.
3. The plugin fetches the session transcript, excluding the calling message.
4. The plugin creates an ephemeral session and prompts the hidden `opencode-advisor:advisor` agent.
5. The hidden agent supplies its model, system prompt, temperature, and permissions.
6. The tool returns the response text.
7. The plugin deletes the ephemeral session.

The hidden agent can inspect the workspace and public web with read-only tools. It cannot edit files or run arbitrary shell commands.

## Requirements

- OpenCode >= 1.4.9
- Provider authentication configured through `/connect` in OpenCode

## Development

```bash
npm install
npm run build
npm run tests
```

The build compiles `plugin.ts` and `plugin.test.ts` to JavaScript. The published package entry is `plugin.js`.

## License

MIT
