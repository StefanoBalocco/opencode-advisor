# Changelog

## 2.0.0 — 2026-07-21

- Unified Advisor + BTW into a single root plugin configured via tuple `["@stefanobalocco/opencode-advisor", profile]` with shared or split AgentConfig-like per-feature profiles.
- Replaced per-feature env-var and Bun-based BTW setup with hidden internal agents (`opencode-advisor:advisor`, `opencode-advisor:btw`) registered in the `config` hook.
- Both hidden agents enforce a fixed read/research-only permission allowlist with no write access.
- Published plugin compiles to `plugin.js`; build and test via AVA + c8.

## 1.2.1 — 2026-05-10

- Refactored model config from `config` hook to plugin entry tuple `options` parameter for both advisor and BTW plugins.
- Config format changed from `{ "advisor": { "model": "..." } }` to `["@u007/opencode-advisor", { "model": "..." }]` in `opencode.json`.
- Extracted shared model resolution into `applyModelOptions()` helper.

## 1.1.2 — 2026-05-06

- Version bump to resolve npm publish conflict (1.1.1 was already published).

## 1.1.1 — 2026-05-06

- Republish with no functional changes.

## 1.1.0 — 2026-05-06

- Configurable advisor provider/model. Defaults to `deepseek/deepseek-v4-pro`.
- Read from `opencode.json` via `advisor` block (`{ "advisor": { "model": "provider/model" } }` or split `providerID` / `modelID`).
- Override via env vars `OPENCODE_ADVISOR_MODEL` (supports `provider/model` form) and `OPENCODE_ADVISOR_PROVIDER`.
- Precedence: env var > `opencode.json` > default.
- Log the active provider/model on each advisor call.

## 1.0.1 — 2026-05-06

- Added debug logging of the input transcript sent to the advisor and the returned advice.

## 1.0.0 — 2026-05-06

- Initial release: first-class `advisor()` tool that forwards the session transcript to DeepSeek V4 Pro and returns concise strategic guidance.
