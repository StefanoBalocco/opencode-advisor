import { readFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import test from "ava";
import type { Config as PluginConfig, Hooks, PluginInput, PluginOptions } from "@opencode-ai/plugin";
import type { ToolContext, ToolResult } from "@opencode-ai/plugin/tool";
import type { OpencodeClient, Part, StepStartPart, TextPart } from "@opencode-ai/sdk";
import { AdvisorPlugin } from "./plugin.js";
import type { Undefinedable } from "./plugin.js";

// ── Path helpers (repo-local, no temp files) ───────────────────────────────

const __filename: string = fileURLToPath( import.meta.url );
const repoRoot: string = resolvePath( __filename, ".." );
const changelogAbs: string = resolvePath( repoRoot, "CHANGELOG.md" );

// ── Types ──────────────────────────────────────────────────────────────────

type MockSessionMethods = "messages" | "create" | "prompt" | "delete";

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
	};

	// Merge overrides for individual mock replacements
	for( const key of Object.keys( overrides ) ) {
		( session as unknown as Record<string, unknown> )[ key ] = overrides[ key ];
	}

	return session;
}

function createPluginInput(
	session: Pick<OpencodeClient[ "session" ], MockSessionMethods>,
	directory?: string,
): PluginInput {
	return { client: { session }, directory: directory ?? repoRoot } as unknown as PluginInput;
}

function createMockConfig(): PluginConfig {
	return { agent: {}, command: {} };
}

// ── parseOptions: shared vs split ──────────────────────────────────────────

test.serial( "parseOptions: undefined returns defaults", async ( t ) => {
	const cfg: PluginConfig = createMockConfig();

	const plugin: Hooks = await AdvisorPlugin( createPluginInput( createMockSession() ), undefined );
	await plugin.config!( cfg );

	const advisorAgent: Record<string, unknown> = cfg.agent![ "opencode-advisor:advisor" ] as Record<string, unknown>;
	t.truthy( advisorAgent );
	t.is( advisorAgent.model, "deepseek/deepseek-v4-pro" );
} );

test.serial( "parseOptions: empty object returns defaults", async ( t ) => {
	const cfg: PluginConfig = createMockConfig();

	const plugin: Hooks = await AdvisorPlugin( createPluginInput( createMockSession() ), {} );
	await plugin.config!( cfg );

	const advisorAgent: Record<string, unknown> = cfg.agent![ "opencode-advisor:advisor" ] as Record<string, unknown>;
	t.truthy( advisorAgent );
	t.is( advisorAgent!.model, "deepseek/deepseek-v4-pro" );
} );

test.serial( "parseOptions: null throws", async ( t ) => {
	await t.throwsAsync(
		async () => {
			await AdvisorPlugin( createPluginInput( createMockSession() ), null as unknown as undefined );
		},
		{ message: /null/ },
	);
} );

test.serial( "parseOptions: shared profile applies to both agents", async ( t ) => {
	const cfg: PluginConfig = createMockConfig();

	const plugin: Hooks = await AdvisorPlugin(
		createPluginInput( createMockSession() ),
		{ model: "anthropic/claude-opus-4-7", temperature: 0 },
	);

	await plugin.config!( cfg );

	const advisorCfg: Record<string, unknown> = cfg.agent![ "opencode-advisor:advisor" ] as Record<string, unknown>;
	const btwCfg: Record<string, unknown> = cfg.agent![ "opencode-advisor:btw" ] as Record<string, unknown>;
	t.truthy( advisorCfg );
	t.truthy( btwCfg );
	t.is( advisorCfg!.model, "anthropic/claude-opus-4-7" );
	t.is( btwCfg!.model, "anthropic/claude-opus-4-7" );
} );

test.serial( "parseOptions: split profiles work", async ( t ) => {
	const cfg: PluginConfig = createMockConfig();

	const plugin: Hooks = await AdvisorPlugin(
		createPluginInput( createMockSession() ),
		{
			advisor: { options: { reasoningEffort: "high" } },
			btw: { prompt: "Answer concisely." },
		},
	);

	await plugin.config!( cfg );

	const agent: Record<string, unknown> = cfg.agent![ "opencode-advisor:advisor" ] as Record<string, unknown>;
	t.truthy( agent );
	t.truthy( agent!.options );
	t.is( ( agent!.options as Record<string, unknown> ).reasoningEffort, "high" );
	t.is( cfg.agent![ "opencode-advisor:btw" ]!.prompt, "Answer concisely." );
} );

test.serial( "parseOptions: split section can be omitted", async ( t ) => {
	const cfg: PluginConfig = createMockConfig();

	const plugin: Hooks = await AdvisorPlugin(
		createPluginInput( createMockSession() ),
		{ advisor: { options: { reasoningEffort: "high" } } },
	);

	await plugin.config!( cfg );

	t.truthy( cfg.agent![ "opencode-advisor:advisor" ]!.options );
	t.is( cfg.agent![ "opencode-advisor:btw" ]!.model, "deepseek/deepseek-v4-pro" );
} );

