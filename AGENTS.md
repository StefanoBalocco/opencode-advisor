# AGENTS.md

This file governs OpenCode agent behavior in this repository. See [README.md](README.md) for installation and user configuration.

## Repository purpose

`@stefanobalocco/opencode-advisor` provides two features:

1. The `advisor()` tool, which consults a strategic model on demand.
2. Auto-escalation: after a configurable number of consecutive tool errors, the plugin aborts the failing session, obtains hidden-advisor guidance, and resumes the source agent in a new turn.

## Architecture

`plugin.ts` is the only source entry point. Its factory registers the hidden `opencode-advisor:advisor` subagent in the `config` hook with its own prompt, model, temperature, and fixed read-only permission policy.

### advisor() tool

The `advisor()` tool uses the v1 plugin client to:

1. Fetch the current transcript.
2. Create an ephemeral session.
3. Prompt the hidden agent by name without passing `model`, `system`, or `tools` in the prompt body.
4. Extract text parts from the response.
5. Delete the ephemeral session in `finally`.

A recursion guard (`inAdvisorCall`) rejects concurrent nested calls.

### Auto-escalation (event hook)

The plugin uses the v1 `event` hook. It listens for `message.part.updated` with a `ToolPart`, `session.idle`, `session.status`, and `session.deleted` events. Factory-local state is isolated per plugin instance:

- `advisorSessions: Set<string>` — tracks temporary advisor session IDs so their tool events are ignored.
- `sessionStates: Map<string, SessionState>` — per-session failure counter, failure details (bounded to threshold), `triggered` latch, `intervening` flag, `awaitingIdle` flag, `idle` flag, `deleted` flag, resolved `sourceAgent`, and `advice` text.

**Flow:**

1. On a terminal error `ToolPart` whose `sessionID` is not an advisor session and whose `tool` is not `"advisor"`: increment the counter. When the counter first reaches `failureThreshold`, set `triggered` and `intervening` synchronously, then `void _launchIntervention()`.
2. `_launchIntervention` fetches the session messages, resolves the source agent via `ToolPart.messageID → assistant info.parentID → user info.agent`, and checks `cfg.agent?.[ agentName ]?.tools?.advisor !== false`. It then calls `abort()`. Only after a successful abort does it start the post-abort idle-wait phase (`awaitingIdle = true`, clear `idle`), record the current `idleGeneration`, and query `session.status()`. The status query result is applied only if no concurrent event advanced the generation. Pre-abort idle events do not qualify a resume. After status, it calls the shared advisor lifecycle with the failure context appended to the transcript.
3. `_maybeResume` fires exactly one source `session.prompt` when the state is registered, not deleted, `intervening`, `idle`, has a `sourceAgent`, and has `advice`. It clears `intervening` immediately before the fire-and-forget prompt.
4. On a terminal `completed` `ToolPart`: reset the counter and clear `triggered`.
5. During intervention (`intervening = true`), all tool events from that session are skipped.
6. `session.idle`, `session.status` (idle/busy/retry), and `session.deleted` events update state and may trigger `_maybeResume`.

Recursion exclusion: tool events from the internal advisor-session set are ignored. The `advisor` tool itself ignores its own error events to prevent cascading.

The shared advisor lifecycle (`_callAdvisor`) creates an ephemeral session, adds its ID to `advisorSessions`, prompts the hidden agent, extracts text, then removes the ID and deletes in `finally`. Both the manual tool and automatic intervention use this same function.

## Configuration invariants

The optional profile object is validated at plugin initialization. Model resolution uses the first available value: profile `model`, `agent.plan.model`, global `model`, then the `deepseek/deepseek-v4-pro` fallback.

A supplied `prompt`, including an empty string, replaces the built-in prompt. `temperature` falls back to `0`. `top_p`, `variant`, and `options` are set only when supplied. Profile `options` accepts JSON-safe plain objects and is cloned before registration.

`failureThreshold` accepts a positive integer (default `3`). Invalid values (0, negative, non-integer, non-finite, non-number) throw a named error.

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
