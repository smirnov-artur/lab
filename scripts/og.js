// Grabs the share card straight off the running page — 1200×630, JPEG.
import { chromium } from 'playwright';

const url = process.argv[ 2 ] || 'http://localhost:4321/';

const browser = await chromium.launch( {
	headless: false, // headless Chromium has no usable WebGPU adapter here
	executablePath: process.env.CHROME_PATH || undefined,
	args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu' ],
} );

const page = await browser.newPage( { viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 } );
await page.goto( url, { waitUntil: 'load' } );
await page.waitForTimeout( 6000 ); // let the field settle into shape
await page.screenshot( { path: 'og.jpg', type: 'jpeg', quality: 80 } );
await browser.close();

console.log( 'og.jpg written' );
