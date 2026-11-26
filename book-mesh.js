function createBookMesh(stage) {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl', { antialias: true, alpha: true, depth: true });
  if (!gl || typeof DOMMatrix !== 'function') return null;

  const program = gl.createProgram();
  const shaders = [
    [gl.VERTEX_SHADER, `
      attribute vec3 point;
      attribute vec2 uv;
      attribute vec3 tone;
      uniform vec2 viewport;
      varying vec2 texel;
      varying vec3 color;
      void main() {
        float w = 1.0 - point.z / 1300.0;
        gl_Position = vec4(2.0 * point.x / viewport.x, -2.0 * point.y / viewport.y,
          -point.z / 2600.0, w);
        texel = uv;
        color = tone;
      }
    `],
    [gl.FRAGMENT_SHADER, `
      precision mediump float;
      uniform sampler2D art;
      varying vec2 texel;
      varying vec3 color;
      void main() {
        gl_FragColor = vec4(texture2D(art, texel).rgb * color, 1.0);
      }
    `],
  ];
  for (const [type, source] of shaders) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return null;
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;

  canvas.className = 'book-mesh';
  canvas.hidden = true;
  canvas.setAttribute('aria-hidden', 'true');
  stage.append(canvas);
  gl.useProgram(program);
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.clearColor(0, 0, 0, 0);
  const viewport = gl.getUniformLocation(program, 'viewport');
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  for (const [name, width, offset] of [['point', 3, 0], ['uv', 2, 3], ['tone', 3, 5]]) {
    const attribute = gl.getAttribLocation(program, name);
    gl.enableVertexAttribArray(attribute);
    gl.vertexAttribPointer(attribute, width, gl.FLOAT, false, 32, offset * 4);
  }
  const blank = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, blank);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
    new Uint8Array([255, 255, 255, 255]));

  const textures = new Map();
  const local = location.protocol === 'file:';
  const white = [1, 1, 1];
  const paper = [.98, .95, .89];
  const layers = [0.89, .83, .74];
  const board = [.235, .135, .19];
  const lining = [.30, .20, .26];
  const endpaper = [61 / 255, 38 / 255, 59 / 255];
  let stageWidth;
  let stageHeight;
  let root;
  let lost = false;
  let scheduled = false;
  let waitingForTextures = false;
  let animationMode = null;
  let shown = false;
  const identity = new DOMMatrix();

  function show(ready) {
    if (shown === ready) return;
    shown = ready;
    canvas.hidden = !ready;
    stage.classList.toggle('mesh-ready', ready);
  }

  canvas.addEventListener('webglcontextlost', () => {
    lost = true;
    for (const record of textures.values()) record.settle();
    show(false);
  });

  function refresh() {
    if (scheduled || !root || lost || !waitingForTextures || animationMode === false) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      if (waitingForTextures) paint(root);
    });
  }

  function loadImage(url, source) {
    const record = textures.get(url);
    if (!record || lost) return;
    const image = new Image();
    image.onload = () => {
      if (lost) return;
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      } catch {
        gl.deleteTexture(texture);
        record.settle();
        refresh();
        return;
      }
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      record.texture = texture;
      record.settle();
      const pages = [...textures.entries()].filter(([name, entry]) =>
        entry.texture && !['assets/spine.webp', 'assets/page-01.jpg', 'assets/page-68.jpg'].includes(name));
      if (pages.length > 12) {
        const [name, old] = pages.sort((a, b) => a[1].used - b[1].used)[0];
        gl.deleteTexture(old.texture);
        textures.delete(name);
      }
      refresh();
    };
    image.onerror = () => { record.settle(); refresh(); };
    image.src = source;
  }

  // Local HTML can run its packaged texture scripts on browsers that isolate file images.
  if (local) window.receiveBookTexture = loadImage;

  function preload(url) {
    const current = textures.get(url);
    if (current) {
      current.used = performance.now();
      return current.texture;
    }
    if (lost) return undefined;
    const record = { used: performance.now() };
    record.loaded = new Promise(resolve => { record.settle = resolve; });
    textures.set(url, record);
    if (!local) {
      loadImage(url, url);
      return undefined;
    }
    const script = document.createElement('script');
    script.src = url.replace('assets/', 'assets/textures/').replace(/\.(jpg|webp)$/, '.js');
    script.onload = () => script.remove();
    script.onerror = () => { script.remove(); record.settle(); refresh(); };
    document.head.append(script);
    return undefined;
  }

  function ready(urls) {
    return !lost && urls.every(url => textures.get(url)?.texture);
  }

  async function prepare(urls) {
    if (lost || ready(urls)) return !lost;
    for (const url of urls) preload(url);
    let timer;
    await Promise.race([
      Promise.all(urls.map(url => textures.get(url)?.loaded)),
      new Promise(resolve => { timer = setTimeout(resolve, 650); }),
    ]);
    clearTimeout(timer);
    return ready(urls);
  }

  function paint(camera) {
    root = camera;
    if (lost || !stageWidth || !stageHeight) return;
    if (animationMode === false) {
      show(false);
      return;
    }
    const batches = new Map();
    const frameTextures = new Map();
    let pending = false;
    function visit(node, model, inheritedArt, foldShade, isEndpaper) {
      if (node.hidden) return;
      const plane = node.meshPlane;
      if (!plane && node.meshTransform) {
        if (node.meshMatrixSource !== node.meshTransform) {
          node.meshMatrix = new DOMMatrix(node.meshTransform);
          node.meshMatrixSource = node.meshTransform;
        }
        model = model.multiply(node.meshMatrix);
      }
      const art = node.meshArt === undefined ? inheritedArt : node.meshArt;
      const shade = node.meshShade ?? foldShade;
      const darkPaper = node.meshEndpaper ?? isEndpaper;
      if (!node.meshMaterial) {
        for (const child of node.children) visit(child, model, art, shade, darkPaper);
        return;
      }
      const material = node.meshMaterial;
      const textured = material === 'spine' || material.includes('illustrated') || material === 'paper page-face';
      let texture = blank;
      if (textured && art) {
        if (!frameTextures.has(art)) frameTextures.set(art, preload(art));
        texture = frameTextures.get(art);
      }
      if (!texture) {
        pending = true;
        return;
      }
      if (!batches.has(texture)) batches.set(texture, []);
      const vertices = batches.get(texture);
      const tone = textured && art ? white : material.startsWith('paper')
        ? (darkPaper ? endpaper : material.includes('edge') ? layers : paper)
        : (material.includes('lining') ? lining : board);

      function vertex(x, y, u, v, shadow = 0) {
        let z = 0;
        if (plane) {
          z = plane.z + x * plane.dz;
          x = plane.x + x * plane.dx;
          y += plane.y;
        }
        const light = 1 - shade * shadow;
        vertices.push(
          model.m11 * x + model.m21 * y + model.m31 * z + model.m41,
          model.m12 * x + model.m22 * y + model.m32 * z + model.m42,
          model.m13 * x + model.m23 * y + model.m33 * z + model.m43,
          u, v, tone[0] * light, tone[1] * light, tone[2] * light,
        );
      }

      const h = node.meshHeight;
      if (node.meshCap) {
        const { baseline, columns } = node.meshCap;
        for (let i = 1; i < columns.length; i++) {
          const [x0, y0] = columns[i - 1];
          const [x1, y1] = columns[i];
          const top0 = Math.min(y0, baseline);
          const top1 = Math.min(y1, baseline);
          const bottom0 = Math.max(y0, baseline);
          const bottom1 = Math.max(y1, baseline);
          vertex(x0, top0, 0, 0);
          vertex(x0, bottom0, 0, 0);
          vertex(x1, bottom1, 0, 0);
          vertex(x0, top0, 0, 0);
          vertex(x1, bottom1, 0, 0);
          vertex(x1, top1, 0, 0);
        }
        return;
      }
      const { span = node.meshWidth, u0 = 0, u1 = 1, shade0 = 0, shade1 = 0 } = node.meshPanel ?? {};
      vertex(0, 0, u0, 0, shade0);
      vertex(0, h, u0, 1, shade0);
      vertex(span, h, u1, 1, shade1);
      vertex(0, 0, u0, 0, shade0);
      vertex(span, h, u1, 1, shade1);
      vertex(span, 0, u1, 0, shade1);
    }

    visit(camera, identity, null, 0, false);
    waitingForTextures = pending;
    if (pending) {
      show(false);
      return;
    }
    const resolution = Math.min(devicePixelRatio, 1.25, Math.sqrt(1250000 / (stageWidth * stageHeight)));
    const width = Math.round(stageWidth * resolution);
    const height = Math.round(stageHeight * resolution);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.uniform2f(viewport, stageWidth, stageHeight);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    for (const [texture, vertices] of batches) {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 8);
    }
    show(true);
    return true;
  }
  return {
    paint,
    preload,
    ready(urls) { return lost || ready(urls); },
    prepare,
    hold(mode) { animationMode = mode; },
    resize(width, height) {
      stageWidth = width;
      stageHeight = height;
    },
  };
}
