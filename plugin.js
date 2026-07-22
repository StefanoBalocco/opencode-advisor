import { tool } from "@opencode-ai/plugin";
const defaultModel = "deepseek/deepseek-v4-pro";
const defaultFailureThreshold = 3;
const advisorAgent = "opencode-advisor:advisor";
const advisorDefaultPrompt = `Act as a strategic advisor to a coding agent. Read the conversation transcript, identify the current objective, and provide a concise plan or course correction.

Give the executor clear, ordered instructions. State what to do next, the sequence to follow, the main risks, and the actions to avoid. Prefer the simplest solution that satisfies the specification. Flag choices that add unnecessary code, indirection, or maintenance burden. When the executor is stuck, repeating failed attempts, or following a disproved assumption, redirect the approach. State plainly when tests, logs, or other evidence contradict the current reasoning.

Use read-only tools only when they add necessary context. You may inspect the workspace with "read", "glob", and "grep", consult public sources with "webfetch" and "websearch", and load relevant skills. Do not edit files, change system state, or run commands other than read-only shell commands.

Respond in fewer than 300 words. Use numbered steps. Do not write code; provide advice only.`;
const advisorToolDescription = `Consult a strategic advisor that reads the full conversation and returns a concise plan or course correction.

Call "advisor" before substantive work: writing code, editing files, choosing an interpretation, or relying on an unverified assumption. Complete only the orientation needed to inform the review—locate files, read code, or fetch documentation—then call the advisor. Orientation is not substantive work.

Call it again when the approach stalls, errors recur, results contradict expectations, or a different direction appears necessary. Request a final review before declaring the task complete. First preserve the deliverable in its proper durable form by saving files or results and committing only when the task requires a commit.

For tasks longer than a few steps, consult the advisor before choosing an approach and again before completion. Skip it only on short, reactive turns where tool output directly determines the next action.

Give the advice serious weight. Override a specific recommendation only when primary-source evidence disproves it. Present the conflict in another advisor call instead of changing course silently.`;
const fixedPermission = {
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
        "rtk git show *": "allow",
    },
};
const fixedTools = {
    read: true,
    glob: true,
    grep: true,
    webfetch: true,
    websearch: true,
    skill: true,
    edit: false,
};
const profileKeys = new Set([
    "model",
    "variant",
    "prompt",
    "temperature",
    "top_p",
    "options",
    "failureThreshold",
]);
function assertString(v, label, allowEmpty = false) {
    if ("string" === typeof v) {
        if (!allowEmpty && (0 === v.length)) {
            throw new Error(`${label}: must not be empty`);
        }
    }
    else {
        throw new Error(`${label}: must be a string, got ${typeof v}`);
    }
}
function assertFiniteNumber(v, label) {
    if ("number" === typeof v) {
        if (!Number.isFinite(v)) {
            throw new Error(`${label}: must be a finite number, got ${v}`);
        }
    }
    else {
        throw new Error(`${label}: must be a finite number, got ${typeof v}`);
    }
}
function isPlainObject(v) {
    return ("object" === typeof v) && (null !== v) && !Array.isArray(v) &&
        ((Object.prototype === Object.getPrototypeOf(v)) || (null === Object.getPrototypeOf(v)));
}
function assertValidOptionsValue(v, path) {
    if (null === v) {
    }
    else if ("boolean" === typeof v) {
    }
    else if ("string" === typeof v) {
    }
    else if ("number" === typeof v) {
        if (!Number.isFinite(v)) {
            throw new Error(`${path}: must be a finite number`);
        }
    }
    else if (Array.isArray(v)) {
        for (let iL1 = 0; iL1 < v.length; iL1++) {
            assertValidOptionsValue(v[iL1], `${path}[${iL1}]`);
        }
    }
    else if (isPlainObject(v)) {
        const keys = Object.keys(v);
        for (let iL1 = 0; iL1 < keys.length; iL1++) {
            assertValidOptionsValue(v[keys[iL1]], `${path}.${keys[iL1]}`);
        }
    }
    else {
        throw new Error(`${path}: invalid option type ${typeof v}`);
    }
}
function assertValidOptions(v, path) {
    if (isPlainObject(v)) {
        const keys = Object.keys(v);
        for (let iL1 = 0; iL1 < keys.length; iL1++) {
            assertValidOptionsValue(v[keys[iL1]], `${path}.${keys[iL1]}`);
        }
    }
    else {
        throw new Error(`${path}: must be a non-array object, got ${null === v ? "null" : typeof v}`);
    }
}
function parseProfile(value, section) {
    let returnValue;
    if (isPlainObject(value)) {
        const obj = value;
        const objKeys = Object.keys(obj);
        for (let iL1 = 0; iL1 < objKeys.length; iL1++) {
            if (!profileKeys.has(objKeys[iL1])) {
                throw new Error(`${section}: unknown key "${objKeys[iL1]}". Allowed: ${Array.from(profileKeys).join(", ")}`);
            }
        }
        const profile = {};
        if (undefined !== obj.model) {
            assertString(obj.model, `${section}.model`);
            const slashIdx = obj.model.indexOf("/");
            if ((0 >= slashIdx) || ((obj.model.length - 1) <= slashIdx)) {
                throw new Error(`${section}.model: must be "provider/model", got "${obj.model}"`);
            }
            profile.model = obj.model;
        }
        if (undefined !== obj.variant) {
            assertString(obj.variant, `${section}.variant`, true);
            profile.variant = obj.variant;
        }
        if (undefined !== obj.prompt) {
            assertString(obj.prompt, `${section}.prompt`, true);
            profile.prompt = obj.prompt;
        }
        if (undefined !== obj.temperature) {
            assertFiniteNumber(obj.temperature, `${section}.temperature`);
            profile.temperature = obj.temperature;
        }
        if (undefined !== obj.top_p) {
            assertFiniteNumber(obj.top_p, `${section}.top_p`);
            profile.top_p = obj.top_p;
        }
        if (undefined !== obj.options) {
            assertValidOptions(obj.options, `${section}.options`);
            profile.options = structuredClone(obj.options);
        }
        if (undefined !== obj.failureThreshold) {
            assertFiniteNumber(obj.failureThreshold, `${section}.failureThreshold`);
            if (!Number.isInteger(obj.failureThreshold) || (1 > obj.failureThreshold)) {
                throw new Error(`${section}.failureThreshold: must be a positive integer`);
            }
            profile.failureThreshold = obj.failureThreshold;
        }
        returnValue = profile;
    }
    else if (undefined === value) {
        returnValue = {};
    }
    else if (null === value) {
        throw new Error(`${section}: must be a non-array object when present; got null`);
    }
    else {
        throw new Error(`${section}: must be a non-array object when present`);
    }
    return returnValue;
}
function resolveModel(profileModel, pluginCfg) {
    let returnValue;
    if (undefined !== profileModel) {
        returnValue = profileModel;
    }
    else {
        const planModel = pluginCfg?.agent?.plan?.model;
        if ("string" === typeof planModel && planModel.includes("/")) {
            returnValue = planModel;
        }
        else if ("string" === typeof pluginCfg?.model && pluginCfg.model.includes("/")) {
            returnValue = pluginCfg.model;
        }
        else {
            returnValue = undefined;
        }
    }
    return returnValue;
}
function buildAgentConfig(profile, defaultPrompt, pluginCfg) {
    const model = resolveModel(profile.model, pluginCfg) ?? defaultModel;
    const agentCfg = {
        model,
        prompt: profile.prompt ?? defaultPrompt,
        temperature: profile.temperature ?? 0,
        mode: "subagent",
        hidden: true,
        tools: { ...fixedTools },
    };
    if (undefined !== profile.top_p) {
        agentCfg.top_p = profile.top_p;
    }
    if (undefined !== profile.variant) {
        agentCfg.variant = profile.variant;
    }
    if (undefined !== profile.options) {
        agentCfg.options = structuredClone(profile.options);
    }
    agentCfg.permission = { ...fixedPermission };
    return agentCfg;
}
let inAdvisorCall = false;
function formatTranscript(messages, excludeID) {
    return messages
        .filter((m) => m.info.id !== excludeID)
        .map((m) => {
        const text = m.parts
            .filter((p) => "text" === p.type)
            .map((p) => p.text ?? "")
            .join("");
        const role = "user" === m.info.role ? "User" : "Assistant";
        return `${role}: ${text}`;
    })
        .filter((s) => {
        const afterColon = s.indexOf(": ");
        return (-1 !== afterColon) && (s.length > (afterColon + 2));
    })
        .join("\n\n");
}
function textPart(t) {
    return { type: "text", text: t };
}
function createSessionState() {
    return {
        count: 0,
        failures: [],
        triggered: false,
        intervening: false,
        awaitingIdle: false,
        idle: false,
        idleGeneration: 0,
        deleted: false,
        sourceAgent: "",
        advice: "",
    };
}
export const AdvisorPlugin = async ({ client }, rawOptions) => {
    const advisorProfile = parseProfile(rawOptions, "plugin options");
    const failureThreshold = advisorProfile.failureThreshold ?? defaultFailureThreshold;
    const advisorSessions = new Set();
    const sessionStates = new Map();
    let resolvedCfg;
    async function _callAdvisor(transcript) {
        let returnValue;
        const createRes = await client.session.create({
            body: { title: "advisor-subcall" },
        });
        const tempID = createRes.data?.id;
        if (!tempID) {
            returnValue = "Advisor error: failed to create ephemeral session.";
        }
        else {
            advisorSessions.add(tempID);
            try {
                const response = await client.session.prompt({
                    path: { id: tempID },
                    body: {
                        agent: advisorAgent,
                        parts: [textPart(transcript)],
                    },
                });
                const text = response.data?.parts
                    ?.filter((p) => "text" === p.type)
                    .map((p) => p.text)
                    .join("\n");
                returnValue = text || "Advisor returned no advice.";
            }
            finally {
                advisorSessions.delete(tempID);
                await client.session
                    .delete({ path: { id: tempID } })
                    .catch(() => { });
            }
        }
        return returnValue;
    }
    function _maybeResume(sessionID, state) {
        if (!state.deleted && state.intervening && state.idle && state.sourceAgent && state.advice) {
            state.intervening = false;
            state.awaitingIdle = false;
            client.session.prompt({
                path: { id: sessionID },
                body: {
                    agent: state.sourceAgent,
                    parts: [textPart(state.advice + "\n\nContinue the task using this advice.")],
                },
            }).catch(() => { });
        }
    }
    async function _launchIntervention(sessionID, messageID, state) {
        let msgs;
        let fetchOk = true;
        try {
            const msgsRes = await client.session.messages({
                path: { id: sessionID },
            });
            msgs = msgsRes.data;
        }
        catch {
            fetchOk = false;
        }
        if (fetchOk && msgs) {
            let assistantMsgInfo;
            let userMsgInfo;
            let parentID;
            for (const msg of msgs) {
                if ("assistant" === msg.info.role && msg.info.id === messageID) {
                    assistantMsgInfo = msg;
                    break;
                }
            }
            if (assistantMsgInfo) {
                parentID = assistantMsgInfo.info.parentID;
            }
            if (parentID) {
                for (const msg of msgs) {
                    if ("user" === msg.info.role && msg.info.id === parentID) {
                        userMsgInfo = msg;
                        break;
                    }
                }
            }
            const sourceAgent = userMsgInfo?.info?.agent ?? "";
            if (sourceAgent) {
                let agentEligible = true;
                if (resolvedCfg?.agent?.[sourceAgent]?.tools?.advisor === false) {
                    agentEligible = false;
                }
                if (agentEligible) {
                    state.sourceAgent = sourceAgent;
                    let abortOk = false;
                    try {
                        const abortRes = await client.session.abort({
                            path: { id: sessionID },
                        });
                        abortOk = true === abortRes.data;
                    }
                    catch {
                        abortOk = false;
                    }
                    if (abortOk) {
                        state.awaitingIdle = true;
                        state.idle = false;
                        const capturedGeneration = state.idleGeneration;
                        try {
                            const statusRes = await client.session.status();
                            if (capturedGeneration === state.idleGeneration) {
                                const sessStatus = statusRes.data?.[sessionID];
                                if (sessStatus) {
                                    state.idle = ("idle" === sessStatus.type);
                                }
                                else {
                                    state.idle = false;
                                }
                            }
                        }
                        catch {
                        }
                        const transcript = formatTranscript(msgs, "");
                        const failureBlock = state.failures
                            .map((f) => `Tool: ${f.tool}\nError: ${f.error}`)
                            .join("\n\n");
                        const advisorInput = transcript
                            ? `${transcript}\n\n--- Recent tool failures ---\n${failureBlock}`
                            : `--- Tool failures ---\n${failureBlock}\n\nContinue the task reassessing the approach.`;
                        let advice;
                        try {
                            const rawAdvice = await _callAdvisor(advisorInput);
                            if ("Advisor returned no advice." === rawAdvice || "Advisor error: failed to create ephemeral session." === rawAdvice) {
                                advice = "Reassess the failed approach and continue working.";
                            }
                            else {
                                advice = rawAdvice;
                            }
                        }
                        catch {
                            advice = "Reassess the failed approach and continue working.";
                        }
                        state.advice = advice;
                        _maybeResume(sessionID, state);
                    }
                    else {
                        state.intervening = false;
                    }
                }
                else {
                    state.intervening = false;
                }
            }
            else {
                state.intervening = false;
            }
        }
        else {
            state.intervening = false;
        }
    }
    return {
        config: async (cfg) => {
            resolvedCfg = cfg;
            const advisorCfg = buildAgentConfig(advisorProfile, advisorDefaultPrompt, cfg);
            const agents = cfg.agent ?? {};
            agents[advisorAgent] = advisorCfg;
            cfg.agent = agents;
        },
        event: async ({ event }) => {
            if ("message.part.updated" === event.type) {
                const part = event.properties.part;
                if ("tool" === part.type && !advisorSessions.has(part.sessionID)) {
                    const sessionID = part.sessionID;
                    let state = sessionStates.get(sessionID);
                    if (state && state.intervening) {
                    }
                    else if ("error" === part.state.status) {
                        if ("advisor" !== part.tool) {
                            if (!state) {
                                state = createSessionState();
                                sessionStates.set(sessionID, state);
                            }
                            if (state.failures.length >= failureThreshold) {
                                state.failures.shift();
                            }
                            state.failures.push({ tool: part.tool, error: part.state.error });
                            state.count = state.failures.length;
                            if (state.count >= failureThreshold && !state.triggered) {
                                state.triggered = true;
                                state.intervening = true;
                                void _launchIntervention(sessionID, part.messageID, state);
                            }
                        }
                    }
                    else if ("completed" === part.state.status) {
                        if (!state) {
                            state = createSessionState();
                            sessionStates.set(sessionID, state);
                        }
                        state.count = 0;
                        state.failures = [];
                        state.triggered = false;
                    }
                }
            }
            else if ("session.idle" === event.type) {
                const sessID = event.properties.sessionID;
                const state = sessionStates.get(sessID);
                if (state && state.awaitingIdle) {
                    state.idleGeneration++;
                    state.idle = true;
                    _maybeResume(sessID, state);
                }
            }
            else if ("session.status" === event.type) {
                const sessID = event.properties.sessionID;
                const state = sessionStates.get(sessID);
                if (state && state.awaitingIdle) {
                    if ("idle" === event.properties.status.type) {
                        state.idleGeneration++;
                        state.idle = true;
                        _maybeResume(sessID, state);
                    }
                    else if ("busy" === event.properties.status.type || "retry" === event.properties.status.type) {
                        state.idleGeneration++;
                        state.idle = false;
                    }
                }
            }
            else if ("session.deleted" === event.type) {
                const sessID = event.properties.info.id;
                const state = sessionStates.get(sessID);
                if (state) {
                    state.deleted = true;
                }
                sessionStates.delete(sessID);
            }
        },
        tool: {
            advisor: tool({
                description: advisorToolDescription,
                args: {},
                async execute(_args, context) {
                    let returnValue;
                    if (inAdvisorCall) {
                        returnValue = "Error: advisor tool cannot be called recursively.";
                    }
                    else {
                        const sessionID = context.sessionID;
                        const messageID = context.messageID;
                        try {
                            inAdvisorCall = true;
                            const { data: messages } = await client.session.messages({
                                path: { id: sessionID },
                            });
                            const transcript = formatTranscript(messages ?? [], messageID);
                            if (!transcript) {
                                returnValue = "Advisor declined: no prior conversation to analyze.";
                            }
                            else {
                                returnValue = await _callAdvisor(transcript);
                            }
                        }
                        catch (err) {
                            returnValue = `Advisor error: ${String(err)}`;
                        }
                        finally {
                            inAdvisorCall = false;
                        }
                    }
                    return returnValue;
                },
            }),
        },
    };
};
export default AdvisorPlugin;