test.serial( "parseOptions: null split section throws", async ( t ) => {
	await t.throwsAsync(
		async () => {
			await AdvisorPlugin(
				createPluginInput( createMockSession() ),
				{ advisor: null } as unknown as PluginOptions,
			);
		},
		{ message: /null/ },
	);
} );

test.serial( "parseOptions: mixed shared and split throws", async ( t ) => {
	await t.throwsAsync(
		async () => {
			await AdvisorPlugin(
				createPluginInput( createMockSession() ),
				{ model: "anthropic/claude-opus-4-7", advisor: {} } as unknown as PluginOptions,
			);
		},
		{ message: /Cannot mix/ },
	);
} );

test.serial( "parseOptions: unknown top-level key in split form throws", async ( t ) => {
	await t.throwsAsync(
		async () => {
			await AdvisorPlugin(
				createPluginInput( createMockSession() ),
				{ advisor: {}, unknownKey: {} } as unknown as PluginOptions,
			);
		},
		{ message: /unknownKey/ },
	);
} );

test.serial( "parseOptions: unknown profile key throws", async ( t ) => {
	await t.throwsAsync(
		async () => {
			await AdvisorPlugin(
				createPluginInput( createMockSession() ),
				{ advisor: { color: "red" } } as unknown as PluginOptions,
			);
		},
		{ message: /color/ },
	);
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

test.serial( "fixed permissions: structure is identical between agents", async ( t ) => {
	const cfg: PluginConfig = createMockConfig();

	const plugin: Hooks = await AdvisorPlugin( createPluginInput( createMockSession() ), undefined );
	await plugin.config!( cfg );

	const advisorAgent: Record<string, unknown> = cfg.agent![ "opencode-advisor:advisor" ] as Record<string, unknown>;
	const btwAgent: Record<string, unknown> = cfg.agent![ "opencode-advisor:btw" ] as Record<string, unknown>;
	t.truthy( advisorAgent );
	t.truthy( btwAgent );
	t.deepEqual( advisorAgent.permission, btwAgent.permission );
} );

// ── Hidden agent prompt replacement / defaults ─────────────────────────────

test.serial( "prompt: custom prompt replaces default", async ( t ) => {
	const cfg: PluginConfig = createMockConfig();

	const plugin: Hooks = await AdvisorPlugin(
		createPluginInput( createMockSession() ),
		{ prompt: "Custom shared prompt" },
	);

	await plugin.config!( cfg );

	t.is( cfg.agent![ "opencode-advisor:advisor" ]!.prompt, "Custom shared prompt" );
	t.is( cfg.agent![ "opencode-advisor:btw" ]!.prompt, "Custom shared prompt" );
} );

test.serial( "prompt: custom prompt per-feature", async ( t ) => {
	const cfg: PluginConfig = createMockConfig();

	const plugin: Hooks = await AdvisorPlugin(
		createPluginInput( createMockSession() ),
		{
			advisor: { prompt: "Advisor prompt" },
			btw: { prompt: "BTW prompt" },
		},
	);

	await plugin.config!( cfg );

	t.is( cfg.agent![ "opencode-advisor:advisor" ]!.prompt, "Advisor prompt" );
	t.is( cfg.agent![ "opencode-advisor:btw" ]!.prompt, "BTW prompt" );
} );

test.serial( "prompt: empty string in shared profile replaces default", async ( t ) => {
	const cfg: PluginConfig = createMockConfig();

	const plugin: Hooks = await AdvisorPlugin(
		createPluginInput( createMockSession() ),
		{ prompt: "" },
	);

	await plugin.config!( cfg );

	t.is( cfg.agent![ "opencode-advisor:advisor" ]!.prompt, "" );
	t.is( cfg.agent![ "opencode-advisor:btw" ]!.prompt, "" );
} );

test.serial( "prompt: empty string in split profile replaces default per-feature", async ( t ) => {
	const cfg: PluginConfig = createMockConfig();

	const plugin: Hooks = await AdvisorPlugin(
		createPluginInput( createMockSession() ),
		{
			advisor: { prompt: "" },
			btw: { prompt: "" },
		},
	);

	await plugin.config!( cfg );

	t.is( cfg.agent![ "opencode-advisor:advisor" ]!.prompt, "" );
	t.is( cfg.agent![ "opencode-advisor:btw" ]!.prompt, "" );
} );

// ── {file:path} prompt feature ─────────────────────────────────────────────

test.serial( "prompt: shared {file:} relative path reads file content", async ( t ) => {
	const cfg: PluginConfig = createMockConfig();
	const expectedContent: string = await readFile( changelogAbs, "utf-8" );

	const plugin: Hooks = await AdvisorPlugin(
		createPluginInput( createMockSession() ),
		{ prompt: "{file:CHANGELOG.md}" },
	);

	await plugin.config!( cfg );

	t.is( cfg.agent![ "opencode-advisor:advisor" ]!.prompt, expectedContent );
	t.is( cfg.agent![ "opencode-advisor:btw" ]!.prompt, expectedContent );
} );

test.serial( "prompt: split {file:} relative and absolute paths work independently", async ( t ) => {
	const cfg: PluginConfig = createMockConfig();
	const expectedContent: string = await readFile( changelogAbs, "utf-8" );

	const plugin: Hooks = await AdvisorPlugin(
		createPluginInput( createMockSession() ),
		{
			advisor: { prompt: "{file:CHANGELOG.md}" },
			btw: { prompt: `{file:${changelogAbs}}` },
		},
	);

	await plugin.config!( cfg );

	t.is( cfg.agent![ "opencode-advisor:advisor" ]!.prompt, expectedContent );
	t.is( cfg.agent![ "opencode-advisor:btw" ]!.prompt, expectedContent );
} );

test.serial( "prompt: {file:} empty path rejected during init", async ( t ) => {
	const err: Error = await t.throwsAsync( async () => {
		await AdvisorPlugin(
			createPluginInput( createMockSession() ),
			{ prompt: "{file:}" } as unknown as PluginOptions,
		);
	} );
	t.truthy( err.message.includes( "{file:}" ), "error must name the {file:} reference" );
	t.truthy( err.message.includes( "must have a non-empty path" ), "error must state path is empty" );
} );

test.serial( "prompt: {file:} missing path fails with reference and resolved path", async ( t ) => {
	const err: Error = await t.throwsAsync( async () => {
		await AdvisorPlugin(
			createPluginInput( createMockSession() ),
			{ prompt: "{file:non-existent-file.md}" } as unknown as PluginOptions,
		);
	} );
	t.truthy( err.message.includes( "{file:non-existent-file.md}" ), "error must contain original file ref" );
	t.truthy( err.message.includes( resolvePath( repoRoot, "non-existent-file.md" ) ), "error must contain resolved absolute path" );
} );

test.serial( "prompt: {file:.} directory target fails with reference and resolved path", async ( t ) => {
	const err: Error = await t.throwsAsync( async () => {
		await AdvisorPlugin(
			createPluginInput( createMockSession() ),
			{ prompt: "{file:.}" } as unknown as PluginOptions,
		);
	} );
	t.truthy( err.message.includes( "{file:.}" ), "error must contain original file ref" );
	t.truthy( err.message.includes( repoRoot ), "error must contain resolved absolute path" );
} );

test.serial( "prompt: non-exact {file:x} forms remain literal and do not fail", async ( t ) => {
	const cfg: PluginConfig = createMockConfig();

	// Leading space
	const plugin1: Hooks = await AdvisorPlugin(
		createPluginInput( createMockSession() ),
		{ prompt: " {file:CHANGELOG.md}" } as unknown as PluginOptions,
	);
	await plugin1.config!( cfg );
	t.is( cfg.agent![ "opencode-advisor:advisor" ]!.prompt, " {file:CHANGELOG.md}" );

	// Trailing space
	const plugin2: Hooks = await AdvisorPlugin(
		createPluginInput( createMockSession() ),
		{ prompt: "{file:CHANGELOG.md} " } as unknown as PluginOptions,
	);
	await plugin2.config!( cfg );
	t.is( cfg.agent![ "opencode-advisor:advisor" ]!.prompt, "{file:CHANGELOG.md} " );

	// Missing closing brace
	const plugin3: Hooks = await AdvisorPlugin(
		createPluginInput( createMockSession() ),
		{ prompt: "{file:CHANGELOG.md" } as unknown as PluginOptions,
	);
	await plugin3.config!( cfg );
	t.is( cfg.agent![ "opencode-advisor:advisor" ]!.prompt, "{file:CHANGELOG.md" );

	// Inline text containing {file:...}
	const plugin4: Hooks = await AdvisorPlugin(
		createPluginInput( createMockSession() ),
		{ prompt: "prefix{file:CHANGELOG.md}suffix" } as unknown as PluginOptions,
	);
	await plugin4.config!( cfg );
	t.is( cfg.agent![ "opencode-advisor:advisor" ]!.prompt, "prefix{file:CHANGELOG.md}suffix" );
} );

// ── Config hook: /btw command registration ─────────────────────────────────

test.serial( "config hook: registers /btw command when absent", async ( t ) => {
	const cfg: PluginConfig = createMockConfig();

	const plugin: Hooks = await AdvisorPlugin( createPluginInput( createMockSession() ), undefined );
	await plugin.config!( cfg );

	t.truthy( cfg.command!.btw );
	t.deepEqual( cfg.command!.btw, { template: "$ARGUMENTS" } );
} );

test.serial( "config hook: does not overwrite existing /btw command", async ( t ) => {
	const userCommand: { template: string; description: string } = { template: "$ARGUMENTS", description: "My custom btw" };
	const cfg: PluginConfig = { agent: {}, command: { btw: userCommand } };

	const plugin: Hooks = await AdvisorPlugin( createPluginInput( createMockSession() ), undefined );
	await plugin.config!( cfg );

	t.is( cfg.command!.btw, userCommand );
} );

// ── Default-command ownership gating ──────────────────────────────────────

test.serial( "ownership: intercepts /btw when plugin owns default command", async ( t ) => {
	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession();
	const cfg: PluginConfig = createMockConfig(); // no user btw command → plugin owns it
	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), undefined );
	await plugin.config!( cfg );

	// Default command was registered
	t.truthy( cfg.command!.btw );

	// Hook mutates output as expected (interception proof)
	const existingPart: TextPart = { id: "pid-own", sessionID: "sess-own", messageID: "msg-own", type: "text", text: "" };
	const output: { parts: Part[] } = { parts: [ existingPart ] };
	const hook: NonNullable<Hooks[ "command.execute.before" ]> = plugin[ "command.execute.before" ]!;
	await hook( { command: "btw", sessionID: "sess-own", arguments: "hello?" }, output );

	t.is( existingPart.text, "[BTW] hello?..." );
} );

