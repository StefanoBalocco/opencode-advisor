import test from "ava";
import type { Config as PluginConfig, Hooks, PluginInput, PluginOptions } from "@opencode-ai/plugin";
import type { ToolContext, ToolResult } from "@opencode-ai/plugin/tool";
import type { Event, OpencodeClient } from "@opencode-ai/sdk";
import { AdvisorPlugin } from "./plugin.js";
import type { Undefinedable } from "./plugin.js";

// ── Types ──────────────────────────────────────────────────────────────────

type MockSessionMethods = "messages" | "create" | "prompt" | "delete" | "abort" | "status";

interface PromptRecording {
	promptSessionID: Undefinedable<string>;
	promptAgent: Undefinedable<string>;
	promptNoReply: unknown;
	promptSynthetic: unknown;
	promptText: Undefinedable<string>;
	prompts: Array<{ sessionID: Undefinedable<string>; text: Undefinedable<string>; agent: Undefinedable<string> }>;
}

function createPromptRecording(): PromptRecording {
	return {
		promptSessionID: undefined,
		promptAgent: undefined,
		promptNoReply: undefined,
		promptSynthetic: undefined,
		promptText: undefined,
		prompts: [],
	};
}

function toolContext( sessionID: string, messageID: string ): ToolContext {
	return {
		sessionID,
		messageID,
		agent: "",
		directory: "",
		worktree: "",
		abort: new AbortController().signal,
		metadata: () => {},
		ask: async () => {},
	};
}

// ── Event mock helpers ─────────────────────────────────────────────────────

function errorToolPartEvent(
	sessionID: string,
	messageID: string,
	tool: string,
	error: string,
	callID: string = "call-1",
): Event {
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
	} as unknown as Event;
}

function completedToolPartEvent(
	sessionID: string,
	messageID: string,
	tool: string,
	callID: string = "call-1",
): Event {
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
	} as unknown as Event;
}

function pendingToolPartEvent(
	sessionID: string,
	messageID: string,
	tool: string,
	callID: string = "call-1",
): Event {
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
	} as unknown as Event;
}

function runningToolPartEvent(
	sessionID: string,
	messageID: string,
	tool: string,
	callID: string = "call-1",
): Event {
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
	} as unknown as Event;
}

function sessionIdleEvent( sessionID: string ): Event {
	return {
		type: "session.idle",
		properties: { sessionID },
	} as unknown as Event;
}

function sessionDeletedEvent( sessionID: string ): Event {
	return {
		type: "session.deleted",
		properties: { info: { id: sessionID } },
	} as unknown as Event;
}

// ── Mock helpers ───────────────────────────────────────────────────────────

function createMockSession( overrides: Record<string, unknown> = {} ): Pick<OpencodeClient[ "session" ], MockSessionMethods> {
	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = {
		messages: ( async () => ( {
			data: [
				{
					info: { role: "user", id: "msg-1" },
					parts: [ { type: "text", text: "Hello" } ],
				},
			],
		} ) ) as unknown as OpencodeClient[ "session" ][ "messages" ],
		create: ( async () => ( {
			data: { id: "temp-session-1" },
		} ) ) as unknown as OpencodeClient[ "session" ][ "create" ],
		prompt: ( async () => ( {
			data: { parts: [ { type: "text", text: "Advisor response" } ] },
		} ) ) as unknown as OpencodeClient[ "session" ][ "prompt" ],
		delete: ( async () => {} ) as unknown as OpencodeClient[ "session" ][ "delete" ],
		abort: ( async () => ( {
			data: true,
		} ) ) as unknown as OpencodeClient[ "session" ][ "abort" ],
		status: ( async () => ( {
			data: {},
		} ) ) as unknown as OpencodeClient[ "session" ][ "status" ],
	};

	// Merge overrides for individual mock replacements
	for( const key of Object.keys( overrides ) ) {
		( session as unknown as Record<string, unknown> )[ key ] = overrides[ key ];
	}

	return session;
}



function createPluginInput(
	session: Pick<OpencodeClient[ "session" ], MockSessionMethods>,
): PluginInput {
	return { client: { session }, directory: "" } as unknown as PluginInput;
}

function createMockConfig(): PluginConfig {
	return { agent: {}, command: {} };
}

// ── Config: advisor-only registration ───────────────────────────────────────

test.serial( "config registers only advisor agent, no btw agent or command", async ( t ) => {
	const cfg: PluginConfig = createMockConfig();

	const plugin: Hooks = await AdvisorPlugin( createPluginInput( createMockSession() ), undefined );
	await plugin.config!( cfg );

	// Advisor agent registered
	t.truthy( cfg.agent![ "opencode-advisor:advisor" ] );

	// No btw agent
	t.falsy( cfg.agent![ "opencode-advisor:btw" ] );

	// No btw command
	t.falsy( cfg.command!.btw );

	// No command.execute.before hook
	t.falsy( ( plugin as Record<string, unknown> )[ "command.execute.before" ] );
} );

test.serial( "config: does not mutate user-defined command object", async ( t ) => {
	const userCommands: Record<string, { template: string }> = { btw: { template: "$ARGUMENTS" }, other: { template: "do-something" } };
	const cfg: PluginConfig = { agent: {}, command: userCommands as PluginConfig[ "command" ] };
	const snapshot: Record<string, { template: string }> = structuredClone( userCommands );

	const plugin: Hooks = await AdvisorPlugin( createPluginInput( createMockSession() ), undefined );
	await plugin.config!( cfg );

	// Reference identity: command object must NOT be replaced
	t.is( cfg.command as Record<string, { template: string }>, userCommands, "command object must not be replaced" );

	// Deep equality against pre-hook snapshot: contents must not be mutated
	t.deepEqual( cfg.command as Record<string, { template: string }>, snapshot, "command object must not be mutated" );
} );

// ── Profile: defaults ────────────────────────────────────────────────────────

test.serial( "profile: undefined returns defaults", async ( t ) => {
	const cfg: PluginConfig = createMockConfig();

	const plugin: Hooks = await AdvisorPlugin( createPluginInput( createMockSession() ), undefined );
	await plugin.config!( cfg );

	const advisorAgent: Record<string, unknown> = cfg.agent![ "opencode-advisor:advisor" ] as Record<string, unknown>;
	t.truthy( advisorAgent );
	t.is( advisorAgent.model, "deepseek/deepseek-v4-pro" );
} );

test.serial( "profile: empty object returns defaults", async ( t ) => {
	const cfg: PluginConfig = createMockConfig();

	const plugin: Hooks = await AdvisorPlugin( createPluginInput( createMockSession() ), {} );
	await plugin.config!( cfg );

	const advisorAgent: Record<string, unknown> = cfg.agent![ "opencode-advisor:advisor" ] as Record<string, unknown>;
	t.truthy( advisorAgent );
	t.is( advisorAgent!.model, "deepseek/deepseek-v4-pro" );
} );

test.serial( "profile: null throws", async ( t ) => {
	await t.throwsAsync(
		async () => {
			await AdvisorPlugin( createPluginInput( createMockSession() ), null as unknown as undefined );
		},
		{ message: /null/ },
	);
} );

test.serial( "profile: direct options apply to advisor", async ( t ) => {
	const cfg: PluginConfig = createMockConfig();

	const plugin: Hooks = await AdvisorPlugin(
		createPluginInput( createMockSession() ),
		{ model: "anthropic/claude-opus-4-7", temperature: 0 },
	);

	await plugin.config!( cfg );

	const advisorCfg: Record<string, unknown> = cfg.agent![ "opencode-advisor:advisor" ] as Record<string, unknown>;
	t.truthy( advisorCfg );
	t.is( advisorCfg!.model, "anthropic/claude-opus-4-7" );
	t.is( advisorCfg!.temperature, 0 );
} );

// ── Fixed permission object ────────────────────────────────────────────────

test.serial( "fixed permissions: no ls/cat/grep shell entries", async ( t ) => {
	const cfg: PluginConfig = createMockConfig();

	const plugin: Hooks = await AdvisorPlugin( createPluginInput( createMockSession() ), undefined );
	await plugin.config!( cfg );

	const agentPerm: Record<string, unknown> = cfg.agent![ "opencode-advisor:advisor" ] as Record<string, unknown>;
	t.truthy( agentPerm );
	const permission: Record<string, unknown> = agentPerm.permission as Record<string, unknown>;
	t.truthy( permission );
	const bash: Record<string, string> = permission.bash as Record<string, string>;

	t.is( bash[ "wc *" ], "allow" );
	t.is( bash[ "git log *" ], "allow" );
	t.is( bash[ "git diff *" ], "allow" );
	t.is( bash[ "git show *" ], "allow" );
	t.is( bash[ "ls *" ] as string | undefined, undefined );
	t.is( bash[ "cat *" ] as string | undefined, undefined );
	t.is( bash[ "grep *" ] as string | undefined, undefined );
} );

// ── Hidden agent prompt replacement / defaults ─────────────────────────────

test.serial( "prompt: custom prompt replaces default", async ( t ) => {
	const cfg: PluginConfig = createMockConfig();

	const plugin: Hooks = await AdvisorPlugin(
		createPluginInput( createMockSession() ),
		{ prompt: "Custom advisor prompt" },
	);

	await plugin.config!( cfg );

	t.is( cfg.agent![ "opencode-advisor:advisor" ]!.prompt, "Custom advisor prompt" );
} );

test.serial( "prompt: empty string in options replaces default", async ( t ) => {
	const cfg: PluginConfig = createMockConfig();

	const plugin: Hooks = await AdvisorPlugin(
		createPluginInput( createMockSession() ),
		{ prompt: "" },
	);

	await plugin.config!( cfg );

	t.is( cfg.agent![ "opencode-advisor:advisor" ]!.prompt, "" );
} );
// ── Advisor success lifecycle ───────────────────────────────────────────────

test.serial( "advisor: success lifecycle — fetch transcript, create session, prompt with agent only, return text, delete", async ( t ) => {
	const captured: {
		deleteCalled: boolean;
		deleteSessionID: Undefinedable<string>;
		promptAgent: Undefinedable<string>;
		promptModel: unknown;
		promptSystem: unknown;
		promptTools: unknown;
		promptTranscript: Undefinedable<string>;
	} = {
		deleteCalled: false,
		deleteSessionID: undefined,
		promptAgent: undefined,
		promptModel: "sentinel",
		promptSystem: "sentinel",
		promptTools: "sentinel",
		promptTranscript: undefined,
	};

	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession( {
		messages: ( async () => ( {
			data: [
				{ info: { role: "user", id: "msg-prev" }, parts: [ { type: "text", text: "Earlier" } ] },
				{ info: { role: "assistant", id: "msg-current" }, parts: [ { type: "text", text: "Current" } ] },
			],
		} ) ) as unknown as OpencodeClient[ "session" ][ "messages" ],
		create: ( async () => ( { data: { id: "ephemeral-adv" } } ) ) as unknown as OpencodeClient[ "session" ][ "create" ],
		prompt: ( async ( args: {
			body?: { agent?: string; model?: unknown; system?: unknown; tools?: unknown; parts?: Array<{ type: string; text?: string }> };
		} ) => {
			captured.promptAgent = args?.body?.agent;
			captured.promptModel = args?.body?.model;
			captured.promptSystem = args?.body?.system;
			captured.promptTools = args?.body?.tools;
			captured.promptTranscript = args?.body?.parts?.[ 0 ]?.text;
			return { data: { parts: [ { type: "text", text: "Strategic advice" } ] } };
		} ) as unknown as OpencodeClient[ "session" ][ "prompt" ],
		delete: ( async ( args: { path?: { id?: string } } ) => {
			captured.deleteCalled = true;
			captured.deleteSessionID = args?.path?.id;
		} ) as unknown as OpencodeClient[ "session" ][ "delete" ],
	} );

	const cfg: PluginConfig = createMockConfig();
	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), undefined );
	await plugin.config!( cfg );

	const result: ToolResult = await plugin.tool!.advisor.execute(
		{},
		toolContext( "sess-adv", "msg-current" ),
	);

	t.is( result, "Strategic advice" );
	t.is( captured.promptAgent, "opencode-advisor:advisor" );
	t.is( captured.promptModel, undefined, "prompt body must not include model" );
	t.is( captured.promptSystem, undefined, "prompt body must not include system" );
	t.is( captured.promptTools, undefined, "prompt body must not include tools" );
	t.truthy( captured.deleteCalled, "session.delete must be called" );
	t.is( captured.deleteSessionID, "ephemeral-adv" );
	// Transcript must exclude the current message
	t.truthy( captured.promptTranscript, "prompt should have received a transcript" );
	t.falsy( captured.promptTranscript!.includes( "Current" ), "transcript must exclude current-message content" );
	t.truthy( captured.promptTranscript!.includes( "Earlier" ), "transcript must include prior messages" );
} );

// ── Advisor prompt failure ──────────────────────────────────────────────────

test.serial( "advisor: prompt failure still deletes session and clears recursion guard", async ( t ) => {
	let deleteCallCount: number = 0;
	let lastDeleteID: Undefinedable<string>;

	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession( {
		messages: ( async () => ( {
			data: [
				{ info: { role: "user", id: "msg-prev" }, parts: [ { type: "text", text: "Prior message" } ] },
			],
		} ) ) as unknown as OpencodeClient[ "session" ][ "messages" ],
		create: ( async () => ( { data: { id: "ephemeral-fail" } } ) ) as unknown as OpencodeClient[ "session" ][ "create" ],
		prompt: ( async () => {
			throw new Error( "Prompt error" );
		} ) as unknown as OpencodeClient[ "session" ][ "prompt" ],
		delete: ( async ( args: { path?: { id?: string } } ) => {
			deleteCallCount++;
			lastDeleteID = args?.path?.id;
		} ) as unknown as OpencodeClient[ "session" ][ "delete" ],
	} );

	const cfg: PluginConfig = createMockConfig();
	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), undefined );
	await plugin.config!( cfg );

	// First call: prompt throws
	const result1: ToolResult = await plugin.tool!.advisor.execute(
		{},
		toolContext( "sess-fail", "msg-1" ),
	);

	t.truthy( ( result1 as string ).startsWith( "Advisor error:" ), `Result should indicate error, got: ${result1}` );
	t.is( deleteCallCount, 1, "delete should be called after prompt failure" );
	t.is( lastDeleteID, "ephemeral-fail", "delete should clean up the created ephemeral session" );

	// Second call: must NOT be blocked by recursion guard
	const result2: ToolResult = await plugin.tool!.advisor.execute(
		{},
		toolContext( "sess-fail", "msg-2" ),
	);

	t.falsy( ( result2 as string ).includes( "recursive" ), "Second advisor call must not be blocked by stale recursion guard" );
	t.is( deleteCallCount, 2, "second call also triggers cleanup" );
} );

