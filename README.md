# Smirnov Lab

Small, self-contained WebGL / WebGPU experiments. One page each, no framework,
no build step beyond a single esbuild call.

## EXP 01 — Flow Field

**[smirnov-artur.github.io/lab](https://smirnov-artur.github.io/lab)**

262 144 particles advanced by one GPU compute dispatch per frame.

- **three.js `WebGPURenderer`** with **TSL** (Three Shading Language) — the shader
  is a node graph in JavaScript, compiled to WGSL at runtime. No string GLSL on
  the WebGPU path.
- **Compute pass.** Position, velocity and lifetime live in storage buffers
  (`instancedArray`, `vec4` each for 16-byte alignment). Every frame one dispatch
  of 1024 workgroups × 256 invocations integrates a curl-noise flow field, a
  tangential swirl, a containment force and pointer repulsion, then respawns dead
  particles at their seed position. Nothing is read back to the CPU.
- **Curl noise** is the curl of `mx_noise_vec3` used as a vector potential,
  by forward differences — 4 noise samples instead of the textbook 6.
- **Render.** `SpriteNodeMaterial` instanced off the same buffers, additive,
  soft analytic disc (no texture fetch), colour ramped by velocity.
- **Post.** TSL `RenderPipeline`: bloom → vignette → grain, ACES tone mapping.
- **Fallback.** `navigator.gpu` *and* the result of `requestAdapter()` are both
  checked. Without WebGPU the page loads a 4 KB WebGL 2 fragment shader that
  draws the same curl-noise field per pixel, and says plainly that this is the
  fallback and what is missing. The 847 KB three.js bundle is never fetched.
- **Adaptive.** 262 144 particles on desktop, 65 536 on touch/small screens;
  halves the dispatch (twice at most) if the frame rate stays under 46 fps.

Measured on desktop 1440×900: 60 fps, 291 KB transferred, no console errors.
Fallback path: 60 fps, 59 KB.

## Build

```sh
npm install
npm run build          # → app.js, fallback.js at the repo root
npm run serve          # http://localhost:4321
node scripts/check.js http://localhost:4321/                  # WebGPU path
node scripts/check.js http://localhost:4321/ --no-gpu         # no navigator.gpu
node scripts/check.js http://localhost:4321/ --null-adapter   # adapter returns null
```

Built files are committed, because GitHub Pages serves this repo straight from
`main` at the root.

---

Artur Smirnov · Belgrade UTC+2 · [portfolio](https://smirnov-artur.github.io/webgl) · [@smirnovarturr](https://t.me/smirnovarturr)