test.serial( "ownership: survives second config invocation on same config object", async ( t ) => {
	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession();
	const cfg: PluginConfig = createMockConfig(); // no user btw command → plugin owns it
	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), undefined );

	// First config invocation — installs default command
	await plugin.config!( cfg );
	t.truthy( cfg.command!.btw );

	// Second config invocation on the same cfg object — must recognise the command it installed
	await plugin.config!( cfg );

	// Hook must still intercept /btw
	const existingPart: TextPart = { id: "pid-reconfig", sessionID: "sess-reconfig", messageID: "msg-reconfig", type: "text", text: "" };
	const output: { parts: Part[] } = { parts: [ existingPart ] };
	const hook: NonNullable<Hooks[ "command.execute.before" ]> = plugin[ "command.execute.before" ]!;
	await hook( { command: "btw", sessionID: "sess-reconfig", arguments: "still works?" }, output );

	t.is( existingPart.text, "[BTW] still works?...", "hook must still intercept after second config call" );
} );

test.serial( "ownership: does NOT intercept /btw when user owns command", async ( t ) => {
	let createCalled: boolean = false;

	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession( {
		create: ( async () => {
			createCalled = true;
			return { data: { id: "should-not-be-called" } };
		} ) as unknown as OpencodeClient[ "session" ][ "create" ],
	} );

	const userCommand: { template: string; description: string } = { template: "$ARGUMENTS", description: "My custom btw" };
	const cfg: PluginConfig = { agent: {}, command: { btw: userCommand } };
	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), undefined );
	await plugin.config!( cfg );

	// 1. Command config is structurally unchanged (same reference, all fields intact)
	t.is( cfg.command!.btw, userCommand );

	// 2. Hook is a no-op — output unchanged, no session API called
	const originalText: string = "original output unchanged";
	const existingPart: TextPart = { id: "pid-user", sessionID: "sess-user", messageID: "msg-user", type: "text", text: originalText };
	const output: { parts: Part[] } = { parts: [ existingPart ] };
	const hook: NonNullable<Hooks[ "command.execute.before" ]> = plugin[ "command.execute.before" ]!;
	await hook( { command: "btw", sessionID: "sess-user", arguments: "anything" }, output );

	t.is( existingPart.text, originalText, "hook must NOT mutate output when user owns /btw" );
	t.falsy( createCalled, "session.create must NOT be called when user owns /btw" );
} );