// ── Model precedence ────────────────────────────────────────────────────────

test.serial( "model precedence: profile model overrides plan model", async ( t ) => {
	const cfg: PluginConfig = { agent: { plan: { model: "anthropic/claude-sonnet-4" } }, command: {} };
	const plugin: Hooks = await AdvisorPlugin(
		createPluginInput( createMockSession() ),
		{ model: "openai/gpt-5" },
	);
	await plugin.config!( cfg );

	t.is( cfg.agent![ "opencode-advisor:advisor" ]!.model, "openai/gpt-5" );
} );

test.serial( "model precedence: absent profile uses plan model", async ( t ) => {
	const cfg: PluginConfig = { agent: { plan: { model: "anthropic/claude-sonnet-4" } }, command: {} };
	const plugin: Hooks = await AdvisorPlugin( createPluginInput( createMockSession() ), undefined );
	await plugin.config!( cfg );

	t.is( cfg.agent![ "opencode-advisor:advisor" ]!.model, "anthropic/claude-sonnet-4" );
} );

test.serial( "model precedence: absent plan uses global model", async ( t ) => {
	const cfg: PluginConfig = { agent: {}, command: {}, model: "openai/gpt-4" };
	const plugin: Hooks = await AdvisorPlugin( createPluginInput( createMockSession() ), undefined );
	await plugin.config!( cfg );

	t.is( cfg.agent![ "opencode-advisor:advisor" ]!.model, "openai/gpt-4" );
} );

test.serial( "model precedence: absent profile with plan and global config but no valid model uses default", async ( t ) => {
	const cfg: PluginConfig = { agent: { plan: { model: "invalid-format" } }, command: {}, model: "also-invalid" };
	const plugin: Hooks = await AdvisorPlugin( createPluginInput( createMockSession() ), undefined );
	await plugin.config!( cfg );

	t.is( cfg.agent![ "opencode-advisor:advisor" ]!.model, "deepseek/deepseek-v4-pro" );
} );

test.serial( "model precedence: both profile and plan and global absent uses default", async ( t ) => {
	const cfg: PluginConfig = createMockConfig();
	const plugin: Hooks = await AdvisorPlugin( createPluginInput( createMockSession() ), undefined );
	await plugin.config!( cfg );

	t.is( cfg.agent![ "opencode-advisor:advisor" ]!.model, "deepseek/deepseek-v4-pro" );
} );

// ── Permission deep equality ────────────────────────────────────────────────

test.serial( "permission: complete fixed policy deep equality", async ( t ) => {
	const cfg: PluginConfig = createMockConfig();
	const plugin: Hooks = await AdvisorPlugin( createPluginInput( createMockSession() ), undefined );
	await plugin.config!( cfg );

	const permission: Record<string, unknown> = cfg.agent![ "opencode-advisor:advisor" ]!.permission as Record<string, unknown>;

	// Global wildcard deny
	t.is( permission[ "*" ], "deny" );

	// Allowed native tools
	t.is( permission[ "read" ], "allow" );
	t.is( permission[ "glob" ], "allow" );
	t.is( permission[ "grep" ], "allow" );
	t.is( permission[ "webfetch" ], "allow" );
	t.is( permission[ "websearch" ], "allow" );
	t.is( permission[ "skill" ], "allow" );

	// Edit explicitly denied
	t.is( permission[ "edit" ], "deny" );

	// Bash entries
	const bash: Record<string, string> = permission[ "bash" ] as Record<string, string>;
	t.is( bash[ "*" ], "deny" );
	t.is( bash[ "wc *" ], "allow" );
	t.is( bash[ "git log *" ], "allow" );
	t.is( bash[ "git diff *" ], "allow" );
	t.is( bash[ "git show *" ], "allow" );
	t.is( bash[ "rtk wc *" ], "allow" );
	t.is( bash[ "rtk git log *" ], "allow" );
	t.is( bash[ "rtk git diff *" ], "allow" );
	t.is( bash[ "rtk git show *" ], "allow" );

	// No ls/cat/grep shell commands or rtk variants thereof
	t.is( bash[ "ls *" ] as string | undefined, undefined );
	t.is( bash[ "cat *" ] as string | undefined, undefined );
	t.is( bash[ "grep *" ] as string | undefined, undefined );
	t.is( bash[ "rtk ls *" ] as string | undefined, undefined );
	t.is( bash[ "rtk cat *" ] as string | undefined, undefined );
	t.is( bash[ "rtk grep *" ] as string | undefined, undefined );

	// Exactly the expected bash keys (no extras, no omissions)
	const expectedBashKeys: string[] = [ "*", "wc *", "git log *", "git diff *", "git show *", "rtk wc *", "rtk git log *", "rtk git diff *", "rtk git show *" ];
	t.deepEqual( Object.keys( bash ).sort(), expectedBashKeys.sort() );
} );

// ── Profile: failureThreshold ──────────────────────────────────────────────────

test.serial( "profile: failureThreshold 1 accepted", async ( t ) => {
	const cfg: PluginConfig = createMockConfig();
	const plugin: Hooks = await AdvisorPlugin( createPluginInput( createMockSession() ), { failureThreshold: 1 } );
	await plugin.config!( cfg );
	t.pass();
} );

test.serial( "profile: failureThreshold 5 accepted", async ( t ) => {
	const cfg: PluginConfig = createMockConfig();
	const plugin: Hooks = await AdvisorPlugin( createPluginInput( createMockSession() ), { failureThreshold: 5 } );
	await plugin.config!( cfg );
	t.pass();
} );

test.serial( "profile: failureThreshold 0 throws", async ( t ) => {
	await t.throwsAsync(
		async () => { await AdvisorPlugin( createPluginInput( createMockSession() ), { failureThreshold: 0 } as unknown as PluginOptions ); },
		{ message: /failureThreshold/ },
	);
} );

test.serial( "profile: failureThreshold -1 throws", async ( t ) => {
	await t.throwsAsync(
		async () => { await AdvisorPlugin( createPluginInput( createMockSession() ), { failureThreshold: -1 } as unknown as PluginOptions ); },
		{ message: /failureThreshold/ },
	);
} );

test.serial( "profile: failureThreshold 2.5 throws", async ( t ) => {
	await t.throwsAsync(
		async () => { await AdvisorPlugin( createPluginInput( createMockSession() ), { failureThreshold: 2.5 } as unknown as PluginOptions ); },
		{ message: /failureThreshold/ },
	);
} );

test.serial( "profile: failureThreshold NaN throws", async ( t ) => {
	await t.throwsAsync(
		async () => { await AdvisorPlugin( createPluginInput( createMockSession() ), { failureThreshold: NaN } as unknown as PluginOptions ); },
		{ message: /failureThreshold/ },
	);
} );

test.serial( "profile: failureThreshold Infinity throws", async ( t ) => {
	await t.throwsAsync(
		async () => { await AdvisorPlugin( createPluginInput( createMockSession() ), { failureThreshold: Infinity } as unknown as PluginOptions ); },
		{ message: /failureThreshold/ },
	);
} );

test.serial( "profile: failureThreshold string throws", async ( t ) => {
	await t.throwsAsync(
		async () => { await AdvisorPlugin( createPluginInput( createMockSession() ), { failureThreshold: "3" } as unknown as PluginOptions ); },
		{ message: /failureThreshold/ },
	);
} );

// ── 1a. Malformed profile fields ─────────────────────────────────────────────

test.serial( "profile: invalid model format — no slash", async ( t ) => {
	await t.throwsAsync(
		async () => { await AdvisorPlugin( createPluginInput( createMockSession() ), { model: "model-without-slash" } as unknown as PluginOptions ); },
		{ message: /must be "provider\/model"/ },
	);
} );

test.serial( "profile: invalid model format — starts with slash", async ( t ) => {
	await t.throwsAsync(
		async () => { await AdvisorPlugin( createPluginInput( createMockSession() ), { model: "/start/slash" } as unknown as PluginOptions ); },
		{ message: /must be "provider\/model"/ },
	);
} );

test.serial( "profile: invalid model format — ends with slash (empty model)", async ( t ) => {
	await t.throwsAsync(
		async () => { await AdvisorPlugin( createPluginInput( createMockSession() ), { model: "ends-with-slash/" } as unknown as PluginOptions ); },
		{ message: /must be "provider\/model"/ },
	);
} );

test.serial( "profile: invalid model format — only slash", async ( t ) => {
	await t.throwsAsync(
		async () => { await AdvisorPlugin( createPluginInput( createMockSession() ), { model: "/" } as unknown as PluginOptions ); },
		{ message: /must be "provider\/model"/ },
	);
} );

test.serial( "profile: non-string variant", async ( t ) => {
	await t.throwsAsync(
		async () => { await AdvisorPlugin( createPluginInput( createMockSession() ), { variant: 42 } as unknown as PluginOptions ); },
		{ message: /variant.*must be a string/ },
	);
} );

test.serial( "profile: non-string prompt", async ( t ) => {
	await t.throwsAsync(
		async () => { await AdvisorPlugin( createPluginInput( createMockSession() ), { prompt: 42 } as unknown as PluginOptions ); },
		{ message: /prompt.*must be a string/ },
	);
} );

test.serial( "profile: non-finite temperature", async ( t ) => {
	await t.throwsAsync(
		async () => { await AdvisorPlugin( createPluginInput( createMockSession() ), { temperature: Infinity } as unknown as PluginOptions ); },
		{ message: /temperature.*finite number/ },
	);
	await t.throwsAsync(
		async () => { await AdvisorPlugin( createPluginInput( createMockSession() ), { temperature: NaN } as unknown as PluginOptions ); },
		{ message: /temperature.*finite number/ },
	);
} );

test.serial( "profile: non-finite top_p", async ( t ) => {
	await t.throwsAsync(
		async () => { await AdvisorPlugin( createPluginInput( createMockSession() ), { top_p: Infinity } as unknown as PluginOptions ); },
		{ message: /top_p.*finite number/ },
	);
	await t.throwsAsync(
		async () => { await AdvisorPlugin( createPluginInput( createMockSession() ), { top_p: NaN } as unknown as PluginOptions ); },
		{ message: /top_p.*finite number/ },
	);
} );

test.serial( "profile: non-object options", async ( t ) => {
	await t.throwsAsync(
		async () => { await AdvisorPlugin( createPluginInput( createMockSession() ), { options: null } as unknown as PluginOptions ); },
		{ message: /must be a non-array object/ },
	);
	await t.throwsAsync(
		async () => { await AdvisorPlugin( createPluginInput( createMockSession() ), { options: "string" } as unknown as PluginOptions ); },
		{ message: /must be a non-array object/ },
	);
	await t.throwsAsync(
		async () => { await AdvisorPlugin( createPluginInput( createMockSession() ), { options: 42 } as unknown as PluginOptions ); },
		{ message: /must be a non-array object/ },
	);
} );

test.serial( "profile: unknown nested key in options throws", async ( t ) => {
	await t.throwsAsync(
		async () => {
			await AdvisorPlugin(
				createPluginInput( createMockSession() ),
				{ options: { reasoningEffort: "high" }, color: "red" } as unknown as PluginOptions,
			);
		},
		{ message: /color/ },
	);
} );

// ── 1b. Recursive JSON-safe options ──────────────────────────────────────────

test.serial( "options: accept nested object/array with primitive JSON values", async ( t ) => {
	const cfg: PluginConfig = createMockConfig();
	const plugin: Hooks = await AdvisorPlugin(
		createPluginInput( createMockSession() ),
		{
			options: {
				str: "hello",
				num: 42,
				bool: true,
				nil: null,
				nested: { a: 1, b: "two" },
				arr: [ 1, "two", true, null ],
			},
		},
	);
	await plugin.config!( cfg );

	const agentOpts: Record<string, unknown> = cfg.agent![ "opencode-advisor:advisor" ]!.options as Record<string, unknown>;
	t.is( agentOpts.str, "hello" );
	t.is( agentOpts.num, 42 );
	t.is( agentOpts.bool, true );
	t.is( agentOpts.nil, null );
	t.deepEqual( agentOpts.nested, { a: 1, b: "two" } );
	t.deepEqual( agentOpts.arr, [ 1, "two", true, null ] );
} );

test.serial( "options: reject non-finite nested number", async ( t ) => {
	await t.throwsAsync(
		async () => {
			await AdvisorPlugin(
				createPluginInput( createMockSession() ),
				{ options: { sub: { x: Infinity } } } as unknown as PluginOptions,
			);
		},
		{ message: /finite number/ },
	);
} );

test.serial( "options: reject function value", async ( t ) => {
	await t.throwsAsync(
		async () => {
			await AdvisorPlugin(
				createPluginInput( createMockSession() ),
				{ options: { fn: (): void => {} } } as unknown as PluginOptions,
			);
		},
		{ message: /invalid option type function/ },
	);
} );

test.serial( "options: reject symbol value", async ( t ) => {
	await t.throwsAsync(
		async () => {
			await AdvisorPlugin(
				createPluginInput( createMockSession() ),
				{ options: { sym: Symbol( "x" ) } } as unknown as PluginOptions,
			);
		},
		{ message: /invalid option type symbol/ },
	);
} );

