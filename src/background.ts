const VERT = `attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `precision mediump float;
uniform vec2 u_res;
uniform float u_time;

// Cheap value noise: enough for grain without the cost of simplex noise.
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  // #2D2D2D (0.176) no topo, #AFAFAF (0.686) na base. A origem de gl_FragCoord
  // fica EMBAIXO, então o eixo entra invertido. O expoente é o que segura o
  // escuro na metade de cima: uma rampa linear já chegava cinza no meio da
  // tela, e o campo precisa do tom fechado onde os cards claros passam.
  float t = pow(1.0 - uv.y, 1.25);
  vec3 base = mix(vec3(0.176), vec3(0.686), t);
  // Two subtle patches breathing out of phase. Neutral: the field is greyscale,
  // so they read as light moving, not as colour.
  float glow = 0.05 * sin(u_time * 0.18) + 0.06;
  base += vec3(0.62) * glow * smoothstep(0.75, 0.0, distance(uv, vec2(0.28, 0.35)));
  base += vec3(0.38) * glow * smoothstep(0.80, 0.0, distance(uv, vec2(0.78, 0.70)));
  base += (hash(gl_FragCoord.xy) - 0.5) * 0.022;
  gl_FragColor = vec4(base, 1.0);
}`;

/** Sem WebGL o fundo continua sendo o mesmo degradê, só que sem brilho e sem grão. */
const FALLBACK_BACKGROUND =
  "linear-gradient(to bottom, #2d2d2d 0%, #4c4c4c 32%, #747474 62%, #afafaf 100%)";

function applyFallback(canvas: HTMLCanvasElement): void {
  canvas.style.background = FALLBACK_BACKGROUND;
}

function deleteShader(
  gl: WebGLRenderingContext,
  shader: WebGLShader | null,
): void {
  if (!shader) return;

  try {
    gl.deleteShader(shader);
  } catch {
    // Cleanup must not prevent the CSS fallback from being applied.
  }
}

function compile(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  let shader: WebGLShader | null = null;

  try {
    shader = gl.createShader(type);
    if (!shader) return null;

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      deleteShader(gl, shader);
      return null;
    }

    return shader;
  } catch {
    deleteShader(gl, shader);
    return null;
  }
}

function deleteProgram(
  gl: WebGLRenderingContext,
  program: WebGLProgram | null,
): void {
  if (!program) return;

  try {
    gl.deleteProgram(program);
  } catch {
    // Cleanup is best-effort when the context is already unhealthy.
  }
}

function deleteBuffer(
  gl: WebGLRenderingContext,
  buffer: WebGLBuffer | null,
): void {
  if (!buffer) return;

  try {
    gl.deleteBuffer(buffer);
  } catch {
    // Cleanup is best-effort when the context is already unhealthy.
  }
}

export function initBackground(canvas: HTMLCanvasElement): void {
  let gl: WebGLRenderingContext | null = null;

  try {
    gl = canvas.getContext("webgl", { antialias: false, depth: false });
  } catch {
    applyFallback(canvas);
    return;
  }

  if (!gl) {
    applyFallback(canvas);
    return;
  }

  let vertexShader: WebGLShader | null = null;
  let fragmentShader: WebGLShader | null = null;
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  let position = -1;
  let resolution: WebGLUniformLocation | null = null;
  let time: WebGLUniformLocation | null = null;

  try {
    vertexShader = compile(gl, gl.VERTEX_SHADER, VERT);
    fragmentShader = compile(gl, gl.FRAGMENT_SHADER, FRAG);

    if (!vertexShader || !fragmentShader) {
      deleteShader(gl, vertexShader);
      deleteShader(gl, fragmentShader);
      applyFallback(canvas);
      return;
    }

    program = gl.createProgram();
    if (!program) {
      deleteShader(gl, vertexShader);
      deleteShader(gl, fragmentShader);
      applyFallback(canvas);
      return;
    }

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      deleteProgram(gl, program);
      deleteShader(gl, vertexShader);
      deleteShader(gl, fragmentShader);
      applyFallback(canvas);
      return;
    }

    gl.useProgram(program);
    buffer = gl.createBuffer();
    position = gl.getAttribLocation(program, "p");
    resolution = gl.getUniformLocation(program, "u_res");
    time = gl.getUniformLocation(program, "u_time");

    if (!buffer || position < 0 || resolution === null || time === null) {
      deleteBuffer(gl, buffer);
      deleteProgram(gl, program);
      deleteShader(gl, vertexShader);
      deleteShader(gl, fragmentShader);
      applyFallback(canvas);
      return;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    // A linked program retains its shaders, so the individual objects can go.
    deleteShader(gl, vertexShader);
    deleteShader(gl, fragmentShader);
    vertexShader = null;
    fragmentShader = null;
  } catch {
    deleteBuffer(gl, buffer);
    deleteProgram(gl, program);
    deleteShader(gl, vertexShader);
    deleteShader(gl, fragmentShader);
    applyFallback(canvas);
    return;
  }

  let stopped = false;
  let animationFrame: number | null = null;
  let lastDrawAt = Number.NEGATIVE_INFINITY;
  const frameInterval = 1000 / 30;

  const stopWithFallback = (): void => {
    if (stopped) return;
    stopped = true;

    if (animationFrame !== null) {
      try {
        window.cancelAnimationFrame(animationFrame);
      } catch {
        // The stopped flag still prevents a queued callback from drawing again.
      }
      animationFrame = null;
    }

    try {
      window.removeEventListener("resize", onResize);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    } catch {
      // Listener cleanup is secondary to making the canvas safe and static.
    }
    applyFallback(canvas);
  };

  const resize = (): boolean => {
    if (stopped) return false;

    try {
      // The shader is diffuse; a near-1x buffer avoids millions of needless
      // fragments on HiDPI screens without a visible sharpness loss.
      const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 1.15);
      canvas.width = Math.max(1, Math.floor(window.innerWidth * dpr));
      canvas.height = Math.max(1, Math.floor(window.innerHeight * dpr));
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(resolution, canvas.width, canvas.height);
      return true;
    } catch {
      stopWithFallback();
      return false;
    }
  };

  const draw = (timestamp: number): boolean => {
    if (stopped) return false;

    try {
      gl.uniform1f(time, timestamp / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return true;
    } catch {
      stopWithFallback();
      return false;
    }
  };

  let reducedMotion = false;
  try {
    reducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    // If the media query API is unavailable, animation remains the default.
  }

  function onResize(): void {
    if (resize() && reducedMotion) draw(0);
  }

  function onContextLost(event: Event): void {
    try {
      event.preventDefault();
    } catch {
      // Continue into the fallback even if a synthetic event cannot be canceled.
    }
    stopWithFallback();
  }

  function loop(timestamp: number): void {
    animationFrame = null;
    if (stopped || document.hidden) return;
    if (timestamp - lastDrawAt >= frameInterval) {
      if (!draw(timestamp)) return;
      lastDrawAt = timestamp;
    }
    requestNextFrame();
  }

  function requestNextFrame(): void {
    if (animationFrame !== null || document.hidden) return;
    try {
      animationFrame = window.requestAnimationFrame(loop);
    } catch {
      stopWithFallback();
    }
  }

  function onVisibilityChange(): void {
    if (document.hidden) {
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      animationFrame = null;
      return;
    }
    if (reducedMotion) {
      draw(0);
      return;
    }
    lastDrawAt = Number.NEGATIVE_INFINITY;
    requestNextFrame();
  }

  canvas.addEventListener("webglcontextlost", onContextLost);
  window.addEventListener("resize", onResize);
  document.addEventListener("visibilitychange", onVisibilityChange);

  if (!resize()) return;

  if (reducedMotion) {
    draw(0);
    return;
  }

  requestNextFrame();
}