// ── BTW missing-session failure produces a card ────────────────────────────

test.serial( "BTW: missing session ID appends failure card", async ( t ) => {
	const captured: { text: Undefinedable<string> } = { text: undefined };

	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession( {
		create: ( async () => ( { data: {} } ) ) as unknown as OpencodeClient[ "session" ][ "create" ],
		prompt: ( async ( args: { body?: { noReply?: boolean; parts?: Array<{ text?: string }> } } ) => {
			if( args?.body?.noReply ) {
				captured.text = args.body.parts?.[ 0 ]?.text;
			}
			return { data: { parts: [ { type: "text", text: "" } ] } };
		} ) as unknown as OpencodeClient[ "session" ][ "prompt" ],
	} );

	const cfg: PluginConfig = createMockConfig();
	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), undefined );
	await plugin.config!( cfg );

	const input: { command: string; sessionID: string; arguments: string } = { command: "btw", sessionID: "sess-1", arguments: "test query" };
	const output: { parts: Part[] } = { parts: [] };
	const hook: NonNullable<Hooks[ "command.execute.before" ]> = plugin[ "command.execute.before" ]!;
	await hook( input, output );

	// Wait for background processing + card append
	await new Promise( ( resolve: ( value: void ) => void ) => setTimeout( resolve, 150 ) );

	t.truthy( captured.text, "Expected a failure card to be appended" );
	t.truthy( captured.text!.includes( "⚠️" ), `Card should contain warning emoji, got: ${captured.text}` );
	t.truthy(
		captured.text!.toLowerCase().includes( "error" ) || captured.text!.includes( "BTW" ),
		`Card should indicate error, got: ${captured.text}`,
	);
} );