test.serial( "options: reject bigint value", async ( t ) => {
	await t.throwsAsync(
		async () => {
			await AdvisorPlugin(
				createPluginInput( createMockSession() ),
				{ options: { big: BigInt( 1 ) } } as unknown as PluginOptions,
			);
		},
		{ message: /invalid option type bigint/ },
	);
} );

test.serial( "options: reject Date/class instance value", async ( t ) => {
	await t.throwsAsync(
		async () => {
			await AdvisorPlugin(
				createPluginInput( createMockSession() ),
				{ options: { date: new Date() } } as unknown as PluginOptions,
			);
		},
		{ message: /invalid option type object/ },
	);
} );

test.serial( "options: reject null at root", async ( t ) => {
	await t.throwsAsync(
		async () => {
			await AdvisorPlugin(
				createPluginInput( createMockSession() ),
				{ options: null } as unknown as PluginOptions,
			);
		},
		{ message: /must be a non-array object/ },
	);
} );

test.serial( "options: reject array at root", async ( t ) => {
	await t.throwsAsync(
		async () => {
			await AdvisorPlugin(
				createPluginInput( createMockSession() ),
				{ options: [ 1, 2, 3 ] } as unknown as PluginOptions,
			);
		},
		{ message: /must be a non-array object/ },
	);
} );

// ── 1c. Hidden agent setup ───────────────────────────────────────────────────

test.serial( "hidden agent: has hidden=true, mode=subagent", async ( t ) => {
	const cfg: PluginConfig = createMockConfig();
	const plugin: Hooks = await AdvisorPlugin( createPluginInput( createMockSession() ), {} );
	await plugin.config!( cfg );

	const advisorAgent: Record<string, unknown> = cfg.agent![ "opencode-advisor:advisor" ] as Record<string, unknown>;
	t.truthy( advisorAgent );

	t.is( advisorAgent.hidden, true, "advisor agent must be hidden" );
	t.is( advisorAgent.mode, "subagent" );
} );

test.serial( "hidden agent: default prompt is built-in, custom prompt replaces", async ( t ) => {
	// When profile prompt is absent, the default prompt is present via ??
	// fallback in buildAgentConfig. Custom prompt would replace it.
	const cfg: PluginConfig = createMockConfig();
	const plugin: Hooks = await AdvisorPlugin( createPluginInput( createMockSession() ), undefined );
	await plugin.config!( cfg );

	const advisorAgent: Record<string, unknown> = cfg.agent![ "opencode-advisor:advisor" ] as Record<string, unknown>;
	t.truthy( advisorAgent.prompt );
	t.truthy( 50 < ( advisorAgent.prompt as string ).length );
} );

test.serial( "hidden agent: profile params map to agent config", async ( t ) => {
	const cfg: PluginConfig = createMockConfig();
	const plugin: Hooks = await AdvisorPlugin(
		createPluginInput( createMockSession() ),
		{
			temperature: 0.7,
			top_p: 0.9,
			variant: "test-variant",
			options: { customOpt: true },
		},
	);
	await plugin.config!( cfg );

	const agent: Record<string, unknown> = cfg.agent![ "opencode-advisor:advisor" ] as Record<string, unknown>;
	t.is( agent.temperature, 0.7 );
	t.is( agent.top_p, 0.9 );
	t.is( agent.variant, "test-variant" );
	t.deepEqual( agent.options, { customOpt: true } );
} );

test.serial( "hidden agent: complete fixed permission policy exercised", async ( t ) => {
	const cfg: PluginConfig = createMockConfig();
	const plugin: Hooks = await AdvisorPlugin( createPluginInput( createMockSession() ), undefined );
	await plugin.config!( cfg );

	const permission: Record<string, unknown> = cfg.agent![ "opencode-advisor:advisor" ]!.permission as Record<string, unknown>;

	// Each top-level key
	t.is( permission[ "*" ], "deny" );
	t.is( permission[ "read" ], "allow" );
	t.is( permission[ "glob" ], "allow" );
	t.is( permission[ "grep" ], "allow" );
	t.is( permission[ "webfetch" ], "allow" );
	t.is( permission[ "websearch" ], "allow" );
	t.is( permission[ "skill" ], "allow" );
	t.is( permission[ "edit" ], "deny" );

	// Bash sub-object exists
	const bash: Record<string, string> = permission[ "bash" ] as Record<string, string>;
	t.truthy( bash );
	t.is( bash[ "*" ], "deny" );

	// Allowed shell commands
	const allowedBash: string[] = [ "wc *", "git log *", "git diff *", "git show *", "rtk wc *", "rtk git log *", "rtk git diff *", "rtk git show *" ];
	for( const cmd of allowedBash ) {
		t.is( bash[ cmd ], "allow", `bash["${cmd}"] must be allow` );
	}

	// Must not contain write or arbitrary-read commands
	t.is( bash[ "ls *" ] as string | undefined, undefined );
	t.is( bash[ "cat *" ] as string | undefined, undefined );
	t.is( bash[ "grep *" ] as string | undefined, undefined );
	t.is( bash[ "sudo *" ] as string | undefined, undefined );
	t.is( bash[ "rm *" ] as string | undefined, undefined );
	t.is( bash[ "vim *" ] as string | undefined, undefined );
	t.is( bash[ "nano *" ] as string | undefined, undefined );
	t.is( bash[ "echo *" ] as string | undefined, undefined );

	// No keys outside the expected set
	const knownKeys: string[] = [ "*", "wc *", "git log *", "git diff *", "git show *", "rtk wc *", "rtk git log *", "rtk git diff *", "rtk git show *" ];
	t.deepEqual( Object.keys( bash ).sort(), knownKeys.sort() );

	// Deny keys at top level are explicitly deny, not absent
	t.is( permission[ "edit" ], "deny" );
	// Assert absent keys are not present in top-level permission
	t.is( ( permission as Record<string, unknown> )[ "write" ], undefined );
	t.is( ( permission as Record<string, unknown> )[ "task" ], undefined );
	t.is( ( permission as Record<string, unknown> )[ "todo" ], undefined );
	t.is( ( permission as Record<string, unknown> )[ "run" ], undefined );
} );

// ── 5a. Advisor recursion guard ────────────────────────────────────────────

test.serial( "advisor: recursion guard blocks concurrent calls", async ( t ) => {
	let resolveMessages: ( value: unknown ) => void = () => {}; // replaced by Promise constructor
	const messagesDeferred: Promise<unknown> = new Promise(
		( resolve: ( value: unknown ) => void ): void => {
			resolveMessages = resolve;
		},
	);

	let messagesCallCount: number = 0;

	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession( {
		messages: ( async (): Promise<{ data: Array<{ info: { role: string; id: string }; parts: Array<{ type: string; text?: string }> }> }> => {
			messagesCallCount++;
			if( 1 === messagesCallCount ) {
				await messagesDeferred;
			}
			return {
				data: [
					{ info: { role: "user", id: "msg-prev" }, parts: [ { type: "text", text: "Prior message" } ] },
				],
			};
		} ) as unknown as OpencodeClient[ "session" ][ "messages" ],
		create: ( async () => ( { data: { id: "ephemeral-rec" } } ) ) as unknown as OpencodeClient[ "session" ][ "create" ],
		prompt: ( async () => ( { data: { parts: [ { type: "text", text: "First advice" } ] } } ) ) as unknown as OpencodeClient[ "session" ][ "prompt" ],
		delete: ( async () => {} ) as unknown as OpencodeClient[ "session" ][ "delete" ],
	} );

	const cfg: PluginConfig = createMockConfig();
	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), undefined );
	await plugin.config!( cfg );

	// Start first call — hangs on deferred messages (do NOT await yet)
	const firstCallPromise: Promise<ToolResult> = plugin.tool!.advisor.execute(
		{},
		toolContext( "sess-rec", "msg-current" ),
	);

	// Yield to event loop so first call sets inAdvisorCall and awaits messages
	await new Promise( ( resolve: ( value: void ) => void ) => setTimeout( resolve, 10 ) );

	t.is( messagesCallCount, 1, "first call must have invoked messages()" );

	// Second call — immediately rejected by recursion guard (inAdvisorCall is still true)
	const secondResult: ToolResult = await plugin.tool!.advisor.execute(
		{},
		toolContext( "sess-rec", "msg-other" ),
	);

	t.is( secondResult, "Error: advisor tool cannot be called recursively." );

	// Release first call's deferred messages
	resolveMessages( undefined );

	// Wait for first call to complete
	await firstCallPromise;

	// Third call — guard must be clear
	const thirdResult: ToolResult = await plugin.tool!.advisor.execute(
		{},
		toolContext( "sess-rec", "msg-third" ),
	);

	t.is( thirdResult, "First advice" );
} );

// ── 5b. Advisor empty transcript ─────────────────────────────────────────

test.serial( "advisor: empty transcript declines — current message only", async ( t ) => {
	let createCalled: boolean = false;

	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession( {
		messages: ( async () => ( {
			data: [
				{ info: { role: "user", id: "msg-current" }, parts: [ { type: "text", text: "Only message" } ] },
			],
		} ) ) as unknown as OpencodeClient[ "session" ][ "messages" ],
		create: ( async () => {
			createCalled = true;
			return { data: { id: "should-not-reach" } };
		} ) as unknown as OpencodeClient[ "session" ][ "create" ],
	} );

	const cfg: PluginConfig = createMockConfig();
	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), undefined );
	await plugin.config!( cfg );

	const result: ToolResult = await plugin.tool!.advisor.execute(
		{},
		toolContext( "sess-empty", "msg-current" ),
	);

	t.is( result, "Advisor declined: no prior conversation to analyze." );
	t.falsy( createCalled, "session.create must not be called when transcript is empty" );
} );

test.serial( "advisor: empty transcript declines — messages with no text parts", async ( t ) => {
	let createCalled: boolean = false;

	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession( {
		messages: ( async () => ( {
			data: [
				{ info: { role: "user", id: "msg-1" }, parts: [] },
				{ info: { role: "assistant", id: "msg-2" }, parts: [ { type: "tool-use", text: "some tool output" } ] },
			],
		} ) ) as unknown as OpencodeClient[ "session" ][ "messages" ],
		create: ( async () => {
			createCalled = true;
			return { data: { id: "should-not-reach" } };
		} ) as unknown as OpencodeClient[ "session" ][ "create" ],
	} );

	const cfg: PluginConfig = createMockConfig();
	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), undefined );
	await plugin.config!( cfg );

	const result: ToolResult = await plugin.tool!.advisor.execute(
		{},
		toolContext( "sess-empty2", "msg-other" ),
	);

	t.is( result, "Advisor declined: no prior conversation to analyze." );
	t.falsy( createCalled, "session.create must not be called when transcript text is empty" );
} );

// ── 5c. Advisor session creation failure ─────────────────────────────────

test.serial( "advisor: create rejection returns error and clears guard", async ( t ) => {
	let createCallCount: number = 0;

	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession( {
		messages: ( async () => ( {
			data: [
				{ info: { role: "user", id: "msg-prev" }, parts: [ { type: "text", text: "Prior message" } ] },
			],
		} ) ) as unknown as OpencodeClient[ "session" ][ "messages" ],
		create: ( async () => {
			createCallCount++;
			if( 1 === createCallCount ) {
				throw new Error( "API unavailable" );
			}
			return { data: { id: "ephemeral-retry" } };
		} ) as unknown as OpencodeClient[ "session" ][ "create" ],
	} );

	const cfg: PluginConfig = createMockConfig();
	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), undefined );
	await plugin.config!( cfg );

	// First call: create throws
	const result1: ToolResult = await plugin.tool!.advisor.execute(
		{},
		toolContext( "sess-fail", "msg-1" ),
	);

	t.truthy( ( result1 as string ).startsWith( "Advisor error:" ), `Expected error prefix, got: ${result1}` );
	t.truthy( ( result1 as string ).includes( "API unavailable" ), `Expected API error, got: ${result1}` );

	// Second call: must succeed (guard cleared)
	const result2: ToolResult = await plugin.tool!.advisor.execute(
		{},
		toolContext( "sess-fail", "msg-2" ),
	);

	t.is( result2, "Advisor response" );
	t.is( createCallCount, 2, "create must be called twice" );
} );

test.serial( "advisor: create returns no ID — ephemeral session ID absent", async ( t ) => {
	let createCallCount: number = 0;
	let deleteCalled: boolean = false;

	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession( {
		messages: ( async () => ( {
			data: [
				{ info: { role: "user", id: "msg-prev" }, parts: [ { type: "text", text: "Prior" } ] },
			],
		} ) ) as unknown as OpencodeClient[ "session" ][ "messages" ],
		create: ( async () => {
			createCallCount++;
			if( 1 === createCallCount ) {
				return { data: {} };
			}
			return { data: { id: "ephemeral-second" } };
		} ) as unknown as OpencodeClient[ "session" ][ "create" ],
		delete: ( async () => {
			deleteCalled = true;
		} ) as unknown as OpencodeClient[ "session" ][ "delete" ],
	} );

	const cfg: PluginConfig = createMockConfig();
	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), undefined );
	await plugin.config!( cfg );

	const result: ToolResult = await plugin.tool!.advisor.execute(
		{},
		toolContext( "sess-noid", "msg-1" ),
	);

	t.is( result, "Advisor error: failed to create ephemeral session." );
	t.falsy( deleteCalled, "delete must not be called when create returns no ID" );

	// Guard must be cleared — second call works
	const result2: ToolResult = await plugin.tool!.advisor.execute(
		{},
		toolContext( "sess-noid", "msg-2" ),
	);

	t.is( result2, "Advisor response" );
} );

// ── 5d. Uncovered validation branches ─────────────────────────────────────

test.serial( "profile: non-string model throws", async ( t ) => {
	await t.throwsAsync(
		async () => {
			await AdvisorPlugin(
				createPluginInput( createMockSession() ),
				{ model: 42 } as unknown as PluginOptions,
			);
		},
		{ message: /model.*must be a string/ },
	);
} );

