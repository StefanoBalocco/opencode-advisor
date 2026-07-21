import { tool } from "@opencode-ai/plugin";
const defaultModel = "deepseek/deepseek-v4-pro";
const advisorAgent = "opencode-advisor:advisor";
const advisorDefaultPrompt = `You are a strategic advisor for a coding agent. Read the conversation transcript and provide a concise plan or course correction.

Your advice must be actionable — tell the executor:
- What to do next
- What order to proceed in
- What to watch out for
- What not to do

Key heuristics:
- Prefer the simplest approach that meets the spec
- Flag approaches that create maintenance burden
- If the executor is stuck or looping, suggest a different approach
- If tests or evidence contradict an assumption, say so explicitly

You may use read-only tools (read, glob, grep, webfetch, websearch, skill) to inspect the workspace or public web for better context. You may NOT edit files or run arbitrary commands beyond read-only shell commands.

Respond in under 300 words. Use enumerated steps. Do NOT write code or edit files — only advise.`;
const advisorToolDescription = `Consult a strategic advisor backed by a configurable reviewer model. It reads your full conversation context and provides a concise plan or course correction.

Call advisor BEFORE substantive work — before writing code, editing files, committing to an interpretation, or building on an assumption. If the task requires orientation first (finding files, reading code, fetching docs), do that, then call advisor. Orientation is NOT substantive work.

Also call advisor:
- When stuck — errors recurring, approach not converging, results that don't fit
- When considering a change of approach
- When you believe the task is complete. BEFORE this call, make your deliverable durable: write the file, save the result, commit the change

On tasks longer than a few steps, call advisor at least once before committing to an approach and once before declaring done. On short reactive turns where tool output directly dictates the next action, skip advisor.

Give the advice serious weight. Only override if you have primary-source evidence that contradicts a specific claim. Surface conflicts in another advisor call rather than silently switching approaches.`;
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
export const AdvisorPlugin = async ({ client }, rawOptions) => {
    const advisorProfile = parseProfile(rawOptions, "plugin options");
    return {
        config: async (cfg) => {
            const advisorCfg = buildAgentConfig(advisorProfile, advisorDefaultPrompt, cfg);
            const agents = cfg.agent ?? {};
            agents[advisorAgent] = advisorCfg;
            cfg.agent = agents;
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
                                const createRes = await client.session.create({
                                    body: { title: "advisor-subcall" },
                                });
                                const tempID = createRes.data?.id;
                                if (!tempID) {
                                    returnValue = "Advisor error: failed to create ephemeral session.";
                                }
                                else {
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
                                        await client.session
                                            .delete({ path: { id: tempID } })
                                            .catch(() => { });
                                    }
                                }
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
//# sourceMappingURL=plugin.js.map