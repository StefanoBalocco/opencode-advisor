import type { Config as PluginConfig, Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import type { OpencodeClient, Part, TextPart, TextPartInput } from "@opencode-ai/sdk";

// ── Constants ──────────────────────────────────────────────────────────────

const defaultModel: string = "deepseek/deepseek-v4-pro";
const advisorAgent: string = "opencode-advisor:advisor";
const btwAgent: string = "opencode-advisor:btw";

// ── Default prompts ────────────────────────────────────────────────────────

const advisorDefaultPrompt: string = `You are a strategic advisor for a coding agent. Read the conversation transcript and provide a concise plan or course correction.

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

const btwDefaultPrompt: string = `You are a helpful assistant answering a by-the-way question. You have access to the conversation transcript and the workspace.

Use the conversation context to understand what the user is working on, then answer their question concisely. You may use read-only tools (read, glob, grep, webfetch, websearch, skill) to inspect the workspace or public web.

Respond in under 300 words. Do NOT ask follow-up questions — this is a one-shot interaction. Do NOT edit any files.`;

const advisorToolDescription: string = `Consult a strategic advisor (backed by a stronger reviewer model, configurable; defaults to DeepSeek V4 Pro) that reads your full conversation context and provides a concise plan or course correction.

Call advisor BEFORE substantive work — before writing code, editing files, committing to an interpretation, or building on an assumption. If the task requires orientation first (finding files, reading code, fetching docs), do that, then call advisor. Orientation is NOT substantive work.

Also call advisor:
- When stuck — errors recurring, approach not converging, results that don't fit
- When considering a change of approach
- When you believe the task is complete. BEFORE this call, make your deliverable durable: write the file, save the result, commit the change

On tasks longer than a few steps, call advisor at least once before committing to an approach and once before declaring done. On short reactive turns where tool output directly dictates the next action, skip advisor.

Give the advice serious weight. Only override if you have primary-source evidence that contradicts a specific claim. Surface conflicts in another advisor call rather than silently switching approaches.`;

// ── Fixed permission policy ────────────────────────────────────────────────
// Object property order matters: later matching rules override the wildcard deny.

const fixedPermission: Record<string, unknown> = {
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

const fixedTools: Record<string, boolean> = {
	read: true,
	glob: true,
	grep: true,
	webfetch: true,
	websearch: true,
	skill: true,
	edit: false,
};

// ── Profile types ──────────────────────────────────────────────────────────

interface Profile {
	model?: string;
	variant?: string;
	prompt?: string;
	temperature?: number;
	top_p?: number;
	options?: Record<string, unknown>;
}

// ── General utility types ────────────────────────────────────────────────────

export type Undefinedable<T> = T | undefined;

// Allowed profile keys (order is descriptive, not enforced)
const profileKeys: Set<string> = new Set( [
	"model",
	"variant",
	"prompt",
	"temperature",
	"top_p",
	"options",
] );

const splitKeys: Set<string> = new Set( [ "advisor", "btw" ] );

// ── Validation helpers ─────────────────────────────────────────────────────

function assertString( v: unknown, label: string, allowEmpty: boolean = false ): asserts v is string {
	if( "string" === typeof v ) {
		if( !allowEmpty && ( 0 === v.length ) ) {
			throw new Error( `${label}: must not be empty` );
		}
	} else {
		throw new Error( `${label}: must be a string, got ${typeof v}` );
	}
}

function assertFiniteNumber( v: unknown, label: string ): asserts v is number {
	if( "number" === typeof v ) {
		if( !Number.isFinite( v ) ) {
			throw new Error( `${label}: must be a finite number, got ${v}` );
		}
	} else {
		throw new Error( `${label}: must be a finite number, got ${typeof v}` );
	}
}

function isPlainObject( v: unknown ): v is Record<string, unknown> {
	return ( "object" === typeof v ) && ( null !== v ) && !Array.isArray( v ) &&
		( ( Object.prototype === Object.getPrototypeOf( v ) ) || ( null === Object.getPrototypeOf( v ) ) );
}

function assertValidOptionsValue( v: unknown, path: string ): void {
	if( null === v ) {
		// null is valid — no-op
	} else if( "boolean" === typeof v ) {
		// boolean valid — no-op
	} else if( "string" === typeof v ) {
		// string valid — no-op
	} else if( "number" === typeof v ) {
		if( !Number.isFinite( v ) ) {
			throw new Error( `${path}: must be a finite number` );
		}
	} else if( Array.isArray( v ) ) {
		for( let iL1: number = 0; iL1 < v.length; iL1++ ) {
			assertValidOptionsValue( v[ iL1 ], `${path}[${iL1}]` );
		}
	} else if( isPlainObject( v ) ) {
		const keys: string[] = Object.keys( v );
		for( let iL1: number = 0; iL1 < keys.length; iL1++ ) {
			assertValidOptionsValue( v[ keys[ iL1 ] ], `${path}.${keys[ iL1 ]}` );
		}
	} else {
		throw new Error( `${path}: invalid option type ${typeof v}` );
	}
}

function assertValidOptions( v: unknown, path: string ): asserts v is Record<string, unknown> {
	if( isPlainObject( v ) ) {
		const keys: string[] = Object.keys( v );
		for( let iL1: number = 0; iL1 < keys.length; iL1++ ) {
			assertValidOptionsValue( v[ keys[ iL1 ] ], `${path}.${keys[ iL1 ]}` );
		}
	} else {
		throw new Error( `${path}: must be a non-array object, got ${null === v ? "null" : typeof v}` );
	}
}

// ── Profile parser ─────────────────────────────────────────────────────────

function parseProfile( value: unknown, section: string ): Profile {
	let returnValue: Profile;

	if( isPlainObject( value ) ) {
		const obj: Record<string, unknown> = value;
		const objKeys: string[] = Object.keys( obj );

		// Check for unknown keys
		for( let iL1: number = 0; iL1 < objKeys.length; iL1++ ) {
			if( !profileKeys.has( objKeys[ iL1 ] ) ) {
				throw new Error( `${section}: unknown key "${objKeys[ iL1 ]}". Allowed: ${Array.from( profileKeys ).join( ", " )}` );
			}
		}

		const profile: Profile = {};

		if( undefined !== obj.model ) {
			assertString( obj.model, `${section}.model` );
			const slashIdx: number = obj.model.indexOf( "/" );
			if( ( 0 >= slashIdx ) || ( ( obj.model.length - 1 ) <= slashIdx ) ) {
				throw new Error( `${section}.model: must be "provider/model", got "${obj.model}"` );
			}
			profile.model = obj.model;
		}

		if( undefined !== obj.variant ) {
			assertString( obj.variant, `${section}.variant`, true );
			profile.variant = obj.variant;
		}

		if( undefined !== obj.prompt ) {
			assertString( obj.prompt, `${section}.prompt`, true ); // allow empty — replaces default
			profile.prompt = obj.prompt;
		}

		if( undefined !== obj.temperature ) {
			assertFiniteNumber( obj.temperature, `${section}.temperature` );
			profile.temperature = obj.temperature;
		}

		if( undefined !== obj.top_p ) {
			assertFiniteNumber( obj.top_p, `${section}.top_p` );
			profile.top_p = obj.top_p;
		}

		if( undefined !== obj.options ) {
			assertValidOptions( obj.options, `${section}.options` );
			profile.options = structuredClone( obj.options ) as Record<string, unknown>;
		}

		returnValue = profile;
	} else if( undefined === value ) {
		returnValue = {};
	} else if( null === value ) {
		throw new Error( `${section}: must be a non-array object when present; got null` );
	} else {
		throw new Error( `${section}: must be a non-array object when present` );
	}

	return returnValue;
}

// ── Root options parser ────────────────────────────────────────────────────

function parseOptions( raw: unknown ): { advisor: Profile; btw: Profile } {
	let returnValue: { advisor: Profile; btw: Profile };

	if( undefined === raw ) {
		returnValue = { advisor: {}, btw: {} };
	} else if( null === raw ) {
		throw new Error(
			"Plugin options must be a non-array object or absent; got null. " +
			"Use either shared profile keys or { advisor: ..., btw: ... }.",
		);
	} else if( isPlainObject( raw ) ) {
		const obj: Record<string, unknown> = raw;
		const keys: string[] = Object.keys( obj );

		const hasSplit: boolean = keys.some( ( k: string ): boolean => splitKeys.has( k ) );
		const hasProfile: boolean = keys.some( ( k: string ): boolean => profileKeys.has( k ) );

		if( hasSplit && hasProfile ) {
			throw new Error(
				"Cannot mix profile keys (model, variant, prompt, temperature, top_p, options) " +
				"with section keys (advisor, btw). Use one shape exclusively.",
			);
		}

		if( hasSplit ) {
			// Validate no unknown keys at top level
			for( let iL1: number = 0; iL1 < keys.length; iL1++ ) {
				if( !splitKeys.has( keys[ iL1 ] ) ) {
					throw new Error( `Unknown top-level key "${keys[ iL1 ]}". Use only "advisor" and/or "btw".` );
				}
			}
			returnValue = {
				advisor: parseProfile( obj.advisor, "advisor" ),
				btw: parseProfile( obj.btw, "btw" ),
			};
		} else {
			const shared: Profile = parseProfile( obj, "root plugin options" );
			returnValue = { advisor: shared, btw: shared };
		}
	} else {
		throw new Error(
			"Plugin options must be a non-array object or absent. " +
			"Use either shared profile keys or { advisor: ..., btw: ... }.",
		);
	}

	return returnValue;
}

// ── Model resolution ───────────────────────────────────────────────────────

function resolveModel(
	profileModel: Undefinedable<string>,
	pluginCfg: Undefinedable<PluginConfig>,
): Undefinedable<string> {
	let returnValue: Undefinedable<string>;

	if( undefined !== profileModel ) {
		returnValue = profileModel;
	} else {
		const planModel: unknown = pluginCfg?.agent?.plan?.model;

		if( "string" === typeof planModel && planModel.includes( "/" ) ) {
			returnValue = planModel;
		} else if( "string" === typeof pluginCfg?.model && pluginCfg.model.includes( "/" ) ) {
			returnValue = pluginCfg.model;
		} else {
			returnValue = undefined;
		}
	}

	return returnValue;
}

// ── Agent config builder ───────────────────────────────────────────────────

function buildAgentConfig(
	profile: Profile,
	defaultPrompt: string,
	pluginCfg: Undefinedable<PluginConfig>,
): Record<string, unknown> {
	const model: string = resolveModel( profile.model, pluginCfg ) ?? defaultModel;

	const agentCfg: Record<string, unknown> = {
		model,
		prompt: profile.prompt ?? defaultPrompt,
		temperature: profile.temperature ?? 0,
		mode: "subagent",
		hidden: true,
		tools: { ...fixedTools },
	};

	if( undefined !== profile.top_p ) {
		agentCfg.top_p = profile.top_p;
	}

	if( undefined !== profile.variant ) {
		agentCfg.variant = profile.variant;
	}

	if( undefined !== profile.options ) {
		agentCfg.options = structuredClone( profile.options );
	}

	// Set permission policy. Property order matters.
	agentCfg.permission = { ...fixedPermission };

	return agentCfg;
}

// ── Recursion guards ───────────────────────────────────────────────────────

let inAdvisorCall: boolean = false;
let inBtwCall: boolean = false;

// ── Transcript helpers ─────────────────────────────────────────────────────

function formatTranscript(
	messages: Array<{ info: { role: string; id: string }; parts: Array<{ type: string; text?: string }> }>,
	excludeID?: string,
): string {
	return messages
		.filter( ( m: { info: { role: string; id: string }; parts: Array<{ type: string; text?: string }> } ): boolean => m.info.id !== excludeID )
		.map( ( m: { info: { role: string; id: string }; parts: Array<{ type: string; text?: string }> } ): string => {
			const text: string = m.parts
				.filter( ( p: { type: string; text?: string } ): boolean => "text" === p.type )
				.map( ( p: { type: string; text?: string } ): string => p.text ?? "" )
				.join( "" );
			const role: string = "user" === m.info.role ? "User" : "Assistant";
			return `${role}: ${text}`;
		} )
		.filter( ( s: string ): boolean => {
			const afterColon: number = s.indexOf( ": " );
			return ( -1 !== afterColon ) && ( s.length > ( afterColon + 2 ) );
		} )
		.join( "\n\n" );
}

// Used for session.prompt body (accepts TextPartInput).
function textPart( t: string ): TextPartInput {
	return { type: "text", text: t };
}

// Mutate first text Part's text in command.execute.before output,
// preserving its identity fields (id/sessionID/messageID).
function setOutputText( output: { parts: Part[] }, text: string ): void {
	let found: boolean = false;
	for( let iL1: number = 0; ( iL1 < output.parts.length ) && !found; iL1++ ) {
		const part: Part = output.parts[ iL1 ];
		if( "text" === part.type ) {
			part.text = text;
			found = true;
		}
	}
}

// ── Plugin factory ─────────────────────────────────────────────────────────

export const AdvisorPlugin: Plugin = async ( { client }, rawOptions ) => {
	const profiles: { advisor: Profile; btw: Profile } = parseOptions( rawOptions );

	// Tracks whether this plugin registered the default /btw command during config.
	// When false (user already defined command.btw), the plugin must neither
	// overwrite the user's definition nor intercept execution.
	let ownsBtwCommand: boolean = false;

	// Stash of the default command object installed by this plugin instance.
	// Reference identity on re-config runs distinguishes plugin-owned from user-owned.
	let defaultBtwCommand: Undefinedable<Record<string, unknown>>;

	return {
		config: async ( cfg: PluginConfig ): Promise<void> => {
			// Reset for safety on repeated config-hook invocations
			ownsBtwCommand = false;

			const advisorCfg: Record<string, unknown> = buildAgentConfig( profiles.advisor, advisorDefaultPrompt, cfg );
			const btwCfg: Record<string, unknown> = buildAgentConfig( profiles.btw, btwDefaultPrompt, cfg );

			// cfg.agent uses an index signature allowing arbitrary agent names
			const agents: NonNullable<PluginConfig[ "agent" ]> = cfg.agent ?? {};
			agents[ advisorAgent ] = advisorCfg as ( typeof agents )[ string ];
			agents[ btwAgent ] = btwCfg as ( typeof agents )[ string ];
			cfg.agent = agents;

			// Register /btw command only if the user has not already defined one.
			// On re-config we use reference identity to recognise the object we
			// installed; a distinct object means the user (or another plugin) has
			// taken over the command and we must not intercept.
			const commands: NonNullable<PluginConfig[ "command" ]> = cfg.command ?? {};
			if( "btw" in commands ) {
				ownsBtwCommand = ( undefined !== defaultBtwCommand ) && ( commands.btw === defaultBtwCommand );
			} else {
				defaultBtwCommand ??= { template: "$ARGUMENTS" };
				Object.assign( commands, { btw: defaultBtwCommand } );
				cfg.command = commands;
				ownsBtwCommand = true;
			}
		},

		tool: {
			advisor: tool( {
				description: advisorToolDescription,
				args: {},
				async execute( _args: Record<string, never>, context: { sessionID: string; messageID: string } ): Promise<string> {
					let returnValue: string;

					if( inAdvisorCall ) {
						returnValue = "Error: advisor tool cannot be called recursively.";
					} else {
						const sessionID: string = context.sessionID;
						const messageID: string = context.messageID;

						try {
							inAdvisorCall = true;

							const { data: messages }: { data: Undefinedable<Array<{ info: { role: string; id: string }; parts: Array<{ type: string; text?: string }> }>> } = await client.session.messages( {
								path: { id: sessionID },
							} );

							const transcript: string = formatTranscript( messages ?? [], messageID );

							if( !transcript ) {
								returnValue = "Advisor declined: no prior conversation to analyze.";
							} else {
								const createRes: { data?: { id?: string } } = await client.session.create( {
									body: { title: "advisor-subcall" },
								} );
								const tempID: Undefinedable<string> = createRes.data?.id;

								if( !tempID ) {
									returnValue = "Advisor error: failed to create ephemeral session.";
								} else {
									try {
										const response: { data?: { parts?: Array<{ type: string; text?: string }> } } = await client.session.prompt( {
											path: { id: tempID },
											body: {
												agent: advisorAgent,
												parts: [ textPart( transcript ) ],
											},
										} );

										const text: Undefinedable<string> = response.data?.parts
											?.filter( ( p: { type: string; text?: string } ): p is TextPart => "text" === p.type )
											.map( ( p: TextPart ): string => p.text )
											.join( "\n" );

										returnValue = text || "Advisor returned no advice.";
									} finally {
										await client.session
											.delete( { path: { id: tempID } } )
											.catch( () => { /* ignore cleanup failure */ } );
									}
								}
							}
		} catch( err: unknown ) {
			returnValue = `Advisor error: ${String( err )}`;
						} finally {
							inAdvisorCall = false;
						}
					}

					return returnValue;
				},
			} ),
		},

		"command.execute.before": async ( input: { command: string; sessionID: string; arguments?: string }, output: { parts: Part[] } ): Promise<void> => {
			if( "btw" === input.command && ownsBtwCommand ) {
				if( inBtwCall ) {
					setOutputText( output, "Error: /btw is already running in background. Wait for the current one to complete." );
				} else {
					const sessionID: string = input.sessionID;
					const btwQuery: Undefinedable<string> = input.arguments;

					if( !btwQuery || !btwQuery.trim() ) {
						setOutputText( output, "Usage: /btw <question> — answers a one-shot question in background." );
					} else {
						// Acknowledge immediately
						setOutputText( output, `[BTW] ${btwQuery}...` );

						inBtwCall = true;

						// Background execution
						processBtw( client, sessionID, btwQuery );
					}
				}
			}
		},
	};
};

export default AdvisorPlugin;

// ── BTW background handler ─────────────────────────────────────────────────

async function processBtw(
	client: OpencodeClient,
	mainSessionID: string,
	query: string,
): Promise<void> {
	try {
		const { data: rawMessages } = await client.session.messages( {
			path: { id: mainSessionID },
		} );

		const transcript: string = formatTranscript( rawMessages ?? [] );

		const promptText: string = transcript
			? `--- CONVERSATION CONTEXT ---\n\n${transcript}\n\n--- QUESTION ---\n\n${query}`
			: query;

		let answerText: string = "BTW returned no answer.";
		const createRes: { data?: { id?: string } } = await client.session.create( {
			body: { title: "btw-subcall" },
		} );
		const tempID: Undefinedable<string> = createRes.data?.id;

		if( !tempID ) {
			throw new Error( "BTW ephemeral session creation failed to return a session ID" );
		}

		try {
			const response: { data?: { parts?: Array<{ type: string; text?: string }> } } = await client.session.prompt( {
				path: { id: tempID },
				body: {
					agent: btwAgent,
					parts: [ textPart( promptText ) ],
				},
			} );

			const joinedText: Undefinedable<string> = response?.data?.parts
				?.filter( ( p: { type: string; text?: string } ): p is TextPart => "text" === p.type )
				.map( ( p: TextPart ): string => p.text )
				.join( "\n" );
			if( joinedText && 0 < joinedText.length ) {
				answerText = joinedText;
			}
		} finally {
			await client.session
				.delete( { path: { id: tempID } } )
				.catch( ( e: unknown ): void => console.error( "btw: failed to delete ephemeral session", e ) );
		}

		// Append result card to main session
		await client.session
			.prompt( {
				path: { id: mainSessionID },
				body: {
					noReply: true,
					parts: [
						textPart( `---\n**BTW:** ${query}\n\n${answerText}\n---` ),
					],
				},
			} )
			.catch( ( e: unknown ): void => console.error( "btw: failed to append result card", e ) );
	} catch( err: unknown ) {
		const msg: string = `BTW error: ${String( err )}`;
		console.error( "btw:", msg );
		// Try to surface a failure card
		await client.session
			.prompt( {
				path: { id: mainSessionID },
				body: {
					noReply: true,
					parts: [ textPart( `---\n**BTW:** ${query}\n\n⚠️ ${msg}\n---` ) ],
				},
			} )
			.catch( () => { /* ignore append failure during error */ } );
	} finally {
		inBtwCall = false;
	}
}