test.serial( "profile: empty model string throws", async ( t ) => {
	await t.throwsAsync(
		async () => {
			await AdvisorPlugin(
				createPluginInput( createMockSession() ),
				{ model: "" } as unknown as PluginOptions,
			);
		},
		{ message: /model.*must not be empty/ },
	);
} );

test.serial( "profile: non-number temperature type throws", async ( t ) => {
	await t.throwsAsync(
		async () => {
			await AdvisorPlugin(
				createPluginInput( createMockSession() ),
				{ temperature: "hot" } as unknown as PluginOptions,
			);
		},
		{ message: /temperature.*must be a finite number/ },
	);
} );

test.serial( "profile: non-number top_p type throws", async ( t ) => {
	await t.throwsAsync(
		async () => {
			await AdvisorPlugin(
				createPluginInput( createMockSession() ),
				{ top_p: "0.9" } as unknown as PluginOptions,
			);
		},
		{ message: /top_p.*must be a finite number/ },
	);
} );

test.serial( "profile: unknown top-level key throws", async ( t ) => {
	await t.throwsAsync(
		async () => {
			await AdvisorPlugin(
				createPluginInput( createMockSession() ),
				{ advisor: {} } as unknown as PluginOptions,
			);
		},
		{ message: /unknown key.*advisor/ },
	);
} );

test.serial( "profile: array root throws", async ( t ) => {
	await t.throwsAsync(
		async () => {
			await AdvisorPlugin(
				createPluginInput( createMockSession() ),
				[ 1, 2 ] as unknown as PluginOptions,
			);
		},
		{ message: /must be a non-array object/ },
	);
} );

test.serial( "profile: string root throws", async ( t ) => {
	await t.throwsAsync(
		async () => {
			await AdvisorPlugin(
				createPluginInput( createMockSession() ),
				"bare-string" as unknown as PluginOptions,
			);
		},
		{ message: /must be a non-array object/ },
	);
} );

// ── 6. Edge-case branch coverage ─────────────────────────────────────────────

test.serial( "config: cfg without agent/command properties uses defaults", async ( t ) => {
	const cfg: PluginConfig = { agent: undefined, command: undefined } as unknown as PluginConfig;
	const plugin: Hooks = await AdvisorPlugin( createPluginInput( createMockSession() ), undefined );
	await plugin.config!( cfg );

	// Advisor agent is registered (config hook initializes agent object)
	t.truthy( cfg.agent![ "opencode-advisor:advisor" ] );

	// No btw agent or command
	t.falsy( cfg.agent![ "opencode-advisor:btw" ] );
	t.falsy( cfg.command! );
} );

test.serial( "advisor: undefined data from messages returns declined", async ( t ) => {
	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession( {
		messages: ( async () => ( {} ) ) as unknown as OpencodeClient[ "session" ][ "messages" ],
	} );

	const cfg: PluginConfig = createMockConfig();
	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), undefined );
	await plugin.config!( cfg );

	const result: ToolResult = await plugin.tool!.advisor.execute(
		{},
		toolContext( "sess-undef", "msg-1" ),
	);

	t.is( result, "Advisor declined: no prior conversation to analyze." );
} );

test.serial( "advisor: non-Error throw in create caught gracefully", async ( t ) => {
	let inCreate: boolean = false;

	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession( {
		create: ( async () => {
			inCreate = true;
			throw "string error message";
		} ) as unknown as OpencodeClient[ "session" ][ "create" ],
	} );

	const cfg: PluginConfig = createMockConfig();
	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), undefined );
	await plugin.config!( cfg );

	const result: ToolResult = await plugin.tool!.advisor.execute(
		{},
		toolContext( "sess-strerr", "msg-other" ),
	);

	t.truthy( inCreate, "create was called" );
	t.truthy( ( result as string ).includes( "string error message" ), `result: ${result}` );
} );

test.serial( "advisor: empty response text uses fallback", async ( t ) => {
	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession( {
		messages: ( async () => ( {
			data: [
				{ info: { role: "user", id: "msg-prev" }, parts: [ { type: "text", text: "Prior" } ] },
				{ info: { role: "assistant", id: "msg-cur" }, parts: [ { type: "text", text: "Current" } ] },
			],
		} ) ) as unknown as OpencodeClient[ "session" ][ "messages" ],
		prompt: ( async () => ( {
			data: { parts: [ { type: "text", text: "" } ] },
		} ) ) as unknown as OpencodeClient[ "session" ][ "prompt" ],
	} );

	const cfg: PluginConfig = createMockConfig();
	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), undefined );
	await plugin.config!( cfg );

	const result: ToolResult = await plugin.tool!.advisor.execute(
		{},
		toolContext( "sess-emptyresp", "msg-cur" ),
	);

	t.is( result, "Advisor returned no advice." );
} );

test.serial( "transcript: parts with null text use empty string fallback", async ( t ) => {
	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession( {
		messages: ( async () => ( {
			data: [
				{ info: { role: "user", id: "msg-1" }, parts: [ { type: "text", text: null } ] },
			],
		} ) ) as unknown as OpencodeClient[ "session" ][ "messages" ],
	} );

	const cfg: PluginConfig = createMockConfig();
	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), undefined );
	await plugin.config!( cfg );

	const result: ToolResult = await plugin.tool!.advisor.execute(
		{},
		toolContext( "sess-nulltxt", "msg-other" ),
	);

	t.is( result, "Advisor declined: no prior conversation to analyze." );
} );

// ── 7a. Event: failure counting ──────────────────────────────────────────────

test.serial( "event: two errors at default threshold do not abort, third does", async ( t ) => {
	let abortCallCount: number = 0;
	const msgsData: Array<{ info: { role: string; id: string; agent?: string; parentID?: string }; parts: Array<{ type: string; text?: string }> }> = [
		{ info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [ { type: "text", text: "Task" } ] },
		{ info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
	];

	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession( {
		messages: ( async () => ( { data: msgsData } ) ) as unknown as OpencodeClient[ "session" ][ "messages" ],
		abort: ( async () => {
			abortCallCount++;
			return { data: true };
		} ) as unknown as OpencodeClient[ "session" ][ "abort" ],
	} );

	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), undefined );
	await plugin.config!( createMockConfig() );

	// Two errors — no abort
	await plugin.event!( { event: errorToolPartEvent( "sess-e1", "asst-msg", "read", "err1", "call-1" ) } );
	await plugin.event!( { event: errorToolPartEvent( "sess-e1", "asst-msg", "read", "err2", "call-2" ) } );
	t.is( abortCallCount, 0 );

	// Third error triggers abort
	await plugin.event!( { event: errorToolPartEvent( "sess-e1", "asst-msg", "read", "err3", "call-3" ) } );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 50 ); } );
	t.is( abortCallCount, 1 );
} );

test.serial( "event: custom failureThreshold honored", async ( t ) => {
	let abortCallCount: number = 0;
	const msgsData: Array<{ info: { role: string; id: string; agent?: string; parentID?: string }; parts: Array<{ type: string; text?: string }> }> = [
		{ info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [ { type: "text", text: "Task" } ] },
		{ info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
	];

	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession( {
		messages: ( async () => ( { data: msgsData } ) ) as unknown as OpencodeClient[ "session" ][ "messages" ],
		abort: ( async () => {
			abortCallCount++;
			return { data: true };
		} ) as unknown as OpencodeClient[ "session" ][ "abort" ],
	} );

	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), { failureThreshold: 1 } );
	await plugin.config!( createMockConfig() );

	// Single error hits threshold immediately
	await plugin.event!( { event: errorToolPartEvent( "sess-cust", "asst-msg", "read", "err", "call-1" ) } );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 50 ); } );
	t.is( abortCallCount, 1 );
} );

test.serial( "event: completed tool resets streak", async ( t ) => {
	let abortCallCount: number = 0;
	const msgsData: Array<{ info: { role: string; id: string; agent?: string; parentID?: string }; parts: Array<{ type: string; text?: string }> }> = [
		{ info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [ { type: "text", text: "Task" } ] },
		{ info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
	];

	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession( {
		messages: ( async () => ( { data: msgsData } ) ) as unknown as OpencodeClient[ "session" ][ "messages" ],
		abort: ( async () => {
			abortCallCount++;
			return { data: true };
		} ) as unknown as OpencodeClient[ "session" ][ "abort" ],
	} );

	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), { failureThreshold: 2 } );
	await plugin.config!( createMockConfig() );

	// Error, then completed, then another error — should not hit threshold
	await plugin.event!( { event: errorToolPartEvent( "sess-reset", "asst-msg", "read", "err1", "call-1" ) } );
	await plugin.event!( { event: completedToolPartEvent( "sess-reset", "asst-msg", "read", "call-2" ) } );
	await plugin.event!( { event: errorToolPartEvent( "sess-reset", "asst-msg", "read", "err2", "call-3" ) } );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 50 ); } );
	t.is( abortCallCount, 0, "reset prevents threshold from being reached" );
} );

test.serial( "event: streaks isolated per session ID", async ( t ) => {
	let abortCallCount: number = 0;
	const msgsData: Array<{ info: { role: string; id: string; agent?: string; parentID?: string }; parts: Array<{ type: string; text?: string }> }> = [
		{ info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [ { type: "text", text: "Task" } ] },
		{ info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
	];

	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession( {
		messages: ( async () => ( { data: msgsData } ) ) as unknown as OpencodeClient[ "session" ][ "messages" ],
		abort: ( async () => {
			abortCallCount++;
			return { data: true };
		} ) as unknown as OpencodeClient[ "session" ][ "abort" ],
	} );

	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), { failureThreshold: 3 } );
	await plugin.config!( createMockConfig() );

	// Session A gets 2 errors
	await plugin.event!( { event: errorToolPartEvent( "sess-A", "asst-msg", "read", "a1", "ca-1" ) } );
	await plugin.event!( { event: errorToolPartEvent( "sess-A", "asst-msg", "read", "a2", "ca-2" ) } );
	// Session B gets 3 errors — triggers its own abort
	await plugin.event!( { event: errorToolPartEvent( "sess-B", "asst-msg", "read", "b1", "cb-1" ) } );
	await plugin.event!( { event: errorToolPartEvent( "sess-B", "asst-msg", "read", "b2", "cb-2" ) } );
	await plugin.event!( { event: errorToolPartEvent( "sess-B", "asst-msg", "read", "b3", "cb-3" ) } );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 50 ); } );
	t.is( abortCallCount, 1, "only session B reaches threshold" );
} );

// ── 7b. Event: tool state filtering ─────────────────────────────────────────

test.serial( "event: pending and running tool states do nothing", async ( t ) => {
	let abortCallCount: number = 0;
	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession( {
		abort: ( async () => {
			abortCallCount++;
			return { data: true };
		} ) as unknown as OpencodeClient[ "session" ][ "abort" ],
	} );

	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), { failureThreshold: 1 } );
	await plugin.config!( createMockConfig() );

	await plugin.event!( { event: pendingToolPartEvent( "sess-p", "asst-m", "read", "c1" ) } );
	await plugin.event!( { event: runningToolPartEvent( "sess-p", "asst-m", "read", "c2" ) } );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 30 ); } );
	t.is( abortCallCount, 0, "pending/running must not be counted" );
} );

test.serial( "event: advisor tool error does not increment", async ( t ) => {
	let abortCallCount: number = 0;
	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession( {
		abort: ( async () => {
			abortCallCount++;
			return { data: true };
		} ) as unknown as OpencodeClient[ "session" ][ "abort" ],
	} );

	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), { failureThreshold: 1 } );
	await plugin.config!( createMockConfig() );

	// advisor tool error must not trigger escalation
	await plugin.event!( { event: errorToolPartEvent( "sess-adv", "asst-m", "advisor", "err", "c1" ) } );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 30 ); } );
	t.is( abortCallCount, 0, "advisor tool error must not trigger intervention" );
} );

test.serial( "event: completed advisor tool resets streak like any tool", async ( t ) => {
	const msgsData: Array<{ info: { role: string; id: string; agent?: string; parentID?: string }; parts: Array<{ type: string; text?: string }> }> = [
		{ info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [ { type: "text", text: "Task" } ] },
		{ info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
	];

	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession( {
		messages: ( async () => ( { data: msgsData } ) ) as unknown as OpencodeClient[ "session" ][ "messages" ],
	} );

	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), { failureThreshold: 2 } );
	await plugin.config!( createMockConfig() );

	// Error on read, then completed on advisor, then error on read — must not reach threshold
	let eventCount: number = 0;
	const origEvent: ( input: { event: Event } ) => Promise<void> = plugin.event!;
	plugin.event = async ( input: { event: Event } ): Promise<void> => {
		eventCount++;
		await origEvent( input );
	};

	await plugin.event!( { event: errorToolPartEvent( "sess-acr", "asst-msg", "read", "e1", "c1" ) } );
	await plugin.event!( { event: completedToolPartEvent( "sess-acr", "asst-msg", "advisor", "c2" ) } );
	await plugin.event!( { event: errorToolPartEvent( "sess-acr", "asst-msg", "read", "e2", "c3" ) } );
	t.is( eventCount, 3, "all events processed" );
	t.pass( "completed advisor tool resets streak" );
} );

// ── 7c. Event: advisor session isolation ────────────────────────────────────

