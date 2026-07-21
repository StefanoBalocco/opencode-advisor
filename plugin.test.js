import { readFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import test from "ava";
import { AdvisorPlugin } from "./plugin.js";
const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolvePath(__filename, "..");
const changelogAbs = resolvePath(repoRoot, "CHANGELOG.md");
function toolContext(sessionID, messageID) {
    return {
        sessionID,
        messageID,
        agent: "",
        directory: "",
        worktree: "",
        abort: new AbortController().signal,
        metadata: () => { },
        ask: async () => { },
    };
}
function createMockSession(overrides = {}) {
    const session = {
        messages: (async () => ({
            data: [
                {
                    info: { role: "user", id: "msg-1" },
                    parts: [{ type: "text", text: "Hello" }],
                },
            ],
        })),
        create: (async () => ({
            data: { id: "temp-session-1" },
        })),
        prompt: (async () => ({
            data: { parts: [{ type: "text", text: "Advisor response" }] },
        })),
        delete: (async () => { }),
    };
    for (const key of Object.keys(overrides)) {
        session[key] = overrides[key];
    }
    return session;
}
function createPluginInput(session, directory) {
    return { client: { session }, directory: directory ?? repoRoot };
}
function createMockConfig() {
    return { agent: {}, command: {} };
}
test.serial("parseOptions: undefined returns defaults", async (t) => {
    const cfg = createMockConfig();
    const plugin = await AdvisorPlugin(createPluginInput(createMockSession()), undefined);
    await plugin.config(cfg);
    const advisorAgent = cfg.agent["opencode-advisor:advisor"];
    t.truthy(advisorAgent);
    t.is(advisorAgent.model, "deepseek/deepseek-v4-pro");
});
test.serial("parseOptions: empty object returns defaults", async (t) => {
    const cfg = createMockConfig();
    const plugin = await AdvisorPlugin(createPluginInput(createMockSession()), {});
    await plugin.config(cfg);
    const advisorAgent = cfg.agent["opencode-advisor:advisor"];
    t.truthy(advisorAgent);
    t.is(advisorAgent.model, "deepseek/deepseek-v4-pro");
});
test.serial("parseOptions: null throws", async (t) => {
    await t.throwsAsync(async () => {
        await AdvisorPlugin(createPluginInput(createMockSession()), null);
    }, { message: /null/ });
});
test.serial("parseOptions: shared profile applies to both agents", async (t) => {
    const cfg = createMockConfig();
    const plugin = await AdvisorPlugin(createPluginInput(createMockSession()), { model: "anthropic/claude-opus-4-7", temperature: 0 });
    await plugin.config(cfg);
    const advisorCfg = cfg.agent["opencode-advisor:advisor"];
    const btwCfg = cfg.agent["opencode-advisor:btw"];
    t.truthy(advisorCfg);
    t.truthy(btwCfg);
    t.is(advisorCfg.model, "anthropic/claude-opus-4-7");
    t.is(btwCfg.model, "anthropic/claude-opus-4-7");
});
test.serial("parseOptions: split profiles work", async (t) => {
    const cfg = createMockConfig();
    const plugin = await AdvisorPlugin(createPluginInput(createMockSession()), {
        advisor: { options: { reasoningEffort: "high" } },
        btw: { prompt: "Answer concisely." },
    });
    await plugin.config(cfg);
    const agent = cfg.agent["opencode-advisor:advisor"];
    t.truthy(agent);
    t.truthy(agent.options);
    t.is(agent.options.reasoningEffort, "high");
    t.is(cfg.agent["opencode-advisor:btw"].prompt, "Answer concisely.");
});
test.serial("parseOptions: split section can be omitted", async (t) => {
    const cfg = createMockConfig();
    const plugin = await AdvisorPlugin(createPluginInput(createMockSession()), { advisor: { options: { reasoningEffort: "high" } } });
    await plugin.config(cfg);
    t.truthy(cfg.agent["opencode-advisor:advisor"].options);
    t.is(cfg.agent["opencode-advisor:btw"].model, "deepseek/deepseek-v4-pro");
});
test.serial("parseOptions: null split section throws", async (t) => {
    await t.throwsAsync(async () => {
        await AdvisorPlugin(createPluginInput(createMockSession()), { advisor: null });
    }, { message: /null/ });
});
test.serial("parseOptions: mixed shared and split throws", async (t) => {
    await t.throwsAsync(async () => {
        await AdvisorPlugin(createPluginInput(createMockSession()), { model: "anthropic/claude-opus-4-7", advisor: {} });
    }, { message: /Cannot mix/ });
});
test.serial("parseOptions: unknown top-level key in split form throws", async (t) => {
    await t.throwsAsync(async () => {
        await AdvisorPlugin(createPluginInput(createMockSession()), { advisor: {}, unknownKey: {} });
    }, { message: /unknownKey/ });
});
test.serial("parseOptions: unknown profile key throws", async (t) => {
    await t.throwsAsync(async () => {
        await AdvisorPlugin(createPluginInput(createMockSession()), { advisor: { color: "red" } });
    }, { message: /color/ });
});
test.serial("fixed permissions: no ls/cat/grep shell entries", async (t) => {
    const cfg = createMockConfig();
    const plugin = await AdvisorPlugin(createPluginInput(createMockSession()), undefined);
    await plugin.config(cfg);
    const agentPerm = cfg.agent["opencode-advisor:advisor"];
    t.truthy(agentPerm);
    const permission = agentPerm.permission;
    t.truthy(permission);
    const bash = permission.bash;
    t.is(bash["wc *"], "allow");
    t.is(bash["git log *"], "allow");
    t.is(bash["git diff *"], "allow");
    t.is(bash["git show *"], "allow");
    t.is(bash["ls *"], undefined);
    t.is(bash["cat *"], undefined);
    t.is(bash["grep *"], undefined);
});
test.serial("fixed permissions: structure is identical between agents", async (t) => {
    const cfg = createMockConfig();
    const plugin = await AdvisorPlugin(createPluginInput(createMockSession()), undefined);
    await plugin.config(cfg);
    const advisorAgent = cfg.agent["opencode-advisor:advisor"];
    const btwAgent = cfg.agent["opencode-advisor:btw"];
    t.truthy(advisorAgent);
    t.truthy(btwAgent);
    t.deepEqual(advisorAgent.permission, btwAgent.permission);
});
test.serial("prompt: custom prompt replaces default", async (t) => {
    const cfg = createMockConfig();
    const plugin = await AdvisorPlugin(createPluginInput(createMockSession()), { prompt: "Custom shared prompt" });
    await plugin.config(cfg);
    t.is(cfg.agent["opencode-advisor:advisor"].prompt, "Custom shared prompt");
    t.is(cfg.agent["opencode-advisor:btw"].prompt, "Custom shared prompt");
});
test.serial("prompt: custom prompt per-feature", async (t) => {
    const cfg = createMockConfig();
    const plugin = await AdvisorPlugin(createPluginInput(createMockSession()), {
        advisor: { prompt: "Advisor prompt" },
        btw: { prompt: "BTW prompt" },
    });
    await plugin.config(cfg);
    t.is(cfg.agent["opencode-advisor:advisor"].prompt, "Advisor prompt");
    t.is(cfg.agent["opencode-advisor:btw"].prompt, "BTW prompt");
});
test.serial("prompt: empty string in shared profile replaces default", async (t) => {
    const cfg = createMockConfig();
    const plugin = await AdvisorPlugin(createPluginInput(createMockSession()), { prompt: "" });
    await plugin.config(cfg);
    t.is(cfg.agent["opencode-advisor:advisor"].prompt, "");
    t.is(cfg.agent["opencode-advisor:btw"].prompt, "");
});
test.serial("prompt: empty string in split profile replaces default per-feature", async (t) => {
    const cfg = createMockConfig();
    const plugin = await AdvisorPlugin(createPluginInput(createMockSession()), {
        advisor: { prompt: "" },
        btw: { prompt: "" },
    });
    await plugin.config(cfg);
    t.is(cfg.agent["opencode-advisor:advisor"].prompt, "");
    t.is(cfg.agent["opencode-advisor:btw"].prompt, "");
});
test.serial("prompt: shared {file:} relative path reads file content", async (t) => {
    const cfg = createMockConfig();
    const expectedContent = await readFile(changelogAbs, "utf-8");
    const plugin = await AdvisorPlugin(createPluginInput(createMockSession()), { prompt: "{file:CHANGELOG.md}" });
    await plugin.config(cfg);
    t.is(cfg.agent["opencode-advisor:advisor"].prompt, expectedContent);
    t.is(cfg.agent["opencode-advisor:btw"].prompt, expectedContent);
});
test.serial("prompt: split {file:} relative and absolute paths work independently", async (t) => {
    const cfg = createMockConfig();
    const expectedContent = await readFile(changelogAbs, "utf-8");
    const plugin = await AdvisorPlugin(createPluginInput(createMockSession()), {
        advisor: { prompt: "{file:CHANGELOG.md}" },
        btw: { prompt: `{file:${changelogAbs}}` },
    });
    await plugin.config(cfg);
    t.is(cfg.agent["opencode-advisor:advisor"].prompt, expectedContent);
    t.is(cfg.agent["opencode-advisor:btw"].prompt, expectedContent);
});
test.serial("prompt: {file:} empty path rejected during init", async (t) => {
    const err = await t.throwsAsync(async () => {
        await AdvisorPlugin(createPluginInput(createMockSession()), { prompt: "{file:}" });
    });
    t.truthy(err.message.includes("{file:}"), "error must name the {file:} reference");
    t.truthy(err.message.includes("must have a non-empty path"), "error must state path is empty");
});
test.serial("prompt: {file:} missing path fails with reference and resolved path", async (t) => {
    const err = await t.throwsAsync(async () => {
        await AdvisorPlugin(createPluginInput(createMockSession()), { prompt: "{file:non-existent-file.md}" });
    });
    t.truthy(err.message.includes("{file:non-existent-file.md}"), "error must contain original file ref");
    t.truthy(err.message.includes(resolvePath(repoRoot, "non-existent-file.md")), "error must contain resolved absolute path");
});
test.serial("prompt: {file:.} directory target fails with reference and resolved path", async (t) => {
    const err = await t.throwsAsync(async () => {
        await AdvisorPlugin(createPluginInput(createMockSession()), { prompt: "{file:.}" });
    });
    t.truthy(err.message.includes("{file:.}"), "error must contain original file ref");
    t.truthy(err.message.includes(repoRoot), "error must contain resolved absolute path");
});
test.serial("prompt: non-exact {file:x} forms remain literal and do not fail", async (t) => {
    const cfg = createMockConfig();
    const plugin1 = await AdvisorPlugin(createPluginInput(createMockSession()), { prompt: " {file:CHANGELOG.md}" });
    await plugin1.config(cfg);
    t.is(cfg.agent["opencode-advisor:advisor"].prompt, " {file:CHANGELOG.md}");
    const plugin2 = await AdvisorPlugin(createPluginInput(createMockSession()), { prompt: "{file:CHANGELOG.md} " });
    await plugin2.config(cfg);
    t.is(cfg.agent["opencode-advisor:advisor"].prompt, "{file:CHANGELOG.md} ");
    const plugin3 = await AdvisorPlugin(createPluginInput(createMockSession()), { prompt: "{file:CHANGELOG.md" });
    await plugin3.config(cfg);
    t.is(cfg.agent["opencode-advisor:advisor"].prompt, "{file:CHANGELOG.md");
    const plugin4 = await AdvisorPlugin(createPluginInput(createMockSession()), { prompt: "prefix{file:CHANGELOG.md}suffix" });
    await plugin4.config(cfg);
    t.is(cfg.agent["opencode-advisor:advisor"].prompt, "prefix{file:CHANGELOG.md}suffix");
});
test.serial("config hook: registers /btw command when absent", async (t) => {
    const cfg = createMockConfig();
    const plugin = await AdvisorPlugin(createPluginInput(createMockSession()), undefined);
    await plugin.config(cfg);
    t.truthy(cfg.command.btw);
    t.deepEqual(cfg.command.btw, { template: "$ARGUMENTS" });
});
test.serial("config hook: does not overwrite existing /btw command", async (t) => {
    const userCommand = { template: "$ARGUMENTS", description: "My custom btw" };
    const cfg = { agent: {}, command: { btw: userCommand } };
    const plugin = await AdvisorPlugin(createPluginInput(createMockSession()), undefined);
    await plugin.config(cfg);
    t.is(cfg.command.btw, userCommand);
});
test.serial("ownership: intercepts /btw when plugin owns default command", async (t) => {
    const session = createMockSession();
    const cfg = createMockConfig();
    const plugin = await AdvisorPlugin(createPluginInput(session), undefined);
    await plugin.config(cfg);
    t.truthy(cfg.command.btw);
    const existingPart = { id: "pid-own", sessionID: "sess-own", messageID: "msg-own", type: "text", text: "" };
    const output = { parts: [existingPart] };
    const hook = plugin["command.execute.before"];
    await hook({ command: "btw", sessionID: "sess-own", arguments: "hello?" }, output);
    t.is(existingPart.text, "[BTW] hello?...");
});
test.serial("ownership: survives second config invocation on same config object", async (t) => {
    const session = createMockSession();
    const cfg = createMockConfig();
    const plugin = await AdvisorPlugin(createPluginInput(session), undefined);
    await plugin.config(cfg);
    t.truthy(cfg.command.btw);
    await plugin.config(cfg);
    const existingPart = { id: "pid-reconfig", sessionID: "sess-reconfig", messageID: "msg-reconfig", type: "text", text: "" };
    const output = { parts: [existingPart] };
    const hook = plugin["command.execute.before"];
    await hook({ command: "btw", sessionID: "sess-reconfig", arguments: "still works?" }, output);
    t.is(existingPart.text, "[BTW] still works?...", "hook must still intercept after second config call");
});
test.serial("ownership: does NOT intercept /btw when user owns command", async (t) => {
    let createCalled = false;
    const session = createMockSession({
        create: (async () => {
            createCalled = true;
            return { data: { id: "should-not-be-called" } };
        }),
    });
    const userCommand = { template: "$ARGUMENTS", description: "My custom btw" };
    const cfg = { agent: {}, command: { btw: userCommand } };
    const plugin = await AdvisorPlugin(createPluginInput(session), undefined);
    await plugin.config(cfg);
    t.is(cfg.command.btw, userCommand);
    const originalText = "original output unchanged";
    const existingPart = { id: "pid-user", sessionID: "sess-user", messageID: "msg-user", type: "text", text: originalText };
    const output = { parts: [existingPart] };
    const hook = plugin["command.execute.before"];
    await hook({ command: "btw", sessionID: "sess-user", arguments: "anything" }, output);
    t.is(existingPart.text, originalText, "hook must NOT mutate output when user owns /btw");
    t.falsy(createCalled, "session.create must NOT be called when user owns /btw");
});
test.serial("BTW: missing session ID appends failure card", async (t) => {
    const captured = { text: undefined };
    const session = createMockSession({
        create: (async () => ({ data: {} })),
        prompt: (async (args) => {
            if (args?.body?.noReply) {
                captured.text = args.body.parts?.[0]?.text;
            }
            return { data: { parts: [{ type: "text", text: "" }] } };
        }),
    });
    const cfg = createMockConfig();
    const plugin = await AdvisorPlugin(createPluginInput(session), undefined);
    await plugin.config(cfg);
    const input = { command: "btw", sessionID: "sess-1", arguments: "test query" };
    const output = { parts: [] };
    const hook = plugin["command.execute.before"];
    await hook(input, output);
    await new Promise((resolve) => setTimeout(resolve, 150));
    t.truthy(captured.text, "Expected a failure card to be appended");
    t.truthy(captured.text.includes("⚠️"), `Card should contain warning emoji, got: ${captured.text}`);
    t.truthy(captured.text.toLowerCase().includes("error") || captured.text.includes("BTW"), `Card should indicate error, got: ${captured.text}`);
});
test.serial("session cleanup: ephemeral session is deleted after use", async (t) => {
    const captured = { called: false, id: undefined };
    const session = createMockSession({
        delete: (async (args) => {
            captured.called = true;
            captured.id = args?.path?.id;
        }),
    });
    const cfg = createMockConfig();
    const plugin = await AdvisorPlugin(createPluginInput(session), undefined);
    await plugin.config(cfg);
    const input = { command: "btw", sessionID: "sess-1", arguments: "test cleanup" };
    const output = { parts: [] };
    const hook = plugin["command.execute.before"];
    await hook(input, output);
    await new Promise((resolve) => setTimeout(resolve, 150));
    t.truthy(captured.called, "Expected session.delete to be called");
    t.is(captured.id, "temp-session-1");
});
test.serial("session cleanup: delete failure does not throw", async (t) => {
    const captured = { callCount: 0 };
    const session = createMockSession({
        delete: (async () => {
            captured.callCount++;
            throw new Error("Simulated delete failure");
        }),
    });
    const cfg = createMockConfig();
    const plugin = await AdvisorPlugin(createPluginInput(session), undefined);
    await plugin.config(cfg);
    const input = { command: "btw", sessionID: "sess-1", arguments: "test delete failure" };
    const output = { parts: [] };
    const hook = plugin["command.execute.before"];
    await hook(input, output);
    await new Promise((resolve) => setTimeout(resolve, 150));
    t.is(captured.callCount, 1);
});
test.serial("advisor: success lifecycle — fetch transcript, create session, prompt with agent only, return text, delete", async (t) => {
    const captured = {
        deleteCalled: false,
        deleteSessionID: undefined,
        promptAgent: undefined,
        promptModel: "sentinel",
        promptSystem: "sentinel",
        promptTools: "sentinel",
        promptTranscript: undefined,
    };
    const session = createMockSession({
        messages: (async () => ({
            data: [
                { info: { role: "user", id: "msg-prev" }, parts: [{ type: "text", text: "Earlier" }] },
                { info: { role: "assistant", id: "msg-current" }, parts: [{ type: "text", text: "Current" }] },
            ],
        })),
        create: (async () => ({ data: { id: "ephemeral-adv" } })),
        prompt: (async (args) => {
            captured.promptAgent = args?.body?.agent;
            captured.promptModel = args?.body?.model;
            captured.promptSystem = args?.body?.system;
            captured.promptTools = args?.body?.tools;
            captured.promptTranscript = args?.body?.parts?.[0]?.text;
            return { data: { parts: [{ type: "text", text: "Strategic advice" }] } };
        }),
        delete: (async (args) => {
            captured.deleteCalled = true;
            captured.deleteSessionID = args?.path?.id;
        }),
    });
    const cfg = createMockConfig();
    const plugin = await AdvisorPlugin(createPluginInput(session), undefined);
    await plugin.config(cfg);
    const result = await plugin.tool.advisor.execute({}, toolContext("sess-adv", "msg-current"));
    t.is(result, "Strategic advice");
    t.is(captured.promptAgent, "opencode-advisor:advisor");
    t.is(captured.promptModel, undefined, "prompt body must not include model");
    t.is(captured.promptSystem, undefined, "prompt body must not include system");
    t.is(captured.promptTools, undefined, "prompt body must not include tools");
    t.truthy(captured.deleteCalled, "session.delete must be called");
    t.is(captured.deleteSessionID, "ephemeral-adv");
    t.truthy(captured.promptTranscript, "prompt should have received a transcript");
    t.falsy(captured.promptTranscript.includes("Current"), "transcript must exclude current-message content");
    t.truthy(captured.promptTranscript.includes("Earlier"), "transcript must include prior messages");
});
test.serial("advisor: prompt failure still deletes session and clears recursion guard", async (t) => {
    let deleteCallCount = 0;
    let lastDeleteID;
    const session = createMockSession({
        messages: (async () => ({
            data: [
                { info: { role: "user", id: "msg-prev" }, parts: [{ type: "text", text: "Prior message" }] },
            ],
        })),
        create: (async () => ({ data: { id: "ephemeral-fail" } })),
        prompt: (async () => {
            throw new Error("Prompt error");
        }),
        delete: (async (args) => {
            deleteCallCount++;
            lastDeleteID = args?.path?.id;
        }),
    });
    const cfg = createMockConfig();
    const plugin = await AdvisorPlugin(createPluginInput(session), undefined);
    await plugin.config(cfg);
    const result1 = await plugin.tool.advisor.execute({}, toolContext("sess-fail", "msg-1"));
    t.truthy(result1.startsWith("Advisor error:"), `Result should indicate error, got: ${result1}`);
    t.is(deleteCallCount, 1, "delete should be called after prompt failure");
    t.is(lastDeleteID, "ephemeral-fail", "delete should clean up the created ephemeral session");
    const result2 = await plugin.tool.advisor.execute({}, toolContext("sess-fail", "msg-2"));
    t.falsy(result2.includes("recursive"), "Second advisor call must not be blocked by stale recursion guard");
    t.is(deleteCallCount, 2, "second call also triggers cleanup");
});
test.serial("model precedence: profile model overrides plan model", async (t) => {
    const cfg = { agent: { plan: { model: "anthropic/claude-sonnet-4" } }, command: {} };
    const plugin = await AdvisorPlugin(createPluginInput(createMockSession()), { model: "openai/gpt-5" });
    await plugin.config(cfg);
    t.is(cfg.agent["opencode-advisor:advisor"].model, "openai/gpt-5");
});
test.serial("model precedence: absent profile uses plan model", async (t) => {
    const cfg = { agent: { plan: { model: "anthropic/claude-sonnet-4" } }, command: {} };
    const plugin = await AdvisorPlugin(createPluginInput(createMockSession()), undefined);
    await plugin.config(cfg);
    t.is(cfg.agent["opencode-advisor:advisor"].model, "anthropic/claude-sonnet-4");
});
test.serial("model precedence: absent plan uses global model", async (t) => {
    const cfg = { agent: {}, command: {}, model: "openai/gpt-4" };
    const plugin = await AdvisorPlugin(createPluginInput(createMockSession()), undefined);
    await plugin.config(cfg);
    t.is(cfg.agent["opencode-advisor:advisor"].model, "openai/gpt-4");
});
test.serial("model precedence: absent profile with plan and global config but no valid model uses default", async (t) => {
    const cfg = { agent: { plan: { model: "invalid-format" } }, command: {}, model: "also-invalid" };
    const plugin = await AdvisorPlugin(createPluginInput(createMockSession()), undefined);
    await plugin.config(cfg);
    t.is(cfg.agent["opencode-advisor:advisor"].model, "deepseek/deepseek-v4-pro");
});
test.serial("model precedence: both profile and plan and global absent uses default", async (t) => {
    const cfg = createMockConfig();
    const plugin = await AdvisorPlugin(createPluginInput(createMockSession()), undefined);
    await plugin.config(cfg);
    t.is(cfg.agent["opencode-advisor:advisor"].model, "deepseek/deepseek-v4-pro");
});
test.serial("permission: complete fixed policy deep equality", async (t) => {
    const cfg = createMockConfig();
    const plugin = await AdvisorPlugin(createPluginInput(createMockSession()), undefined);
    await plugin.config(cfg);
    const permission = cfg.agent["opencode-advisor:advisor"].permission;
    t.is(permission["*"], "deny");
    t.is(permission["read"], "allow");
    t.is(permission["glob"], "allow");
    t.is(permission["grep"], "allow");
    t.is(permission["webfetch"], "allow");
    t.is(permission["websearch"], "allow");
    t.is(permission["skill"], "allow");
    t.is(permission["edit"], "deny");
    const bash = permission["bash"];
    t.is(bash["*"], "deny");
    t.is(bash["wc *"], "allow");
    t.is(bash["git log *"], "allow");
    t.is(bash["git diff *"], "allow");
    t.is(bash["git show *"], "allow");
    t.is(bash["rtk wc *"], "allow");
    t.is(bash["rtk git log *"], "allow");
    t.is(bash["rtk git diff *"], "allow");
    t.is(bash["rtk git show *"], "allow");
    t.is(bash["ls *"], undefined);
    t.is(bash["cat *"], undefined);
    t.is(bash["grep *"], undefined);
    t.is(bash["rtk ls *"], undefined);
    t.is(bash["rtk cat *"], undefined);
    t.is(bash["rtk grep *"], undefined);
    const expectedBashKeys = ["*", "wc *", "git log *", "git diff *", "git show *", "rtk wc *", "rtk git log *", "rtk git diff *", "rtk git show *"];
    t.deepEqual(Object.keys(bash).sort(), expectedBashKeys.sort());
});
test.serial("profile: invalid model format — no slash", async (t) => {
    await t.throwsAsync(async () => { await AdvisorPlugin(createPluginInput(createMockSession()), { model: "model-without-slash" }); }, { message: /must be "provider\/model"/ });
});
test.serial("profile: invalid model format — starts with slash", async (t) => {
    await t.throwsAsync(async () => { await AdvisorPlugin(createPluginInput(createMockSession()), { model: "/start/slash" }); }, { message: /must be "provider\/model"/ });
});
test.serial("profile: invalid model format — ends with slash (empty model)", async (t) => {
    await t.throwsAsync(async () => { await AdvisorPlugin(createPluginInput(createMockSession()), { model: "ends-with-slash/" }); }, { message: /must be "provider\/model"/ });
});
test.serial("profile: invalid model format — only slash", async (t) => {
    await t.throwsAsync(async () => { await AdvisorPlugin(createPluginInput(createMockSession()), { model: "/" }); }, { message: /must be "provider\/model"/ });
});
test.serial("profile: non-string variant", async (t) => {
    await t.throwsAsync(async () => { await AdvisorPlugin(createPluginInput(createMockSession()), { variant: 42 }); }, { message: /variant.*must be a string/ });
});
test.serial("profile: non-string prompt", async (t) => {
    await t.throwsAsync(async () => { await AdvisorPlugin(createPluginInput(createMockSession()), { prompt: 42 }); }, { message: /prompt.*must be a string/ });
});
test.serial("profile: non-finite temperature", async (t) => {
    await t.throwsAsync(async () => { await AdvisorPlugin(createPluginInput(createMockSession()), { temperature: Infinity }); }, { message: /temperature.*finite number/ });
    await t.throwsAsync(async () => { await AdvisorPlugin(createPluginInput(createMockSession()), { temperature: NaN }); }, { message: /temperature.*finite number/ });
});
test.serial("profile: non-finite top_p", async (t) => {
    await t.throwsAsync(async () => { await AdvisorPlugin(createPluginInput(createMockSession()), { top_p: Infinity }); }, { message: /top_p.*finite number/ });
    await t.throwsAsync(async () => { await AdvisorPlugin(createPluginInput(createMockSession()), { top_p: NaN }); }, { message: /top_p.*finite number/ });
});
test.serial("profile: non-object options", async (t) => {
    await t.throwsAsync(async () => { await AdvisorPlugin(createPluginInput(createMockSession()), { options: null }); }, { message: /must be a non-array object/ });
    await t.throwsAsync(async () => { await AdvisorPlugin(createPluginInput(createMockSession()), { options: "string" }); }, { message: /must be a non-array object/ });
    await t.throwsAsync(async () => { await AdvisorPlugin(createPluginInput(createMockSession()), { options: 42 }); }, { message: /must be a non-array object/ });
});
test.serial("profile: unknown nested key in split form", async (t) => {
    await t.throwsAsync(async () => {
        await AdvisorPlugin(createPluginInput(createMockSession()), { advisor: { options: { reasoningEffort: "high" }, color: "red" } });
    }, { message: /color/ });
});
test.serial("options: accept nested object/array with primitive JSON values", async (t) => {
    const cfg = createMockConfig();
    const plugin = await AdvisorPlugin(createPluginInput(createMockSession()), {
        options: {
            str: "hello",
            num: 42,
            bool: true,
            nil: null,
            nested: { a: 1, b: "two" },
            arr: [1, "two", true, null],
        },
    });
    await plugin.config(cfg);
    const agentOpts = cfg.agent["opencode-advisor:advisor"].options;
    t.is(agentOpts.str, "hello");
    t.is(agentOpts.num, 42);
    t.is(agentOpts.bool, true);
    t.is(agentOpts.nil, null);
    t.deepEqual(agentOpts.nested, { a: 1, b: "two" });
    t.deepEqual(agentOpts.arr, [1, "two", true, null]);
});
test.serial("options: reject non-finite nested number", async (t) => {
    await t.throwsAsync(async () => {
        await AdvisorPlugin(createPluginInput(createMockSession()), { options: { sub: { x: Infinity } } });
    }, { message: /finite number/ });
});
test.serial("options: reject function value", async (t) => {
    await t.throwsAsync(async () => {
        await AdvisorPlugin(createPluginInput(createMockSession()), { options: { fn: () => { } } });
    }, { message: /invalid option type function/ });
});
test.serial("options: reject symbol value", async (t) => {
    await t.throwsAsync(async () => {
        await AdvisorPlugin(createPluginInput(createMockSession()), { options: { sym: Symbol("x") } });
    }, { message: /invalid option type symbol/ });
});
test.serial("options: reject bigint value", async (t) => {
    await t.throwsAsync(async () => {
        await AdvisorPlugin(createPluginInput(createMockSession()), { options: { big: BigInt(1) } });
    }, { message: /invalid option type bigint/ });
});
test.serial("options: reject Date/class instance value", async (t) => {
    await t.throwsAsync(async () => {
        await AdvisorPlugin(createPluginInput(createMockSession()), { options: { date: new Date() } });
    }, { message: /invalid option type object/ });
});
test.serial("options: reject null at root", async (t) => {
    await t.throwsAsync(async () => {
        await AdvisorPlugin(createPluginInput(createMockSession()), { options: null });
    }, { message: /must be a non-array object/ });
});
test.serial("options: reject array at root", async (t) => {
    await t.throwsAsync(async () => {
        await AdvisorPlugin(createPluginInput(createMockSession()), { options: [1, 2, 3] });
    }, { message: /must be a non-array object/ });
});
test.serial("hidden agents: both agents have hidden=true, mode=subagent", async (t) => {
    const cfg = createMockConfig();
    const plugin = await AdvisorPlugin(createPluginInput(createMockSession()), {});
    await plugin.config(cfg);
    const advisorAgent = cfg.agent["opencode-advisor:advisor"];
    const btwAgent = cfg.agent["opencode-advisor:btw"];
    t.truthy(advisorAgent);
    t.truthy(btwAgent);
    t.is(advisorAgent.hidden, true, "advisor agent must be hidden");
    t.is(btwAgent.hidden, true, "btw agent must be hidden");
    t.is(advisorAgent.mode, "subagent");
    t.is(btwAgent.mode, "subagent");
});
test.serial("hidden agents: default prompt is built-in, custom prompt replaces", async (t) => {
    const cfg = createMockConfig();
    const plugin = await AdvisorPlugin(createPluginInput(createMockSession()), undefined);
    await plugin.config(cfg);
    const advisorAgent = cfg.agent["opencode-advisor:advisor"];
    t.truthy(advisorAgent.prompt);
    t.truthy(50 < advisorAgent.prompt.length);
});
test.serial("hidden agents: profile params map to agent config", async (t) => {
    const cfg = createMockConfig();
    const plugin = await AdvisorPlugin(createPluginInput(createMockSession()), {
        advisor: {
            temperature: 0.7,
            top_p: 0.9,
            variant: "test-variant",
            options: { customOpt: true },
        },
    });
    await plugin.config(cfg);
    const agent = cfg.agent["opencode-advisor:advisor"];
    t.is(agent.temperature, 0.7);
    t.is(agent.top_p, 0.9);
    t.is(agent.variant, "test-variant");
    t.deepEqual(agent.options, { customOpt: true });
});
test.serial("hidden agents: complete fixed permission policy exercised", async (t) => {
    const cfg = createMockConfig();
    const plugin = await AdvisorPlugin(createPluginInput(createMockSession()), undefined);
    await plugin.config(cfg);
    const permission = cfg.agent["opencode-advisor:advisor"].permission;
    t.is(permission["*"], "deny");
    t.is(permission["read"], "allow");
    t.is(permission["glob"], "allow");
    t.is(permission["grep"], "allow");
    t.is(permission["webfetch"], "allow");
    t.is(permission["websearch"], "allow");
    t.is(permission["skill"], "allow");
    t.is(permission["edit"], "deny");
    const bash = permission["bash"];
    t.truthy(bash);
    t.is(bash["*"], "deny");
    const allowedBash = ["wc *", "git log *", "git diff *", "git show *", "rtk wc *", "rtk git log *", "rtk git diff *", "rtk git show *"];
    for (const cmd of allowedBash) {
        t.is(bash[cmd], "allow", `bash["${cmd}"] must be allow`);
    }
    t.is(bash["ls *"], undefined);
    t.is(bash["cat *"], undefined);
    t.is(bash["grep *"], undefined);
    t.is(bash["sudo *"], undefined);
    t.is(bash["rm *"], undefined);
    t.is(bash["vim *"], undefined);
    t.is(bash["nano *"], undefined);
    t.is(bash["echo *"], undefined);
    const knownKeys = ["*", "wc *", "git log *", "git diff *", "git show *", "rtk wc *", "rtk git log *", "rtk git diff *", "rtk git show *"];
    t.deepEqual(Object.keys(bash).sort(), knownKeys.sort());
    t.is(permission["edit"], "deny");
    t.is(permission["write"], undefined);
    t.is(permission["task"], undefined);
    t.is(permission["todo"], undefined);
    t.is(permission["run"], undefined);
});
test.serial("BTW success: full lifecycle — transcript, prompt with agent only, text extract, session delete, result card", async (t) => {
    const captured = {
        messagesCalled: false,
        createTitle: undefined,
        promptAgent: undefined,
        promptModel: "sentinel",
        promptSystem: "sentinel",
        promptTools: "sentinel",
        promptText: undefined,
        deleteSessionID: undefined,
        noReplyParts: undefined,
    };
    const session = createMockSession({
        messages: (async () => {
            captured.messagesCalled = true;
            return {
                data: [
                    { info: { role: "user", id: "msg-1" }, parts: [{ type: "text", text: "Hello" }] },
                ],
            };
        }),
        create: (async (args) => {
            captured.createTitle = args?.body?.title;
            return { data: { id: "btw-ephemeral" } };
        }),
        prompt: (async (args) => {
            if (args?.body?.noReply) {
                captured.noReplyParts = args.body.parts?.[0]?.text;
                return { data: { parts: [] } };
            }
            captured.promptAgent = args?.body?.agent;
            captured.promptModel = args?.body?.model;
            captured.promptSystem = args?.body?.system;
            captured.promptTools = args?.body?.tools;
            captured.promptText = args?.body?.parts?.[0]?.text;
            return { data: { parts: [{ type: "text", text: "BTW answer here" }] } };
        }),
        delete: (async (args) => {
            captured.deleteSessionID = args?.path?.id;
        }),
    });
    const cfg = createMockConfig();
    const plugin = await AdvisorPlugin(createPluginInput(session), undefined);
    await plugin.config(cfg);
    const output = { parts: [] };
    const hook = plugin["command.execute.before"];
    await hook({ command: "btw", sessionID: "main-sess", arguments: "What's up?" }, output);
    await new Promise((resolve) => setTimeout(resolve, 150));
    t.truthy(captured.messagesCalled, "transcript was fetched");
    t.truthy(captured.promptText, "prompt text was built from transcript");
    t.truthy(captured.promptText.includes("Hello"), "transcript content included");
    t.truthy(captured.promptText.includes("What's up?"), "query included in prompt");
    t.is(captured.createTitle, "btw-subcall");
    t.is(captured.promptAgent, "opencode-advisor:btw");
    t.is(captured.promptModel, undefined, "no model in prompt body");
    t.is(captured.promptSystem, undefined, "no system in prompt body");
    t.is(captured.promptTools, undefined, "no tools in prompt body");
    t.truthy(captured.noReplyParts, "result card was appended");
    t.truthy(captured.noReplyParts.includes("BTW answer here"), "answer text in card");
    t.falsy(captured.noReplyParts.includes("Error"), "no error text in success card");
    t.falsy(captured.noReplyParts.includes("⚠️"), "no warning in success card");
    t.is(captured.deleteSessionID, "btw-ephemeral", "ephemeral session deleted");
});
test.serial("BTW: undefined messages data tolerates missing transcript and returns normal answer", async (t) => {
    const captured = {
        messagesCalled: false,
        promptText: undefined,
        noReplyParts: undefined,
        promptAgent: undefined,
        deleteSessionID: undefined,
    };
    const session = createMockSession({
        messages: (async () => {
            captured.messagesCalled = true;
            return { data: undefined };
        }),
        create: (async () => ({ data: { id: "btw-ephemeral-undef" } })),
        prompt: (async (args) => {
            if (args?.body?.noReply) {
                captured.noReplyParts = args.body.parts?.[0]?.text;
                return { data: { parts: [] } };
            }
            captured.promptAgent = args?.body?.agent;
            captured.promptText = args?.body?.parts?.[0]?.text;
            return { data: { parts: [{ type: "text", text: "BTW answer without context" }] } };
        }),
        delete: (async (args) => {
            captured.deleteSessionID = args?.path?.id;
        }),
    });
    const cfg = createMockConfig();
    const plugin = await AdvisorPlugin(createPluginInput(session), undefined);
    await plugin.config(cfg);
    const output = { parts: [] };
    const hook = plugin["command.execute.before"];
    await hook({ command: "btw", sessionID: "main-sess-undef", arguments: "question?" }, output);
    await new Promise((resolve) => setTimeout(resolve, 150));
    t.truthy(captured.messagesCalled, "messages() was called");
    t.truthy(captured.promptText, "prompt text was built");
    t.is(captured.promptText, "question?", "prompt text equals the bare query when transcript is empty");
    t.is(captured.promptAgent, "opencode-advisor:btw");
    t.truthy(captured.noReplyParts, "result card was appended");
    t.truthy(captured.noReplyParts.includes("question?"), "query in card");
    t.truthy(captured.noReplyParts.includes("BTW answer without context"), "answer text in card");
    t.falsy(captured.noReplyParts.includes("⚠️"), "no warning in success card");
    t.is(captured.deleteSessionID, "btw-ephemeral-undef", "ephemeral session deleted");
});
test.serial("command.execute.before: mutates existing text part, preserves identity", async (t) => {
    const session = createMockSession();
    const cfg = createMockConfig();
    const plugin = await AdvisorPlugin(createPluginInput(session), undefined);
    await plugin.config(cfg);
    const existingPart = {
        id: "part-id-1",
        sessionID: "sess-1",
        messageID: "msg-1",
        type: "text",
        text: "",
    };
    const output = { parts: [existingPart] };
    const hook = plugin["command.execute.before"];
    await hook({ command: "btw", sessionID: "sess-1", arguments: "test identity" }, output);
    t.is(output.parts.length, 1);
    t.is(output.parts[0], existingPart);
    t.is(existingPart.text, "[BTW] test identity...");
    t.is(existingPart.id, "part-id-1");
    t.is(existingPart.sessionID, "sess-1");
    t.is(existingPart.messageID, "msg-1");
});
test.serial("command.execute.before: empty query preserves identity", async (t) => {
    const session = createMockSession();
    const cfg = createMockConfig();
    const plugin = await AdvisorPlugin(createPluginInput(session), undefined);
    await plugin.config(cfg);
    const existingPart = {
        id: "part-id-empty",
        sessionID: "sess-empty",
        messageID: "msg-empty",
        type: "text",
        text: "",
    };
    const output = { parts: [existingPart] };
    const hook = plugin["command.execute.before"];
    await hook({ command: "btw", sessionID: "sess-empty", arguments: "" }, output);
    t.is(output.parts.length, 1);
    const part = output.parts[0];
    t.is(part.text, "Usage: /btw <question> — answers a one-shot question in background.");
    t.is(part.id, "part-id-empty");
    t.is(part.sessionID, "sess-empty");
    t.is(part.messageID, "msg-empty");
});
test.serial("command.execute.before: recursive error preserves identity", async (t) => {
    const session = createMockSession({
        messages: (async () => {
            await new Promise((resolve) => setTimeout(resolve, 500));
            return { data: [] };
        }),
    });
    const cfg = createMockConfig();
    const plugin = await AdvisorPlugin(createPluginInput(session), undefined);
    await plugin.config(cfg);
    const hook = plugin["command.execute.before"];
    const output1 = {
        parts: [{ id: "part-rec-1", sessionID: "sess-rec", messageID: "msg-rec", type: "text", text: "" }],
    };
    await hook({ command: "btw", sessionID: "sess-rec", arguments: "first" }, output1);
    const output2 = {
        parts: [{ id: "part-rec-2", sessionID: "sess-rec", messageID: "msg-rec", type: "text", text: "" }],
    };
    await hook({ command: "btw", sessionID: "sess-rec", arguments: "second" }, output2);
    t.is(output2.parts.length, 1);
    const part = output2.parts[0];
    t.truthy(part.text.includes("already running"));
    t.is(part.id, "part-rec-2");
    t.is(part.sessionID, "sess-rec");
    t.is(part.messageID, "msg-rec");
});
test.serial("command.execute.before: non-text part preserved unchanged", async (t) => {
    const session = createMockSession();
    const cfg = createMockConfig();
    const plugin = await AdvisorPlugin(createPluginInput(session), undefined);
    await plugin.config(cfg);
    const nonTextPart = {
        id: "part-start-1",
        sessionID: "sess-start",
        messageID: "msg-start",
        type: "step-start",
    };
    const output = { parts: [nonTextPart] };
    const hook = plugin["command.execute.before"];
    await hook({ command: "btw", sessionID: "sess-start", arguments: "something" }, output);
    t.is(output.parts.length, 1);
    t.is(output.parts[0], nonTextPart);
    t.is(output.parts[0].type, "step-start");
    t.is(output.parts[0].id, "part-start-1");
    t.is(output.parts[0].sessionID, "sess-start");
    t.is(output.parts[0].messageID, "msg-start");
});
test.serial("advisor: recursion guard blocks concurrent calls", async (t) => {
    let resolveMessages = () => { };
    const messagesDeferred = new Promise((resolve) => {
        resolveMessages = resolve;
    });
    let messagesCallCount = 0;
    const session = createMockSession({
        messages: (async () => {
            messagesCallCount++;
            if (1 === messagesCallCount) {
                await messagesDeferred;
            }
            return {
                data: [
                    { info: { role: "user", id: "msg-prev" }, parts: [{ type: "text", text: "Prior message" }] },
                ],
            };
        }),
        create: (async () => ({ data: { id: "ephemeral-rec" } })),
        prompt: (async () => ({ data: { parts: [{ type: "text", text: "First advice" }] } })),
        delete: (async () => { }),
    });
    const cfg = createMockConfig();
    const plugin = await AdvisorPlugin(createPluginInput(session), undefined);
    await plugin.config(cfg);
    const firstCallPromise = plugin.tool.advisor.execute({}, toolContext("sess-rec", "msg-current"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    t.is(messagesCallCount, 1, "first call must have invoked messages()");
    const secondResult = await plugin.tool.advisor.execute({}, toolContext("sess-rec", "msg-other"));
    t.is(secondResult, "Error: advisor tool cannot be called recursively.");
    resolveMessages(undefined);
    await firstCallPromise;
    const thirdResult = await plugin.tool.advisor.execute({}, toolContext("sess-rec", "msg-third"));
    t.is(thirdResult, "First advice");
});
test.serial("advisor: empty transcript declines — current message only", async (t) => {
    let createCalled = false;
    const session = createMockSession({
        messages: (async () => ({
            data: [
                { info: { role: "user", id: "msg-current" }, parts: [{ type: "text", text: "Only message" }] },
            ],
        })),
        create: (async () => {
            createCalled = true;
            return { data: { id: "should-not-reach" } };
        }),
    });
    const cfg = createMockConfig();
    const plugin = await AdvisorPlugin(createPluginInput(session), undefined);
    await plugin.config(cfg);
    const result = await plugin.tool.advisor.execute({}, toolContext("sess-empty", "msg-current"));
    t.is(result, "Advisor declined: no prior conversation to analyze.");
    t.falsy(createCalled, "session.create must not be called when transcript is empty");
});
test.serial("advisor: empty transcript declines — messages with no text parts", async (t) => {
    let createCalled = false;
    const session = createMockSession({
        messages: (async () => ({
            data: [
                { info: { role: "user", id: "msg-1" }, parts: [] },
                { info: { role: "assistant", id: "msg-2" }, parts: [{ type: "tool-use", text: "some tool output" }] },
            ],
        })),
        create: (async () => {
            createCalled = true;
            return { data: { id: "should-not-reach" } };
        }),
    });
    const cfg = createMockConfig();
    const plugin = await AdvisorPlugin(createPluginInput(session), undefined);
    await plugin.config(cfg);
    const result = await plugin.tool.advisor.execute({}, toolContext("sess-empty2", "msg-other"));
    t.is(result, "Advisor declined: no prior conversation to analyze.");
    t.falsy(createCalled, "session.create must not be called when transcript text is empty");
});
test.serial("advisor: create rejection returns error and clears guard", async (t) => {
    let createCallCount = 0;
    const session = createMockSession({
        messages: (async () => ({
            data: [
                { info: { role: "user", id: "msg-prev" }, parts: [{ type: "text", text: "Prior message" }] },
            ],
        })),
        create: (async () => {
            createCallCount++;
            if (1 === createCallCount) {
                throw new Error("API unavailable");
            }
            return { data: { id: "ephemeral-retry" } };
        }),
    });
    const cfg = createMockConfig();
    const plugin = await AdvisorPlugin(createPluginInput(session), undefined);
    await plugin.config(cfg);
    const result1 = await plugin.tool.advisor.execute({}, toolContext("sess-fail", "msg-1"));
    t.truthy(result1.startsWith("Advisor error:"), `Expected error prefix, got: ${result1}`);
    t.truthy(result1.includes("API unavailable"), `Expected API error, got: ${result1}`);
    const result2 = await plugin.tool.advisor.execute({}, toolContext("sess-fail", "msg-2"));
    t.is(result2, "Advisor response");
    t.is(createCallCount, 2, "create must be called twice");
});
test.serial("advisor: create returns no ID — ephemeral session ID absent", async (t) => {
    let createCallCount = 0;
    let deleteCalled = false;
    const session = createMockSession({
        messages: (async () => ({
            data: [
                { info: { role: "user", id: "msg-prev" }, parts: [{ type: "text", text: "Prior" }] },
            ],
        })),
        create: (async () => {
            createCallCount++;
            if (1 === createCallCount) {
                return { data: {} };
            }
            return { data: { id: "ephemeral-second" } };
        }),
        delete: (async () => {
            deleteCalled = true;
        }),
    });
    const cfg = createMockConfig();
    const plugin = await AdvisorPlugin(createPluginInput(session), undefined);
    await plugin.config(cfg);
    const result = await plugin.tool.advisor.execute({}, toolContext("sess-noid", "msg-1"));
    t.is(result, "Advisor error: failed to create ephemeral session.");
    t.falsy(deleteCalled, "delete must not be called when create returns no ID");
    const result2 = await plugin.tool.advisor.execute({}, toolContext("sess-noid", "msg-2"));
    t.is(result2, "Advisor response");
});
test.serial("profile: non-string model throws", async (t) => {
    await t.throwsAsync(async () => {
        await AdvisorPlugin(createPluginInput(createMockSession()), { model: 42 });
    }, { message: /model.*must be a string/ });
});
test.serial("profile: empty model string throws", async (t) => {
    await t.throwsAsync(async () => {
        await AdvisorPlugin(createPluginInput(createMockSession()), { model: "" });
    }, { message: /model.*must not be empty/ });
});
test.serial("profile: non-number temperature type throws", async (t) => {
    await t.throwsAsync(async () => {
        await AdvisorPlugin(createPluginInput(createMockSession()), { temperature: "hot" });
    }, { message: /temperature.*must be a finite number/ });
});
test.serial("profile: non-number top_p type throws", async (t) => {
    await t.throwsAsync(async () => {
        await AdvisorPlugin(createPluginInput(createMockSession()), { top_p: "0.9" });
    }, { message: /top_p.*must be a finite number/ });
});
test.serial("profile: bare string advisor section throws", async (t) => {
    await t.throwsAsync(async () => {
        await AdvisorPlugin(createPluginInput(createMockSession()), { advisor: "bare-string" });
    }, { message: /advisor.*must be a non-array object/ });
});
test.serial("profile: numeric advisor section throws", async (t) => {
    await t.throwsAsync(async () => {
        await AdvisorPlugin(createPluginInput(createMockSession()), { advisor: 42 });
    }, { message: /advisor.*must be a non-array object/ });
});
test.serial("parseOptions: array root throws", async (t) => {
    await t.throwsAsync(async () => {
        await AdvisorPlugin(createPluginInput(createMockSession()), [1, 2]);
    }, { message: /must be a non-array object/ });
});
test.serial("parseOptions: string root throws", async (t) => {
    await t.throwsAsync(async () => {
        await AdvisorPlugin(createPluginInput(createMockSession()), "bare-string");
    }, { message: /must be a non-array object/ });
});
test.serial("config: cfg without agent/command properties uses defaults", async (t) => {
    const cfg = { agent: undefined, command: undefined };
    const plugin = await AdvisorPlugin(createPluginInput(createMockSession()), undefined);
    await plugin.config(cfg);
    t.truthy(cfg.agent["opencode-advisor:advisor"]);
    t.truthy(cfg.command.btw);
});
test.serial("advisor: undefined data from messages returns declined", async (t) => {
    const session = createMockSession({
        messages: (async () => ({})),
    });
    const cfg = createMockConfig();
    const plugin = await AdvisorPlugin(createPluginInput(session), undefined);
    await plugin.config(cfg);
    const result = await plugin.tool.advisor.execute({}, toolContext("sess-undef", "msg-1"));
    t.is(result, "Advisor declined: no prior conversation to analyze.");
});
test.serial("advisor: non-Error throw in create caught gracefully", async (t) => {
    let inCreate = false;
    const session = createMockSession({
        create: (async () => {
            inCreate = true;
            throw "string error message";
        }),
    });
    const cfg = createMockConfig();
    const plugin = await AdvisorPlugin(createPluginInput(session), undefined);
    await plugin.config(cfg);
    const result = await plugin.tool.advisor.execute({}, toolContext("sess-strerr", "msg-other"));
    t.truthy(inCreate, "create was called");
    t.truthy(result.includes("string error message"), `result: ${result}`);
});
test.serial("advisor: empty response text uses fallback", async (t) => {
    const session = createMockSession({
        messages: (async () => ({
            data: [
                { info: { role: "user", id: "msg-prev" }, parts: [{ type: "text", text: "Prior" }] },
                { info: { role: "assistant", id: "msg-cur" }, parts: [{ type: "text", text: "Current" }] },
            ],
        })),
        prompt: (async () => ({
            data: { parts: [{ type: "text", text: "" }] },
        })),
    });
    const cfg = createMockConfig();
    const plugin = await AdvisorPlugin(createPluginInput(session), undefined);
    await plugin.config(cfg);
    const result = await plugin.tool.advisor.execute({}, toolContext("sess-emptyresp", "msg-cur"));
    t.is(result, "Advisor returned no advice.");
});
test.serial("transcript: parts with null text use empty string fallback", async (t) => {
    const session = createMockSession({
        messages: (async () => ({
            data: [
                { info: { role: "user", id: "msg-1" }, parts: [{ type: "text", text: null }] },
            ],
        })),
    });
    const cfg = createMockConfig();
    const plugin = await AdvisorPlugin(createPluginInput(session), undefined);
    await plugin.config(cfg);
    const result = await plugin.tool.advisor.execute({}, toolContext("sess-nulltxt", "msg-other"));
    t.is(result, "Advisor declined: no prior conversation to analyze.");
});
//# sourceMappingURL=plugin.test.js.map