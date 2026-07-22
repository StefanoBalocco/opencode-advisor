import test from "ava";
import { AdvisorPlugin } from "./plugin.js";
function createPromptRecording() {
    return {
        promptSessionID: undefined,
        promptAgent: undefined,
        promptNoReply: undefined,
        promptSynthetic: undefined,
        promptText: undefined,
        prompts: [],
    };
}
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
function errorToolPartEvent(sessionID, messageID, tool, error, callID = "call-1") {
    return {
        type: "message.part.updated",
        properties: {
            part: {
                id: `part-${callID}`,
                sessionID,
                messageID,
                type: "tool",
                callID,
                tool,
                state: {
                    status: "error",
                    error,
                    input: {},
                    time: { start: 100, end: 200 },
                },
            },
            delta: undefined,
        },
    };
}
function completedToolPartEvent(sessionID, messageID, tool, callID = "call-1") {
    return {
        type: "message.part.updated",
        properties: {
            part: {
                id: `part-${callID}`,
                sessionID,
                messageID,
                type: "tool",
                callID,
                tool,
                state: {
                    status: "completed",
                    output: "success",
                    title: "Completed",
                    input: {},
                    metadata: {},
                    time: { start: 100, end: 200 },
                },
            },
            delta: undefined,
        },
    };
}
function pendingToolPartEvent(sessionID, messageID, tool, callID = "call-1") {
    return {
        type: "message.part.updated",
        properties: {
            part: {
                id: `part-${callID}`,
                sessionID,
                messageID,
                type: "tool",
                callID,
                tool,
                state: {
                    status: "pending",
                    input: {},
                    raw: "",
                },
            },
            delta: undefined,
        },
    };
}
function runningToolPartEvent(sessionID, messageID, tool, callID = "call-1") {
    return {
        type: "message.part.updated",
        properties: {
            part: {
                id: `part-${callID}`,
                sessionID,
                messageID,
                type: "tool",
                callID,
                tool,
                state: {
                    status: "running",
                    input: {},
                    time: { start: 100 },
                },
            },
            delta: undefined,
        },
    };
}
function sessionIdleEvent(sessionID) {
    return {
        type: "session.idle",
        properties: { sessionID },
    };
}
function sessionDeletedEvent(sessionID) {
    return {
        type: "session.deleted",
        properties: { info: { id: sessionID } },
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
        abort: (async () => ({
            data: true,
        })),
        status: (async () => ({
            data: {},
        })),
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
test.serial("profile: failureThreshold 1 accepted", async (t) => {
    const cfg = createMockConfig();
    const plugin = await AdvisorPlugin(createPluginInput(createMockSession()), { failureThreshold: 1 });
    await plugin.config(cfg);
    t.pass();
});
test.serial("profile: failureThreshold 5 accepted", async (t) => {
    const cfg = createMockConfig();
    const plugin = await AdvisorPlugin(createPluginInput(createMockSession()), { failureThreshold: 5 });
    await plugin.config(cfg);
    t.pass();
});
test.serial("profile: failureThreshold 0 throws", async (t) => {
    await t.throwsAsync(async () => { await AdvisorPlugin(createPluginInput(createMockSession()), { failureThreshold: 0 }); }, { message: /failureThreshold/ });
});
test.serial("profile: failureThreshold -1 throws", async (t) => {
    await t.throwsAsync(async () => { await AdvisorPlugin(createPluginInput(createMockSession()), { failureThreshold: -1 }); }, { message: /failureThreshold/ });
});
test.serial("profile: failureThreshold 2.5 throws", async (t) => {
    await t.throwsAsync(async () => { await AdvisorPlugin(createPluginInput(createMockSession()), { failureThreshold: 2.5 }); }, { message: /failureThreshold/ });
});
test.serial("profile: failureThreshold NaN throws", async (t) => {
    await t.throwsAsync(async () => { await AdvisorPlugin(createPluginInput(createMockSession()), { failureThreshold: NaN }); }, { message: /failureThreshold/ });
});
test.serial("profile: failureThreshold Infinity throws", async (t) => {
    await t.throwsAsync(async () => { await AdvisorPlugin(createPluginInput(createMockSession()), { failureThreshold: Infinity }); }, { message: /failureThreshold/ });
});
test.serial("profile: failureThreshold string throws", async (t) => {
    await t.throwsAsync(async () => { await AdvisorPlugin(createPluginInput(createMockSession()), { failureThreshold: "3" }); }, { message: /failureThreshold/ });
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
test.serial("event: two errors at default threshold do not abort, third does", async (t) => {
    let abortCallCount = 0;
    const msgsData = [
        { info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [{ type: "text", text: "Task" }] },
        { info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
    ];
    const session = createMockSession({
        messages: (async () => ({ data: msgsData })),
        abort: (async () => {
            abortCallCount++;
            return { data: true };
        }),
    });
    const plugin = await AdvisorPlugin(createPluginInput(session), undefined);
    await plugin.config(createMockConfig());
    await plugin.event({ event: errorToolPartEvent("sess-e1", "asst-msg", "read", "err1", "call-1") });
    await plugin.event({ event: errorToolPartEvent("sess-e1", "asst-msg", "read", "err2", "call-2") });
    t.is(abortCallCount, 0);
    await plugin.event({ event: errorToolPartEvent("sess-e1", "asst-msg", "read", "err3", "call-3") });
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    t.is(abortCallCount, 1);
});
test.serial("event: custom failureThreshold honored", async (t) => {
    let abortCallCount = 0;
    const msgsData = [
        { info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [{ type: "text", text: "Task" }] },
        { info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
    ];
    const session = createMockSession({
        messages: (async () => ({ data: msgsData })),
        abort: (async () => {
            abortCallCount++;
            return { data: true };
        }),
    });
    const plugin = await AdvisorPlugin(createPluginInput(session), { failureThreshold: 1 });
    await plugin.config(createMockConfig());
    await plugin.event({ event: errorToolPartEvent("sess-cust", "asst-msg", "read", "err", "call-1") });
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    t.is(abortCallCount, 1);
});
test.serial("event: completed tool resets streak", async (t) => {
    let abortCallCount = 0;
    const msgsData = [
        { info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [{ type: "text", text: "Task" }] },
        { info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
    ];
    const session = createMockSession({
        messages: (async () => ({ data: msgsData })),
        abort: (async () => {
            abortCallCount++;
            return { data: true };
        }),
    });
    const plugin = await AdvisorPlugin(createPluginInput(session), { failureThreshold: 2 });
    await plugin.config(createMockConfig());
    await plugin.event({ event: errorToolPartEvent("sess-reset", "asst-msg", "read", "err1", "call-1") });
    await plugin.event({ event: completedToolPartEvent("sess-reset", "asst-msg", "read", "call-2") });
    await plugin.event({ event: errorToolPartEvent("sess-reset", "asst-msg", "read", "err2", "call-3") });
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    t.is(abortCallCount, 0, "reset prevents threshold from being reached");
});
test.serial("event: streaks isolated per session ID", async (t) => {
    let abortCallCount = 0;
    const msgsData = [
        { info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [{ type: "text", text: "Task" }] },
        { info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
    ];
    const session = createMockSession({
        messages: (async () => ({ data: msgsData })),
        abort: (async () => {
            abortCallCount++;
            return { data: true };
        }),
    });
    const plugin = await AdvisorPlugin(createPluginInput(session), { failureThreshold: 3 });
    await plugin.config(createMockConfig());
    await plugin.event({ event: errorToolPartEvent("sess-A", "asst-msg", "read", "a1", "ca-1") });
    await plugin.event({ event: errorToolPartEvent("sess-A", "asst-msg", "read", "a2", "ca-2") });
    await plugin.event({ event: errorToolPartEvent("sess-B", "asst-msg", "read", "b1", "cb-1") });
    await plugin.event({ event: errorToolPartEvent("sess-B", "asst-msg", "read", "b2", "cb-2") });
    await plugin.event({ event: errorToolPartEvent("sess-B", "asst-msg", "read", "b3", "cb-3") });
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    t.is(abortCallCount, 1, "only session B reaches threshold");
});
test.serial("event: pending and running tool states do nothing", async (t) => {
    let abortCallCount = 0;
    const session = createMockSession({
        abort: (async () => {
            abortCallCount++;
            return { data: true };
        }),
    });
    const plugin = await AdvisorPlugin(createPluginInput(session), { failureThreshold: 1 });
    await plugin.config(createMockConfig());
    await plugin.event({ event: pendingToolPartEvent("sess-p", "asst-m", "read", "c1") });
    await plugin.event({ event: runningToolPartEvent("sess-p", "asst-m", "read", "c2") });
    await new Promise((resolve) => { setTimeout(resolve, 30); });
    t.is(abortCallCount, 0, "pending/running must not be counted");
});
test.serial("event: advisor tool error does not increment", async (t) => {
    let abortCallCount = 0;
    const session = createMockSession({
        abort: (async () => {
            abortCallCount++;
            return { data: true };
        }),
    });
    const plugin = await AdvisorPlugin(createPluginInput(session), { failureThreshold: 1 });
    await plugin.config(createMockConfig());
    await plugin.event({ event: errorToolPartEvent("sess-adv", "asst-m", "advisor", "err", "c1") });
    await new Promise((resolve) => { setTimeout(resolve, 30); });
    t.is(abortCallCount, 0, "advisor tool error must not trigger intervention");
});
test.serial("event: completed advisor tool resets streak like any tool", async (t) => {
    const msgsData = [
        { info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [{ type: "text", text: "Task" }] },
        { info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
    ];
    const session = createMockSession({
        messages: (async () => ({ data: msgsData })),
    });
    const plugin = await AdvisorPlugin(createPluginInput(session), { failureThreshold: 2 });
    await plugin.config(createMockConfig());
    let eventCount = 0;
    const origEvent = plugin.event;
    plugin.event = async (input) => {
        eventCount++;
        await origEvent(input);
    };
    await plugin.event({ event: errorToolPartEvent("sess-acr", "asst-msg", "read", "e1", "c1") });
    await plugin.event({ event: completedToolPartEvent("sess-acr", "asst-msg", "advisor", "c2") });
    await plugin.event({ event: errorToolPartEvent("sess-acr", "asst-msg", "read", "e2", "c3") });
    t.is(eventCount, 3, "all events processed");
    t.pass("completed advisor tool resets streak");
});
test.serial("event: auto-created advisor session events are ignored", async (t) => {
    let abortCallCount = 0;
    const msgsData = [
        { info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [{ type: "text", text: "Task" }] },
        { info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
    ];
    const session = createMockSession({
        messages: (async () => ({ data: msgsData })),
        abort: (async () => {
            abortCallCount++;
            return { data: true };
        }),
    });
    const recording = createPromptRecording();
    session.prompt = (async (args) => {
        const body = args.body;
        recording.prompts.push({
            sessionID: args.path?.id,
            agent: body.agent,
            text: body.parts?.[0]?.text,
        });
        return { data: { parts: [{ type: "text", text: "Advice" }] } };
    });
    const plugin = await AdvisorPlugin(createPluginInput(session), { failureThreshold: 2 });
    await plugin.config(createMockConfig());
    await plugin.event({ event: errorToolPartEvent("sess-isol", "asst-msg", "read", "e1", "c1") });
    await plugin.event({ event: errorToolPartEvent("sess-isol", "asst-msg", "read", "e2", "c2") });
    await new Promise((resolve) => { setTimeout(resolve, 100); });
    const advisorPrompts = recording.prompts.filter((p) => "opencode-advisor:advisor" === p.agent).length;
    t.true(0 < advisorPrompts, "advisor session was created");
    t.pass("advisor session events are excluded from counting");
});
test.serial("event: tools.advisor false prevents intervention", async (t) => {
    let abortCallCount = 0;
    const msgsData = [
        { info: { role: "user", id: "user-msg", agent: "no-advisor-agent" }, parts: [{ type: "text", text: "Task" }] },
        { info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
    ];
    const session = createMockSession({
        messages: (async () => ({ data: msgsData })),
        abort: (async () => {
            abortCallCount++;
            return { data: true };
        }),
    });
    const plugin = await AdvisorPlugin(createPluginInput(session), { failureThreshold: 1 });
    const cfg = createMockConfig();
    cfg.agent["no-advisor-agent"] = { tools: { advisor: false } };
    await plugin.config(cfg);
    await plugin.event({ event: errorToolPartEvent("sess-opt", "asst-msg", "read", "err", "c1") });
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    t.is(abortCallCount, 0, "no intervention when agent opts out");
});
test.serial("event: missing source agent causes no intervention", async (t) => {
    let abortCallCount = 0;
    const msgsData = [
        { info: { role: "user", id: "user-msg" }, parts: [{ type: "text", text: "Task" }] },
        { info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
    ];
    const session = createMockSession({
        messages: (async () => ({ data: msgsData })),
        abort: (async () => {
            abortCallCount++;
            return { data: true };
        }),
    });
    const plugin = await AdvisorPlugin(createPluginInput(session), { failureThreshold: 1 });
    await plugin.config(createMockConfig());
    await plugin.event({ event: errorToolPartEvent("sess-noagent", "asst-msg", "read", "err", "c1") });
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    t.is(abortCallCount, 0, "no intervention when source agent is missing");
});
test.serial("event: absent agent is eligible when tools.advisor is not explicitly false", async (t) => {
    let abortCallCount = 0;
    const msgsData = [
        { info: { role: "user", id: "user-msg", agent: "some-agent" }, parts: [{ type: "text", text: "Task" }] },
        { info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
    ];
    const session = createMockSession({
        messages: (async () => ({ data: msgsData })),
        abort: (async () => {
            abortCallCount++;
            return { data: true };
        }),
    });
    const plugin = await AdvisorPlugin(createPluginInput(session), { failureThreshold: 1 });
    const cfg = createMockConfig();
    cfg.agent["some-agent"] = { tools: {} };
    await plugin.config(cfg);
    await plugin.event({ event: errorToolPartEvent("sess-elig", "asst-msg", "read", "err", "c1") });
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    t.is(abortCallCount, 1, "agent without explicit tools.advisor false is eligible");
});
test.serial("event: advisor prompt includes tool names and error messages", async (t) => {
    const msgsData = [
        { info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [{ type: "text", text: "Task" }] },
        { info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
    ];
    const recording = createPromptRecording();
    const session = createMockSession({
        messages: (async () => ({ data: msgsData })),
        abort: (async () => ({ data: true })),
        prompt: (async (args) => {
            const body = args.body;
            recording.prompts.push({
                sessionID: args.path?.id,
                agent: body.agent,
                text: body.parts?.[0]?.text,
            });
            return { data: { parts: [{ type: "text", text: "Strategic advice" }] } };
        }),
    });
    const plugin = await AdvisorPlugin(createPluginInput(session), { failureThreshold: 2 });
    await plugin.config(createMockConfig());
    await plugin.event({ event: errorToolPartEvent("sess-pf", "asst-msg", "read", "File not found", "c1") });
    await plugin.event({ event: errorToolPartEvent("sess-pf", "asst-msg", "edit", "Permission denied", "c2") });
    await new Promise((resolve) => { setTimeout(resolve, 100); });
    const advisorPrompt = recording.prompts.find((p) => "opencode-advisor:advisor" === p.agent && undefined !== p.text);
    t.truthy(advisorPrompt, "advisor was prompted");
    t.truthy(advisorPrompt.text.includes("read"), "prompt must mention tool name 'read'");
    t.truthy(advisorPrompt.text.includes("File not found"), "prompt must mention first error");
    t.truthy(advisorPrompt.text.includes("edit"), "prompt must mention tool name 'edit'");
    t.truthy(advisorPrompt.text.includes("Permission denied"), "prompt must mention second error");
});
test.serial("event: resume waits for both idle event and advisor response", async (t) => {
    const msgsData = [
        { info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [{ type: "text", text: "Task" }] },
        { info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
    ];
    const recording = createPromptRecording();
    let resolveAdvisorPrompt = () => { };
    const advisorDeferred = new Promise((resolve) => {
        resolveAdvisorPrompt = resolve;
    });
    let advisorPromptCount = 0;
    const session = createMockSession({
        messages: (async () => ({ data: msgsData })),
        abort: (async () => ({ data: true })),
        create: (async () => ({ data: { id: "temp-adv-wait" } })),
        prompt: (async (args) => {
            const body = args.body;
            const sessID = args.path?.id ?? "";
            recording.prompts.push({
                sessionID: sessID,
                agent: body.agent,
                text: body.parts?.[0]?.text,
            });
            advisorPromptCount++;
            if (1 === advisorPromptCount) {
                await advisorDeferred;
            }
            return { data: { parts: [{ type: "text", text: "Deferred advice" }] } };
        }),
    });
    const plugin = await AdvisorPlugin(createPluginInput(session), { failureThreshold: 2 });
    await plugin.config(createMockConfig());
    await plugin.event({ event: errorToolPartEvent("sess-order", "asst-msg", "read", "e1", "c1") });
    await plugin.event({ event: errorToolPartEvent("sess-order", "asst-msg", "read", "e2", "c2") });
    await new Promise((resolve) => { setTimeout(resolve, 30); });
    await plugin.event({ event: sessionIdleEvent("sess-order") });
    await new Promise((resolve) => { setTimeout(resolve, 30); });
    const resumePromptsBefore = recording.prompts.filter((p) => "test-agent" === p.agent).length;
    t.is(resumePromptsBefore, 0, "no resume before advisor response");
    resolveAdvisorPrompt(undefined);
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    const resumePromptsAfter = recording.prompts.filter((p) => "test-agent" === p.agent).length;
    t.is(resumePromptsAfter, 1, "resume after both idle and advisor response");
});
test.serial("event: resume prompt format", async (t) => {
    const msgsData = [
        { info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [{ type: "text", text: "Task" }] },
        { info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
    ];
    const recording = createPromptRecording();
    const session = createMockSession({
        messages: (async () => ({ data: msgsData })),
        abort: (async () => ({ data: true })),
        status: (async () => ({
            data: { "sess-fmt": { type: "idle" } },
        })),
        prompt: (async (args) => {
            const body = args.body;
            recording.prompts.push({
                sessionID: args.path?.id,
                agent: body.agent,
                text: body.parts?.[0]?.text,
            });
            return { data: { parts: [{ type: "text", text: "Advice" }] } };
        }),
    });
    const plugin = await AdvisorPlugin(createPluginInput(session), { failureThreshold: 2 });
    await plugin.config(createMockConfig());
    await plugin.event({ event: errorToolPartEvent("sess-fmt", "asst-msg", "read", "e1", "c1") });
    await plugin.event({ event: errorToolPartEvent("sess-fmt", "asst-msg", "read", "e2", "c2") });
    await new Promise((resolve) => { setTimeout(resolve, 100); });
    const resumePrompt = recording.prompts.find((p) => "test-agent" === p.agent);
    t.truthy(resumePrompt, "resume prompt exists");
    t.is(resumePrompt.sessionID, "sess-fmt", "resume targets original session");
    t.is(resumePrompt.agent, "test-agent", "resume uses source agent");
    t.truthy(resumePrompt.text.includes("Advice"), "resume includes advisor advice");
    t.truthy(resumePrompt.text.includes("Continue the task using this advice."), "resume includes continuation instruction");
});
test.serial("event: abort failure prevents resume", async (t) => {
    const msgsData = [
        { info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [{ type: "text", text: "Task" }] },
        { info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
    ];
    const recording = createPromptRecording();
    const session = createMockSession({
        messages: (async () => ({ data: msgsData })),
        abort: (async () => ({ data: false })),
        prompt: (async (args) => {
            const body = args.body;
            recording.prompts.push({
                sessionID: args.path?.id,
                agent: body.agent,
                text: body.parts?.[0]?.text,
            });
            return { data: { parts: [{ type: "text", text: "Advice" }] } };
        }),
    });
    const plugin = await AdvisorPlugin(createPluginInput(session), { failureThreshold: 2 });
    await plugin.config(createMockConfig());
    await plugin.event({ event: errorToolPartEvent("sess-abfail", "asst-msg", "read", "e1", "c1") });
    await plugin.event({ event: errorToolPartEvent("sess-abfail", "asst-msg", "read", "e2", "c2") });
    await new Promise((resolve) => { setTimeout(resolve, 100); });
    const resumePrompts = recording.prompts.filter((p) => "test-agent" === p.agent).length;
    t.is(resumePrompts, 0, "no resume when abort fails");
});
test.serial("event: advisor failure still resumes with fallback", async (t) => {
    const msgsData = [
        { info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [{ type: "text", text: "Task" }] },
        { info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
    ];
    const recording = createPromptRecording();
    let promptCallCount = 0;
    const session = createMockSession({
        messages: (async () => ({ data: msgsData })),
        abort: (async () => ({ data: true })),
        status: (async () => ({
            data: { "sess-advfail": { type: "idle" } },
        })),
        create: (async () => ({ data: { id: "temp-fail" } })),
        prompt: (async (args) => {
            promptCallCount++;
            const body = args.body;
            const sessID = args.path?.id ?? "";
            recording.prompts.push({
                sessionID: sessID,
                agent: body.agent,
                text: body.parts?.[0]?.text,
            });
            if (1 === promptCallCount) {
                throw new Error("Advisor API error");
            }
            return { data: { parts: [{ type: "text", text: "ok" }] } };
        }),
    });
    const plugin = await AdvisorPlugin(createPluginInput(session), { failureThreshold: 2 });
    await plugin.config(createMockConfig());
    await plugin.event({ event: errorToolPartEvent("sess-advfail", "asst-msg", "read", "e1", "c1") });
    await plugin.event({ event: errorToolPartEvent("sess-advfail", "asst-msg", "read", "e2", "c2") });
    await new Promise((resolve) => { setTimeout(resolve, 100); });
    const resumePrompts = recording.prompts.filter((p) => "test-agent" === p.agent).length;
    t.is(resumePrompts, 1, "resume occurs despite advisor failure");
    const resumeText = recording.prompts.find((p) => "test-agent" === p.agent)?.text;
    t.truthy(resumeText, "resume text exists");
    t.falsy((resumeText ?? "").includes("Advisor error"), "must not contain raw Advisor error");
    t.truthy((resumeText ?? "").includes("reassess") || (resumeText ?? "").includes("Continue"), "must contain fallback guidance");
});
test.serial("event: session.deleted prevents resume", async (t) => {
    const msgsData = [
        { info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [{ type: "text", text: "Task" }] },
        { info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
    ];
    const recording = createPromptRecording();
    const session = createMockSession({
        messages: (async () => ({ data: msgsData })),
        abort: (async () => ({ data: true })),
        prompt: (async (args) => {
            const body = args.body;
            recording.prompts.push({
                sessionID: args.path?.id,
                agent: body.agent,
                text: body.parts?.[0]?.text,
            });
            return { data: { parts: [{ type: "text", text: "Advice" }] } };
        }),
    });
    const plugin = await AdvisorPlugin(createPluginInput(session), { failureThreshold: 2 });
    await plugin.config(createMockConfig());
    await plugin.event({ event: errorToolPartEvent("sess-del", "asst-msg", "read", "e1", "c1") });
    await plugin.event({ event: errorToolPartEvent("sess-del", "asst-msg", "read", "e2", "c2") });
    await new Promise((resolve) => { setTimeout(resolve, 30); });
    await plugin.event({ event: sessionDeletedEvent("sess-del") });
    await plugin.event({ event: sessionIdleEvent("sess-del") });
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    const resumePrompts = recording.prompts.filter((p) => "test-agent" === p.agent).length;
    t.is(resumePrompts, 0, "no resume after session deletion");
});
test.serial("event: tool events ignored during intervention, completed before resume re-arms", async (t) => {
    const msgsData = [
        { info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [{ type: "text", text: "Task" }] },
        { info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
    ];
    const recording = createPromptRecording();
    let resolveAbort = () => { };
    const abortDeferred = new Promise((resolve) => {
        resolveAbort = resolve;
    });
    const session = createMockSession({
        messages: (async () => ({ data: msgsData })),
        abort: (async () => {
            await abortDeferred;
            return { data: true };
        }),
        status: (async () => ({
            data: { "sess-gate": { type: "idle" } },
        })),
        prompt: (async (args) => {
            const body = args.body;
            recording.prompts.push({
                sessionID: args.path?.id,
                agent: body.agent,
                text: body.parts?.[0]?.text,
            });
            return { data: { parts: [{ type: "text", text: "Advice" }] } };
        }),
    });
    const plugin = await AdvisorPlugin(createPluginInput(session), { failureThreshold: 1 });
    await plugin.config(createMockConfig());
    await plugin.event({ event: errorToolPartEvent("sess-gate", "asst-msg", "read", "e1", "c1") });
    await new Promise((resolve) => { setTimeout(resolve, 30); });
    await plugin.event({ event: errorToolPartEvent("sess-gate", "asst-msg", "read", "e2", "c2") });
    await plugin.event({ event: errorToolPartEvent("sess-gate", "asst-msg", "read", "e3", "c3") });
    resolveAbort(undefined);
    await new Promise((resolve) => { setTimeout(resolve, 100); });
    await plugin.event({ event: completedToolPartEvent("sess-gate", "asst-msg", "read", "c4") });
    let abortCallCount = 0;
    session.abort = (async () => {
        abortCallCount++;
        return { data: true };
    });
    await plugin.event({ event: errorToolPartEvent("sess-gate", "asst-msg", "read", "e4", "c5") });
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    t.is(abortCallCount, 1, "completed tool re-arms the feature");
});
test.serial("event: abort rejection still clears intervening", async (t) => {
    const msgsData = [
        { info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [{ type: "text", text: "Task" }] },
        { info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
    ];
    const session = createMockSession({
        messages: (async () => ({ data: msgsData })),
        abort: (async () => {
            throw new Error("Abort failed");
        }),
    });
    const plugin = await AdvisorPlugin(createPluginInput(session), { failureThreshold: 1 });
    await plugin.config(createMockConfig());
    await plugin.event({ event: errorToolPartEvent("sess-abrej", "asst-msg", "read", "err", "c1") });
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    await plugin.event({ event: completedToolPartEvent("sess-abrej", "asst-msg", "read", "c2") });
    let abortCallCount = 0;
    session.abort = (async () => {
        abortCallCount++;
        return { data: true };
    });
    await plugin.event({ event: errorToolPartEvent("sess-abrej", "asst-msg", "read", "err2", "c3") });
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    t.is(abortCallCount, 1, "abort rejection recovery allows later intervention");
});
test.serial("event: status rejection waits for idle event", async (t) => {
    const msgsData = [
        { info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [{ type: "text", text: "Task" }] },
        { info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
    ];
    const recording = createPromptRecording();
    const session = createMockSession({
        messages: (async () => ({ data: msgsData })),
        abort: (async () => ({ data: true })),
        status: (async () => {
            throw new Error("Status error");
        }),
        prompt: (async (args) => {
            const body = args.body;
            recording.prompts.push({
                sessionID: args.path?.id,
                agent: body.agent,
                text: body.parts?.[0]?.text,
            });
            return { data: { parts: [{ type: "text", text: "Advice" }] } };
        }),
    });
    const plugin = await AdvisorPlugin(createPluginInput(session), { failureThreshold: 2 });
    await plugin.config(createMockConfig());
    await plugin.event({ event: errorToolPartEvent("sess-statfail", "asst-msg", "read", "e1", "c1") });
    await plugin.event({ event: errorToolPartEvent("sess-statfail", "asst-msg", "read", "e2", "c2") });
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    await plugin.event({ event: sessionIdleEvent("sess-statfail") });
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    const resumePrompts = recording.prompts.filter((p) => "test-agent" === p.agent).length;
    t.is(resumePrompts, 1, "resume occurs after idle event despite status failure");
});
test.serial("event: messages failure clears intervention", async (t) => {
    const session = createMockSession({
        messages: (async () => {
            throw new Error("Messages error");
        }),
    });
    const plugin = await AdvisorPlugin(createPluginInput(session), { failureThreshold: 1 });
    await plugin.config(createMockConfig());
    await plugin.event({ event: errorToolPartEvent("sess-msgerr", "asst-msg", "read", "err", "c1") });
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    t.pass("messages failure handled gracefully");
});
test.serial("event: completed tool creates state if none exists", async (t) => {
    const msgsData = [
        { info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [{ type: "text", text: "Task" }] },
        { info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
    ];
    let abortCallCount = 0;
    const session = createMockSession({
        messages: (async () => ({ data: msgsData })),
        abort: (async () => {
            abortCallCount++;
            return { data: true };
        }),
    });
    const plugin = await AdvisorPlugin(createPluginInput(session), { failureThreshold: 2 });
    await plugin.config(createMockConfig());
    await plugin.event({ event: completedToolPartEvent("sess-fresh", "asst-msg", "read", "c1") });
    await plugin.event({ event: errorToolPartEvent("sess-fresh", "asst-msg", "read", "e1", "c2") });
    await plugin.event({ event: errorToolPartEvent("sess-fresh", "asst-msg", "read", "e2", "c3") });
    await new Promise((resolve) => { setTimeout(resolve, 100); });
    t.is(abortCallCount, 1, "completed-initiated state still tracks errors");
});
test.serial("event: failures array shift when exceeding threshold", async (t) => {
    const msgsData = [
        { info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [{ type: "text", text: "Task" }] },
        { info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
    ];
    const session = createMockSession({
        messages: (async () => ({ data: msgsData })),
        abort: (async () => ({ data: true })),
        status: (async () => ({
            data: { "sess-shift": { type: "idle" } },
        })),
    });
    const plugin = await AdvisorPlugin(createPluginInput(session), { failureThreshold: 2 });
    await plugin.config(createMockConfig());
    await plugin.event({ event: errorToolPartEvent("sess-shift", "asst-msg", "read", "e1", "c1") });
    await plugin.event({ event: errorToolPartEvent("sess-shift", "asst-msg", "read", "e2", "c2") });
    await new Promise((resolve) => { setTimeout(resolve, 100); });
    await plugin.event({ event: errorToolPartEvent("sess-shift", "asst-msg", "read", "e3", "c3") });
    t.pass("failure shift exercised");
});
test.serial("event: session.status idle triggers resume", async (t) => {
    const msgsData = [
        { info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [{ type: "text", text: "Task" }] },
        { info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
    ];
    const recording = createPromptRecording();
    const session = createMockSession({
        messages: (async () => ({ data: msgsData })),
        abort: (async () => ({ data: true })),
        status: (async () => ({ data: {} })),
        prompt: (async (args) => {
            const body = args.body;
            recording.prompts.push({
                sessionID: args.path?.id,
                agent: body.agent,
                text: body.parts?.[0]?.text,
            });
            return { data: { parts: [{ type: "text", text: "Advice" }] } };
        }),
    });
    const plugin = await AdvisorPlugin(createPluginInput(session), { failureThreshold: 2 });
    await plugin.config(createMockConfig());
    await plugin.event({ event: errorToolPartEvent("sess-statidle", "asst-msg", "read", "e1", "c1") });
    await plugin.event({ event: errorToolPartEvent("sess-statidle", "asst-msg", "read", "e2", "c2") });
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    await plugin.event({ event: { type: "session.status", properties: { sessionID: "sess-statidle", status: { type: "idle" } } } });
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    const resumePrompts = recording.prompts.filter((p) => "test-agent" === p.agent).length;
    t.is(resumePrompts, 1, "session.status idle triggers resume");
});
test.serial("event: session.status busy prevents idle false -> resume on idle", async (t) => {
    const msgsData = [
        { info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [{ type: "text", text: "Task" }] },
        { info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
    ];
    const recording = createPromptRecording();
    const session = createMockSession({
        messages: (async () => ({ data: msgsData })),
        abort: (async () => ({ data: true })),
        status: (async () => ({
            data: { "sess-busy": { type: "busy" } },
        })),
        prompt: (async (args) => {
            const body = args.body;
            recording.prompts.push({
                sessionID: args.path?.id,
                agent: body.agent,
                text: body.parts?.[0]?.text,
            });
            return { data: { parts: [{ type: "text", text: "Advice" }] } };
        }),
    });
    const plugin = await AdvisorPlugin(createPluginInput(session), { failureThreshold: 2 });
    await plugin.config(createMockConfig());
    await plugin.event({ event: errorToolPartEvent("sess-busy", "asst-msg", "read", "e1", "c1") });
    await plugin.event({ event: errorToolPartEvent("sess-busy", "asst-msg", "read", "e2", "c2") });
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    await plugin.event({ event: { type: "session.status", properties: { sessionID: "sess-busy", status: { type: "busy" } } } });
    await plugin.event({ event: sessionIdleEvent("sess-busy") });
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    const resumePrompts = recording.prompts.filter((p) => "test-agent" === p.agent).length;
    t.is(resumePrompts, 1, "resume after busy->idle transition");
});
test.serial("event: intervention with empty transcript uses fallback input", async (t) => {
    const msgsData = [
        { info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [{ type: "tool-use", text: "tool output" }] },
        { info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
    ];
    const recording = createPromptRecording();
    const session = createMockSession({
        messages: (async () => ({ data: msgsData })),
        abort: (async () => ({ data: true })),
        status: (async () => ({
            data: { "sess-noctx": { type: "idle" } },
        })),
        prompt: (async (args) => {
            const body = args.body;
            recording.prompts.push({
                sessionID: args.path?.id,
                agent: body.agent,
                text: body.parts?.[0]?.text,
            });
            return { data: { parts: [{ type: "text", text: "Advice" }] } };
        }),
    });
    const plugin = await AdvisorPlugin(createPluginInput(session), { failureThreshold: 1 });
    await plugin.config(createMockConfig());
    await plugin.event({ event: errorToolPartEvent("sess-noctx", "asst-msg", "read", "err", "c1") });
    await new Promise((resolve) => { setTimeout(resolve, 100); });
    const advisorPrompt = recording.prompts.find((p) => "opencode-advisor:advisor" === p.agent && undefined !== p.text);
    t.truthy(advisorPrompt, "advisor was prompted");
    t.truthy(advisorPrompt.text.includes("Tool failures"), "should use fallback format");
    t.truthy(advisorPrompt.text.includes("err"), "should include error message");
});
test.serial("event: session.status retry sets idle false", async (t) => {
    const msgsData = [
        { info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [{ type: "text", text: "Task" }] },
        { info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
    ];
    const recording = createPromptRecording();
    let resolveAbort2 = () => { };
    const abortDeferred2 = new Promise((resolve) => {
        resolveAbort2 = resolve;
    });
    const session = createMockSession({
        messages: (async () => ({ data: msgsData })),
        abort: (async () => {
            await abortDeferred2;
            return { data: true };
        }),
        status: (async () => ({
            data: {},
        })),
        prompt: (async (args) => {
            const body = args.body;
            recording.prompts.push({
                sessionID: args.path?.id,
                agent: body.agent,
                text: body.parts?.[0]?.text,
            });
            return { data: { parts: [{ type: "text", text: "Advice" }] } };
        }),
    });
    const plugin = await AdvisorPlugin(createPluginInput(session), { failureThreshold: 2 });
    await plugin.config(createMockConfig());
    await plugin.event({ event: errorToolPartEvent("sess-retry", "asst-msg", "read", "e1", "c1") });
    await plugin.event({ event: errorToolPartEvent("sess-retry", "asst-msg", "read", "e2", "c2") });
    await new Promise((resolve) => { setTimeout(resolve, 30); });
    resolveAbort2(undefined);
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    await plugin.event({ event: { type: "session.status", properties: { sessionID: "sess-retry", status: { type: "retry", attempt: 1, message: "", next: 0 } } } });
    await new Promise((resolve) => { setTimeout(resolve, 30); });
    const resumeRetry = recording.prompts.filter((p) => "test-agent" === p.agent).length;
    t.is(resumeRetry, 0, "no resume after retry status");
    await plugin.event({ event: sessionIdleEvent("sess-retry") });
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    const resumePrompts = recording.prompts.filter((p) => "test-agent" === p.agent).length;
    t.is(resumePrompts, 1, "resume after retry->idle transition");
});
test.serial("event: idle before abort resolves does not cause premature resume", async (t) => {
    const msgsData = [
        { info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [{ type: "text", text: "Task" }] },
        { info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
    ];
    const recording = createPromptRecording();
    let resolveAbortReg = () => { };
    const abortDeferredReg = new Promise((resolve) => {
        resolveAbortReg = resolve;
    });
    const session = createMockSession({
        messages: (async () => ({ data: msgsData })),
        abort: (async () => {
            await abortDeferredReg;
            return { data: true };
        }),
        status: (async () => ({
            data: { "sess-bfra": { type: "busy" } },
        })),
        prompt: (async (args) => {
            const body = args.body;
            recording.prompts.push({
                sessionID: args.path?.id,
                agent: body.agent,
                text: body.parts?.[0]?.text,
            });
            return { data: { parts: [{ type: "text", text: "Advice" }] } };
        }),
    });
    const plugin = await AdvisorPlugin(createPluginInput(session), { failureThreshold: 1 });
    await plugin.config(createMockConfig());
    await plugin.event({ event: errorToolPartEvent("sess-bfra", "asst-msg", "read", "err", "c1") });
    await new Promise((resolve) => { setTimeout(resolve, 30); });
    await plugin.event({ event: sessionIdleEvent("sess-bfra") });
    await new Promise((resolve) => { setTimeout(resolve, 30); });
    const resumeBeforeAbort = recording.prompts.filter((p) => "test-agent" === p.agent).length;
    t.is(resumeBeforeAbort, 0, "no resume during pending abort despite idle event");
    resolveAbortReg(undefined);
    await new Promise((resolve) => { setTimeout(resolve, 100); });
    const resumeAfterBusyStatus = recording.prompts.filter((p) => "test-agent" === p.agent).length;
    t.is(resumeAfterBusyStatus, 0, "no resume when status reports busy after abort");
    await plugin.event({ event: sessionIdleEvent("sess-bfra") });
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    const resumeFinal = recording.prompts.filter((p) => "test-agent" === p.agent).length;
    t.is(resumeFinal, 1, "exactly one resume after post-abort idle");
});
test.serial("event: missing temp session uses fallback not Advisor error string", async (t) => {
    const msgsData = [
        { info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [{ type: "text", text: "Task" }] },
        { info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
    ];
    const recording = createPromptRecording();
    const session = createMockSession({
        messages: (async () => ({ data: msgsData })),
        abort: (async () => ({ data: true })),
        status: (async () => ({
            data: { "sess-notemp": { type: "idle" } },
        })),
        create: (async () => ({ data: {} })),
        prompt: (async (args) => {
            const body = args.body;
            recording.prompts.push({
                sessionID: args.path?.id,
                agent: body.agent,
                text: body.parts?.[0]?.text,
            });
            return { data: { parts: [{ type: "text", text: "ignored" }] } };
        }),
    });
    const plugin = await AdvisorPlugin(createPluginInput(session), { failureThreshold: 1 });
    await plugin.config(createMockConfig());
    await plugin.event({ event: errorToolPartEvent("sess-notemp", "asst-msg", "read", "err", "c1") });
    await new Promise((resolve) => { setTimeout(resolve, 100); });
    const resumePrompt = recording.prompts.find((p) => "test-agent" === p.agent);
    t.truthy(resumePrompt, "resume prompt exists despite missing temp session");
    t.falsy((resumePrompt.text ?? "").includes("Advisor error"), "must not contain raw Advisor error string");
    t.truthy((resumePrompt.text ?? "").includes("reassess") || (resumePrompt.text ?? "").includes("Continue"), "must contain fallback guidance");
});
test.serial("event: empty advisor response uses fallback not Advisor returned no advice", async (t) => {
    const msgsData = [
        { info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [{ type: "text", text: "Task" }] },
        { info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
    ];
    const recording = createPromptRecording();
    const session = createMockSession({
        messages: (async () => ({ data: msgsData })),
        abort: (async () => ({ data: true })),
        status: (async () => ({
            data: { "sess-emptxt": { type: "idle" } },
        })),
        prompt: (async (args) => {
            const body = args.body;
            recording.prompts.push({
                sessionID: args.path?.id,
                agent: body.agent,
                text: body.parts?.[0]?.text,
            });
            return { data: { parts: [{ type: "text", text: "" }] } };
        }),
    });
    const plugin = await AdvisorPlugin(createPluginInput(session), { failureThreshold: 1 });
    await plugin.config(createMockConfig());
    await plugin.event({ event: errorToolPartEvent("sess-emptxt", "asst-msg", "read", "err", "c1") });
    await new Promise((resolve) => { setTimeout(resolve, 100); });
    const resumePrompt = recording.prompts.find((p) => "test-agent" === p.agent);
    t.truthy(resumePrompt, "resume prompt exists despite empty advisor response");
    t.falsy((resumePrompt.text ?? "").includes("Advisor returned no advice"), "must not contain raw empty-response string");
    t.truthy((resumePrompt.text ?? "").includes("reassess") || (resumePrompt.text ?? "").includes("Continue"), "must contain fallback guidance");
});
test.serial("event: stale status busy after idle event does not overwrite idle", async (t) => {
    const msgsData = [
        { info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [{ type: "text", text: "Task" }] },
        { info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
    ];
    const recording = createPromptRecording();
    let resolveStatusStale = () => { };
    const statusDeferred = new Promise((resolve) => {
        resolveStatusStale = resolve;
    });
    const session = createMockSession({
        messages: (async () => ({ data: msgsData })),
        abort: (async () => ({ data: true })),
        status: (async () => {
            await statusDeferred;
            return { data: { "sess-stale": { type: "busy" } } };
        }),
        prompt: (async (args) => {
            const body = args.body;
            recording.prompts.push({
                sessionID: args.path?.id,
                agent: body.agent,
                text: body.parts?.[0]?.text,
            });
            return { data: { parts: [{ type: "text", text: "Advice" }] } };
        }),
    });
    const plugin = await AdvisorPlugin(createPluginInput(session), { failureThreshold: 1 });
    await plugin.config(createMockConfig());
    await plugin.event({ event: errorToolPartEvent("sess-stale", "asst-msg", "read", "err", "c1") });
    await new Promise((resolve) => { setTimeout(resolve, 30); });
    await plugin.event({ event: sessionIdleEvent("sess-stale") });
    await new Promise((resolve) => { setTimeout(resolve, 30); });
    resolveStatusStale(undefined);
    await new Promise((resolve) => { setTimeout(resolve, 100); });
    const resumePrompts = recording.prompts.filter((p) => "test-agent" === p.agent).length;
    t.is(resumePrompts, 1, "resume fires despite stale busy status response");
});
test.serial("event: post-abort idle followed by busy status event before advice blocks resume", async (t) => {
    const msgsData = [
        { info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [{ type: "text", text: "Task" }] },
        { info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
    ];
    const recording = createPromptRecording();
    let resolvePromptDelay = () => { };
    const promptDeferred = new Promise((resolve) => {
        resolvePromptDelay = resolve;
    });
    let promptCallCountEvent = 0;
    const session = createMockSession({
        messages: (async () => ({ data: msgsData })),
        abort: (async () => ({ data: true })),
        status: (async () => ({
            data: { "sess-busy2": { type: "idle" } },
        })),
        prompt: (async (args) => {
            promptCallCountEvent++;
            const body = args.body;
            const sessID = args.path?.id ?? "";
            recording.prompts.push({
                sessionID: sessID,
                agent: body.agent,
                text: body.parts?.[0]?.text,
            });
            if (1 === promptCallCountEvent) {
                await promptDeferred;
            }
            return { data: { parts: [{ type: "text", text: "Advice2" }] } };
        }),
    });
    const plugin = await AdvisorPlugin(createPluginInput(session), { failureThreshold: 1 });
    await plugin.config(createMockConfig());
    await plugin.event({ event: errorToolPartEvent("sess-busy2", "asst-msg", "read", "err", "c1") });
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    await plugin.event({ event: { type: "session.status", properties: { sessionID: "sess-busy2", status: { type: "busy" } } } });
    await new Promise((resolve) => { setTimeout(resolve, 30); });
    const resumeAfterBusy = recording.prompts.filter((p) => "test-agent" === p.agent).length;
    t.is(resumeAfterBusy, 0, "no resume after post-abort idle then busy event");
    resolvePromptDelay(undefined);
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    const resumeAfterAdvice = recording.prompts.filter((p) => "test-agent" === p.agent).length;
    t.is(resumeAfterAdvice, 0, "no resume after advisor completes while idle=false");
    await plugin.event({ event: sessionIdleEvent("sess-busy2") });
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    const resumeFinalEvent = recording.prompts.filter((p) => "test-agent" === p.agent).length;
    t.is(resumeFinalEvent, 1, "exactly one resume after subsequent idle event");
});
test.serial("event: pre-abort idle ignored, post-abort status busy blocks until later idle", async (t) => {
    const msgsData = [
        { info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [{ type: "text", text: "Task" }] },
        { info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
    ];
    const recording = createPromptRecording();
    let resolveAbortPre = () => { };
    const abortDeferredPre = new Promise((resolve) => {
        resolveAbortPre = resolve;
    });
    const session = createMockSession({
        messages: (async () => ({ data: msgsData })),
        abort: (async () => {
            await abortDeferredPre;
            return { data: true };
        }),
        status: (async () => ({
            data: { "sess-bfra2": { type: "busy" } },
        })),
        prompt: (async (args) => {
            const body = args.body;
            recording.prompts.push({
                sessionID: args.path?.id,
                agent: body.agent,
                text: body.parts?.[0]?.text,
            });
            return { data: { parts: [{ type: "text", text: "Advice3" }] } };
        }),
    });
    const plugin = await AdvisorPlugin(createPluginInput(session), { failureThreshold: 1 });
    await plugin.config(createMockConfig());
    await plugin.event({ event: errorToolPartEvent("sess-bfra2", "asst-msg", "read", "err", "c1") });
    await new Promise((resolve) => { setTimeout(resolve, 30); });
    await plugin.event({ event: sessionIdleEvent("sess-bfra2") });
    await new Promise((resolve) => { setTimeout(resolve, 30); });
    resolveAbortPre(undefined);
    await new Promise((resolve) => { setTimeout(resolve, 100); });
    const resumeAfterBusyPre = recording.prompts.filter((p) => "test-agent" === p.agent).length;
    t.is(resumeAfterBusyPre, 0, "no resume with pre-abort idle and post-abort busy status");
    await plugin.event({ event: sessionIdleEvent("sess-bfra2") });
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    const resumeFinalPre = recording.prompts.filter((p) => "test-agent" === p.agent).length;
    t.is(resumeFinalPre, 1, "exactly one resume after post-abort idle");
});