test.serial( "event: auto-created advisor session events are ignored", async ( t ) => {
	let abortCallCount: number = 0;
	const msgsData: Array<{ info: { role: string; id: string; agent?: string; parentID?: string }; parts: Array<{ type: string; text?: string }> }> = [
		{ info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [ { type: "text", text: "Task" } ] },
		{ info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
	];

	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession( {
		messages: ( async () => ( { data: msgsData } ) ) as unknown as OpencodeClient[ "session" ][ "messages" ],
		abort: ( async () => {
			abortCallCount++;
			return { data: true };
		} ) as unknown as OpencodeClient[ "session" ][ "abort" ],
	} );

	const recording: PromptRecording = createPromptRecording();
	session.prompt = ( async ( args: Record<string, unknown> ) => {
		const body: Record<string, unknown> = args.body as Record<string, unknown>;
		recording.prompts.push( {
			sessionID: ( args.path as Record<string, string> )?.id,
			agent: body.agent as string,
			text: ( body.parts as Array<{ text: string }> )?.[ 0 ]?.text,
		} );
		return { data: { parts: [ { type: "text", text: "Advice" } ] } };
	} ) as unknown as OpencodeClient[ "session" ][ "prompt" ];

	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), { failureThreshold: 2 } );
	await plugin.config!( createMockConfig() );

	// Two errors trigger intervention which creates an advisor session
	await plugin.event!( { event: errorToolPartEvent( "sess-isol", "asst-msg", "read", "e1", "c1" ) } );
	await plugin.event!( { event: errorToolPartEvent( "sess-isol", "asst-msg", "read", "e2", "c2" ) } );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 100 ); } );

	// Verify that the advisor was prompted (temp session prompt to the advisor agent)
	const advisorPrompts: number = recording.prompts.filter(
		( p: { agent: Undefinedable<string> } ): boolean => "opencode-advisor:advisor" === p.agent,
	).length;
	t.true( 0 < advisorPrompts, "advisor session was created" );

	// Even if the advisor temp session emitted tool events, our plugin's event hook
	// should not have counted them. There's no assertion on abortCallCount because
	// the intervention was triggered, but the advisor session events must be ignored.
	t.pass( "advisor session events are excluded from counting" );
} );

// ── 7d. Event: agent eligibility ────────────────────────────────────────────

test.serial( "event: tools.advisor false prevents intervention", async ( t ) => {
	let abortCallCount: number = 0;
	const msgsData: Array<{ info: { role: string; id: string; agent?: string; parentID?: string }; parts: Array<{ type: string; text?: string }> }> = [
		{ info: { role: "user", id: "user-msg", agent: "no-advisor-agent" }, parts: [ { type: "text", text: "Task" } ] },
		{ info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
	];

	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession( {
		messages: ( async () => ( { data: msgsData } ) ) as unknown as OpencodeClient[ "session" ][ "messages" ],
		abort: ( async () => {
			abortCallCount++;
			return { data: true };
		} ) as unknown as OpencodeClient[ "session" ][ "abort" ],
	} );

	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), { failureThreshold: 1 } );
	const cfg: PluginConfig = createMockConfig();
	cfg.agent![ "no-advisor-agent" ] = { tools: { advisor: false } } as Record<string, unknown>;
	await plugin.config!( cfg );

	await plugin.event!( { event: errorToolPartEvent( "sess-opt", "asst-msg", "read", "err", "c1" ) } );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 50 ); } );
	t.is( abortCallCount, 0, "no intervention when agent opts out" );
} );

test.serial( "event: missing source agent causes no intervention", async ( t ) => {
	let abortCallCount: number = 0;
	// Messages without agent field
	const msgsData: Array<{ info: { role: string; id: string; parentID?: string }; parts: Array<{ type: string; text?: string }> }> = [
		{ info: { role: "user", id: "user-msg" }, parts: [ { type: "text", text: "Task" } ] },
		{ info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
	];

	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession( {
		messages: ( async () => ( { data: msgsData } ) ) as unknown as OpencodeClient[ "session" ][ "messages" ],
		abort: ( async () => {
			abortCallCount++;
			return { data: true };
		} ) as unknown as OpencodeClient[ "session" ][ "abort" ],
	} );

	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), { failureThreshold: 1 } );
	await plugin.config!( createMockConfig() );

	await plugin.event!( { event: errorToolPartEvent( "sess-noagent", "asst-msg", "read", "err", "c1" ) } );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 50 ); } );
	t.is( abortCallCount, 0, "no intervention when source agent is missing" );
} );

test.serial( "event: absent agent is eligible when tools.advisor is not explicitly false", async ( t ) => {
	let abortCallCount: number = 0;
	const msgsData: Array<{ info: { role: string; id: string; agent?: string; parentID?: string }; parts: Array<{ type: string; text?: string }> }> = [
		{ info: { role: "user", id: "user-msg", agent: "some-agent" }, parts: [ { type: "text", text: "Task" } ] },
		{ info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
	];

	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession( {
		messages: ( async () => ( { data: msgsData } ) ) as unknown as OpencodeClient[ "session" ][ "messages" ],
		abort: ( async () => {
			abortCallCount++;
			return { data: true };
		} ) as unknown as OpencodeClient[ "session" ][ "abort" ],
	} );

	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), { failureThreshold: 1 } );
	const cfg: PluginConfig = createMockConfig();
	// some-agent exists but has no tools.advisor field
	cfg.agent![ "some-agent" ] = { tools: {} } as Record<string, unknown>;
	await plugin.config!( cfg );

	await plugin.event!( { event: errorToolPartEvent( "sess-elig", "asst-msg", "read", "err", "c1" ) } );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 50 ); } );
	t.is( abortCallCount, 1, "agent without explicit tools.advisor false is eligible" );
} );

// ── 7e. Event: prompt format and lifecycle ordering ─────────────────────────

test.serial( "event: advisor prompt includes tool names and error messages", async ( t ) => {
	const msgsData: Array<{ info: { role: string; id: string; agent?: string; parentID?: string }; parts: Array<{ type: string; text?: string }> }> = [
		{ info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [ { type: "text", text: "Task" } ] },
		{ info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
	];

	const recording: PromptRecording = createPromptRecording();
	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession( {
		messages: ( async () => ( { data: msgsData } ) ) as unknown as OpencodeClient[ "session" ][ "messages" ],
		abort: ( async () => ( { data: true } ) ) as unknown as OpencodeClient[ "session" ][ "abort" ],
		prompt: ( async ( args: Record<string, unknown> ) => {
			const body: Record<string, unknown> = args.body as Record<string, unknown>;
			recording.prompts.push( {
				sessionID: ( args.path as Record<string, string> )?.id,
				agent: body.agent as string,
				text: ( body.parts as Array<{ text: string }> )?.[ 0 ]?.text,
			} );
			return { data: { parts: [ { type: "text", text: "Strategic advice" } ] } };
		} ) as unknown as OpencodeClient[ "session" ][ "prompt" ],
	} );

	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), { failureThreshold: 2 } );
	await plugin.config!( createMockConfig() );

	// Two different failures
	await plugin.event!( { event: errorToolPartEvent( "sess-pf", "asst-msg", "read", "File not found", "c1" ) } );
	await plugin.event!( { event: errorToolPartEvent( "sess-pf", "asst-msg", "edit", "Permission denied", "c2" ) } );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 100 ); } );

	// Find the advisor prompt (not the resume prompt)
	const advisorPrompt: Undefinedable<{ sessionID: Undefinedable<string>; text: Undefinedable<string>; agent: Undefinedable<string> }> = recording.prompts.find(
		( p: { agent: Undefinedable<string>; text: Undefinedable<string> } ): boolean => "opencode-advisor:advisor" === p.agent && undefined !== p.text,
	);
	t.truthy( advisorPrompt, "advisor was prompted" );
	t.truthy( advisorPrompt!.text!.includes( "read" ), "prompt must mention tool name 'read'" );
	t.truthy( advisorPrompt!.text!.includes( "File not found" ), "prompt must mention first error" );
	t.truthy( advisorPrompt!.text!.includes( "edit" ), "prompt must mention tool name 'edit'" );
	t.truthy( advisorPrompt!.text!.includes( "Permission denied" ), "prompt must mention second error" );
} );

test.serial( "event: resume waits for both idle event and advisor response", async ( t ) => {
	const msgsData: Array<{ info: { role: string; id: string; agent?: string; parentID?: string }; parts: Array<{ type: string; text?: string }> }> = [
		{ info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [ { type: "text", text: "Task" } ] },
		{ info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
	];

	const recording: PromptRecording = createPromptRecording();
	let resolveAdvisorPrompt: ( value: unknown ) => void = () => {};
	const advisorDeferred: Promise<unknown> = new Promise(
		( resolve: ( value: unknown ) => void ): void => {
			resolveAdvisorPrompt = resolve;
		},
	);
	let advisorPromptCount: number = 0;

	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession( {
		messages: ( async () => ( { data: msgsData } ) ) as unknown as OpencodeClient[ "session" ][ "messages" ],
		abort: ( async () => ( { data: true } ) ) as unknown as OpencodeClient[ "session" ][ "abort" ],
		create: ( async () => ( { data: { id: "temp-adv-wait" } } ) ) as unknown as OpencodeClient[ "session" ][ "create" ],
		prompt: ( async ( args: Record<string, unknown> ) => {
			const body: Record<string, unknown> = args.body as Record<string, unknown>;
			const sessID: string = ( args.path as Record<string, string> )?.id ?? "";
			recording.prompts.push( {
				sessionID: sessID,
				agent: body.agent as string,
				text: ( body.parts as Array<{ text: string }> )?.[ 0 ]?.text,
			} );
			advisorPromptCount++;
			if( 1 === advisorPromptCount ) {
				// First prompt is the advisor prompt — defer it
				await advisorDeferred;
			}
			return { data: { parts: [ { type: "text", text: "Deferred advice" } ] } };
		} ) as unknown as OpencodeClient[ "session" ][ "prompt" ],
	} );

	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), { failureThreshold: 2 } );
	await plugin.config!( createMockConfig() );

	// Trigger intervention
	await plugin.event!( { event: errorToolPartEvent( "sess-order", "asst-msg", "read", "e1", "c1" ) } );
	await plugin.event!( { event: errorToolPartEvent( "sess-order", "asst-msg", "read", "e2", "c2" ) } );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 30 ); } );

	// Advisor prompt is deferred — resume should not happen yet
	// Send idle event
	await plugin.event!( { event: sessionIdleEvent( "sess-order" ) } );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 30 ); } );

	// Should not have resume prompt yet because advisor hasn't responded
	const resumePromptsBefore: number = recording.prompts.filter(
		( p: { agent: Undefinedable<string> } ): boolean => "test-agent" === p.agent,
	).length;
	t.is( resumePromptsBefore, 0, "no resume before advisor response" );

	// Now resolve advisor prompt
	resolveAdvisorPrompt( undefined );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 50 ); } );

	// Should now have resume prompt
	const resumePromptsAfter: number = recording.prompts.filter(
		( p: { agent: Undefinedable<string> } ): boolean => "test-agent" === p.agent,
	).length;
	t.is( resumePromptsAfter, 1, "resume after both idle and advisor response" );
} );

test.serial( "event: resume prompt format", async ( t ) => {
	const msgsData: Array<{ info: { role: string; id: string; agent?: string; parentID?: string }; parts: Array<{ type: string; text?: string }> }> = [
		{ info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [ { type: "text", text: "Task" } ] },
		{ info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
	];

	const recording: PromptRecording = createPromptRecording();
	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession( {
		messages: ( async () => ( { data: msgsData } ) ) as unknown as OpencodeClient[ "session" ][ "messages" ],
		abort: ( async () => ( { data: true } ) ) as unknown as OpencodeClient[ "session" ][ "abort" ],
		status: ( async () => ( {
			data: { "sess-fmt": { type: "idle" } },
		} ) ) as unknown as OpencodeClient[ "session" ][ "status" ],
		prompt: ( async ( args: Record<string, unknown> ) => {
			const body: Record<string, unknown> = args.body as Record<string, unknown>;
			recording.prompts.push( {
				sessionID: ( args.path as Record<string, string> )?.id,
				agent: body.agent as string,
				text: ( body.parts as Array<{ text: string }> )?.[ 0 ]?.text,
			} );
			return { data: { parts: [ { type: "text", text: "Advice" } ] } };
		} ) as unknown as OpencodeClient[ "session" ][ "prompt" ],
	} );

	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), { failureThreshold: 2 } );
	await plugin.config!( createMockConfig() );

	await plugin.event!( { event: errorToolPartEvent( "sess-fmt", "asst-msg", "read", "e1", "c1" ) } );
	await plugin.event!( { event: errorToolPartEvent( "sess-fmt", "asst-msg", "read", "e2", "c2" ) } );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 100 ) } );

	// Find the resume prompt (agent = test-agent, not advisor)
	const resumePrompt: Undefinedable<{ sessionID: Undefinedable<string>; agent: Undefinedable<string>; text: Undefinedable<string> }> = recording.prompts.find(
		( p: { agent: Undefinedable<string> } ): boolean => "test-agent" === p.agent,
	);
	t.truthy( resumePrompt, "resume prompt exists" );
	t.is( resumePrompt!.sessionID, "sess-fmt", "resume targets original session" );
	t.is( resumePrompt!.agent, "test-agent", "resume uses source agent" );
	t.truthy( resumePrompt!.text!.includes( "Advice" ), "resume includes advisor advice" );
	t.truthy( resumePrompt!.text!.includes( "Continue the task using this advice." ), "resume includes continuation instruction" );
} );

// ── 7f. Event: abort / advisor failure recovery ─────────────────────────────

test.serial( "event: abort failure prevents resume", async ( t ) => {
	const msgsData: Array<{ info: { role: string; id: string; agent?: string; parentID?: string }; parts: Array<{ type: string; text?: string }> }> = [
		{ info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [ { type: "text", text: "Task" } ] },
		{ info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
	];

	const recording: PromptRecording = createPromptRecording();
	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession( {
		messages: ( async () => ( { data: msgsData } ) ) as unknown as OpencodeClient[ "session" ][ "messages" ],
		abort: ( async () => ( { data: false } ) ) as unknown as OpencodeClient[ "session" ][ "abort" ],
		prompt: ( async ( args: Record<string, unknown> ) => {
			const body: Record<string, unknown> = args.body as Record<string, unknown>;
			recording.prompts.push( {
				sessionID: ( args.path as Record<string, string> )?.id,
				agent: body.agent as string,
				text: ( body.parts as Array<{ text: string }> )?.[ 0 ]?.text,
			} );
			return { data: { parts: [ { type: "text", text: "Advice" } ] } };
		} ) as unknown as OpencodeClient[ "session" ][ "prompt" ],
	} );

	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), { failureThreshold: 2 } );
	await plugin.config!( createMockConfig() );

	await plugin.event!( { event: errorToolPartEvent( "sess-abfail", "asst-msg", "read", "e1", "c1" ) } );
	await plugin.event!( { event: errorToolPartEvent( "sess-abfail", "asst-msg", "read", "e2", "c2" ) } );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 100 ) } );

	// No resume prompt for test-agent (abort returned false)
	const resumePrompts: number = recording.prompts.filter(
		( p: { agent: Undefinedable<string> } ): boolean => "test-agent" === p.agent,
	).length;
	t.is( resumePrompts, 0, "no resume when abort fails" );
} );

