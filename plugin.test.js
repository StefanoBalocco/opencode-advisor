import test from "ava";
import { AdvisorPlugin } from "./plugin.js";
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
function createPluginInput(session) {
    return { client: { session }, directory: "" };
}
function createMockConfig() {
    return { agent: {}, command: {} };
}
test.serial("config registers only advisor agent, no btw agent or command", async (t) => {
    const cfg = createMockConfig();
    const plugin = await AdvisorPlugin(createPluginInput(createMockSession()), undefined);
    await plugin.config(cfg);
    t.truthy(cfg.agent["opencode-advisor:advisor"]);
    t.falsy(cfg.agent["opencode-advisor:btw"]);
    t.falsy(cfg.command.btw);
    t.falsy(plugin["command.execute.before"]);
});
test.serial("config: does not mutate user-defined command object", async (t) => {
    const userCommands = { btw: { template: "$ARGUMENTS" }, other: { template: "do-something" } };
    const cfg = { agent: {}, command: userCommands };
    const snapshot = structuredClone(userCommands);
    const plugin = await AdvisorPlugin(createPluginInput(createMockSession()), undefined);
    await plugin.config(cfg);
    t.is(cfg.command, userCommands, "command object must not be replaced");
    t.deepEqual(cfg.command, snapshot, "command object must not be mutated");
});
test.serial("profile: undefined returns defaults", async (t) => {
    const cfg = createMockConfig();
    const plugin = await AdvisorPlugin(createPluginInput(createMockSession()), undefined);
    await plugin.config(cfg);
    const advisorAgent = cfg.agent["opencode-advisor:advisor"];
    t.truthy(advisorAgent);
    t.is(advisorAgent.model, "deepseek/deepseek-v4-pro");
});
test.serial("profile: empty object returns defaults", async (t) => {
    const cfg = createMockConfig();
    const plugin = await AdvisorPlugin(createPluginInput(createMockSession()), {});
    await plugin.config(cfg);
    const advisorAgent = cfg.agent["opencode-advisor:advisor"];
    t.truthy(advisorAgent);
    t.is(advisorAgent.model, "deepseek/deepseek-v4-pro");
});
test.serial("profile: null throws", async (t) => {
    await t.throwsAsync(async () => {
        await AdvisorPlugin(createPluginInput(createMockSession()), null);
    }, { message: /null/ });
});
test.serial("profile: direct options apply to advisor", async (t) => {
    const cfg = createMockConfig();
    const plugin = await AdvisorPlugin(createPluginInput(createMockSession()), { model: "anthropic/claude-opus-4-7", temperature: 0 });
    await plugin.config(cfg);
    const advisorCfg = cfg.agent["opencode-advisor:advisor"];
    t.truthy(advisorCfg);
    t.is(advisorCfg.model, "anthropic/claude-opus-4-7");
    t.is(advisorCfg.temperature, 0);
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
test.serial("prompt: custom prompt replaces default", async (t) => {
    const cfg = createMockConfig();
    const plugin = await AdvisorPlugin(createPluginInput(createMockSession()), { prompt: "Custom advisor prompt" });
    await plugin.config(cfg);
    t.is(cfg.agent["opencode-advisor:advisor"].prompt, "Custom advisor prompt");
});
test.serial("prompt: empty string in options replaces default", async (t) => {
    const cfg = createMockConfig();
    const plugin = await AdvisorPlugin(createPluginInput(createMockSession()), { prompt: "" });
    await plugin.config(cfg);
    t.is(cfg.agent["opencode-advisor:advisor"].prompt, "");
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
test.serial("profile: unknown nested key in options throws", async (t) => {
    await t.throwsAsync(async () => {
        await AdvisorPlugin(createPluginInput(createMockSession()), { options: { reasoningEffort: "high" }, color: "red" });
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
test.serial("hidden agent: has hidden=true, mode=subagent", async (t) => {
    const cfg = createMockConfig();
    const plugin = await AdvisorPlugin(createPluginInput(createMockSession()), {});
    await plugin.config(cfg);
    const advisorAgent = cfg.agent["opencode-advisor:advisor"];
    t.truthy(advisorAgent);
    t.is(advisorAgent.hidden, true, "advisor agent must be hidden");
    t.is(advisorAgent.mode, "subagent");
});
test.serial("hidden agent: default prompt is built-in, custom prompt replaces", async (t) => {
    const cfg = createMockConfig();
    const plugin = await AdvisorPlugin(createPluginInput(createMockSession()), undefined);
    await plugin.config(cfg);
    const advisorAgent = cfg.agent["opencode-advisor:advisor"];
    t.truthy(advisorAgent.prompt);
    t.truthy(50 < advisorAgent.prompt.length);
});
test.serial("hidden agent: profile params map to agent config", async (t) => {
    const cfg = createMockConfig();
    const plugin = await AdvisorPlugin(createPluginInput(createMockSession()), {
        temperature: 0.7,
        top_p: 0.9,
        variant: "test-variant",
        options: { customOpt: true },
    });
    await plugin.config(cfg);
    const agent = cfg.agent["opencode-advisor:advisor"];
    t.is(agent.temperature, 0.7);
    t.is(agent.top_p, 0.9);
    t.is(agent.variant, "test-variant");
    t.deepEqual(agent.options, { customOpt: true });
});
test.serial("hidden agent: complete fixed permission policy exercised", async (t) => {
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
test.serial("profile: unknown top-level key throws", async (t) => {
    await t.throwsAsync(async () => {
        await AdvisorPlugin(createPluginInput(createMockSession()), { advisor: {} });
    }, { message: /unknown key.*advisor/ });
});
test.serial("profile: array root throws", async (t) => {
    await t.throwsAsync(async () => {
        await AdvisorPlugin(createPluginInput(createMockSession()), [1, 2]);
    }, { message: /must be a non-array object/ });
});
test.serial("profile: string root throws", async (t) => {
    await t.throwsAsync(async () => {
        await AdvisorPlugin(createPluginInput(createMockSession()), "bare-string");
    }, { message: /must be a non-array object/ });
});
test.serial("config: cfg without agent/command properties uses defaults", async (t) => {
    const cfg = { agent: undefined, command: undefined };
    const plugin = await AdvisorPlugin(createPluginInput(createMockSession()), undefined);
    await plugin.config(cfg);
    t.truthy(cfg.agent["opencode-advisor:advisor"]);
    t.falsy(cfg.agent["opencode-advisor:btw"]);
    t.falsy(cfg.command);
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