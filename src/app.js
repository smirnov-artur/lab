/**
 * EXP 01 — Flow Field
 * three.js WebGPURenderer + TSL. Particle state lives in GPU storage buffers
 * and is advanced by one compute dispatch per frame. Nothing is read back.
 */

import * as THREE from 'three/webgpu';
import {
	Fn, If, instanceIndex, instancedArray, uniform, hash,
	float, vec2, vec3, vec4, color,
	deltaTime, time, uv, screenUV, pass,
	mix, smoothstep, mx_noise_vec3,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

const WORKGROUP = 256;

/* ---------------------------------------------------------------- palette */

const C_SLOW = new THREE.Color( '#101d38' ); // resting particles — near background
const C_MID = new THREE.Color( '#4d74b8' ); // mid-velocity filaments
const C_FAST = new THREE.Color( '#e6ecf7' ); // whipped through the field

/* ------------------------------------------------------------ curl noise  */
// Curl of a vector potential N(p). Forward differences: 4 noise samples
// instead of the textbook 6, visually identical at this scale.

const curlNoise = Fn( ( [ p ] ) => {

	const e = float( 0.32 );

	const n0 = mx_noise_vec3( p );
	const nx = mx_noise_vec3( p.add( vec3( e, 0, 0 ) ) );
	const ny = mx_noise_vec3( p.add( vec3( 0, e, 0 ) ) );
	const nz = mx_noise_vec3( p.add( vec3( 0, 0, e ) ) );

	const x = ny.z.sub( n0.z ).sub( nz.y.sub( n0.y ) );
	const y = nz.x.sub( n0.x ).sub( nx.z.sub( n0.z ) );
	const z = nx.y.sub( n0.y ).sub( ny.x.sub( n0.x ) );

	return vec3( x, y, z ).div( e );

} );

curlNoise.setLayout( {
	name: 'curlNoise',
	type: 'vec3',
	inputs: [ { name: 'p', type: 'vec3' } ],
} );

/* ------------------------------------------------------------------ main  */

export async function start( { canvas, hud, onFail } ) {

	if ( ! navigator.gpu ) return onFail( 'no-adapter' );

	const coarse = matchMedia( '(pointer: coarse)' ).matches;
	const small = Math.min( innerWidth, innerHeight ) < 620;
	const mobile = coarse || small;
	const calm = matchMedia( '(prefers-reduced-motion: reduce)' ).matches;

	let count = mobile ? 65536 : 262144;
	const maxCount = count;

	const renderer = new THREE.WebGPURenderer( {
		canvas,
		antialias: false,
		alpha: false,
		powerPreference: 'high-performance',
	} );

	renderer.setPixelRatio( Math.min( devicePixelRatio, mobile ? 2 : 1.5 ) );
	renderer.setSize( innerWidth, innerHeight );
	renderer.setClearColor( 0x05060a, 1 );
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.05;

	try {

		await renderer.init();

	} catch ( err ) {

		console.warn( 'WebGPU init failed:', err );
		return onFail( 'init-failed' );

	}

	if ( renderer.backend?.isWebGPUBackend !== true ) return onFail( 'no-adapter' );

	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera( 42, innerWidth / innerHeight, 0.1, 60 );
	camera.position.set( 0, 1.1, 9.4 );

	/* ----------------------------------------------------------- buffers */
	// vec4 throughout: 16-byte alignment matches the WGSL storage layout, and
	// the spare lane carries life / lifespan without a fourth allocation.
	//   position.xyz  position.w = life 1 → 0
	//   velocity.xyz  velocity.w = size seed
	//   home.xyz      home.w     = 1 / lifespan

	const positionBuffer = instancedArray( maxCount, 'vec4' );
	const velocityBuffer = instancedArray( maxCount, 'vec4' );
	const homeBuffer = instancedArray( maxCount, 'vec4' );

	/* ---------------------------------------------------------- uniforms */

	const uFlow = uniform( 1.45 ); // curl-noise force
	const uScale = uniform( 0.30 ); // noise frequency
	const uSpin = uniform( 0.62 ); // tangential swirl around Y
	const uPull = uniform( 2.35 ); // containment toward origin
	const uPointer = uniform( new THREE.Vector3( 0, 0, 0 ) );
	const uPointerK = uniform( 0.0 ); // pointer repulsion, eased 0 → 1
	const uRes = uniform( new THREE.Vector2( 1, 1 ) );

	/* ------------------------------------------------------------- seed  */

	const seedPositions = Fn( () => {

		const i = instanceIndex;
		const r1 = hash( i.mul( 3 ).add( 11 ) );
		const r2 = hash( i.mul( 5 ).add( 97 ) );
		const r3 = hash( i.mul( 7 ).add( 613 ) );
		const r4 = hash( i.mul( 11 ).add( 2749 ) );

		const theta = r1.mul( Math.PI * 2 );
		const cosPhi = r2.mul( 2 ).sub( 1 );
		const sinPhi = cosPhi.mul( cosPhi ).oneMinus().max( 0 ).sqrt();
		const radius = r3.pow( 1 / 3 ).mul( 2.55 );

		// lens, not a ball: squashed on Y so the field reads on a wide screen
		const home = vec3(
			sinPhi.mul( theta.cos() ),
			cosPhi.mul( 0.42 ),
			sinPhi.mul( theta.sin() )
		).mul( radius );

		homeBuffer.element( i ).assign( vec4( home, float( 0.10 ).add( r4.mul( 0.16 ) ) ) );
		positionBuffer.element( i ).assign( vec4( home, r4 ) ); // staggered lifetimes
		velocityBuffer.element( i ).assign( vec4( 0, 0, 0, r1.mul( 0.7 ).add( 0.55 ) ) );

	} );

	/* ----------------------------------------------------------- update  */

	const stepParticles = Fn( () => {

		const i = instanceIndex;
		const posRef = positionBuffer.element( i );
		const velRef = velocityBuffer.element( i );
		const home = homeBuffer.element( i );

		const dt = deltaTime.min( 1 / 30 );
		const p = posRef.xyz.toVar();
		const v = velRef.xyz.toVar();
		const life = posRef.w.toVar();

		// 1 — curl-noise flow, field itself drifting on Y
		const sample = p.mul( uScale ).add( vec3( 0, time.mul( 0.07 ), time.mul( 0.02 ) ) );
		const force = curlNoise( sample ).mul( uFlow ).toVar();

		// 2 — tangential swirl keeps the lens turning
		const flat = vec3( p.x, 0, p.z );
		const tangent = vec3( flat.z.negate(), 0, flat.x ).div( flat.length().max( 0.35 ) );
		force.addAssign( tangent.mul( uSpin ) );

		// 3 — containment: nothing escapes the frame
		const d = p.length();
		force.addAssign( p.negate().div( d.max( 0.001 ) ).mul( uPull ).mul( smoothstep( 1.9, 4.3, d ) ) );

		// 4 — pointer repulsion, inverse-square with a soft core
		const away = p.sub( uPointer );
		const pd = away.length().max( 0.06 );
		force.addAssign( away.div( pd ).mul( uPointerK ).mul( float( 2.6 ).div( pd.mul( pd ).add( 0.35 ) ) ) );

		v.addAssign( force.mul( dt ) );
		v.mulAssign( float( 1 ).sub( dt.mul( 1.35 ) ).max( 0 ) ); // damping
		p.addAssign( v.mul( dt ) );

		life.subAssign( dt.mul( home.w ) );

		If( life.lessThan( 0 ), () => {

			p.assign( home.xyz );
			v.assign( vec3( 0 ) );
			life.assign( 1 );

		} );

		posRef.assign( vec4( p, life ) );
		velRef.assign( vec4( v, velRef.w ) );

	} );

	const initCompute = seedPositions().compute( maxCount, [ WORKGROUP ] );
	let stepCompute = stepParticles().compute( count, [ WORKGROUP ] );

	await renderer.computeAsync( initCompute );

	/* ------------------------------------------------------------ render */

	const instPos = positionBuffer.toAttribute();
	const instVel = velocityBuffer.toAttribute();

	const speed = instVel.xyz.length();
	const heat = smoothstep( 0.15, 2.4, speed );
	const life = instPos.w;

	// life runs 1 → 0; fade in just after respawn, out just before death
	const fade = smoothstep( 1.0, 0.93, life ).mul( smoothstep( 0.0, 0.14, life ) );

	const tint = mix(
		mix( color( C_SLOW ), color( C_MID ), smoothstep( 0.0, 0.55, heat ) ),
		color( C_FAST ),
		smoothstep( 0.5, 1.0, heat )
	);

	// round soft dot, no texture fetch
	const disc = smoothstep( 0.5, 0.06, uv().sub( 0.5 ).length() );

	const material = new THREE.SpriteNodeMaterial( {
		transparent: true,
		depthWrite: false,
		depthTest: true,
		blending: THREE.AdditiveBlending,
	} );

	material.positionNode = instPos.xyz;
	material.scaleNode = instVel.w.mul( 0.019 ).mul( heat.mul( 0.5 ).add( 0.75 ) );
	material.colorNode = vec4(
		tint.mul( heat.mul( 1.5 ).add( 0.35 ) ),
		disc.mul( fade ).mul( 0.36 )
	);

	const particles = new THREE.Sprite( material );
	particles.count = count;
	particles.frustumCulled = false;
	scene.add( particles );

	/* ---------------------------------------------------- postprocessing */

	const Pipeline = THREE.RenderPipeline || THREE.PostProcessing;
	const post = new Pipeline( renderer );
	const scenePass = pass( scene, camera );
	const sceneColor = scenePass.getTextureNode( 'output' );
	const bloomPass = bloom( sceneColor, 0.38, 0.6, 0.62 );

	const vignette = smoothstep( 1.06, 0.34, screenUV.sub( 0.5 ).length() ).mul( 0.85 ).add( 0.15 );
	const grain = screenUV.mul( uRes ).add( time.mul( 91.7 ) )
		.dot( vec2( 12.9898, 78.233 ) ).sin().mul( 43758.5453 ).fract().sub( 0.5 );

	post.outputNode = sceneColor.add( bloomPass ).mul( vignette ).add( grain.mul( 0.022 ) );

	/* ---------------------------------------------------------- pointer  */

	const pointerNDC = new THREE.Vector2( 0, 0 );
	const pointerWorld = new THREE.Vector3();
	const parallax = new THREE.Vector2( 0, 0 );
	let pointerTarget = 0;
	let pointerActive = false;

	const onPointer = ( e ) => {

		pointerNDC.set( ( e.clientX / innerWidth ) * 2 - 1, - ( e.clientY / innerHeight ) * 2 + 1 );
		pointerActive = true;
		pointerTarget = 1;

	};

	addEventListener( 'pointermove', onPointer, { passive: true } );
	addEventListener( 'pointerdown', onPointer, { passive: true } );
	addEventListener( 'pointerleave', () => { pointerTarget = 0; }, { passive: true } );
	addEventListener( 'pointerup', () => { if ( coarse ) pointerTarget = 0; }, { passive: true } );

	/* ----------------------------------------------------------- resize  */

	// Frame the cloud instead of hard-coding a distance: fit it vertically,
	// and on portrait screens also (loosely) horizontally, so a phone gets a
	// composition rather than a crop. Then slide the subject off-centre —
	// right on landscape, up on portrait — to clear the type.
	const R = 4.3;
	let orbit = 9.4;
	let shiftX = 0;
	let shiftY = 0;

	const frame = () => {

		const vTan = Math.tan( ( camera.fov * Math.PI ) / 360 );
		const fitV = R / vTan;
		const fitH = R / ( vTan * camera.aspect );
		orbit = Math.max( fitV, fitH * 0.72 );

		if ( camera.aspect < 0.95 ) {

			shiftX = 0;
			shiftY = - orbit * 0.19; // camera down → cloud sits high

		} else {

			shiftX = - orbit * 0.19; // camera left → cloud sits right
			shiftY = 0;

		}

	};

	const resize = () => {

		camera.aspect = innerWidth / innerHeight;
		camera.updateProjectionMatrix();
		renderer.setPixelRatio( Math.min( devicePixelRatio, mobile ? 2 : 1.5 ) );
		renderer.setSize( innerWidth, innerHeight );
		uRes.value.set( innerWidth, innerHeight );
		frame();

	};

	addEventListener( 'resize', resize );
	resize();

	/* -------------------------------------------------------------- loop */

	let prev = performance.now();
	let elapsed = 0;
	let fpsEMA = 60;
	let frames = 0;
	let slowFrames = 0;
	let downshifts = 0;
	let hudTick = 0;

	const tmp = new THREE.Vector3();

	renderer.setAnimationLoop( () => {

		const now = performance.now();
		const dt = Math.min( ( now - prev ) / 1000, 0.1 );
		prev = now;
		elapsed += dt;
		const t = elapsed;

		// pointer → world point on the plane through the origin
		if ( pointerActive ) {

			tmp.set( pointerNDC.x, pointerNDC.y, 0.5 ).unproject( camera ).sub( camera.position ).normalize();
			pointerWorld.copy( camera.position ).addScaledVector( tmp, camera.position.length() );
			uPointer.value.lerp( pointerWorld, 0.16 );

		}

		uPointerK.value += ( pointerTarget - uPointerK.value ) * Math.min( 1, dt * 4 );

		// slow orbit + a little parallax
		parallax.x += ( pointerNDC.x * 0.55 - parallax.x ) * Math.min( 1, dt * 1.6 );
		parallax.y += ( pointerNDC.y * 0.35 - parallax.y ) * Math.min( 1, dt * 1.6 );

		const a = calm ? 0.6 : t * 0.055;
		camera.position.set(
			Math.sin( a ) * orbit + parallax.x,
			orbit * 0.12 + parallax.y,
			Math.cos( a ) * orbit
		);
		camera.lookAt( 0, 0, 0 );
		camera.translateX( shiftX );
		camera.translateY( shiftY );
		camera.updateMatrixWorld();

		renderer.compute( stepCompute );
		post.render();

		// --- readouts + adaptive quality
		if ( dt > 0 ) fpsEMA += ( 1 / dt - fpsEMA ) * 0.06;
		frames ++;

		if ( frames > 90 ) {

			if ( fpsEMA < 46 ) slowFrames ++; else slowFrames = 0;

			if ( slowFrames > 45 && downshifts < 2 && count > 32768 ) {

				count = Math.floor( count / 2 );
				particles.count = count;
				stepCompute = stepParticles().compute( count, [ WORKGROUP ] );
				downshifts ++;
				slowFrames = 0;

			}

		}

		if ( ++ hudTick % 15 === 0 ) hud( { fps: fpsEMA, count } );

	} );

	return {
		backend: 'webgpu',
		count,
		workgroup: WORKGROUP,
		getFPS: () => fpsEMA,
	};

}