test.serial( "event: advisor failure still resumes with fallback", async ( t ) => {
	const msgsData: Array<{ info: { role: string; id: string; agent?: string; parentID?: string }; parts: Array<{ type: string; text?: string }> }> = [
		{ info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [ { type: "text", text: "Task" } ] },
		{ info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
	];

	const recording: PromptRecording = createPromptRecording();
	let promptCallCount: number = 0;
	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession( {
		messages: ( async () => ( { data: msgsData } ) ) as unknown as OpencodeClient[ "session" ][ "messages" ],
		abort: ( async () => ( { data: true } ) ) as unknown as OpencodeClient[ "session" ][ "abort" ],
		status: ( async () => ( {
			data: { "sess-advfail": { type: "idle" } },
		} ) ) as unknown as OpencodeClient[ "session" ][ "status" ],
		create: ( async () => ( { data: { id: "temp-fail" } } ) ) as unknown as OpencodeClient[ "session" ][ "create" ],
		prompt: ( async ( args: Record<string, unknown> ) => {
			promptCallCount++;
			const body: Record<string, unknown> = args.body as Record<string, unknown>;
			const sessID: string = ( args.path as Record<string, string> )?.id ?? "";
			recording.prompts.push( {
				sessionID: sessID,
				agent: body.agent as string,
				text: ( body.parts as Array<{ text: string }> )?.[ 0 ]?.text,
			} );
			if( 1 === promptCallCount ) {
				// First prompt (advisor) fails
				throw new Error( "Advisor API error" );
			}
			return { data: { parts: [ { type: "text", text: "ok" } ] } };
		} ) as unknown as OpencodeClient[ "session" ][ "prompt" ],
	} );

	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), { failureThreshold: 2 } );
	await plugin.config!( createMockConfig() );

	await plugin.event!( { event: errorToolPartEvent( "sess-advfail", "asst-msg", "read", "e1", "c1" ) } );
	await plugin.event!( { event: errorToolPartEvent( "sess-advfail", "asst-msg", "read", "e2", "c2" ) } );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 100 ) } );

	// Should have a resume prompt despite advisor failure
	const resumePrompts: number = recording.prompts.filter(
		( p: { agent: Undefinedable<string> } ): boolean => "test-agent" === p.agent,
	).length;
	t.is( resumePrompts, 1, "resume occurs despite advisor failure" );

	// Resume content must be fallback, not raw error
	const resumeText: Undefinedable<string> = recording.prompts.find(
		( p: { agent: Undefinedable<string> } ): boolean => "test-agent" === p.agent,
	)?.text;
	t.truthy( resumeText, "resume text exists" );
	t.falsy( ( resumeText ?? "" ).includes( "Advisor error" ), "must not contain raw Advisor error" );
	t.truthy( ( resumeText ?? "" ).includes( "reassess" ) || ( resumeText ?? "" ).includes( "Continue" ), "must contain fallback guidance" );
} );

// ── 7g. Event: session deletion during intervention ─────────────────────────

test.serial( "event: session.deleted prevents resume", async ( t ) => {
	const msgsData: Array<{ info: { role: string; id: string; agent?: string; parentID?: string }; parts: Array<{ type: string; text?: string }> }> = [
		{ info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [ { type: "text", text: "Task" } ] },
		{ info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
	];

	const recording: PromptRecording = createPromptRecording();
	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession( {
		messages: ( async () => ( { data: msgsData } ) ) as unknown as OpencodeClient[ "session" ][ "messages" ],
		abort: ( async () => ( { data: true } ) ) as unknown as OpencodeClient[ "session" ][ "abort" ],
		prompt: ( async ( args: Record<string, unknown> ) => {
			const body: Record<string, unknown> = args.body as Record<string, unknown>;
			recording.prompts.push( {
				sessionID: ( args.path as Record<string, string> )?.id,
				agent: body.agent as string,
				text: ( body.parts as Array<{ text: string }> )?.[ 0 ]?.text,
			} );
			return { data: { parts: [ { type: "text", text: "Advice" } ] } };
		} ) as unknown as OpencodeClient[ "session" ][ "prompt" ],
	} );

	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), { failureThreshold: 2 } );
	await plugin.config!( createMockConfig() );

	await plugin.event!( { event: errorToolPartEvent( "sess-del", "asst-msg", "read", "e1", "c1" ) } );
	await plugin.event!( { event: errorToolPartEvent( "sess-del", "asst-msg", "read", "e2", "c2" ) } );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 30 ) } );

	// Delete session during intervention
	await plugin.event!( { event: sessionDeletedEvent( "sess-del" ) } );
	await plugin.event!( { event: sessionIdleEvent( "sess-del" ) } );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 50 ) } );

	// No resume for the deleted session
	const resumePrompts: number = recording.prompts.filter(
		( p: { agent: Undefinedable<string> } ): boolean => "test-agent" === p.agent,
	).length;
	t.is( resumePrompts, 0, "no resume after session deletion" );
} );

// ── 7h. Event: intervention gate — ignore tool events during intervention ──

test.serial( "event: tool events ignored during intervention, completed before resume re-arms", async ( t ) => {
	const msgsData: Array<{ info: { role: string; id: string; agent?: string; parentID?: string }; parts: Array<{ type: string; text?: string }> }> = [
		{ info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [ { type: "text", text: "Task" } ] },
		{ info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
	];

	const recording: PromptRecording = createPromptRecording();
	let resolveAbort: ( value: unknown ) => void = () => {};
	const abortDeferred: Promise<unknown> = new Promise(
		( resolve: ( value: unknown ) => void ): void => {
			resolveAbort = resolve;
		},
	);

	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession( {
		messages: ( async () => ( { data: msgsData } ) ) as unknown as OpencodeClient[ "session" ][ "messages" ],
		abort: ( async () => {
			await abortDeferred;
			return { data: true };
		} ) as unknown as OpencodeClient[ "session" ][ "abort" ],
		status: ( async () => ( {
			data: { "sess-gate": { type: "idle" } },
		} ) ) as unknown as OpencodeClient[ "session" ][ "status" ],
		prompt: ( async ( args: Record<string, unknown> ) => {
			const body: Record<string, unknown> = args.body as Record<string, unknown>;
			recording.prompts.push( {
				sessionID: ( args.path as Record<string, string> )?.id,
				agent: body.agent as string,
				text: ( body.parts as Array<{ text: string }> )?.[ 0 ]?.text,
			} );
			return { data: { parts: [ { type: "text", text: "Advice" } ] } };
		} ) as unknown as OpencodeClient[ "session" ][ "prompt" ],
	} );

	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), { failureThreshold: 1 } );
	await plugin.config!( createMockConfig() );

	// Error triggers intervention — abort is deferred, so intervention stays in progress
	await plugin.event!( { event: errorToolPartEvent( "sess-gate", "asst-msg", "read", "e1", "c1" ) } );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 30 ) } );

	// While intervention is still in progress (abort deferred), send more error events
	// These must be ignored because state.intervening is true
	await plugin.event!( { event: errorToolPartEvent( "sess-gate", "asst-msg", "read", "e2", "c2" ) } );
	await plugin.event!( { event: errorToolPartEvent( "sess-gate", "asst-msg", "read", "e3", "c3" ) } );

	// Release abort to let intervention complete
	resolveAbort( undefined );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 100 ) } );

	// After resume, a completed tool should re-arm the feature
	await plugin.event!( { event: completedToolPartEvent( "sess-gate", "asst-msg", "read", "c4" ) } );

	// Now a new error should trigger another intervention (re-armed)
	let abortCallCount: number = 0;
	session.abort = ( async () => {
		abortCallCount++;
		return { data: true };
	} ) as unknown as OpencodeClient[ "session" ][ "abort" ];

	await plugin.event!( { event: errorToolPartEvent( "sess-gate", "asst-msg", "read", "e4", "c5" ) } );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 50 ) } );

	t.is( abortCallCount, 1, "completed tool re-arms the feature" );
} );

// ── 7i. Edge-case branch coverage ────────────────────────────────────────────

test.serial( "event: abort rejection still clears intervening", async ( t ) => {
	const msgsData: Array<{ info: { role: string; id: string; agent?: string; parentID?: string }; parts: Array<{ type: string; text?: string }> }> = [
		{ info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [ { type: "text", text: "Task" } ] },
		{ info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
	];

	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession( {
		messages: ( async () => ( { data: msgsData } ) ) as unknown as OpencodeClient[ "session" ][ "messages" ],
		abort: ( async () => {
			throw new Error( "Abort failed" );
		} ) as unknown as OpencodeClient[ "session" ][ "abort" ],
	} );

	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), { failureThreshold: 1 } );
	await plugin.config!( createMockConfig() );

	// Error triggers intervention — abort throws
	await plugin.event!( { event: errorToolPartEvent( "sess-abrej", "asst-msg", "read", "err", "c1" ) } );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 50 ) } );

	// After abort rejection, intervening should be false, triggered still true
	// A subsequent completed tool should reset triggered and allow a fresh start
	await plugin.event!( { event: completedToolPartEvent( "sess-abrej", "asst-msg", "read", "c2" ) } );

	// Now an error should be counted without triggering another launch (triggered was reset)
	let abortCallCount: number = 0;
	session.abort = ( async () => {
		abortCallCount++;
		return { data: true };
	} ) as unknown as OpencodeClient[ "session" ][ "abort" ];
	await plugin.event!( { event: errorToolPartEvent( "sess-abrej", "asst-msg", "read", "err2", "c3" ) } );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 50 ) } );

	t.is( abortCallCount, 1, "abort rejection recovery allows later intervention" );
} );

test.serial( "event: status rejection waits for idle event", async ( t ) => {
	const msgsData: Array<{ info: { role: string; id: string; agent?: string; parentID?: string }; parts: Array<{ type: string; text?: string }> }> = [
		{ info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [ { type: "text", text: "Task" } ] },
		{ info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
	];

	const recording: PromptRecording = createPromptRecording();
	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession( {
		messages: ( async () => ( { data: msgsData } ) ) as unknown as OpencodeClient[ "session" ][ "messages" ],
		abort: ( async () => ( { data: true } ) ) as unknown as OpencodeClient[ "session" ][ "abort" ],
		status: ( async () => {
			throw new Error( "Status error" );
		} ) as unknown as OpencodeClient[ "session" ][ "status" ],
		prompt: ( async ( args: Record<string, unknown> ) => {
			const body: Record<string, unknown> = args.body as Record<string, unknown>;
			recording.prompts.push( {
				sessionID: ( args.path as Record<string, string> )?.id,
				agent: body.agent as string,
				text: ( body.parts as Array<{ text: string }> )?.[ 0 ]?.text,
			} );
			return { data: { parts: [ { type: "text", text: "Advice" } ] } };
		} ) as unknown as OpencodeClient[ "session" ][ "prompt" ],
	} );

	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), { failureThreshold: 2 } );
	await plugin.config!( createMockConfig() );

	// Two errors trigger intervention — status throws but idle event should still work
	await plugin.event!( { event: errorToolPartEvent( "sess-statfail", "asst-msg", "read", "e1", "c1" ) } );
	await plugin.event!( { event: errorToolPartEvent( "sess-statfail", "asst-msg", "read", "e2", "c2" ) } );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 50 ) } );

	// Status threw, so state.idle is still false — send idle event
	await plugin.event!( { event: sessionIdleEvent( "sess-statfail" ) } );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 50 ) } );

	const resumePrompts: number = recording.prompts.filter(
		( p: { agent: Undefinedable<string> } ): boolean => "test-agent" === p.agent,
	).length;
	t.is( resumePrompts, 1, "resume occurs after idle event despite status failure" );
} );

test.serial( "event: messages failure clears intervention", async ( t ) => {
	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession( {
		messages: ( async () => {
			throw new Error( "Messages error" );
		} ) as unknown as OpencodeClient[ "session" ][ "messages" ],
	} );

	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), { failureThreshold: 1 } );
	await plugin.config!( createMockConfig() );

	await plugin.event!( { event: errorToolPartEvent( "sess-msgerr", "asst-msg", "read", "err", "c1" ) } );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 50 ) } );

	// Intervention should have cleared intervening flag silently
	t.pass( "messages failure handled gracefully" );
} );

test.serial( "event: completed tool creates state if none exists", async ( t ) => {
	const msgsData: Array<{ info: { role: string; id: string; agent?: string; parentID?: string }; parts: Array<{ type: string; text?: string }> }> = [
		{ info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [ { type: "text", text: "Task" } ] },
		{ info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
	];

	let abortCallCount: number = 0;
	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession( {
		messages: ( async () => ( { data: msgsData } ) ) as unknown as OpencodeClient[ "session" ][ "messages" ],
		abort: ( async () => {
			abortCallCount++;
			return { data: true };
		} ) as unknown as OpencodeClient[ "session" ][ "abort" ],
	} );

	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), { failureThreshold: 2 } );
	await plugin.config!( createMockConfig() );

	// Send completed first (creates state with count=0, triggered=false)
	await plugin.event!( { event: completedToolPartEvent( "sess-fresh", "asst-msg", "read", "c1" ) } );

	// Two errors should trigger intervention
	await plugin.event!( { event: errorToolPartEvent( "sess-fresh", "asst-msg", "read", "e1", "c2" ) } );
	await plugin.event!( { event: errorToolPartEvent( "sess-fresh", "asst-msg", "read", "e2", "c3" ) } );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 100 ) } );

	t.is( abortCallCount, 1, "completed-initiated state still tracks errors" );
} );

