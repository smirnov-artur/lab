// Static server for local checks. Gzips text assets so measured transfer
// sizes match what GitHub Pages actually sends.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { extname, join, normalize } from 'node:path';

const ROOT = fileURLToPath( new URL( '..', import.meta.url ) );
const PORT = Number( process.argv[ 2 ] || 4321 );

const TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.woff2': 'font/woff2',
	'.json': 'application/json',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.ico': 'image/x-icon',
};
const COMPRESS = new Set( [ '.html', '.js', '.css', '.json', '.svg' ] );

createServer( async ( req, res ) => {

	let p = decodeURIComponent( req.url.split( '?' )[ 0 ] );
	if ( p.endsWith( '/' ) ) p += 'index.html';
	const file = join( ROOT, normalize( p ).replace( /^(\.\.[/\\])+/, '' ) );

	try {

		await stat( file );
		const ext = extname( file );
		const body = await readFile( file );
		const headers = { 'content-type': TYPES[ ext ] || 'application/octet-stream', 'cache-control': 'no-store' };

		if ( COMPRESS.has( ext ) && /gzip/.test( req.headers[ 'accept-encoding' ] || '' ) ) {

			const gz = gzipSync( body, { level: 9 } );
			res.writeHead( 200, { ...headers, 'content-encoding': 'gzip', 'content-length': gz.length } );
			res.end( gz );

		} else {

			res.writeHead( 200, { ...headers, 'content-length': body.length } );
			res.end( body );

		}

	} catch {

		res.writeHead( 404, { 'content-type': 'text/plain' } );
		res.end( 'not found' );

	}

} ).listen( PORT, () => console.log( `http://localhost:${PORT}/` ) );
