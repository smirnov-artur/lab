// Playwright probe: screenshots, FPS, transfer weight, console errors.
// Usage: node scripts/check.js [url] [--headless] [--no-gpu]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[ 2 ] || 'http://localhost:4321/';
const headless = process.argv.includes( '--headless' );
const killGPU = process.argv.includes( '--no-gpu' );
const nullAdapter = process.argv.includes( '--null-adapter' );
const tag = process.argv.includes( '--tag' )
	? process.argv[ process.argv.indexOf( '--tag' ) + 1 ]
	: ( killGPU ? 'fallback' : nullAdapter ? 'noadapter' : 'gpu' );
const OUT = 'shots';
mkdirSync( OUT, { recursive: true } );

const PROFILES = [
	{ name: 'desktop-1440', width: 1440, height: 900, dpr: 1, mobile: false },
	{ name: 'mobile-390', width: 390, height: 844, dpr: 3, mobile: true },
];

const browser = await chromium.launch( {
	headless,
	executablePath: process.env.CHROME_PATH || undefined,
	args: [
		'--enable-unsafe-webgpu',
		'--enable-features=Vulkan',
		'--ignore-gpu-blocklist',
		'--enable-gpu',
	],
} );

for ( const p of PROFILES ) {

	const ctx = await browser.newContext( {
		viewport: { width: p.width, height: p.height },
		deviceScaleFactor: p.dpr,
		isMobile: p.mobile,
		hasTouch: p.mobile,
	} );

	if ( killGPU ) {

		await ctx.addInitScript( () => {

			Object.defineProperty( navigator, 'gpu', { get: () => undefined, configurable: true } );

		} );

	}

	// navigator.gpu present, but the adapter request comes back empty —
	// the case that actually happens on older Linux and locked-down Android
	if ( nullAdapter ) {

		await ctx.addInitScript( () => {

			if ( navigator.gpu ) navigator.gpu.requestAdapter = async () => null;

		} );

	}

	const page = await ctx.newPage();
	const logs = [];
	page.on( 'console', ( m ) => { if ( m.type() === 'error' || m.type() === 'warning' ) logs.push( `${m.type()}: ${m.text()}` ); } );
	page.on( 'pageerror', ( e ) => logs.push( `pageerror: ${e.message}` ) );

	const transfers = [];
	page.on( 'response', async ( r ) => {

		try {

			const h = await r.allHeaders();
			transfers.push( { url: r.url().split( '/' ).pop() || '/', size: Number( h[ 'content-length' ] || 0 ), enc: h[ 'content-encoding' ] || '-' } );

		} catch {}

	} );

	await page.goto( url, { waitUntil: 'load' } );
	await page.waitForTimeout( 1500 );

	// nudge the pointer so the repulsion path runs too
	await page.mouse.move( p.width * 0.66, p.height * 0.42 );
	await page.mouse.move( p.width * 0.72, p.height * 0.5, { steps: 12 } );
	await page.waitForTimeout( 2500 );

	const probe = await page.evaluate( () => new Promise( ( resolve ) => {

		const t = [];
		let last = performance.now();
		let n = 0;
		const tick = ( now ) => {

			t.push( now - last ); last = now;
			if ( ++ n < 120 ) requestAnimationFrame( tick );
			else {

				const s = t.slice( 20 ).sort( ( a, b ) => a - b );
				const med = s[ Math.floor( s.length / 2 ) ];
				const p95 = s[ Math.floor( s.length * 0.95 ) ];
				const canvas = document.getElementById( 'stage' );
				resolve( {
					fpsMedian: +( 1000 / med ).toFixed( 1 ),
					fpsP5: +( 1000 / p95 ).toFixed( 1 ),
					canvas: canvas ? `${canvas.width}x${canvas.height}` : null,
					hud: Object.fromEntries( [ ...document.querySelectorAll( '.hud > div' ) ]
						.map( ( d ) => [ d.querySelector( 'dt' ).textContent, d.querySelector( 'dd' ).textContent ] ) ),
					mode: document.body.dataset.mode || 'none',
					h1: ( () => { const s = getComputedStyle( document.querySelector( 'h1' ) ); return `${s.fontSize} / ls ${s.letterSpacing} / ${s.fontFamily.split( ',' )[ 0 ]}`; } )(),
					weight: Math.round( [ ...performance.getEntriesByType( 'resource' ), ...performance.getEntriesByType( 'navigation' ) ]
						.reduce( ( a, e ) => a + ( e.transferSize || 0 ), 0 ) / 1024 ),
					scroll: document.documentElement.scrollHeight - innerHeight,
				} );

			}

		};

		requestAnimationFrame( tick );

	} ) );

	await page.screenshot( { path: `${OUT}/${tag}-${p.name}.png` } );

	console.log( `\n=== ${tag} · ${p.name} (dpr ${p.dpr}) ===` );
	console.log( probe );
	console.log( 'transfer:', transfers.map( ( t ) => `${t.url} ${( t.size / 1024 ).toFixed( 1 )}KB/${t.enc}` ).join( ' · ' ) );
	console.log( 'console:', logs.length ? logs.slice( 0, 12 ) : 'clean' );

	await ctx.close();

}

await browser.close();