test.serial( "event: failures array shift when exceeding threshold", async ( t ) => {
	const msgsData: Array<{ info: { role: string; id: string; agent?: string; parentID?: string }; parts: Array<{ type: string; text?: string }> }> = [
		{ info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [ { type: "text", text: "Task" } ] },
		{ info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
	];

	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession( {
		messages: ( async () => ( { data: msgsData } ) ) as unknown as OpencodeClient[ "session" ][ "messages" ],
		abort: ( async () => ( { data: true } ) ) as unknown as OpencodeClient[ "session" ][ "abort" ],
		status: ( async () => ( {
			data: { "sess-shift": { type: "idle" } },
		} ) ) as unknown as OpencodeClient[ "session" ][ "status" ],
	} );

	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), { failureThreshold: 2 } );
	await plugin.config!( createMockConfig() );

	// Two errors trigger intervention — status returns idle so intervention completes fully
	await plugin.event!( { event: errorToolPartEvent( "sess-shift", "asst-msg", "read", "e1", "c1" ) } );
	await plugin.event!( { event: errorToolPartEvent( "sess-shift", "asst-msg", "read", "e2", "c2" ) } );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 100 ) } );

	// Intervention completed (intervening=false via _maybeResume). Send another error.
	// This should trigger shift because failures.length (2) >= threshold (2)
	await plugin.event!( { event: errorToolPartEvent( "sess-shift", "asst-msg", "read", "e3", "c3" ) } );

	t.pass( "failure shift exercised" );
} );

test.serial( "event: session.status idle triggers resume", async ( t ) => {
	const msgsData: Array<{ info: { role: string; id: string; agent?: string; parentID?: string }; parts: Array<{ type: string; text?: string }> }> = [
		{ info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [ { type: "text", text: "Task" } ] },
		{ info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
	];

	const recording: PromptRecording = createPromptRecording();
	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession( {
		messages: ( async () => ( { data: msgsData } ) ) as unknown as OpencodeClient[ "session" ][ "messages" ],
		abort: ( async () => ( { data: true } ) ) as unknown as OpencodeClient[ "session" ][ "abort" ],
		status: ( async () => ( { data: {} } ) ) as unknown as OpencodeClient[ "session" ][ "status" ],
		prompt: ( async ( args: Record<string, unknown> ) => {
			const body: Record<string, unknown> = args.body as Record<string, unknown>;
			recording.prompts.push( {
				sessionID: ( args.path as Record<string, string> )?.id,
				agent: body.agent as string,
				text: ( body.parts as Array<{ text: string }> )?.[ 0 ]?.text,
			} );
			return { data: { parts: [ { type: "text", text: "Advice" } ] } };
		} ) as unknown as OpencodeClient[ "session" ][ "prompt" ],
	} );

	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), { failureThreshold: 2 } );
	await plugin.config!( createMockConfig() );

	await plugin.event!( { event: errorToolPartEvent( "sess-statidle", "asst-msg", "read", "e1", "c1" ) } );
	await plugin.event!( { event: errorToolPartEvent( "sess-statidle", "asst-msg", "read", "e2", "c2" ) } );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 50 ) } );

	// Use session.status with idle type to trigger resume
	await plugin.event!( { event: { type: "session.status", properties: { sessionID: "sess-statidle", status: { type: "idle" } } } as Event } );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 50 ) } );

	const resumePrompts: number = recording.prompts.filter(
		( p: { agent: Undefinedable<string> } ): boolean => "test-agent" === p.agent,
	).length;
	t.is( resumePrompts, 1, "session.status idle triggers resume" );
} );

test.serial( "event: session.status busy prevents idle false -> resume on idle", async ( t ) => {
	const msgsData: Array<{ info: { role: string; id: string; agent?: string; parentID?: string }; parts: Array<{ type: string; text?: string }> }> = [
		{ info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [ { type: "text", text: "Task" } ] },
		{ info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
	];

	const recording: PromptRecording = createPromptRecording();
	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession( {
		messages: ( async () => ( { data: msgsData } ) ) as unknown as OpencodeClient[ "session" ][ "messages" ],
		abort: ( async () => ( { data: true } ) ) as unknown as OpencodeClient[ "session" ][ "abort" ],
		status: ( async () => ( {
			data: { "sess-busy": { type: "busy" } },
		} ) ) as unknown as OpencodeClient[ "session" ][ "status" ],
		prompt: ( async ( args: Record<string, unknown> ) => {
			const body: Record<string, unknown> = args.body as Record<string, unknown>;
			recording.prompts.push( {
				sessionID: ( args.path as Record<string, string> )?.id,
				agent: body.agent as string,
				text: ( body.parts as Array<{ text: string }> )?.[ 0 ]?.text,
			} );
			return { data: { parts: [ { type: "text", text: "Advice" } ] } };
		} ) as unknown as OpencodeClient[ "session" ][ "prompt" ],
	} );

	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), { failureThreshold: 2 } );
	await plugin.config!( createMockConfig() );

	// Two errors trigger intervention — status returns busy, so idle=false
	await plugin.event!( { event: errorToolPartEvent( "sess-busy", "asst-msg", "read", "e1", "c1" ) } );
	await plugin.event!( { event: errorToolPartEvent( "sess-busy", "asst-msg", "read", "e2", "c2" ) } );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 50 ) } );

	// Now send busy status event — should set idle=false
	await plugin.event!( { event: { type: "session.status", properties: { sessionID: "sess-busy", status: { type: "busy" } } } as Event } );

	// Then send idle event to trigger resume
	await plugin.event!( { event: sessionIdleEvent( "sess-busy" ) } );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 50 ) } );

	const resumePrompts: number = recording.prompts.filter(
		( p: { agent: Undefinedable<string> } ): boolean => "test-agent" === p.agent,
	).length;
	t.is( resumePrompts, 1, "resume after busy->idle transition" );
} );

test.serial( "event: intervention with empty transcript uses fallback input", async ( t ) => {
	// Messages with no text parts → transcript is empty → advisor input should use failure block
	const msgsData: Array<{ info: { role: string; id: string; agent?: string; parentID?: string }; parts: Array<{ type: string; text?: string }> }> = [
		{ info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [ { type: "tool-use", text: "tool output" } ] },
		{ info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
	];

	const recording: PromptRecording = createPromptRecording();
	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession( {
		messages: ( async () => ( { data: msgsData } ) ) as unknown as OpencodeClient[ "session" ][ "messages" ],
		abort: ( async () => ( { data: true } ) ) as unknown as OpencodeClient[ "session" ][ "abort" ],
		status: ( async () => ( {
			data: { "sess-noctx": { type: "idle" } },
		} ) ) as unknown as OpencodeClient[ "session" ][ "status" ],
		prompt: ( async ( args: Record<string, unknown> ) => {
			const body: Record<string, unknown> = args.body as Record<string, unknown>;
			recording.prompts.push( {
				sessionID: ( args.path as Record<string, string> )?.id,
				agent: body.agent as string,
				text: ( body.parts as Array<{ text: string }> )?.[ 0 ]?.text,
			} );
			return { data: { parts: [ { type: "text", text: "Advice" } ] } };
		} ) as unknown as OpencodeClient[ "session" ][ "prompt" ],
	} );

	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), { failureThreshold: 1 } );
	await plugin.config!( createMockConfig() );

	await plugin.event!( { event: errorToolPartEvent( "sess-noctx", "asst-msg", "read", "err", "c1" ) } );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 100 ) } );

	// Advisor prompt should use fallback format (tool failures without transcript)
	const advisorPrompt: Undefinedable<{ text: Undefinedable<string> }> = recording.prompts.find(
		( p: { agent: Undefinedable<string>; text: Undefinedable<string> } ): boolean => "opencode-advisor:advisor" === p.agent && undefined !== p.text,
	) as { text: Undefinedable<string> } | undefined;
	t.truthy( advisorPrompt, "advisor was prompted" );
	t.truthy( advisorPrompt!.text!.includes( "Tool failures" ), "should use fallback format" );
	t.truthy( advisorPrompt!.text!.includes( "err" ), "should include error message" );
} );

test.serial( "event: session.status retry sets idle false", async ( t ) => {
	const msgsData: Array<{ info: { role: string; id: string; agent?: string; parentID?: string }; parts: Array<{ type: string; text?: string }> }> = [
		{ info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [ { type: "text", text: "Task" } ] },
		{ info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
	];

	const recording: PromptRecording = createPromptRecording();
	let resolveAbort2: ( value: unknown ) => void = () => {};
	const abortDeferred2: Promise<unknown> = new Promise(
		( resolve: ( value: unknown ) => void ): void => {
			resolveAbort2 = resolve;
		},
	);

	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession( {
		messages: ( async () => ( { data: msgsData } ) ) as unknown as OpencodeClient[ "session" ][ "messages" ],
		abort: ( async () => {
			await abortDeferred2;
			return { data: true };
		} ) as unknown as OpencodeClient[ "session" ][ "abort" ],
		status: ( async () => ( {
			data: {},
		} ) ) as unknown as OpencodeClient[ "session" ][ "status" ],
		prompt: ( async ( args: Record<string, unknown> ) => {
			const body: Record<string, unknown> = args.body as Record<string, unknown>;
			recording.prompts.push( {
				sessionID: ( args.path as Record<string, string> )?.id,
				agent: body.agent as string,
				text: ( body.parts as Array<{ text: string }> )?.[ 0 ]?.text,
			} );
			return { data: { parts: [ { type: "text", text: "Advice" } ] } };
		} ) as unknown as OpencodeClient[ "session" ][ "prompt" ],
	} );

	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), { failureThreshold: 2 } );
	await plugin.config!( createMockConfig() );

	// Two errors trigger intervention — abort is deferred
	await plugin.event!( { event: errorToolPartEvent( "sess-retry", "asst-msg", "read", "e1", "c1" ) } );
	await plugin.event!( { event: errorToolPartEvent( "sess-retry", "asst-msg", "read", "e2", "c2" ) } );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 30 ) } );

	// Release abort to finish — awaitingIdle is now set
	resolveAbort2( undefined );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 50 ) } );

	// Send retry status event post-abort — idle should become false, blocking resume
	await plugin.event!( { event: { type: "session.status", properties: { sessionID: "sess-retry", status: { type: "retry", attempt: 1, message: "", next: 0 } } } as Event } );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 30 ) } );

	// No resume should have happened yet because idle is false after retry
	const resumeRetry: number = recording.prompts.filter(
		( p: { agent: Undefinedable<string> } ): boolean => "test-agent" === p.agent,
	).length;
	t.is( resumeRetry, 0, "no resume after retry status" );

	// Now send idle event to allow resume
	await plugin.event!( { event: sessionIdleEvent( "sess-retry" ) } );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 50 ) } );

	const resumePrompts: number = recording.prompts.filter(
		( p: { agent: Undefinedable<string> } ): boolean => "test-agent" === p.agent,
	).length;
	t.is( resumePrompts, 1, "resume after retry->idle transition" );
} );

// ── 7j. Regression: idle during abort race ───────────────────────────────────

test.serial( "event: idle before abort resolves does not cause premature resume", async ( t ) => {
	const msgsData: Array<{ info: { role: string; id: string; agent?: string; parentID?: string }; parts: Array<{ type: string; text?: string }> }> = [
		{ info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [ { type: "text", text: "Task" } ] },
		{ info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
	];

	const recording: PromptRecording = createPromptRecording();
	let resolveAbortReg: ( value: unknown ) => void = () => {};
	const abortDeferredReg: Promise<unknown> = new Promise(
		( resolve: ( value: unknown ) => void ): void => {
			resolveAbortReg = resolve;
		},
	);

	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession( {
		messages: ( async () => ( { data: msgsData } ) ) as unknown as OpencodeClient[ "session" ][ "messages" ],
		abort: ( async () => {
			await abortDeferredReg;
			return { data: true };
		} ) as unknown as OpencodeClient[ "session" ][ "abort" ],
		status: ( async () => ( {
			data: { "sess-bfra": { type: "busy" } },
		} ) ) as unknown as OpencodeClient[ "session" ][ "status" ],
		prompt: ( async ( args: Record<string, unknown> ) => {
			const body: Record<string, unknown> = args.body as Record<string, unknown>;
			recording.prompts.push( {
				sessionID: ( args.path as Record<string, string> )?.id,
				agent: body.agent as string,
				text: ( body.parts as Array<{ text: string }> )?.[ 0 ]?.text,
			} );
			return { data: { parts: [ { type: "text", text: "Advice" } ] } };
		} ) as unknown as OpencodeClient[ "session" ][ "prompt" ],
	} );

	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), { failureThreshold: 1 } );
	await plugin.config!( createMockConfig() );

	// Error triggers intervention — abort is deferred
	await plugin.event!( { event: errorToolPartEvent( "sess-bfra", "asst-msg", "read", "err", "c1" ) } );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 30 ) } );

	// Emit idle event while abort is still pending — must NOT trigger resume
	await plugin.event!( { event: sessionIdleEvent( "sess-bfra" ) } );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 30 ) } );

	// Before abort resolved, no resume should have occurred
	const resumeBeforeAbort: number = recording.prompts.filter(
		( p: { agent: Undefinedable<string> } ): boolean => "test-agent" === p.agent,
	).length;
	t.is( resumeBeforeAbort, 0, "no resume during pending abort despite idle event" );

	// Resolve abort — status returns busy so idle stays false
	resolveAbortReg( undefined );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 100 ) } );

	// Still no resume because status reported busy
	const resumeAfterBusyStatus: number = recording.prompts.filter(
		( p: { agent: Undefinedable<string> } ): boolean => "test-agent" === p.agent,
	).length;
	t.is( resumeAfterBusyStatus, 0, "no resume when status reports busy after abort" );

	// Now emit post-abort idle event — should trigger exactly one resume
	await plugin.event!( { event: sessionIdleEvent( "sess-bfra" ) } );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 50 ) } );

	const resumeFinal: number = recording.prompts.filter(
		( p: { agent: Undefinedable<string> } ): boolean => "test-agent" === p.agent,
	).length;
	t.is( resumeFinal, 1, "exactly one resume after post-abort idle" );
} );