// ── Session cleanup behavior ───────────────────────────────────────────────

test.serial( "session cleanup: ephemeral session is deleted after use", async ( t ) => {
	const captured: { called: boolean; id: Undefinedable<string> } = { called: false, id: undefined };

	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession( {
		delete: ( async ( args: { path?: { id?: string } } ) => {
			captured.called = true;
			captured.id = args?.path?.id;
		} ) as unknown as OpencodeClient[ "session" ][ "delete" ],
	} );

	const cfg: PluginConfig = createMockConfig();
	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), undefined );
	await plugin.config!( cfg );

	const input: { command: string; sessionID: string; arguments: string } = { command: "btw", sessionID: "sess-1", arguments: "test cleanup" };
	const output: { parts: Part[] } = { parts: [] };
	const hook: NonNullable<Hooks[ "command.execute.before" ]> = plugin[ "command.execute.before" ]!;
	await hook( input, output );

	// Wait for background processing
	await new Promise( ( resolve: ( value: void ) => void ) => setTimeout( resolve, 150 ) );

	t.truthy( captured.called, "Expected session.delete to be called" );
	t.is( captured.id, "temp-session-1" );
} );

test.serial( "session cleanup: delete failure does not throw", async ( t ) => {
	const captured: { callCount: number } = { callCount: 0 };

	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession( {
		delete: ( async () => {
			captured.callCount++;
			throw new Error( "Simulated delete failure" );
		} ) as unknown as OpencodeClient[ "session" ][ "delete" ],
	} );

	const cfg: PluginConfig = createMockConfig();
	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), undefined );
	await plugin.config!( cfg );

	const input: { command: string; sessionID: string; arguments: string } = { command: "btw", sessionID: "sess-1", arguments: "test delete failure" };
	const output: { parts: Part[] } = { parts: [] };
	const hook: NonNullable<Hooks[ "command.execute.before" ]> = plugin[ "command.execute.before" ]!;
	await hook( input, output );

	// Wait for background processing
	await new Promise( ( resolve: ( value: void ) => void ) => setTimeout( resolve, 150 ) );

	// Force assertion: delete was called and failed, but no unhandled rejection
	t.is( captured.callCount, 1 );
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

