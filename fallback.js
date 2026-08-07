var w=`#version 300 es
in vec2 a;
void main(){ gl_Position = vec4(a, 0.0, 1.0); }`,y=`#version 300 es
precision highp float;
out vec4 o;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uPointer;

// --- value noise ------------------------------------------------------
vec3 hash3(vec3 p){
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
           dot(p, vec3(269.5, 183.3, 246.1)),
           dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453) * 2.0 - 1.0;
}
float noise(vec3 p){
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(dot(hash3(i + vec3(0,0,0)), f - vec3(0,0,0)),
            dot(hash3(i + vec3(1,0,0)), f - vec3(1,0,0)), u.x),
        mix(dot(hash3(i + vec3(0,1,0)), f - vec3(0,1,0)),
            dot(hash3(i + vec3(1,1,0)), f - vec3(1,1,0)), u.x), u.y),
    mix(mix(dot(hash3(i + vec3(0,0,1)), f - vec3(0,0,1)),
            dot(hash3(i + vec3(1,0,1)), f - vec3(1,0,1)), u.x),
        mix(dot(hash3(i + vec3(0,1,1)), f - vec3(0,1,1)),
            dot(hash3(i + vec3(1,1,1)), f - vec3(1,1,1)), u.x), u.y), u.z);
}
float fbm(vec3 p){
  float a = 0.5, s = 0.0;
  for (int k = 0; k < 3; k++){ s += a * noise(p); p *= 2.07; a *= 0.5; }
  return s;
}
// curl of a scalar-derived potential, 2D slice
vec2 curl(vec3 p){
  float e = 0.16;
  float n0 = fbm(p);
  float nx = fbm(p + vec3(e, 0.0, 0.0));
  float ny = fbm(p + vec3(0.0, e, 0.0));
  return vec2(ny - n0, -(nx - n0)) / e;
}

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float t = uTime * 0.06;

  // domain warp: trace the flow a few steps, accumulate density
  vec2 p = uv * 1.55;
  float acc = 0.0;
  for (int k = 0; k < 4; k++){
    vec2 f = curl(vec3(p, t));
    p += f * 0.06;
    acc += fbm(vec3(p * 2.6, t * 1.6)) * 0.25;
  }

  // pointer pushes the field away, echoing the compute version
  float pd = length(uv - uPointer);
  acc += 0.13 * exp(-pd * 5.5);

  // contrast: filaments, not fog
  float v = smoothstep(-0.02, 0.21, acc);
  v *= 0.42 + 0.58 * smoothstep(-0.14, 0.26, fbm(vec3(p * 8.5, t * 2.4)));
  v *= smoothstep(1.05, 0.12, length(uv * vec2(0.92, 1.5)));

  vec3 slow = vec3(0.051, 0.086, 0.170);
  vec3 midc = vec3(0.243, 0.376, 0.639);
  vec3 fast = vec3(0.882, 0.910, 0.965);
  vec3 col = mix(slow, midc, smoothstep(0.0, 0.55, v));
  col = mix(col, fast, smoothstep(0.62, 1.0, v));
  col *= v * 1.25;

  // vignette + grain
  col *= smoothstep(1.2, 0.3, length(uv * vec2(0.6, 1.0))) * 0.85 + 0.15;
  col += (fract(sin(dot(gl_FragCoord.xy + uTime, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.02;

  o = vec4(max(col, 0.0), 1.0);
}`;function P({canvas:i,hud:p}){let e=i.getContext("webgl2",{antialias:!1,alpha:!1,powerPreference:"high-performance"});if(!e)return{backend:"none"};let a=(o,n)=>{let r=e.createShader(o);return e.shaderSource(r,n),e.compileShader(r),e.getShaderParameter(r,e.COMPILE_STATUS)||console.warn(e.getShaderInfoLog(r)),r},t=e.createProgram();e.attachShader(t,a(e.VERTEX_SHADER,w)),e.attachShader(t,a(e.FRAGMENT_SHADER,y)),e.linkProgram(t),e.useProgram(t);let d=e.createVertexArray();e.bindVertexArray(d);let g=e.createBuffer();e.bindBuffer(e.ARRAY_BUFFER,g),e.bufferData(e.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),e.STATIC_DRAW);let s=e.getAttribLocation(t,"a");e.enableVertexAttribArray(s),e.vertexAttribPointer(s,2,e.FLOAT,!1,0,0);let x=e.getUniformLocation(t,"uRes"),A=e.getUniformLocation(t,"uTime"),R=e.getUniformLocation(t,"uPointer"),f=Math.min(devicePixelRatio,1),v=()=>{i.width=Math.round(innerWidth*f),i.height=Math.round(innerHeight*f),e.viewport(0,0,i.width,i.height),e.uniform2f(x,i.width,i.height)};addEventListener("resize",v),v();let h=0,l=0;addEventListener("pointermove",o=>{h=(o.clientX-innerWidth/2)/innerHeight,l=-(o.clientY-innerHeight/2)/innerHeight},{passive:!0});let c=60,u=performance.now(),b=0,m=o=>{let n=Math.min((o-u)/1e3,.1);u=o,n>0&&(c+=(1/n-c)*.06),e.uniform1f(A,o/1e3),e.uniform2f(R,h,l),e.drawArrays(e.TRIANGLES,0,3),++b%15===0&&p({fps:c,count:0}),requestAnimationFrame(m)};return requestAnimationFrame(m),{backend:"webgl2",getFPS:()=>c}}export{P as start};