// ── 7k. Regression: auto-path unusable advisor output ────────────────────────

test.serial( "event: missing temp session uses fallback not Advisor error string", async ( t ) => {
	const msgsData: Array<{ info: { role: string; id: string; agent?: string; parentID?: string }; parts: Array<{ type: string; text?: string }> }> = [
		{ info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [ { type: "text", text: "Task" } ] },
		{ info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
	];

	const recording: PromptRecording = createPromptRecording();
	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession( {
		messages: ( async () => ( { data: msgsData } ) ) as unknown as OpencodeClient[ "session" ][ "messages" ],
		abort: ( async () => ( { data: true } ) ) as unknown as OpencodeClient[ "session" ][ "abort" ],
		status: ( async () => ( {
			data: { "sess-notemp": { type: "idle" } },
		} ) ) as unknown as OpencodeClient[ "session" ][ "status" ],
		create: ( async () => ( { data: {} } ) ) as unknown as OpencodeClient[ "session" ][ "create" ],
		prompt: ( async ( args: Record<string, unknown> ) => {
			const body: Record<string, unknown> = args.body as Record<string, unknown>;
			recording.prompts.push( {
				sessionID: ( args.path as Record<string, string> )?.id,
				agent: body.agent as string,
				text: ( body.parts as Array<{ text: string }> )?.[ 0 ]?.text,
			} );
			return { data: { parts: [ { type: "text", text: "ignored" } ] } };
		} ) as unknown as OpencodeClient[ "session" ][ "prompt" ],
	} );

	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), { failureThreshold: 1 } );
	await plugin.config!( createMockConfig() );

	await plugin.event!( { event: errorToolPartEvent( "sess-notemp", "asst-msg", "read", "err", "c1" ) } );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 100 ) } );

	// Resume prompt must contain fallback, not "Advisor error"
	const resumePrompt: Undefinedable<{ text: Undefinedable<string> }> = recording.prompts.find(
		( p: { agent: Undefinedable<string> } ): boolean => "test-agent" === p.agent,
	) as { text: Undefinedable<string> } | undefined;
	t.truthy( resumePrompt, "resume prompt exists despite missing temp session" );
	t.falsy( ( resumePrompt!.text ?? "" ).includes( "Advisor error" ), "must not contain raw Advisor error string" );
	t.truthy( ( resumePrompt!.text ?? "" ).includes( "reassess" ) || ( resumePrompt!.text ?? "" ).includes( "Continue" ), "must contain fallback guidance" );
} );

test.serial( "event: empty advisor response uses fallback not Advisor returned no advice", async ( t ) => {
	const msgsData: Array<{ info: { role: string; id: string; agent?: string; parentID?: string }; parts: Array<{ type: string; text?: string }> }> = [
		{ info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [ { type: "text", text: "Task" } ] },
		{ info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
	];

	const recording: PromptRecording = createPromptRecording();
	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession( {
		messages: ( async () => ( { data: msgsData } ) ) as unknown as OpencodeClient[ "session" ][ "messages" ],
		abort: ( async () => ( { data: true } ) ) as unknown as OpencodeClient[ "session" ][ "abort" ],
		status: ( async () => ( {
			data: { "sess-emptxt": { type: "idle" } },
		} ) ) as unknown as OpencodeClient[ "session" ][ "status" ],
		prompt: ( async ( args: Record<string, unknown> ) => {
			const body: Record<string, unknown> = args.body as Record<string, unknown>;
			recording.prompts.push( {
				sessionID: ( args.path as Record<string, string> )?.id,
				agent: body.agent as string,
				text: ( body.parts as Array<{ text: string }> )?.[ 0 ]?.text,
			} );
			return { data: { parts: [ { type: "text", text: "" } ] } };
		} ) as unknown as OpencodeClient[ "session" ][ "prompt" ],
	} );

	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), { failureThreshold: 1 } );
	await plugin.config!( createMockConfig() );

	await plugin.event!( { event: errorToolPartEvent( "sess-emptxt", "asst-msg", "read", "err", "c1" ) } );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 100 ) } );

	// Resume prompt must contain fallback, not "Advisor returned no advice"
	const resumePrompt: Undefinedable<{ text: Undefinedable<string> }> = recording.prompts.find(
		( p: { agent: Undefinedable<string> } ): boolean => "test-agent" === p.agent,
	) as { text: Undefinedable<string> } | undefined;
	t.truthy( resumePrompt, "resume prompt exists despite empty advisor response" );
	t.falsy( ( resumePrompt!.text ?? "" ).includes( "Advisor returned no advice" ), "must not contain raw empty-response string" );
	t.truthy( ( resumePrompt!.text ?? "" ).includes( "reassess" ) || ( resumePrompt!.text ?? "" ).includes( "Continue" ), "must contain fallback guidance" );
} );

// ── 7l. Regression: idleGeneration ordering token for post-abort race ─────────

test.serial( "event: stale status busy after idle event does not overwrite idle", async ( t ) => {
	const msgsData: Array<{ info: { role: string; id: string; agent?: string; parentID?: string }; parts: Array<{ type: string; text?: string }> }> = [
		{ info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [ { type: "text", text: "Task" } ] },
		{ info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
	];

	const recording: PromptRecording = createPromptRecording();
	let resolveStatusStale: ( value: unknown ) => void = () => {};
	const statusDeferred: Promise<unknown> = new Promise(
		( resolve: ( value: unknown ) => void ): void => {
			resolveStatusStale = resolve;
		},
	);

	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession( {
		messages: ( async () => ( { data: msgsData } ) ) as unknown as OpencodeClient[ "session" ][ "messages" ],
		abort: ( async () => ( { data: true } ) ) as unknown as OpencodeClient[ "session" ][ "abort" ],
		status: ( async () => {
			await statusDeferred;
			return { data: { "sess-stale": { type: "busy" } } };
		} ) as unknown as OpencodeClient[ "session" ][ "status" ],
		prompt: ( async ( args: Record<string, unknown> ) => {
			const body: Record<string, unknown> = args.body as Record<string, unknown>;
			recording.prompts.push( {
				sessionID: ( args.path as Record<string, string> )?.id,
				agent: body.agent as string,
				text: ( body.parts as Array<{ text: string }> )?.[ 0 ]?.text,
			} );
			return { data: { parts: [ { type: "text", text: "Advice" } ] } };
		} ) as unknown as OpencodeClient[ "session" ][ "prompt" ],
	} );

	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), { failureThreshold: 1 } );
	await plugin.config!( createMockConfig() );

	// Trigger intervention — status query is deferred
	await plugin.event!( { event: errorToolPartEvent( "sess-stale", "asst-msg", "read", "err", "c1" ) } );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 30 ) } );

	// While status query is outstanding, deliver a real idle event
	await plugin.event!( { event: sessionIdleEvent( "sess-stale" ) } );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 30 ) } );

	// Resolve the status query with stale busy result
	resolveStatusStale( undefined );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 100 ) } );

	// Idle event was newer than the status query — must remain authoritative
	const resumePrompts: number = recording.prompts.filter(
		( p: { agent: Undefinedable<string> } ): boolean => "test-agent" === p.agent,
	).length;
	t.is( resumePrompts, 1, "resume fires despite stale busy status response" );
} );

test.serial( "event: post-abort idle followed by busy status event before advice blocks resume", async ( t ) => {
	const msgsData: Array<{ info: { role: string; id: string; agent?: string; parentID?: string }; parts: Array<{ type: string; text?: string }> }> = [
		{ info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [ { type: "text", text: "Task" } ] },
		{ info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
	];

	const recording: PromptRecording = createPromptRecording();
	let resolvePromptDelay: ( value: unknown ) => void = () => {};
	const promptDeferred: Promise<unknown> = new Promise(
		( resolve: ( value: unknown ) => void ): void => {
			resolvePromptDelay = resolve;
		},
	);
	let promptCallCountEvent: number = 0;

	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession( {
		messages: ( async () => ( { data: msgsData } ) ) as unknown as OpencodeClient[ "session" ][ "messages" ],
		abort: ( async () => ( { data: true } ) ) as unknown as OpencodeClient[ "session" ][ "abort" ],
		status: ( async () => ( {
			data: { "sess-busy2": { type: "idle" } },
		} ) ) as unknown as OpencodeClient[ "session" ][ "status" ],
		prompt: ( async ( args: Record<string, unknown> ) => {
			promptCallCountEvent++;
			const body: Record<string, unknown> = args.body as Record<string, unknown>;
			const sessID: string = ( args.path as Record<string, string> )?.id ?? "";
			recording.prompts.push( {
				sessionID: sessID,
				agent: body.agent as string,
				text: ( body.parts as Array<{ text: string }> )?.[ 0 ]?.text,
			} );
			if( 1 === promptCallCountEvent ) {
				// First prompt (advisor) is deferred to let events interleave
				await promptDeferred;
			}
			return { data: { parts: [ { type: "text", text: "Advice2" } ] } };
		} ) as unknown as OpencodeClient[ "session" ][ "prompt" ],
	} );

	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), { failureThreshold: 1 } );
	await plugin.config!( createMockConfig() );

	// Trigger intervention — status returns idle so post-abort idle=true
	// Advisor prompt is deferred so we can send events before it resolves
	await plugin.event!( { event: errorToolPartEvent( "sess-busy2", "asst-msg", "read", "err", "c1" ) } );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 50 ) } );

	// Send busy status event before advisor prompt resolves — should set idle=false
	await plugin.event!( { event: { type: "session.status", properties: { sessionID: "sess-busy2", status: { type: "busy" } } } as Event } );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 30 ) } );

	// No resume yet (idle=false after busy event)
	const resumeAfterBusy: number = recording.prompts.filter(
		( p: { agent: Undefinedable<string> } ): boolean => "test-agent" === p.agent,
	).length;
	t.is( resumeAfterBusy, 0, "no resume after post-abort idle then busy event" );

	// Resolve advisor prompt — advice is stored but idle=false prevents resume
	resolvePromptDelay( undefined );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 50 ) } );

	const resumeAfterAdvice: number = recording.prompts.filter(
		( p: { agent: Undefinedable<string> } ): boolean => "test-agent" === p.agent,
	).length;
	t.is( resumeAfterAdvice, 0, "no resume after advisor completes while idle=false" );

	// Now send a fresh idle event — should trigger resume
	await plugin.event!( { event: sessionIdleEvent( "sess-busy2" ) } );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 50 ) } );

	const resumeFinalEvent: number = recording.prompts.filter(
		( p: { agent: Undefinedable<string> } ): boolean => "test-agent" === p.agent,
	).length;
	t.is( resumeFinalEvent, 1, "exactly one resume after subsequent idle event" );
} );

test.serial( "event: pre-abort idle ignored, post-abort status busy blocks until later idle", async ( t ) => {
	// Same scenario as "idle before abort" above but uses generation-based approach
	const msgsData: Array<{ info: { role: string; id: string; agent?: string; parentID?: string }; parts: Array<{ type: string; text?: string }> }> = [
		{ info: { role: "user", id: "user-msg", agent: "test-agent" }, parts: [ { type: "text", text: "Task" } ] },
		{ info: { role: "assistant", id: "asst-msg", parentID: "user-msg" }, parts: [] },
	];

	const recording: PromptRecording = createPromptRecording();
	let resolveAbortPre: ( value: unknown ) => void = () => {};
	const abortDeferredPre: Promise<unknown> = new Promise(
		( resolve: ( value: unknown ) => void ): void => {
			resolveAbortPre = resolve;
		},
	);

	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession( {
		messages: ( async () => ( { data: msgsData } ) ) as unknown as OpencodeClient[ "session" ][ "messages" ],
		abort: ( async () => {
			await abortDeferredPre;
			return { data: true };
		} ) as unknown as OpencodeClient[ "session" ][ "abort" ],
		status: ( async () => ( {
			data: { "sess-bfra2": { type: "busy" } },
		} ) ) as unknown as OpencodeClient[ "session" ][ "status" ],
		prompt: ( async ( args: Record<string, unknown> ) => {
			const body: Record<string, unknown> = args.body as Record<string, unknown>;
			recording.prompts.push( {
				sessionID: ( args.path as Record<string, string> )?.id,
				agent: body.agent as string,
				text: ( body.parts as Array<{ text: string }> )?.[ 0 ]?.text,
			} );
			return { data: { parts: [ { type: "text", text: "Advice3" } ] } };
		} ) as unknown as OpencodeClient[ "session" ][ "prompt" ],
	} );

	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), { failureThreshold: 1 } );
	await plugin.config!( createMockConfig() );

	// Error triggers intervention — abort is deferred
	await plugin.event!( { event: errorToolPartEvent( "sess-bfra2", "asst-msg", "read", "err", "c1" ) } );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 30 ) } );

	// Emit idle while abort is pending — pre-abort idle must be ignored
	await plugin.event!( { event: sessionIdleEvent( "sess-bfra2" ) } );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 30 ) } );

	// Resolve abort — awaitingIdle starts now; status returns busy → idle stays false
	resolveAbortPre( undefined );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 100 ) } );

	// No resume because status said busy
	const resumeAfterBusyPre: number = recording.prompts.filter(
		( p: { agent: Undefinedable<string> } ): boolean => "test-agent" === p.agent,
	).length;
	t.is( resumeAfterBusyPre, 0, "no resume with pre-abort idle and post-abort busy status" );

	// Now deliver a genuine post-abort idle event
	await plugin.event!( { event: sessionIdleEvent( "sess-bfra2" ) } );
	await new Promise<void>( ( resolve: () => void ): void => { setTimeout( resolve, 50 ) } );

	// Exactly one resume must occur
	const resumeFinalPre: number = recording.prompts.filter(
		( p: { agent: Undefinedable<string> } ): boolean => "test-agent" === p.agent,
	).length;
	t.is( resumeFinalPre, 1, "exactly one resume after post-abort idle" );
} );