test.serial( "profile: unknown nested key in split form", async ( t ) => {
	await t.throwsAsync(
		async () => {
			await AdvisorPlugin(
				createPluginInput( createMockSession() ),
				{ advisor: { options: { reasoningEffort: "high" }, color: "red" } } as unknown as PluginOptions,
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

test.serial( "hidden agents: both agents have hidden=true, mode=subagent", async ( t ) => {
	const cfg: PluginConfig = createMockConfig();
	const plugin: Hooks = await AdvisorPlugin( createPluginInput( createMockSession() ), {} );
	await plugin.config!( cfg );

	const advisorAgent: Record<string, unknown> = cfg.agent![ "opencode-advisor:advisor" ] as Record<string, unknown>;
	const btwAgent: Record<string, unknown> = cfg.agent![ "opencode-advisor:btw" ] as Record<string, unknown>;
	t.truthy( advisorAgent );
	t.truthy( btwAgent );

	t.is( advisorAgent.hidden, true, "advisor agent must be hidden" );
	t.is( btwAgent.hidden, true, "btw agent must be hidden" );
	t.is( advisorAgent.mode, "subagent" );
	t.is( btwAgent.mode, "subagent" );
} );

test.serial( "hidden agents: default prompt is built-in, custom prompt replaces", async ( t ) => {
	// When profile prompt is absent, the default prompt is present via ??
	// fallback in buildAgentConfig. Custom prompt would replace it.
	const cfg: PluginConfig = createMockConfig();
	const plugin: Hooks = await AdvisorPlugin( createPluginInput( createMockSession() ), undefined );
	await plugin.config!( cfg );

	const advisorAgent: Record<string, unknown> = cfg.agent![ "opencode-advisor:advisor" ] as Record<string, unknown>;
	t.truthy( advisorAgent.prompt );
	t.truthy( 50 < ( advisorAgent.prompt as string ).length );
} );

test.serial( "hidden agents: profile params map to agent config", async ( t ) => {
	const cfg: PluginConfig = createMockConfig();
	const plugin: Hooks = await AdvisorPlugin(
		createPluginInput( createMockSession() ),
		{
			advisor: {
				temperature: 0.7,
				top_p: 0.9,
				variant: "test-variant",
				options: { customOpt: true },
			},
		},
	);
	await plugin.config!( cfg );

	const agent: Record<string, unknown> = cfg.agent![ "opencode-advisor:advisor" ] as Record<string, unknown>;
	t.is( agent.temperature, 0.7 );
	t.is( agent.top_p, 0.9 );
	t.is( agent.variant, "test-variant" );
	t.deepEqual( agent.options, { customOpt: true } );
} );

test.serial( "hidden agents: complete fixed permission policy exercised", async ( t ) => {
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

// ── 1d. BTW success lifecycle ────────────────────────────────────────────────

test.serial( "BTW success: full lifecycle — transcript, prompt with agent only, text extract, session delete, result card", async ( t ) => {
	const captured: {
		messagesCalled: boolean;
		createTitle: Undefinedable<string>;
		promptAgent: Undefinedable<string>;
		promptModel: unknown;
		promptSystem: unknown;
		promptTools: unknown;
		promptText: Undefinedable<string>;
		deleteSessionID: Undefinedable<string>;
		noReplyParts: Undefinedable<string>;
	} = {
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

	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession( {
		messages: ( async () => {
			captured.messagesCalled = true;
			return {
				data: [
					{ info: { role: "user", id: "msg-1" }, parts: [ { type: "text", text: "Hello" } ] },
				],
			};
		} ) as unknown as OpencodeClient[ "session" ][ "messages" ],
		create: ( async ( args: { body?: { title?: string } } ) => {
			captured.createTitle = args?.body?.title;
			return { data: { id: "btw-ephemeral" } };
		} ) as unknown as OpencodeClient[ "session" ][ "create" ],
		prompt: ( async ( args: {
			body?: { agent?: string; model?: unknown; system?: unknown; tools?: unknown; noReply?: boolean; parts?: Array<{ type: string; text?: string }> };
		} ) => {
			if( args?.body?.noReply ) {
				captured.noReplyParts = args.body.parts?.[ 0 ]?.text;
				return { data: { parts: [] } };
			}
			captured.promptAgent = args?.body?.agent;
			captured.promptModel = args?.body?.model;
			captured.promptSystem = args?.body?.system;
			captured.promptTools = args?.body?.tools;
			captured.promptText = args?.body?.parts?.[ 0 ]?.text;
			return { data: { parts: [ { type: "text", text: "BTW answer here" } ] } };
		} ) as unknown as OpencodeClient[ "session" ][ "prompt" ],
		delete: ( async ( args: { path?: { id?: string } } ) => {
			captured.deleteSessionID = args?.path?.id;
		} ) as unknown as OpencodeClient[ "session" ][ "delete" ],
	} );

	const cfg: PluginConfig = createMockConfig();
	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), undefined );
	await plugin.config!( cfg );

	const output: { parts: Part[] } = { parts: [] };
	const hook: NonNullable<Hooks[ "command.execute.before" ]> = plugin[ "command.execute.before" ]!;
	await hook( { command: "btw", sessionID: "main-sess", arguments: "What's up?" }, output );

	// Wait for background processing
	await new Promise( ( resolve: ( value: void ) => void ) => setTimeout( resolve, 150 ) );

	// 1. Transcript retrieval
	t.truthy( captured.messagesCalled, "transcript was fetched" );
	t.truthy( captured.promptText, "prompt text was built from transcript" );
	t.truthy( captured.promptText!.includes( "Hello" ), "transcript content included" );
	t.truthy( captured.promptText!.includes( "What's up?" ), "query included in prompt" );

	// 2. Ephemeral session created with title
	t.is( captured.createTitle, "btw-subcall" );

	// 3. Prompt used BTW hidden agent only — no model/system/tools in body
	t.is( captured.promptAgent, "opencode-advisor:btw" );
	t.is( captured.promptModel, undefined, "no model in prompt body" );
	t.is( captured.promptSystem, undefined, "no system in prompt body" );
	t.is( captured.promptTools, undefined, "no tools in prompt body" );

	// 4. Text extracted from response — no failure text in answer
	t.truthy( captured.noReplyParts, "result card was appended" );
	t.truthy( captured.noReplyParts!.includes( "BTW answer here" ), "answer text in card" );
	t.falsy( captured.noReplyParts!.includes( "Error" ), "no error text in success card" );
	t.falsy( captured.noReplyParts!.includes( "⚠️" ), "no warning in success card" );

	// 5. Ephemeral session deleted
	t.is( captured.deleteSessionID, "btw-ephemeral", "ephemeral session deleted" );
} );

test.serial( "BTW: undefined messages data tolerates missing transcript and returns normal answer", async ( t ) => {
	const captured: {
		messagesCalled: boolean;
		promptText: Undefinedable<string>;
		noReplyParts: Undefinedable<string>;
		promptAgent: Undefinedable<string>;
		deleteSessionID: Undefinedable<string>;
	} = {
		messagesCalled: false,
		promptText: undefined,
		noReplyParts: undefined,
		promptAgent: undefined,
		deleteSessionID: undefined,
	};

	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession( {
		messages: ( async () => {
			captured.messagesCalled = true;
			return { data: undefined };
		} ) as unknown as OpencodeClient[ "session" ][ "messages" ],
		create: ( async () => ( { data: { id: "btw-ephemeral-undef" } } ) ) as unknown as OpencodeClient[ "session" ][ "create" ],
		prompt: ( async ( args: {
			body?: { agent?: string; model?: unknown; system?: unknown; tools?: unknown; noReply?: boolean; parts?: Array<{ type: string; text?: string }> };
		} ) => {
			if( args?.body?.noReply ) {
				captured.noReplyParts = args.body.parts?.[ 0 ]?.text;
				return { data: { parts: [] } };
			}
			captured.promptAgent = args?.body?.agent;
			captured.promptText = args?.body?.parts?.[ 0 ]?.text;
			return { data: { parts: [ { type: "text", text: "BTW answer without context" } ] } };
		} ) as unknown as OpencodeClient[ "session" ][ "prompt" ],
		delete: ( async ( args: { path?: { id?: string } } ) => {
			captured.deleteSessionID = args?.path?.id;
		} ) as unknown as OpencodeClient[ "session" ][ "delete" ],
	} );

	const cfg: PluginConfig = createMockConfig();
	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), undefined );
	await plugin.config!( cfg );

	const output: { parts: Part[] } = { parts: [] };
	const hook: NonNullable<Hooks[ "command.execute.before" ]> = plugin[ "command.execute.before" ]!;
	await hook( { command: "btw", sessionID: "main-sess-undef", arguments: "question?" }, output );

	await new Promise( ( resolve: ( value: void ) => void ) => setTimeout( resolve, 150 ) );

	// 1. Messages was called (returned undefined data)
	t.truthy( captured.messagesCalled, "messages() was called" );

	// 2. Prompt was sent with only the query (no transcript context)
	t.truthy( captured.promptText, "prompt text was built" );
	t.is( captured.promptText, "question?", "prompt text equals the bare query when transcript is empty" );

	// 3. Prompt used BTW hidden agent
	t.is( captured.promptAgent, "opencode-advisor:btw" );

	// 4. Success card appended (not failure)
	t.truthy( captured.noReplyParts, "result card was appended" );
	t.truthy( captured.noReplyParts!.includes( "question?" ), "query in card" );
	t.truthy( captured.noReplyParts!.includes( "BTW answer without context" ), "answer text in card" );
	t.falsy( captured.noReplyParts!.includes( "⚠️" ), "no warning in success card" );

	// 5. Ephemeral session deleted
	t.is( captured.deleteSessionID, "btw-ephemeral-undef", "ephemeral session deleted" );
} );

// ── 3. Command output shape ───────────────────────────────────────────────────

test.serial( "command.execute.before: mutates existing text part, preserves identity", async ( t ) => {
	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession();
	const cfg: PluginConfig = createMockConfig();
	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), undefined );
	await plugin.config!( cfg );

	const existingPart: TextPart = {
		id: "part-id-1",
		sessionID: "sess-1",
		messageID: "msg-1",
		type: "text",
		text: "",
	};
	const output: { parts: Part[] } = { parts: [ existingPart ] };
	const hook: NonNullable<Hooks[ "command.execute.before" ]> = plugin[ "command.execute.before" ]!;
	await hook( { command: "btw", sessionID: "sess-1", arguments: "test identity" }, output );

	t.is( output.parts.length, 1 );
	t.is( output.parts[ 0 ], existingPart );
	t.is( existingPart.text, "[BTW] test identity..." );

	// Identity fields preserved — same ref, fields unchanged
	t.is( existingPart.id, "part-id-1" );
	t.is( existingPart.sessionID, "sess-1" );
	t.is( existingPart.messageID, "msg-1" );
} );

test.serial( "command.execute.before: empty query preserves identity", async ( t ) => {
	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession();
	const cfg: PluginConfig = createMockConfig();
	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), undefined );
	await plugin.config!( cfg );

	const existingPart: Part = {
		id: "part-id-empty",
		sessionID: "sess-empty",
		messageID: "msg-empty",
		type: "text",
		text: "",
	};
	const output: { parts: Part[] } = { parts: [ existingPart ] };
	const hook: NonNullable<Hooks[ "command.execute.before" ]> = plugin[ "command.execute.before" ]!;
	await hook( { command: "btw", sessionID: "sess-empty", arguments: "" }, output );

	t.is( output.parts.length, 1 );
	const part: Record<string, unknown> = output.parts[ 0 ] as Record<string, unknown>;
	t.is( part.text, "Usage: /btw <question> — answers a one-shot question in background." );
	t.is( part.id, "part-id-empty" );
	t.is( part.sessionID, "sess-empty" );
	t.is( part.messageID, "msg-empty" );
} );

