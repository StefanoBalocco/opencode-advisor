import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const __filename = fileURLToPath( import.meta.url );
const __dirname = path.dirname( __filename );
const isMain = process.argv[ 1 ] && path.resolve( process.argv[ 1 ] ) === __filename;

// ── Tuple manifest ────────────────────────────────────────────────────────────
// [ name, tsconfigFileName, filesToMinify[], prefix? ]

const buildTargets = [
	[ 'plugin', 'tsconfig.json', [] ],
	[ 'tests', 'tsconfig.tests.json', [] ]
];

// ── Utilities ─────────────────────────────────────────────────────────────────

function log( step, message ) {
	const stamp = new Date().toISOString().substring( 11, 19 );
	console.log( `[${ stamp }] [${ step }] ${ message }` );
}

function compileTsc( configPath ) {
	const absConfig = path.resolve( __dirname, configPath );
	const configFile = ts.readConfigFile( absConfig, ts.sys.readFile );
	if( configFile.error ) {
		throw new Error( ts.formatDiagnosticsWithColorAndContext( [ configFile.error ], {
			getCurrentDirectory: ts.sys.getCurrentDirectory,
			getCanonicalFileName: f => f,
			getNewLine: () => '\n'
		} ) );
	}
	const parsed = ts.parseJsonConfigFileContent(
		configFile.config,
		ts.sys,
		path.dirname( absConfig )
	);
	const program = ts.createProgram( parsed.fileNames, parsed.options );
	const emitResult = program.emit();
	const diagnostics = ts.getPreEmitDiagnostics( program ).concat( emitResult.diagnostics );
	if( 0 < diagnostics.length ) {
		const message = ts.formatDiagnosticsWithColorAndContext( diagnostics, {
			getCurrentDirectory: ts.sys.getCurrentDirectory,
			getCanonicalFileName: f => f,
			getNewLine: () => '\n'
		} );
		throw new Error( message );
	}
}

// ── Tuple validation ──────────────────────────────────────────────────────────

function validateBuildTargets( targets ) {
	const cL1 = targets.length;
	for( let iL1 = 0; iL1 < cL1; iL1++ ) {
		const tuple = targets[ iL1 ];
		const errorPrefix = `Build target ${ iL1 }:`;
		if( !Array.isArray( tuple ) || ( 3 !== tuple.length && 4 !== tuple.length ) ) {
			throw new Error( `${ errorPrefix } must be a tuple of length 3 or 4` );
		}
		const [ name, configFile, filesToMinify, prefix ] = tuple;
		if( 'string' !== typeof name || '' === name ) {
			throw new Error( `${ errorPrefix } name must be a non-empty string` );
		}
		if( 'string' !== typeof configFile || '' === configFile ) {
			throw new Error( `${ errorPrefix } tsconfig file must be a non-empty string` );
		}
		if( !Array.isArray( filesToMinify ) ) {
			throw new Error( `${ errorPrefix } filesToMinify must be an array` );
		}
		if( undefined !== prefix && 'string' !== typeof prefix ) {
			throw new Error( `${ errorPrefix } prefix must be a string when provided` );
		}
		const cL2 = filesToMinify.length;
		for( let iL2 = 0; iL2 < cL2; iL2++ ) {
			if( 'string' !== typeof filesToMinify[ iL2 ] || !filesToMinify[ iL2 ].endsWith( '.js' ) ) {
				throw new Error( `${ errorPrefix } file '${ filesToMinify[ iL2 ] }' must end in '.js'` );
			}
		}
	}
}

// ── Target runner ─────────────────────────────────────────────────────────────

async function runTarget( target ) {
	const [ name, configFile, filesToMinify, prefix ] = target;
	const dir = path.resolve( __dirname, prefix ?? '.' );
	const absConfig = path.resolve( dir, configFile );
	log( name.toUpperCase(), 'Compiling TypeScript...' );
	compileTsc( absConfig );
	log( name.toUpperCase(), '✓ Built.' );
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

if( isMain ) {
	validateBuildTargets( buildTargets );

	const targetNamesAllowed = new Set(
		buildTargets.flatMap( ( [ targetName ] ) => [ targetName ] )
	);
	let targetNamesArgs = new Set( process.argv.slice( 2 ) );

	if( targetNamesArgs.has( 'all' ) ) {
		targetNamesArgs.delete( 'all' );
		for( const targetName of targetNamesAllowed ) {
			targetNamesArgs.add( targetName );
		}
	}

	const targetNamesSelected = targetNamesAllowed.intersection( targetNamesArgs );
	const targetNamesInvalid = targetNamesArgs.difference( targetNamesAllowed );

	if( 0 < targetNamesSelected.size && 0 === targetNamesInvalid.size ) {
		async function main() {
			for( const target of buildTargets ) {
				if( targetNamesSelected.has( target[ 0 ] ) ) {
					await runTarget( target );
				}
			}
		}

		main().catch( err => {
			console.error( err );
			process.exit( 1 );
		} );
	} else {
		if( 0 < targetNamesInvalid.size ) {
			console.error( 'Unknown target(s): ' + [ ...targetNamesInvalid ].join( ', ' ) );
		}
		console.log( 'Usage: node build.mjs <target> [<target> ...]' );
		console.log( 'Available targets: ' + [ ...targetNamesAllowed ].join( ', ' ) + ', all' );
		process.exitCode = 1;
	}
}
