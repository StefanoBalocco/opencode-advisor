import type { Config as PluginConfig, Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import type {
	Event,
	Part,
	SessionStatus,
	TextPart,
	TextPartInput,
} from "@opencode-ai/sdk";

// ── Constants ──────────────────────────────────────────────────────────────

const defaultModel: string = "deepseek/deepseek-v4-pro";
const defaultFailureThreshold: number = 3;
const advisorAgent: string = "opencode-advisor:advisor";

// ── Default prompts ────────────────────────────────────────────────────────

const advisorDefaultPrompt: string = `Act as a strategic advisor to a coding agent. Read the conversation transcript, identify the current objective, and provide a concise plan or course correction.

Give the executor clear, ordered instructions. State what to do next, the sequence to follow, the main risks, and the actions to avoid. Prefer the simplest solution that satisfies the specification. Flag choices that add unnecessary code, indirection, or maintenance burden. When the executor is stuck, repeating failed attempts, or following a disproved assumption, redirect the approach. State plainly when tests, logs, or other evidence contradict the current reasoning.

Use read-only tools only when they add necessary context. You may inspect the workspace with "read", "glob", and "grep", consult public sources with "webfetch" and "websearch", and load relevant skills. Do not edit files, change system state, or run commands other than read-only shell commands.

Respond in fewer than 300 words. Use numbered steps. Do not write code; provide advice only.`;

const advisorToolDescription: string = `Consult a strategic advisor that reads the full conversation and returns a concise plan or course correction.

Call "advisor" before substantive work: writing code, editing files, choosing an interpretation, or relying on an unverified assumption. Complete only the orientation needed to inform the review—locate files, read code, or fetch documentation—then call the advisor. Orientation is not substantive work.

Call it again when the approach stalls, errors recur, results contradict expectations, or a different direction appears necessary. Request a final review before declaring the task complete. First preserve the deliverable in its proper durable form by saving files or results and committing only when the task requires a commit.

For tasks longer than a few steps, consult the advisor before choosing an approach and again before completion. Skip it only on short, reactive turns where tool output directly determines the next action.

Give the advice serious weight. Override a specific recommendation only when primary-source evidence disproves it. Present the conflict in another advisor call instead of changing course silently.`;

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
	failureThreshold?: number;
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
	"failureThreshold",
] );

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

		if( undefined !== obj.failureThreshold ) {
			assertFiniteNumber( obj.failureThreshold, `${section}.failureThreshold` );
			if( !Number.isInteger( obj.failureThreshold ) || ( 1 > obj.failureThreshold ) ) {
				throw new Error( `${section}.failureThreshold: must be a positive integer` );
			}
			profile.failureThreshold = obj.failureThreshold;
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

// ── Event state types ──────────────────────────────────────────────────────

interface FailureDetail {
	tool: string;
	error: string;
}

interface SessionState {
	count: number;
	failures: Array<FailureDetail>;
	triggered: boolean;
	intervening: boolean;
	awaitingIdle: boolean;
	idle: boolean;
	idleGeneration: number;
	deleted: boolean;
	sourceAgent: string;
	advice: string;
}

function createSessionState(): SessionState {
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

// ── Plugin factory ─────────────────────────────────────────────────────────

export const AdvisorPlugin: Plugin = async ( { client }, rawOptions ) => {
	const advisorProfile: Profile = parseProfile( rawOptions, "plugin options" );
	const failureThreshold: number = advisorProfile.failureThreshold ?? defaultFailureThreshold;

	// Factory-local event state (isolated per plugin instance)
	const advisorSessions: Set<string> = new Set();
	const sessionStates: Map<string, SessionState> = new Map();
	let resolvedCfg: Undefinedable<PluginConfig>;

	// ── Shared advisor lifecycle ───────────────────────────────────────────

	async function _callAdvisor( transcript: string ): Promise<string> {
		let returnValue: string;
		const createRes: { data?: { id?: string } } = await client.session.create( {
			body: { title: "advisor-subcall" },
		} );
		const tempID: Undefinedable<string> = createRes.data?.id;

		if( !tempID ) {
			returnValue = "Advisor error: failed to create ephemeral session.";
		} else {
			advisorSessions.add( tempID );
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
				advisorSessions.delete( tempID );
				await client.session
					.delete( { path: { id: tempID } } )
					.catch( () => { /* ignore cleanup failure */ } );
			}
		}

		return returnValue;
	}

	// ── Intervention orchestration ─────────────────────────────────────────

	function _maybeResume( sessionID: string, state: SessionState ): void {
		if( !state.deleted && state.intervening && state.idle && state.sourceAgent && state.advice ) {
			state.intervening = false;
			state.awaitingIdle = false;
			// Fire-and-forget: never block event bus on prompt
			client.session.prompt( {
				path: { id: sessionID },
				body: {
					agent: state.sourceAgent,
					parts: [ textPart( state.advice + "\n\nContinue the task using this advice." ) ],
				},
			} ).catch( () => { /* swallow resume rejection */ } );
		}
	}

	async function _launchIntervention(
		sessionID: string,
		messageID: string,
		state: SessionState,
	): Promise<void> {
		// Step 1: fetch messages to resolve source agent
		let msgs: Undefinedable<Array<{ info: { role: string; id: string }; parts: Array<{ type: string; text?: string }> }>>;
		let fetchOk: boolean = true;
		try {
			const msgsRes: { data?: Array<{ info: { role: string; id: string }; parts: Array<{ type: string; text?: string }> }> } = await client.session.messages( {
				path: { id: sessionID },
			} );
			msgs = msgsRes.data;
		} catch {
			fetchOk = false;
		}

		if( fetchOk && msgs ) {
			// Resolve source agent: assistant message messageID → parentID → user message → agent
			let assistantMsgInfo: Undefinedable<{ info: { role: string; id: string }; parts: Array<{ type: string; text?: string }> }>;
			let userMsgInfo: Undefinedable<{ info: { role: string; id: string; agent?: string }; parts: Array<{ type: string; text?: string }> }>;
			let parentID: Undefinedable<string>;

			for( const msg of msgs ) {
				if( "assistant" === msg.info.role && msg.info.id === messageID ) {
					assistantMsgInfo = msg;
					break;
				}
			}

			if( assistantMsgInfo ) {
				parentID = ( assistantMsgInfo.info as { role: string; id: string; parentID?: string } ).parentID;
			}

			if( parentID ) {
				for( const msg of msgs ) {
					if( "user" === msg.info.role && msg.info.id === parentID ) {
						userMsgInfo = msg as { info: { role: string; id: string; agent?: string }; parts: Array<{ type: string; text?: string }> };
						break;
					}
				}
			}

			const sourceAgent: string = userMsgInfo?.info?.agent ?? "";

			if( sourceAgent ) {
				// Check eligibility: tools.advisor must not be explicitly false
				let agentEligible: boolean = true;
				if( resolvedCfg?.agent?.[ sourceAgent ]?.tools?.advisor === false ) {
					agentEligible = false;
				}

				if( agentEligible ) {
					state.sourceAgent = sourceAgent;

					// Step 2: abort the session (awaitingIdle set only after success)
					let abortOk: boolean = false;
					try {
						const abortRes: { data?: boolean } = await client.session.abort( {
							path: { id: sessionID },
						} );
						abortOk = true === abortRes.data;
					} catch {
						abortOk = false;
					}

					if( abortOk ) {
						// Step 3: start post-abort idle-wait phase
						state.awaitingIdle = true;
						state.idle = false;

						// Step 4: check current status to close idle-before-wait race.
						// Capture generation before async query so a concurrent event
						// (idle, busy, retry) can invalidate a stale query result.
						const capturedGeneration: number = state.idleGeneration;
						try {
							const statusRes: { data?: Record<string, SessionStatus> } = await client.session.status();
							// Only apply query result if no event advanced the generation
							if( capturedGeneration === state.idleGeneration ) {
								const sessStatus: Undefinedable<SessionStatus> = statusRes.data?.[ sessionID ];
								if( sessStatus ) {
									state.idle = ( "idle" === sessStatus.type );
								} else {
									state.idle = false;
								}
							}
						} catch {
							// non-idle, wait for event; generation unchanged, no event lost
						}

						// Step 5: build advisor input with failure context
						const transcript: string = formatTranscript( msgs, "" );
						const failureBlock: string = state.failures
							.map( ( f: FailureDetail ): string => `Tool: ${f.tool}\nError: ${f.error}` )
							.join( "\n\n" );

						const advisorInput: string = transcript
							? `${transcript}\n\n--- Recent tool failures ---\n${failureBlock}`
							: `--- Tool failures ---\n${failureBlock}\n\nContinue the task reassessing the approach.`;

						// Step 6: call advisor
						let advice: string;
						try {
							const rawAdvice: string = await _callAdvisor( advisorInput );
							// Manual-facing unusable strings must be replaced with fallback for auto path
							if( "Advisor returned no advice." === rawAdvice || "Advisor error: failed to create ephemeral session." === rawAdvice ) {
								advice = "Reassess the failed approach and continue working.";
							} else {
								advice = rawAdvice;
							}
						} catch {
							advice = "Reassess the failed approach and continue working.";
						}
						state.advice = advice;

						// Step 7: attempt resume
						_maybeResume( sessionID, state );
					} else {
						// Abort failed, clear intervening but keep triggered latched
						state.intervening = false;
					}
				} else {
					// Agent opted out, clear intervention
					state.intervening = false;
				}
			} else {
				// No source agent resolvable, clear intervention
				state.intervening = false;
			}
		} else {
			// Messages unavailable, clear intervention
			state.intervening = false;
		}
	}

	// ── Plugin hooks ───────────────────────────────────────────────────────

	return {
		config: async ( cfg: PluginConfig ): Promise<void> => {
			resolvedCfg = cfg;

			const advisorCfg: Record<string, unknown> = buildAgentConfig( advisorProfile, advisorDefaultPrompt, cfg );

			// cfg.agent uses an index signature allowing arbitrary agent names
			const agents: NonNullable<PluginConfig[ "agent" ]> = cfg.agent ?? {};
			agents[ advisorAgent ] = advisorCfg as ( typeof agents )[ string ];
			cfg.agent = agents;
		},

		event: async ( { event }: { event: Event } ): Promise<void> => {
			if( "message.part.updated" === event.type ) {
				const part: Part = event.properties.part;
				if( "tool" === part.type && !advisorSessions.has( part.sessionID ) ) {
					const sessionID: string = part.sessionID;
					let state: Undefinedable<SessionState> = sessionStates.get( sessionID );

					if( state && state.intervening ) {
						// Skip all tool events during intervention
					} else if( "error" === part.state.status ) {
						// Ignore advisor tool errors to prevent recursion
						if( "advisor" !== part.tool ) {
							if( !state ) {
								state = createSessionState();
								sessionStates.set( sessionID, state );
							}

							// Keep failures bounded to threshold
							if( state.failures.length >= failureThreshold ) {
								state.failures.shift();
							}
							state.failures.push( { tool: part.tool, error: part.state.error } );
							state.count = state.failures.length;

							if( state.count >= failureThreshold && !state.triggered ) {
								state.triggered = true;
								state.intervening = true;
								void _launchIntervention( sessionID, part.messageID, state );
							}
						}
					} else if( "completed" === part.state.status ) {
						// Completed tool resets the streak
						if( !state ) {
							state = createSessionState();
							sessionStates.set( sessionID, state );
						}
						state.count = 0;
						state.failures = [];
						state.triggered = false;
					}
				}
			} else if( "session.idle" === event.type ) {
				const sessID: string = event.properties.sessionID;
				const state: Undefinedable<SessionState> = sessionStates.get( sessID );
				if( state && state.awaitingIdle ) {
					state.idleGeneration++;
					state.idle = true;
					_maybeResume( sessID, state );
				}
			} else if( "session.status" === event.type ) {
				const sessID: string = event.properties.sessionID;
				const state: Undefinedable<SessionState> = sessionStates.get( sessID );
				if( state && state.awaitingIdle ) {
					if( "idle" === event.properties.status.type ) {
						state.idleGeneration++;
						state.idle = true;
						_maybeResume( sessID, state );
					} else if( "busy" === event.properties.status.type || "retry" === event.properties.status.type ) {
						state.idleGeneration++;
						state.idle = false;
					}
				}
			} else if( "session.deleted" === event.type ) {
				const sessID: string = event.properties.info.id;
				const state: Undefinedable<SessionState> = sessionStates.get( sessID );
				if( state ) {
					state.deleted = true;
				}
				sessionStates.delete( sessID );
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
								returnValue = await _callAdvisor( transcript );
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
	};
};

export default AdvisorPlugin;