test.serial( "command.execute.before: recursive error preserves identity", async ( t ) => {
	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession( {
		// Delay messages to keep processBtw running so inBtwCall stays true
		messages: ( async () => {
			await new Promise( ( resolve: ( value: void ) => void ) => setTimeout( resolve, 500 ) );
			return { data: [] };
		} ) as unknown as OpencodeClient[ "session" ][ "messages" ],
	} );

	const cfg: PluginConfig = createMockConfig();
	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), undefined );
	await plugin.config!( cfg );

	const hook: NonNullable<Hooks[ "command.execute.before" ]> = plugin[ "command.execute.before" ]!;

	// First call — sets inBtwCall = true, fires processBtw (500ms delay)
	const output1: { parts: Part[] } = {
		parts: [ { id: "part-rec-1", sessionID: "sess-rec", messageID: "msg-rec", type: "text", text: "" } ],
	};
	await hook( { command: "btw", sessionID: "sess-rec", arguments: "first" }, output1 );

	// Second call — inBtwCall is still true since processBtw hasn't resolved yet
	const output2: { parts: Part[] } = {
		parts: [ { id: "part-rec-2", sessionID: "sess-rec", messageID: "msg-rec", type: "text", text: "" } ],
	};
	await hook( { command: "btw", sessionID: "sess-rec", arguments: "second" }, output2 );

	t.is( output2.parts.length, 1 );
	const part: Record<string, unknown> = output2.parts[ 0 ] as Record<string, unknown>;
	t.truthy( ( part.text as string ).includes( "already running" ) );
	t.is( part.id, "part-rec-2" );
	t.is( part.sessionID, "sess-rec" );
	t.is( part.messageID, "msg-rec" );
} );

test.serial( "command.execute.before: non-text part preserved unchanged", async ( t ) => {
	const session: Pick<OpencodeClient[ "session" ], MockSessionMethods> = createMockSession();
	const cfg: PluginConfig = createMockConfig();
	const plugin: Hooks = await AdvisorPlugin( createPluginInput( session ), undefined );
	await plugin.config!( cfg );

	const nonTextPart: StepStartPart = {
		id: "part-start-1",
		sessionID: "sess-start",
		messageID: "msg-start",
		type: "step-start",
	};
	const output: { parts: Part[] } = { parts: [ nonTextPart ] };
	const hook: NonNullable<Hooks[ "command.execute.before" ]> = plugin[ "command.execute.before" ]!;
	await hook( { command: "btw", sessionID: "sess-start", arguments: "something" }, output );

	t.is( output.parts.length, 1 );
	t.is( output.parts[ 0 ], nonTextPart );
	t.is( output.parts[ 0 ].type, "step-start" );
	t.is( output.parts[ 0 ].id, "part-start-1" );
	t.is( output.parts[ 0 ].sessionID, "sess-start" );
	t.is( output.parts[ 0 ].messageID, "msg-start" );
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

test.serial( "profile: bare string advisor section throws", async ( t ) => {
	await t.throwsAsync(
		async () => {
			await AdvisorPlugin(
				createPluginInput( createMockSession() ),
				{ advisor: "bare-string" } as unknown as PluginOptions,
			);
		},
		{ message: /advisor.*must be a non-array object/ },
	);
} );

test.serial( "profile: numeric advisor section throws", async ( t ) => {
	await t.throwsAsync(
		async () => {
			await AdvisorPlugin(
				createPluginInput( createMockSession() ),
				{ advisor: 42 } as unknown as PluginOptions,
			);
		},
		{ message: /advisor.*must be a non-array object/ },
	);
} );

test.serial( "parseOptions: array root throws", async ( t ) => {
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

test.serial( "parseOptions: string root throws", async ( t ) => {
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

	t.truthy( cfg.agent![ "opencode-advisor:advisor" ] );
	t.truthy( cfg.command!.btw );
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
