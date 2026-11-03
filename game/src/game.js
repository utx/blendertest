// Cubit Island: screens, 3D stage and answer reveals. Puzzle logic lives in puzzles.js.
(function () {
  "use strict";
  const P = window.Puzzles;
  const A = window.CI_ASSETS;
  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const STATIONS = [
    { id: "crates", name: "Crate Yard", skill: "Counting cubes you can't see", tip: "Count one layer at a time from the top. A crate can't float, so every crate you see up high has more underneath it." },
    { id: "lookout", name: "Lookout Tower", skill: "Front, side and top views", tip: "Pretend you are standing right at the sign. In each column you only see the tallest pile along that line." },
    { id: "twins", name: "Twin Stones", skill: "Turning shapes and mirror images", tip: "Find one easy cube, like a corner or the end of the longest arm, and follow what comes off it. A mirror twin looks right but can never be turned to match." },
    { id: "nets", name: "Fold Factory", skill: "Cube nets and opposite faces", tip: "Choose one square as the floor and fold the others up around it. Squares with one square between them in a line end up opposite each other." },
    { id: "punch", name: "Punch Bay", skill: "Paper folding and holes", tip: "Each fold doubles the layers, so it doubles the holes. Unfold from the last fold to the first, and treat every fold line as a mirror." },
    { id: "paint", name: "Paint Dip", skill: "Painted cubes and cuboids", tip: "Corners get 3 painted faces. Edges get 2. The middle of a face gets 1. Buried cubes get none. Work out where each kind of cube lives." },
  ];
  const stationOf = (id) => STATIONS.find((s) => s.id === id);
  const LEVELS = ["", "Bronze", "Silver", "Gold"];
  const LETTERS = "ABCD";
  const SESSION_LENGTH = 6;
  const EXAM_LENGTH = 10;
  const EXAM_SECONDS = 600;

  // ---------------------------------------------------------------- saved progress

  const STORE_KEY = "cubit-island-v1";
  const blank = () => ({ stars: {}, level: {}, stats: {}, exams: [], muted: false, updatedAt: 0, last: null });
  let state = blank();
  let progressDoc = null;
  let saveTimer = 0;

  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) state = { ...blank(), ...JSON.parse(raw) };
  } catch (e) { /* Private windows can refuse storage. The game still plays. */ }

  function save() {
    state.updatedAt = Date.now();
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* Same as above. */ }
    clearTimeout(saveTimer);
    if (progressDoc) saveTimer = setTimeout(() => progressDoc.set(state).catch(() => {}), 800);
  }

  // Progress follows the signed-in child across devices when the viewer offers it.
  async function connectSavedProgress() {
    if (!window.claude || !window.claude.use) return;
    try {
      const [db, user] = await Promise.all([window.claude.use("db"), window.claude.use("user")]);
      if (!db || !user) return;
      const id = await user.id();
      if (!id) return;
      const doc = db.collection("data/users/" + id).doc("progress");
      const snap = await doc.get();
      progressDoc = doc;
      const remote = snap.exists ? snap.data() : null;
      if (remote && (remote.updatedAt || 0) > state.updatedAt) {
        state = { ...blank(), ...JSON.parse(JSON.stringify(remote)) };
        try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* Same as above. */ }
        refreshHub();
      } else if (state.updatedAt) {
        progressDoc.set(state).catch(() => {});
      }
    } catch (e) { /* Local progress keeps working. */ }
  }

  const levelOf = (kind) => state.level[kind] || 1;
  function recordStat(kind, right, clean) {
    const s = state.stats[kind] || (state.stats[kind] = { right: 0, total: 0, clean: 0 });
    s.total++;
    if (right) s.right++;
    if (right && clean) s.clean++;
  }
  const totalStars = () => STATIONS.reduce((n, s) => n + (state.stars[s.id] || 0), 0);
  const starsHtml = (n, max = 3) => "<i>★</i>".repeat(n) + "★".repeat(Math.max(0, max - n));

  // ---------------------------------------------------------------- sound

  let audio = null;
  function tone(freqs, dur = 0.12, type = "triangle") {
    if (state.muted) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      freqs.forEach((f, i) => {
        const o = audio.createOscillator(), g = audio.createGain();
        o.type = type; o.frequency.value = f;
        const t = audio.currentTime + i * dur * 0.8;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.14, t + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(audio.destination);
        o.start(t); o.stop(t + dur + 0.02);
      });
    } catch (e) { /* Sound is optional. */ }
  }
  const SFX = { right: () => tone([523, 659, 784]), wrong: () => tone([220, 175], 0.16, "sine"), tap: () => tone([600], 0.05), win: () => tone([523, 659, 784, 1047], 0.16) };

  // ---------------------------------------------------------------- tweens

  let tweens = [];
  const easeInOut = (t) => (t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const easeOutBack = (t) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);
  function tween(ms, fn, ease = easeInOut) {
    return new Promise((resolve) => {
      tweens.push({ start: performance.now(), dur: Math.max(1, REDUCED ? ms * 0.1 : ms), fn, ease, resolve });
    });
  }
  const wait = (ms) => tween(ms, () => {});
  function stepTweens(now) {
    // A finished tween can start new ones through its promise, and those land in the fresh list.
    const current = tweens;
    tweens = [];
    for (const t of current) {
      const k = Math.min(1, (now - t.start) / t.dur);
      t.fn(t.ease(Math.max(0, k)));
      if (k < 1) tweens.push(t); else t.resolve(true);
    }
  }
  let runToken = 0;
  function stopAnimations() {
    runToken++;
    const old = tweens;
    tweens = [];
    old.forEach((t) => t.resolve(false));
  }

  // ---------------------------------------------------------------- three.js set-up

  const canvas = $("#gl");
  let renderer = null;
  let glError = null;
  try {
    if (!window.THREE) throw new Error("no three");
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  } catch (e) { glError = e; }

  if (!renderer) {
    $("#playBtn").disabled = true;
    const n = $("#titleNote");
    n.hidden = false;
    n.textContent = window.THREE
      ? "This game needs 3D graphics (WebGL), which this browser has turned off. Try Chrome, Edge or Safari with hardware acceleration on."
      : "The 3D engine could not load. Check the internet connection and reload.";
  }
  $("#title").style.backgroundImage = `url(${A.img.title})`;

  const models = { island: null, cubit: null, frameGeo: null, panelGeo: null };

  function b64ToBuffer(b64) {
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return buf.buffer;
  }
  const parseGlb = (b64) => new Promise((res, rej) => new THREE.GLTFLoader().parse(b64ToBuffer(b64), "", res, rej));

  function addLights(scene, size = 16, shadow = true) {
    scene.add(new THREE.HemisphereLight(0xfff8e8, 0x8fb7c2, 0.5));
    const sun = new THREE.DirectionalLight(0xfff0d8, 0.62);
    sun.position.set(-size * .55, size, size * .75);
    if (shadow) {
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      const c = sun.shadow.camera;
      c.left = -size; c.right = size; c.top = size; c.bottom = -size; c.near = .5; c.far = size * 4;
      sun.shadow.bias = -0.0006;
      sun.shadow.normalBias = 0.02;
    }
    scene.add(sun);
    return sun;
  }

  // ---------------------------------------------------------------- island map scene

  const hubScene = renderer ? new THREE.Scene() : null;
  const hubCam = renderer ? new THREE.PerspectiveCamera(30, 1, .1, 800) : null;
  const hub = { stations: {}, cubit: null, parts: {}, hover: null, sea: null, starSprites: {}, hop: false, summit: null };

  const seaMaterial = () => new THREE.ShaderMaterial({
    transparent: true,
    uniforms: { t: { value: 0 } },
    vertexShader: "varying vec3 w; void main(){ vec4 p = modelMatrix * vec4(position,1.); w = p.xyz; gl_Position = projectionMatrix * viewMatrix * p; }",
    fragmentShader: `varying vec3 w; uniform float t;
      void main(){
        float d = length(w.xz);
        vec3 shallow = vec3(.32,.86,.82), deep = vec3(.03,.42,.62), far = vec3(.56,.82,.92);
        vec3 c = mix(shallow, deep, smoothstep(10.5, 21., d));
        float n = sin(w.x*.7+t*.7)+sin(w.z*.9-t*.5)+sin((w.x+w.z)*.35+t*.3);
        float ring = smoothstep(.12,.0,abs(fract(d*.34 - t*.05 + n*.06)-.5)) * smoothstep(24.,12.,d) * .34;
        c += ring + smoothstep(2.2,3.,n)*.1;
        c = mix(c, far, smoothstep(55., 130., d));
        gl_FragColor = vec4(c, 1.);
        #include <encodings_fragment>
      }`,
  });

  function buildHub() {
    addLights(hubScene, 17);
    hub.sea = new THREE.Mesh(new THREE.CircleGeometry(420, 64), seaMaterial());
    hub.sea.rotation.x = -Math.PI / 2;
    hub.sea.position.y = -.01;
    hubScene.add(hub.sea);
    const island = models.island.scene;
    island.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    hubScene.add(island);
    for (const s of STATIONS) {
      const node = island.getObjectByName("station_" + s.id);
      if (!node) continue;
      const box = new THREE.Box3().setFromObject(node);
      const meshes = [];
      node.traverse((o) => {
        if (o.isMesh) {
          o.material = o.material.clone();
          o.userData.base = o.material.color.clone();
          o.userData.station = s.id;
          meshes.push(o);
        }
      });
      hub.stations[s.id] = { node, meshes, top: box.max.y, base: node.position.clone(), centre: box.getCenter(new THREE.Vector3()) };
      const star = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false }));
      star.scale.set(2.4, .8, 1);
      star.renderOrder = 5;
      star.position.set(hub.stations[s.id].centre.x, box.max.y + .8, hub.stations[s.id].centre.z);
      hubScene.add(star);
      hub.starSprites[s.id] = star;
    }
    const summit = island.getObjectByName("summit");
    hub.summit = summit ? summit.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, .17, 0)) : new THREE.Vector3(0, 2.6, 0);
    const bot = models.cubit.scene;
    bot.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    bot.scale.setScalar(1.2);
    bot.position.copy(hub.summit);
    hubScene.add(bot);
    hub.cubit = bot;
    for (const n of ["eyes", "arm_L", "arm_R", "antenna", "body"]) hub.parts[n] = bot.getObjectByName(n);
    if (state.last && hub.stations[state.last]) {
      bot.position.copy(perch(state.last));
    }
  }

  // Cubit stands in front of a station, on the summit side.
  function perch(id) {
    const s = hub.stations[id];
    const dir = new THREE.Vector3(-s.base.x, 0, -s.base.z).normalize();
    const p = s.base.clone().addScaledVector(dir, 2.5);
    p.y = groundAt(p.x, p.z);
    return p;
  }
  const rayDown = new THREE.Raycaster();
  function groundAt(x, z) {
    const terrain = models.island.scene.getObjectByName("terrain");
    if (!terrain) return 1.2;
    rayDown.set(new THREE.Vector3(x, 40, z), new THREE.Vector3(0, -1, 0));
    const hit = rayDown.intersectObject(terrain, true)[0];
    return hit ? hit.point.y : 1.2;
  }

  function starCanvas(n) {
    const c = document.createElement("canvas");
    c.width = 192; c.height = 64;
    const g = c.getContext("2d");
    g.font = "52px Arial, sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    for (let i = 0; i < 3; i++) {
      g.lineWidth = 7; g.strokeStyle = "#12304a"; g.strokeText("★", 32 + i * 64, 34);
      g.fillStyle = i < n ? "#ffc531" : "#dfeef5"; g.fillText("★", 32 + i * 64, 34);
    }
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    return t;
  }

  // Stations stay washed-out until they have earned a star, so the island fills with colour as you play.
  function paintStations() {
    const grey = new THREE.Color(0x9fb4bd);
    for (const s of STATIONS) {
      const h = hub.stations[s.id];
      if (!h) continue;
      const n = state.stars[s.id] || 0;
      h.meshes.forEach((m) => m.material.color.copy(m.userData.base).lerp(grey, n ? 0 : .55));
      const spr = hub.starSprites[s.id];
      if (spr.material.map) spr.material.map.dispose();
      spr.material.map = starCanvas(n);
      spr.material.needsUpdate = true;
    }
  }

  const ray = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  function pickStation(ev) {
    const r = canvas.getBoundingClientRect();
    pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(pointer, hubCam);
    const all = STATIONS.flatMap((s) => (hub.stations[s.id] ? hub.stations[s.id].meshes : []));
    const hit = ray.intersectObjects(all, false)[0];
    return hit ? hit.object.userData.station : null;
  }

  function setHover(id, ev) {
    if (hub.hover !== id) {
      hub.hover = id;
      document.querySelectorAll(".st").forEach((b) => b.classList.toggle("hot", b.dataset.id === id));
    }
    canvas.style.cursor = id ? "pointer" : "";
    const tag = $("#tag");
    tag.hidden = !id;
    if (id && ev) {
      const r = canvas.getBoundingClientRect();
      tag.textContent = stationOf(id).name;
      tag.style.left = ev.clientX - r.left + "px";
      tag.style.top = ev.clientY - r.top - 12 + "px";
    }
  }

  function frameHub() {
    if (!renderer) return;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    const narrow = W <= 800;
    const rail = $("#rail");
    const railW = narrow ? 0 : rail.offsetWidth;
    const railH = narrow ? rail.offsetHeight : 0;
    const availW = W - railW, availH = H - railH;
    hubCam.aspect = W / H;
    const a = availW / availH;
    const dist = 44 * Math.max(.72, Math.max(1.28 / a, 1)) * (H / availH);
    hubCam.position.set(0, dist * .56, dist * .83);
    hubCam.lookAt(0, 1.3, 0);
    hubCam.setViewOffset(W, H, railW / 2, railH / 2, W, H);
    hubCam.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- puzzle stage basics

  const stageScene = renderer ? new THREE.Scene() : null;
  const stageCam = renderer ? new THREE.OrthographicCamera(-5, 5, 5, -5, -100, 200) : null;
  let content = null;
  const ISO_AZ = 45, ISO_EL = 35.264;
  const cam = { az: ISO_AZ, el: ISO_EL, x: 0, y: 1, z: 0, fx: 4, fy: 4 };
  const CRATE = 0xdd9d5c;

  function applyCam() {
    const az = (cam.az * Math.PI) / 180, e = (cam.el * Math.PI) / 180;
    stageCam.position.set(cam.x + Math.sin(az) * Math.cos(e) * 60, cam.y + Math.sin(e) * 60, cam.z + Math.cos(az) * Math.cos(e) * 60);
    stageCam.lookAt(cam.x, cam.y, cam.z);
    const W = canvas.clientWidth || 1, H = canvas.clientHeight || 1;
    const aspect = W / H;
    // The tools row covers the bottom of the stage, so leave a little extra margin.
    const half = Math.max(cam.fy, cam.fx / aspect) * 1.06;
    stageCam.top = half; stageCam.bottom = -half; stageCam.left = -half * aspect; stageCam.right = half * aspect;
    stageCam.updateProjectionMatrix();
  }
  function setCam(v) { Object.assign(cam, v); applyCam(); }
  function moveCam(to, ms) {
    const from = { ...cam };
    return tween(ms, (t) => {
      for (const k in to) cam[k] = from[k] + (to[k] - from[k]) * t;
      applyCam();
    });
  }

  // Crates share one mesh per part so a stack of 60 still animates smoothly.
  class Crates {
    constructor(list, color = CRATE) {
      this.n = list.length;
      this.pos = list.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
      this.scale = list.map(() => 1);
      this.color = list.map(() => new THREE.Color(color));
      this.group = new THREE.Group();
      this.frame = new THREE.InstancedMesh(models.frameGeo, new THREE.MeshStandardMaterial({ roughness: .62 }), this.n);
      this.panel = new THREE.InstancedMesh(models.panelGeo, new THREE.MeshStandardMaterial({ color: 0xc9c9c9, roughness: .8 }), this.n);
      for (const m of [this.frame, this.panel]) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; this.group.add(m); }
      this.sync();
    }
    sync() {
      const d = new THREE.Object3D();
      for (let i = 0; i < this.n; i++) {
        d.position.copy(this.pos[i]);
        d.scale.setScalar(Math.max(.0001, this.scale[i]));
        d.updateMatrix();
        for (const m of [this.frame, this.panel]) { m.setMatrixAt(i, d.matrix); m.setColorAt(i, this.color[i]); }
      }
      for (const m of [this.frame, this.panel]) { m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; }
    }
  }

  function label(text, { bg = "#12304a", fg = "#ffffff", h = .62, ontop = true } = {}) {
    const c = document.createElement("canvas");
    const g0 = c.getContext("2d");
    const font = "64px 'Lilita One', 'Arial Rounded MT Bold', Arial, sans-serif";
    g0.font = font;
    const w = Math.ceil(g0.measureText(text).width) + 56;
    c.width = Math.max(w, 96); c.height = 96;
    const g = c.getContext("2d");
    g.font = font;
    g.fillStyle = bg;
    g.beginPath();
    g.roundRect ? g.roundRect(0, 0, c.width, 96, 26) : g.rect(0, 0, c.width, 96);
    g.fill();
    g.fillStyle = fg; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(text, c.width / 2, 52);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: !ontop }));
    s.scale.set((h * c.width) / 96, h, 1);
    s.renderOrder = ontop ? 10 : 0;
    return s;
  }

  function clearStage() {
    stopAnimations();
    if (content) stageScene.remove(content);
    content = new THREE.Group();
    stageScene.add(content);
    return content;
  }

  // A little sand island under whatever is being shown.
  function addBase(radius, y = -.11) {
    const sand = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.08, .5, 28), new THREE.MeshStandardMaterial({ color: 0xf3d68b, roughness: 1, flatShading: true }));
    sand.position.y = y - .25;
    sand.receiveShadow = true;
    content.add(sand);
    const grass = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.2, radius * 1.32, .5, 28), new THREE.MeshStandardMaterial({ color: 0x25a6b8, roughness: .5, flatShading: true }));
    grass.position.y = y - .62;
    content.add(grass);
  }

  function addPlate(w, d, opts = {}) {
    const geo = new THREE.BoxGeometry(.95, .1, .95);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xfff1c9, roughness: .9 }), w * d);
    const m = new THREE.Object3D();
    let i = 0;
    for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) {
      m.position.set(x + .5 - w / 2, -.05, z + .5 - d / 2);
      m.updateMatrix();
      mesh.setMatrixAt(i++, m.matrix);
    }
    mesh.receiveShadow = true;
    content.add(mesh);
    addBase(Math.hypot(w, d) / 2 + .75);
    if (opts.flags !== false) {
      const edge = (sx, sz, px, pz, color) => {
        const b = new THREE.Mesh(new THREE.BoxGeometry(sx, .12, sz), new THREE.MeshStandardMaterial({ color }));
        b.position.set(px, -.04, pz);
        content.add(b);
      };
      edge(w, .14, 0, d / 2 + .1, 0xff5a4e);
      edge(.14, d, w / 2 + .1, 0, 0x2b7de9);
      const front = label("FRONT", { bg: "#ff5a4e", h: .5 });
      front.position.set(0, .05, d / 2 + .72);
      const right = label("RIGHT", { bg: "#2b7de9", h: .5 });
      right.position.set(w / 2 + .72, .05, 0);
      content.add(front, right);
      content.userData.signs = [front, right];
    }
  }

  const gridPos = (c, w, d) => [c[0] + .5 - w / 2, c[1] + .5, c[2] + .5 - d / 2];
  // How far the iso view reaches, so the camera can frame a w × d × h stack.
  const isoFit = (w, d, h) => ({ fx: (w + d) * .354 + .95, fy: (w + d) * .204 + h * .408 + .85 });

  // ---------------------------------------------------------------- stacks

  function buildStack(q) {
    const w = q.heights.length, d = q.heights[0].length, h = q.box ? q.box[1] : Math.max(...q.heights.flat());
    clearStage();
    addPlate(w, d);
    const cubes = q.cubes.slice();
    const missing = [];
    if (q.box) {
      const has = new Set(cubes.map(String));
      for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) for (let z = 0; z < d; z++) if (!has.has(String([x, y, z]))) missing.push([x, y, z]);
      const wire = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)), new THREE.LineBasicMaterial({ color: 0x12304a }));
      wire.position.y = h / 2;
      content.add(wire);
    }
    const set = new Crates([...cubes, ...missing].map((c) => gridPos(c, w, d)));
    missing.forEach((_, i) => { set.scale[cubes.length + i] = 0; });
    set.sync();
    content.add(set.group);
    setCam({ az: ISO_AZ, el: ISO_EL, x: 0, y: h / 2, z: 0, ...isoFit(w, d, h) });
    return { set, cubes, missing, w, d, h };
  }

  const LAYER_COLOURS = [0xff8a5c, 0xffc531, 0x6fd08c, 0x58b7f0];

  async function revealLayers(q) {
    const s = buildStack(q);
    const tok = runToken;
    await wait(300);
    if (tok !== runToken) return;
    const tops = [...new Set(s.cubes.map((c) => c[1]))].sort((a, b) => b - a);
    const gap = 1.1;
    const lift = (y) => (y * gap);
    const hidden = new Set(P.hiddenCubes(q.heights).map(String));
    const start = s.set.pos.map((p) => p.clone());
    await Promise.all([
      moveCam({ y: (s.h + (s.h - 1) * gap) / 2, ...isoFit(s.w, s.d, s.h + (s.h - 1) * gap) }, 1000),
      tween(1000, (t) => {
        s.cubes.forEach((c, i) => { s.set.pos[i].y = start[i].y + lift(c[1]) * t; });
        s.set.sync();
      }),
    ]);
    if (tok !== runToken) return;
    // Light up each layer from the top, then the crates nobody could see.
    for (const y of tops) {
      const idx = s.cubes.map((c, i) => (c[1] === y ? i : -1)).filter((i) => i >= 0);
      idx.forEach((i) => { s.set.color[i].set(LAYER_COLOURS[y % LAYER_COLOURS.length]); });
      s.set.sync();
      const tag = label(String(idx.length), { h: .72 });
      tag.position.set(-s.w / 2 - .55, y + .5 + lift(y), s.d / 2 + .55);
      content.add(tag);
      SFX.tap();
      await wait(620);
      if (tok !== runToken) return;
    }
    if (hidden.size) {
      s.cubes.forEach((c, i) => { if (hidden.has(String(c))) s.set.color[i].set(0xe8483c); });
      s.set.sync();
    }
  }

  async function revealFill(q) {
    const s = buildStack(q);
    const tok = runToken;
    await wait(350);
    if (tok !== runToken) return;
    const base = s.cubes.length;
    s.missing.forEach((_, i) => s.set.color[base + i].set(0x6fd08c));
    let counter = null;
    for (let i = 0; i < s.missing.length; i++) {
      const c = base + i;
      const end = s.set.pos[c].y;
      await tween(Math.max(70, 280 - s.missing.length * 8), (t) => {
        s.set.scale[c] = t;
        s.set.pos[c].y = end + (1 - t) * 1.6;
        s.set.sync();
      });
      if (tok !== runToken) return;
      if (counter) content.remove(counter);
      counter = label(String(i + 1), { h: .9, bg: "#1c7a40" });
      counter.position.set(-s.w / 2 - .4, s.h + .3, s.d / 2 + .4);
      content.add(counter);
      SFX.tap();
    }
  }

  // ---------------------------------------------------------------- views

  function buildLookout(q) {
    const w = q.heights.length, d = q.heights[0].length, h = Math.max(...q.heights.flat());
    clearStage();
    addPlate(w, d);
    const set = new Crates(q.cubes.map((c) => gridPos(c, w, d)));
    content.add(set.group);
    if (q.fromMap) {
      // The map is the plate seen from directly above, with no crates yet.
      set.scale = set.scale.map(() => 0);
      set.sync();
      const tags = [];
      for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) {
        const t = label(String(q.heights[x][z]), { h: .62, bg: q.heights[x][z] ? "#12304a" : "#9fb4bd" });
        t.position.set(x + .5 - w / 2, .3, z + .5 - d / 2);
        content.add(t);
        tags.push(t);
      }
      setCam({ az: 0, el: 89.9, x: 0, y: 0, z: 0, fx: w / 2 + 1.75, fy: d / 2 + 1.35 });
      return { set, tags, w, d, h };
    }
    setCam({ az: ISO_AZ, el: ISO_EL, x: 0, y: h / 2, z: 0, ...isoFit(w, d, h) });
    return { set, tags: [], w, d, h };
  }

  async function revealView(q) {
    const s = buildLookout(q);
    const tok = runToken;
    await wait(250);
    if (tok !== runToken) return;
    if (q.fromMap) {
      // Build the stack up off the map, then swing round to look at it.
      s.tags.forEach((t) => content.remove(t));
      const ends = s.set.pos.map((p) => p.y);
      await Promise.all([
        tween(900, (t) => {
          s.set.scale = s.set.scale.map(() => t);
          s.set.pos.forEach((p, i) => { p.y = ends[i] * t; });
          s.set.sync();
        }, easeOutBack),
        moveCam({ az: ISO_AZ, el: ISO_EL, y: s.h / 2, ...isoFit(s.w, s.d, s.h) }, 900),
      ]);
      if (tok !== runToken) return;
      await wait(350);
      if (tok !== runToken) return;
    }
    (content.userData.signs || []).forEach((sign) => { sign.visible = q.side === "top"; });
    const AZ = { front: 0, right: 90, back: 180, left: -90, top: 0 };
    const span = q.side === "front" || q.side === "back" ? s.w : s.d;
    let az = AZ[q.side];
    if (q.side === "back" && cam.az > 0) az = 180;
    const to = q.side === "top"
      ? { az: 0, el: 89.9, y: s.h / 2, fx: s.w / 2 + 1, fy: s.d / 2 + 1 }
      : { az, el: 0.01, y: s.h / 2, fx: span / 2 + 1, fy: s.h / 2 + .9 };
    await moveCam(to, 1500);
    if (tok !== runToken) return;
    // Darken to a flat shape so it matches the picture in the answers.
    const start = s.set.color.map((c) => c.clone());
    const dark = new THREE.Color(0x173a5a);
    await tween(600, (t) => {
      s.set.color.forEach((c, i) => c.copy(start[i]).lerp(dark, t));
      s.set.sync();
    });
  }

  // ---------------------------------------------------------------- twins

  function centred(cubes) {
    const n = cubes.length;
    const c = [0, 1, 2].map((i) => cubes.reduce((t, p) => t + p[i], 0) / n);
    return cubes.map((p) => [p[0] - c[0], p[1] - c[1], p[2] - c[2]]);
  }
  const reachOf = (cubes) => Math.max(...centred(cubes).flat().map(Math.abs)) + 1;

  function buildTwins(q) {
    clearStage();
    const R = reachOf(q.cubes);
    addBase(R + 1, -R * 1.05);
    const set = new Crates(centred(q.cubes), 0x9c7be8);
    content.add(set.group);
    setCam({ az: ISO_AZ, el: ISO_EL, x: 0, y: -.3, z: 0, fx: R + 1.2, fy: R + 1.4 });
    return { set, R };
  }

  async function revealTurn(q) {
    clearStage();
    const tok = runToken;
    const R = reachOf(q.cubes);
    const gapX = R + .9;
    const screenRight = new THREE.Vector3(1, 0, -1).normalize();
    const left = new Crates(centred(q.cubes), 0x9c7be8);
    left.group.position.copy(screenRight).multiplyScalar(-gapX);
    const right = new Crates(centred(q.cubes), 0x6fd08c);
    right.group.position.copy(screenRight).multiplyScalar(gapX);
    content.add(left.group, right.group);
    setCam({ az: ISO_AZ, el: ISO_EL, x: 0, y: 0, z: 0, fx: gapX + R + .9, fy: R + 1.3 });
    // The twin starts in its answer pose, then turns until it matches the original.
    const m = q.twinTurn;
    const mat = new THREE.Matrix4().set(m[0][0], m[0][1], m[0][2], 0, m[1][0], m[1][1], m[1][2], 0, m[2][0], m[2][1], m[2][2], 0, 0, 0, 0, 1);
    const from = new THREE.Quaternion().setFromRotationMatrix(mat);
    const to = new THREE.Quaternion();
    right.group.quaternion.copy(from);
    await wait(700);
    if (tok !== runToken) return;
    await tween(1800, (t) => { right.group.quaternion.slerpQuaternions(from, to, t); });
  }

  // ---------------------------------------------------------------- nets

  const FACE_HEX = { red: "#e8443a", blue: "#2b7de9", yellow: "#f5c21b", green: "#3fb550", purple: "#8d5be0", orange: "#f5871f" };
  const SYMBOL = {
    red: "M50 8 61 39 92 50 61 61 50 92 39 61 8 50 39 39Z",
    blue: "M50 20a30 30 0 1 0 .01 0Z",
    yellow: "M50 16a34 34 0 1 1-.01 0ZM50 36a14 14 0 1 0 .01 0Z",
    green: "M22 22H78V78H22Z",
    purple: "M38 16H62V38H84V62H62V84H38V62H16V38H38Z",
    orange: "M28 18a10 10 0 1 1-.01 0ZM72 18a10 10 0 1 1-.01 0ZM50 40a10 10 0 1 1-.01 0ZM28 62a10 10 0 1 1-.01 0ZM72 62a10 10 0 1 1-.01 0Z",
  };
  const textures = {};
  function faceTexture(id) {
    if (textures[id]) return textures[id];
    const c = document.createElement("canvas");
    c.width = c.height = 200;
    const g = c.getContext("2d");
    g.fillStyle = FACE_HEX[id];
    g.fillRect(0, 0, 200, 200);
    g.fillStyle = "#fff";
    g.scale(2, 2);
    g.fill(new Path2D(SYMBOL[id]));
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 4;
    return (textures[id] = t);
  }

  // Builds a net of hinged squares. The root square stays at height 1 and the rest fold down around it, printed side out.
  function buildRig(cells, faces) {
    const keyOf = (c) => c.join(",");
    const index = new Map(cells.map((c, i) => [keyOf(c), i]));
    const degree = (c) => [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([a, b]) => index.has(keyOf([c[0] + a, c[1] + b]))).length;
    let rootIdx = 0;
    const mx = cells.reduce((t, c) => t + c[0], 0) / cells.length, mz = cells.reduce((t, c) => t + c[1], 0) / cells.length;
    let best = -Infinity;
    cells.forEach((c, i) => { const v = degree(c) * 2 - Math.hypot(c[0] - mx, c[1] - mz); if (v > best) { best = v; rootIdx = i; } });

    const raw = new THREE.MeshStandardMaterial({ color: 0xe7b676, roughness: .9 });
    const edge = new THREE.MeshStandardMaterial({ color: 0xc08b4d, roughness: .9 });
    const paperGeo = new THREE.BoxGeometry(.975, .035, .975);
    const panels = [];
    const makePanel = (i) => {
      const faceMat = faces ? new THREE.MeshStandardMaterial({ map: faceTexture(faces[i]), roughness: .7 }) : raw.clone();
      const back = faces ? new THREE.MeshStandardMaterial({ color: new THREE.Color(FACE_HEX[faces[i]]).multiplyScalar(.75) }) : raw;
      const mesh = new THREE.Mesh(paperGeo, [edge, edge, faceMat, back, edge, edge]);
      panels[i] = mesh;
      return mesh;
    };
    const rootGroup = new THREE.Group();
    rootGroup.add(makePanel(rootIdx));
    const hinges = [];
    const seen = new Set([rootIdx]);
    const order = [rootIdx];
    const queue = [{ i: rootIdx, group: rootGroup }];
    while (queue.length) {
      const { i, group } = queue.shift();
      const c = cells[i];
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const j = index.get(keyOf([c[0] + dx, c[1] + dz]));
        if (j === undefined || seen.has(j)) continue;
        seen.add(j);
        order.push(j);
        const hinge = new THREE.Group();
        hinge.position.set(dx * .5, 0, dz * .5);
        const inner = new THREE.Group();
        inner.position.set(dx * .5, 0, dz * .5);
        hinge.add(inner);
        inner.add(makePanel(j));
        group.add(hinge);
        // Each child swings its far edge downward.
        hinges.push({ hinge, axis: dx ? "z" : "x", sign: dx ? -dx : dz });
        queue.push({ i: j, group: inner });
      }
    }
    const ordered = order.map((i) => cells[i]);
    const orderedFaces = faces ? order.map((i) => faces[i]) : null;
    const fold = P.foldNet(ordered);
    return { rootGroup, hinges, panels, root: cells[rootIdx], order, normals: fold.normals, orderedFaces, valid: fold.valid };
  }

  function setFold(rig, t) {
    const a = (t * Math.PI) / 2;
    rig.hinges.forEach((h) => { h.hinge.rotation[h.axis] = h.sign * a; });
  }

  function placeNet(cells, faces) {
    const pivot = new THREE.Group();
    pivot.position.set(0, .5, 0);
    const rig = buildRig(cells, faces);
    rig.rootGroup.position.set(0, .5, 0);
    pivot.add(rig.rootGroup);
    content.add(pivot);
    const xs = cells.map((c) => c[0] - rig.root[0]), zs = cells.map((c) => c[1] - rig.root[1]);
    const box = { x0: Math.min(...xs) - .5, x1: Math.max(...xs) + .5, z0: Math.min(...zs) - .5, z1: Math.max(...zs) + .5 };
    return { rig, pivot, box };
  }

  function buildNetScene(q) {
    clearStage();
    addBase(3.6, -.12);
    if (q.sub === "fold") {
      // Nothing to read here. The question is the shape in the answers, and this is the goal.
      const t = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 1.5), new THREE.MeshStandardMaterial({ color: 0xe7b676, roughness: .8 }));
      t.position.y = 1.2;
      t.castShadow = true;
      content.add(t);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(t.geometry), new THREE.LineBasicMaterial({ color: 0x8f5a2b }));
      t.add(edges);
      const q6 = label("6 faces. Which net?", { h: .55 });
      q6.position.set(0, 2.75, 0);
      content.add(q6);
      setCam({ az: ISO_AZ, el: ISO_EL, x: 0, y: 1.2, z: 0, fx: 4.1, fy: 3.2 });
      return { spin: t };
    }
    const n = placeNet(q.cells, q.faces);
    const cx = (n.box.x0 + n.box.x1) / 2, cz = (n.box.z0 + n.box.z1) / 2;
    const fx = (n.box.x1 - n.box.x0) / 2 + .7, fy = (n.box.z1 - n.box.z0) / 2 + .8;
    setCam({ az: 0, el: 89.9, x: cx, y: 1, z: cz, fx: Math.max(fx, 2), fy: Math.max(fy, 2) });
    return n;
  }

  async function foldAnim(n, tok, ms = 1800) {
    n.rig.panels.forEach((m) => { if (m) m.castShadow = true; });
    await Promise.all([
      moveCam({ az: ISO_AZ, el: ISO_EL, x: 0, y: .5, z: 0, fx: 3.1, fy: 2.8 }, ms * .7),
      tween(ms, (t) => setFold(n.rig, t)),
    ]);
    return tok === runToken;
  }

  // Finds the turn that puts the folded cube in a wanted pose.
  function turnFor(normals, faces, want) {
    for (const m of P.ROTATIONS) {
      const at = {};
      normals.forEach((nm, i) => { at[P.applyM(m, nm.split(",").map(Number)).map((v) => v || 0).join(",")] = faces[i]; });
      if (want(at)) return m;
    }
    return null;
  }
  const quatOf = (m) => new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().set(m[0][0], m[0][1], m[0][2], 0, m[1][0], m[1][1], m[1][2], 0, m[2][0], m[2][1], m[2][2], 0, 0, 0, 0, 1));

  async function revealNet(q, chosen) {
    clearStage();
    const tok = runToken;
    addBase(3.6, -.12);
    if (q.sub === "fold") {
      const picked = chosen != null ? q.options[chosen] : null;
      if (picked && !picked.correct) {
        const bad = placeNet(picked.cells, null);
        const b = bad.box;
        setCam({ az: 0, el: 89.9, x: (b.x0 + b.x1) / 2, y: 1, z: (b.z0 + b.z1) / 2, fx: Math.max((b.x1 - b.x0) / 2 + .7, 2), fy: Math.max((b.z1 - b.z0) / 2 + .8, 2) });
        await wait(600);
        if (tok !== runToken) return;
        await foldAnim(bad, tok);
        if (tok !== runToken) return;
        // Mark the squares that crash into each other.
        const count = {};
        bad.rig.normals.forEach((nm) => { count[nm] = (count[nm] || 0) + 1; });
        bad.rig.order.forEach((cellIdx, k) => {
          if (count[bad.rig.normals[k]] > 1) {
            const mesh = bad.rig.panels[cellIdx];
            mesh.material = new THREE.MeshStandardMaterial({ color: 0xe8483c });
          }
        });
        const crash = label("Two faces crash", { bg: "#e8483c", h: .5 });
        crash.position.set(0, 2.4, 0);
        content.add(crash);
        await wait(1500);
        if (tok !== runToken) return;
        clearStage();
        addBase(3.6, -.12);
        // A fresh token is needed because clearStage moved it on.
        return runFold(q.cells, null, q, runToken);
      }
    }
    return runFold(q.cells, q.faces, q, tok);
  }

  async function runFold(cells, faces, q, tok) {
    const n = placeNet(cells, faces);
    const b = n.box;
    setCam({ az: 0, el: 89.9, x: (b.x0 + b.x1) / 2, y: 1, z: (b.z0 + b.z1) / 2, fx: Math.max((b.x1 - b.x0) / 2 + .7, 2), fy: Math.max((b.z1 - b.z0) / 2 + .8, 2) });
    await wait(500);
    if (tok !== runToken) return;
    await foldAnim(n, tok);
    if (tok !== runToken) return;
    const F = n.rig.orderedFaces;
    const N = n.rig.normals;
    if (q.sub === "opposite") {
      const m = turnFor(N, F, (at) => at["0,1,0"] === q.target);
      const q1 = quatOf(m);
      await tween(800, (t) => n.pivot.quaternion.slerpQuaternions(new THREE.Quaternion(), q1, t));
      if (tok !== runToken) return;
      await wait(700);
      if (tok !== runToken) return;
      const flip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, -1).normalize(), Math.PI);
      const q2 = flip.clone().multiply(q1);
      await tween(1300, (t) => n.pivot.quaternion.slerpQuaternions(q1, q2, t));
    } else if (q.sub === "cube") {
      const want = q.options[q.answer].faces;
      const m = turnFor(N, F, (at) => at["0,1,0"] === want[0] && at["1,0,0"] === want[1] && at["0,0,1"] === want[2]);
      const q1 = quatOf(m);
      await tween(1100, (t) => n.pivot.quaternion.slerpQuaternions(new THREE.Quaternion(), q1, t));
    } else {
      const spin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI * .999);
      await tween(1400, (t) => n.pivot.quaternion.slerpQuaternions(new THREE.Quaternion(), spin, t));
    }
  }

  // ---------------------------------------------------------------- paper

  const clipSide = (poly, inside, cross) => {
    const out = [];
    poly.forEach((a, i) => {
      const b = poly[(i + 1) % poly.length];
      const ia = inside(a), ib = inside(b);
      if (ia) out.push(a);
      if (ia !== ib) out.push(cross(a, b));
    });
    return out;
  };

  // Cuts the sheet into flaps. Each flap remembers which folds move it and which layer it sits on.
  function paperFlaps(folds) {
    let flaps = [{ poly: [[0, 0], [4, 0], [4, 4], [0, 4]], moves: [], layers: [0] }];
    const cur = (flap, p, upto) => {
      let q = p;
      for (let i = 0; i < upto; i++) if (flap.moves.includes(i)) q = P.reflect(folds[i], q);
      return q;
    };
    folds.forEach((f, i) => {
      const maxL = Math.max(...flaps.map((fl) => fl.layers[i]));
      const next = [];
      for (const fl of flaps) {
        const dist = (o) => { const c = cur(fl, o, i); return f.a * c[0] + f.b * c[1] - f.c; };
        const cross = (a, b) => { const da = dist(a), db = dist(b), t = da / (da - db); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; };
        const stay = clipSide(fl.poly, (o) => dist(o) >= -1e-9, cross);
        const go = clipSide(fl.poly, (o) => dist(o) <= 1e-9, cross);
        const area = (pts) => Math.abs(pts.reduce((s, p, k) => { const q = pts[(k + 1) % pts.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
        if (area(stay) > 1e-6) next.push({ poly: stay, moves: fl.moves.slice(), layers: [...fl.layers, fl.layers[i]] });
        if (area(go) > 1e-6) next.push({ poly: go, moves: [...fl.moves, i], layers: [...fl.layers, maxL * 2 + 1 - fl.layers[i]] });
      }
      flaps = next;
    });
    return { flaps, cur };
  }

  function paperTexture(holes) {
    const c = document.createElement("canvas");
    c.width = c.height = 512;
    const g = c.getContext("2d");
    g.fillStyle = "#fbfcf7";
    g.fillRect(0, 0, 512, 512);
    g.strokeStyle = "#c6dbe4";
    g.lineWidth = 3;
    for (let i = 1; i < 4; i++) {
      g.beginPath(); g.moveTo(i * 128, 0); g.lineTo(i * 128, 512);
      g.moveTo(0, i * 128); g.lineTo(512, i * 128);
      g.stroke();
    }
    g.strokeStyle = "#8fb3c4"; g.lineWidth = 8; g.strokeRect(0, 0, 512, 512);
    g.fillStyle = "#12304a";
    for (const [x, y] of holes) { g.beginPath(); g.arc(x * 128, y * 128, 34, 0, 7); g.fill(); }
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 4;
    return t;
  }

  function buildPaper(q) {
    clearStage();
    addBase(3.9, -.04);
    const { flaps, cur } = paperFlaps(q.folds);
    const triCount = flaps.reduce((n, f) => n + (f.poly.length - 2), 0);
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(triCount * 9), uv = new Float32Array(triCount * 6);
    let u = 0;
    for (const f of flaps) for (let i = 1; i < f.poly.length - 1; i++) for (const p of [f.poly[0], f.poly[i], f.poly[i + 1]]) {
      uv[u++] = p[0] / 4; uv[u++] = 1 - p[1] / 4;
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    const mat = new THREE.MeshStandardMaterial({ map: paperTexture([]), side: THREE.DoubleSide, roughness: .85 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    content.add(mesh);
    const n = q.folds.length;
    const EPS = .018;
    // k is the fold being animated and t how far along it is. The earlier folds count as done.
    const pose = (k, t) => {
      let w = 0;
      const f = q.folds[Math.min(k, n - 1)];
      const len = Math.hypot(f.a, f.b);
      for (const fl of flaps) for (let i = 1; i < fl.poly.length - 1; i++) for (const p of [fl.poly[0], fl.poly[i], fl.poly[i + 1]]) {
        let [x, y] = cur(fl, p, k);
        let h = 0;
        const stage = Math.min(k, n - 1);
        const l0 = fl.layers[stage], l1 = fl.layers[stage + 1];
        if (fl.moves.includes(stage)) {
          const dist = (f.a * x + f.b * y - f.c) / len;
          const nx = f.a / len, ny = f.b / len;
          const fx = x - dist * nx, fy = y - dist * ny;
          const phi = t * Math.PI;
          x = fx + nx * dist * Math.cos(phi);
          y = fy + ny * dist * Math.cos(phi);
          h = Math.abs(dist) * Math.sin(phi);
        }
        pos[w++] = x - 2;
        pos[w++] = .05 + h + (l0 + (l1 - l0) * t) * EPS;
        pos[w++] = y - 2;
      }
      geo.attributes.position.needsUpdate = true;
      geo.computeVertexNormals();
    };
    pose(0, 0);
    setCam({ az: 0, el: 66, x: 0, y: .2, z: .1, fx: 3.3, fy: 3.1 });
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(.17, .17, 2.8, 16), new THREE.MeshStandardMaterial({ color: 0xff5a4e, roughness: .4 }));
    rod.position.set(q.punch[0] - 2, 6, q.punch[1] - 2);
    rod.castShadow = true;
    rod.visible = false;
    content.add(rod);
    return { pose, mat, rod, n };
  }

  async function playFolds(q, s, tok) {
    for (let k = 0; k < s.n; k++) {
      await wait(280);
      if (tok !== runToken) return false;
      await tween(800, (t) => s.pose(k, t));
      if (tok !== runToken) return false;
    }
    await wait(250);
    if (tok !== runToken) return false;
    s.rod.visible = true;
    await tween(420, (t) => { s.rod.position.y = 4.5 - t * 3; }, (x) => x * x);
    if (tok !== runToken) return false;
    s.mat.map = paperTexture(q.holes);
    s.mat.needsUpdate = true;
    SFX.tap();
    await tween(400, (t) => { s.rod.position.y = 1.5 + t * 4; });
    s.rod.visible = false;
    return tok === runToken;
  }

  function foldedEnd(q, s) {
    s.pose(s.n - 1, 1);
    s.mat.map = paperTexture(q.holes);
    s.mat.needsUpdate = true;
  }

  async function revealUnfold(q) {
    const s = buildPaper(q);
    const tok = runToken;
    foldedEnd(q, s);
    await wait(500);
    if (tok !== runToken) return;
    for (let k = s.n - 1; k >= 0; k--) {
      await tween(1000, (t) => s.pose(k, 1 - t));
      if (tok !== runToken) return;
      SFX.tap();
      await wait(420);
      if (tok !== runToken) return;
    }
    await moveCam({ el: 89.9, y: 0, z: 0 }, 700);
  }

  // Folding a square in half always leaves a convex shape, so its outline is the convex hull.
  function hull(points) {
    const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const half = (list) => {
      const out = [];
      for (const p of list) {
        while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 1e-9) out.pop();
        out.push(p);
      }
      out.pop();
      return out;
    };
    return [...half(pts), ...half(pts.slice().reverse())];
  }

  // Printed-test style film strip of each fold, drawn from the same flaps as the 3D sheet.
  function stripSvg(q) {
    const { flaps, cur } = paperFlaps(q.folds);
    const out = [];
    const drawn = (k, lineFold, withHole) => {
      const parts = [`<rect x="0" y="0" width="4" height="4" fill="none" stroke="#c5e2ef" stroke-width=".06" stroke-dasharray=".2 .14"/>`];
      const ordered = flaps.slice().sort((a, b) => a.layers[k] - b.layers[k]);
      const everyPoint = [];
      for (const fl of ordered) {
        const moving = lineFold != null && fl.moves.includes(lineFold);
        const placed = fl.poly.map((p) => cur(fl, p, k));
        everyPoint.push(...placed);
        const colour = moving ? "#ffd9bd" : "#ffffff";
        parts.push(`<polygon points="${placed.map((v) => v.map((n) => n.toFixed(3)).join(",")).join(" ")}" fill="${colour}" stroke="${colour}" stroke-width=".02"/>`);
      }
      parts.push(`<polygon points="${hull(everyPoint).map((v) => v.map((n) => n.toFixed(3)).join(",")).join(" ")}" fill="none" stroke="#47637a" stroke-width=".07"/>`);
      if (lineFold != null) {
        const f = q.folds[lineFold];
        const a = f.a, b = f.b, c = f.c;
        const p1 = b === 0 ? [c / a, -1] : a === 0 ? [-1, c / b] : [-1, (c + a) / b];
        const p2 = b === 0 ? [c / a, 5] : a === 0 ? [5, c / b] : [5, (c - 5 * a) / b];
        parts.push(`<line x1="${p1[0]}" y1="${p1[1]}" x2="${p2[0]}" y2="${p2[1]}" stroke="#ff5a4e" stroke-width=".09" stroke-dasharray=".28 .18"/>`);
      }
      if (withHole) parts.push(`<circle cx="${q.punch[0]}" cy="${q.punch[1]}" r=".27" fill="#12304a"/>`);
      return `<svg viewBox="-.2 -.2 4.4 4.4" role="img" aria-label="Paper step" style="overflow:hidden">${parts.join("")}</svg>`;
    };
    q.folds.forEach((_, k) => out.push(drawn(k, k, false)));
    out.push(drawn(q.folds.length, null, true));
    return out.join("");
  }

  // ---------------------------------------------------------------- paint

  function buildPaint(q, dimmable) {
    clearStage();
    const [a, b, c] = q.dims;
    addBase(Math.hypot(a, c) / 2 + .8, -.04);
    const paint = new THREE.MeshStandardMaterial({ color: 0xff4f8b, roughness: .35 });
    const raw = new THREE.MeshStandardMaterial({ color: 0xe7c08c, roughness: .9 });
    const paintDim = new THREE.MeshStandardMaterial({ color: 0xff4f8b, roughness: .35, transparent: true, opacity: 1 });
    const rawDim = new THREE.MeshStandardMaterial({ color: 0xe7c08c, roughness: .9, transparent: true, opacity: 1 });
    const geo = new THREE.BoxGeometry(.965, .965, .965);
    const keys = ["x+", "x-", "y+", "y-", "z+", "z-"];
    const pieces = q.pieces.map((p) => {
      const on = p.faces.length === q.k;
      const mats = keys.map((k) => {
        const painted = p.faces.includes(k);
        if (!dimmable || on) return painted ? paint : raw;
        return painted ? paintDim : rawDim;
      });
      const m = new THREE.Mesh(geo, mats);
      m.castShadow = true;
      m.position.set(p.pos[0] + .5 - a / 2, p.pos[1] + .5, p.pos[2] + .5 - c / 2);
      content.add(m);
      return { mesh: m, on, home: m.position.clone() };
    });
    const fit = isoFit(a, c, b);
    setCam({ az: ISO_AZ, el: ISO_EL, x: 0, y: b / 2, z: 0, ...fit });
    return { pieces, paintDim, rawDim, a, b, c };
  }

  async function revealPaint(q) {
    const s = buildPaint(q, true);
    const tok = runToken;
    await wait(350);
    if (tok !== runToken) return;
    const spread = 1.42;
    const mid = new THREE.Vector3(0, s.b / 2, 0);
    const maxD = Math.max(s.a, s.b, s.c);
    await Promise.all([
      moveCam({ ...isoFit(s.a * spread, s.c * spread, s.b * spread), y: s.b / 2 }, 900),
      tween(900, (t) => {
        s.pieces.forEach((p) => { p.mesh.position.copy(p.home).sub(mid).multiplyScalar(1 + (spread - 1) * t).add(mid); });
      }),
    ]);
    if (tok !== runToken) return;
    await tween(800, (t) => {
      s.paintDim.opacity = 1 - t * .9;
      s.rawDim.opacity = 1 - t * .9;
    });
    if (tok !== runToken) return;
    s.paintDim.depthWrite = false;
    s.rawDim.depthWrite = false;
    const chosen = s.pieces.filter((p) => p.on);
    const pause = Math.max(50, 340 - chosen.length * 12);
    for (let i = 0; i < chosen.length; i++) {
      const p = chosen[i];
      const start = p.mesh.position.clone();
      await tween(pause, (t) => { p.mesh.scale.setScalar(1 + Math.sin(t * Math.PI) * .22); });
      if (tok !== runToken) return;
      const n = label(String(i + 1), { h: Math.min(.48, 2.2 / maxD) });
      n.position.copy(start);
      content.add(n);
      SFX.tap();
    }
  }

  // ---------------------------------------------------------------- thumbnails for 3D answers

  let thumbRenderer = null, thumbScene = null, thumbCam = null;
  function thumbSetup() {
    if (thumbRenderer) return;
    thumbRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    thumbRenderer.outputEncoding = THREE.sRGBEncoding;
    thumbRenderer.setSize(280, 280);
    thumbRenderer.setClearColor(0, 0);
    thumbScene = new THREE.Scene();
    addLights(thumbScene, 8, false);
    thumbCam = new THREE.OrthographicCamera(-3, 3, 3, -3, -50, 100);
  }
  function snap(obj, reach) {
    thumbSetup();
    thumbScene.add(obj);
    const az = (ISO_AZ * Math.PI) / 180, e = (ISO_EL * Math.PI) / 180;
    thumbCam.position.set(Math.sin(az) * Math.cos(e) * 30, Math.sin(e) * 30, Math.cos(az) * Math.cos(e) * 30);
    thumbCam.lookAt(0, 0, 0);
    thumbCam.top = thumbCam.right = reach;
    thumbCam.bottom = thumbCam.left = -reach;
    thumbCam.updateProjectionMatrix();
    thumbRenderer.render(thumbScene, thumbCam);
    const url = thumbRenderer.domElement.toDataURL("image/png");
    thumbScene.remove(obj);
    return url;
  }
  function screenReach(cubes) {
    let most = 0;
    for (const [x, y, z] of centred(cubes)) for (const a of [-.5, .5]) for (const b of [-.5, .5]) for (const c of [-.5, .5]) {
      const across = Math.abs(x + a - (z + c)) / Math.SQRT2;
      const up = Math.abs(2 * (y + b) - (x + a) - (z + c)) / Math.sqrt(6);
      most = Math.max(most, across, up);
    }
    return most + .12;
  }
  const shapeThumb = (cubes, reach) => snap(new Crates(centred(cubes), 0x9c7be8).group, reach);
  function cubeThumb(faces) {
    // Box faces run +x, -x, +y, -y, +z, -z. Hidden faces stay plain.
    const m = (id) => new THREE.MeshStandardMaterial({ map: faceTexture(id), roughness: .7 });
    const plain = new THREE.MeshStandardMaterial({ color: 0xcccccc });
    return snap(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), [m(faces[1]), plain, m(faces[0]), plain, m(faces[2]), plain]), 2.05);
  }

  // ---------------------------------------------------------------- flat drawings for answers

  function gridSvg(cells, side) {
    const rows = cells.length, cols = cells[0].length, s = 20;
    const parts = [];
    cells.forEach((row, r) => row.forEach((on, c) => {
      parts.push(`<rect x="${c * s + .8}" y="${r * s + .8}" width="${s - 1.6}" height="${s - 1.6}" rx="2" fill="${on ? "#173a5a" : "#e6f2f8"}"/>`);
    }));
    const h = rows * s, w = cols * s;
    const foot = side === "top"
      ? `<text x="${w / 2}" y="${h + 11}" text-anchor="middle" font-size="10" font-weight="900" fill="#c8362c" font-family="Nunito, sans-serif">FRONT</text>`
      : `<line x1="0" y1="${h + 2.5}" x2="${w}" y2="${h + 2.5}" stroke="#8f5a2b" stroke-width="3"/>`;
    return `<svg viewBox="-2 -2 ${w + 4} ${h + (side === "top" ? 16 : 8)}" role="img" aria-label="Grid picture">${parts.join("")}${foot}</svg>`;
  }

  function netSvg(cells, faces) {
    const s = 20;
    const w = Math.max(...cells.map((c) => c[0])) + 1, h = Math.max(...cells.map((c) => c[1])) + 1;
    const parts = cells.map(([x, z], i) => {
      const fill = faces ? FACE_HEX[faces[i]] : "#e7b676";
      const sym = faces ? `<path transform="translate(${x * s} ${z * s}) scale(.2)" d="${SYMBOL[faces[i]]}" fill="#fff"/>` : "";
      return `<rect x="${x * s}" y="${z * s}" width="${s}" height="${s}" fill="${fill}" stroke="#12304a" stroke-width="1.4"/>${sym}`;
    });
    const dim = Math.max(w, h) * s + 4;
    return `<svg viewBox="${-2 - (Math.max(w, h) - w) * s / 2} ${-2 - (Math.max(w, h) - h) * s / 2} ${dim} ${dim}" role="img" aria-label="Flat net">${parts.join("")}</svg>`;
  }

  function faceSvg(id) {
    return `<svg viewBox="0 0 100 100" aria-hidden="true"><rect width="100" height="100" rx="10" fill="${FACE_HEX[id]}"/><path d="${SYMBOL[id]}" fill="#fff"/></svg>`;
  }

  function paperSvg(holes) {
    const lines = [1, 2, 3].map((i) => `<path d="M${i} 0V4M0 ${i}H4" stroke="#c6dbe4" stroke-width=".04"/>`).join("");
    const dots = holes.map(([x, y]) => `<circle cx="${x}" cy="${y}" r=".27" fill="#12304a"/>`).join("");
    return `<svg viewBox="-.12 -.12 4.24 4.24" role="img" aria-label="Unfolded paper with ${holes.length} holes"><rect width="4" height="4" fill="#fff" stroke="#47637a" stroke-width=".07"/>${lines}${dots}</svg>`;
  }

  function fillOption(btn, o, i, q) {
    const tag = el("span", "tag", LETTERS[i]);
    btn.append(tag);
    if (o.type === "number") btn.append(el("span", "num", String(o.value)));
    else if (o.type === "grid") btn.insertAdjacentHTML("beforeend", gridSvg(o.cells, q.side));
    else if (o.type === "net") btn.insertAdjacentHTML("beforeend", netSvg(o.cells, o.faces));
    else if (o.type === "paper") btn.insertAdjacentHTML("beforeend", paperSvg(o.holes));
    else if (o.type === "face") {
      const f = el("span", "face");
      f.innerHTML = faceSvg(o.face);
      f.append(el("span", null, o.label));
      btn.append(f);
    } else if (o.type === "shape") {
      const img = el("img");
      img.alt = `Shape ${LETTERS[i]}`;
      img.src = shapeThumb(o.cubes, Math.max(...q.options.map((x) => screenReach(x.cubes))));
      btn.append(img);
    } else if (o.type === "cube") {
      const img = el("img");
      img.alt = `Cube ${LETTERS[i]} showing ${o.faces.join(", ")}`;
      img.src = cubeThumb(o.faces);
      btn.append(img);
    }
  }

  // ---------------------------------------------------------------- building a question on stage

  function stageFor(q) {
    if (q.kind === "crates") buildStack(q);
    else if (q.kind === "lookout") buildLookout(q);
    else if (q.kind === "twins") buildTwins(q);
    else if (q.kind === "nets") buildNetScene(q);
    else if (q.kind === "paint") buildPaint(q, false);
    else if (q.kind === "punch") {
      const s = buildPaper(q);
      const tok = runToken;
      playFolds(q, s, tok);
    }
  }

  function runReveal(q, chosen) {
    stopAnimations();
    if (q.reveal === "layers") return revealLayers(q);
    if (q.reveal === "fill") return revealFill(q);
    if (q.reveal === "view") return revealView(q);
    if (q.reveal === "turn") return revealTurn(q);
    if (q.reveal === "fold") return revealNet(q, chosen);
    if (q.reveal === "unfold") return revealUnfold(q);
    if (q.reveal === "paint") return revealPaint(q);
    return Promise.resolve();
  }

  // ---------------------------------------------------------------- screens

  let session = null;
  let screen = "title";
  let peekOn = false;

  function show(name) {
    screen = name;
    $("#app").dataset.screen = name;
    $("#title").hidden = name !== "title";
    $("#hub").hidden = name !== "hub";
    $("#play").hidden = name !== "play";
    $("#tools").hidden = name !== "play";
    $("#tag").hidden = true;
    resize();
    if (name === "hub") { frameHub(); refreshHub(); paintStations(); }
  }

  function modal(html) {
    $("#card").innerHTML = html;
    $("#modal").hidden = false;
    const f = $("#card button");
    if (f) f.focus({ preventScroll: true });
  }
  const closeModal = () => { $("#modal").hidden = true; };

  function weakest() {
    let pick = null, bestScore = Infinity;
    for (const s of STATIONS) {
      const st = state.stats[s.id];
      const score = st ? (st.right / st.total) + (state.stars[s.id] || 0) * .2 : -1;
      if (score < bestScore) { bestScore = score; pick = s; }
    }
    return pick;
  }

  function refreshHub() {
    const box = $("#stations");
    box.innerHTML = "";
    for (const s of STATIONS) {
      const b = el("button", "st");
      b.type = "button";
      b.dataset.id = s.id;
      const img = el("img");
      img.src = A.img["badge_" + s.id];
      img.alt = "";
      const info = el("span");
      info.append(el("b", null, s.name), el("small", null, s.skill));
      const stars = el("span", "stars");
      stars.innerHTML = starsHtml(state.stars[s.id] || 0);
      stars.setAttribute("aria-label", `${state.stars[s.id] || 0} of 3 stars`);
      info.append(stars);
      b.append(img, info);
      b.addEventListener("click", () => goStation(s.id));
      b.addEventListener("mouseenter", () => { hub.hover = s.id; });
      b.addEventListener("mouseleave", () => { hub.hover = null; });
      box.append(b);
    }
    $("#totalStars").textContent = `★ ${totalStars()} of ${STATIONS.length * 3}`;
    $("#soundBtn").textContent = state.muted ? "Sound off" : "Sound on";
    const next = weakest();
    $("#nextUp").textContent = totalStars() ? `Cubit suggests ${next.name} next.` : "Colour comes back to the island as you earn stars.";
  }

  async function goStation(id) {
    if (hub.hop) return;
    SFX.tap();
    state.last = id;
    hub.hop = true;
    const target = perch(id);
    const from = hub.cubit.position.clone();
    await tween(650, (t) => {
      hub.cubit.position.lerpVectors(from, target, t);
      hub.cubit.position.y += Math.sin(t * Math.PI) * 2.4;
    });
    hub.hop = false;
    briefing(id);
  }

  function briefing(id) {
    const s = stationOf(id);
    const lv = levelOf(id);
    modal(`<div class="head"><img src="${A.img["badge_" + id]}" alt=""><div><h2>${s.name}</h2><p class="sub">${s.skill}. You are on ${LEVELS[lv]}.</p></div></div>
      <div class="tip">${s.tip}</div>
      <p class="sub">${SESSION_LENGTH} questions. Two right in a row moves you up a level. Solve without peeking for a full star.</p>
      <div class="row"><button class="btn" id="mBack" type="button">Back</button><button class="btn go" id="mGo" type="button">Start</button></div>`);
    $("#mBack").onclick = closeModal;
    $("#mGo").onclick = () => { closeModal(); startSession(id); };
    $("#mGo").focus({ preventScroll: true });
  }

  function startSession(kind) {
    session = { kind, exam: false, total: SESSION_LENGTH, i: 0, level: levelOf(kind), up: 0, down: 0, results: [], q: null };
    show("play");
    nextQuestion();
  }

  function startExam() {
    const kinds = P.shuffle(Math.random, [...P.KINDS, ...P.shuffle(Math.random, P.KINDS).slice(0, EXAM_LENGTH - P.KINDS.length)]);
    const qs = kinds.map((k) => P.make(k, levelOf(k)));
    session = { exam: true, total: EXAM_LENGTH, i: 0, qs, results: [], q: null, ends: Date.now() + EXAM_SECONDS * 1000, startedAt: Date.now() };
    show("play");
    nextQuestion();
  }

  function renderPips() {
    const box = $("#pips");
    box.innerHTML = "";
    for (let i = 0; i < session.total; i++) {
      const r = session.results[i];
      const c = !r ? (i === session.i ? "now" : "") : session.exam ? "now" : r.right ? (r.clean ? "right" : "half") : "wrong";
      box.append(el("span", c));
    }
  }

  function setHead(q) {
    const where = $("#where");
    where.textContent = "";
    const name = session.exam ? "Exam Flight" : stationOf(q.kind).name;
    where.append(document.createTextNode(name));
    where.append(el("small", null, session.review
      ? "Reviewing your answers"
      : `Question ${session.i + 1} of ${session.total}` + (session.exam ? "" : ` · ${LEVELS[q.level]} level`)));
  }

  function renderQuestion(q) {
    session.q = q;
    session.peeked = false;
    session.locked = false;
    peekOn = false;
    $("#peekNote").hidden = true;
    $("#prompt").textContent = q.prompt;
    $("#feedback").hidden = true;
    const showStrip = q.kind === "punch";
    $("#stripWrap").hidden = !showStrip;
    if (showStrip) {
      $("#strip").innerHTML = stripSvg(q);
      $("#stripText").textContent = q.folds.map((f, i) => `${i + 1}. ${f.text}`).join(" ");
    }
    const box = $("#options");
    box.innerHTML = "";
    q.options.forEach((o, i) => {
      const b = el("button", "opt");
      b.type = "button";
      fillOption(b, o, i, q);
      b.addEventListener("click", () => answer(i));
      box.append(b);
    });
    $("#scroll").scrollTop = 0;
    setHead(q);
    renderPips();
    stageFor(q);
    // On Exam Flight the picture has to do the work, just like paper.
    const canPeek = !session.exam && !session.review && q.reveal !== "fold" && q.reveal !== "unfold" && !q.fromMap;
    $("#peek").hidden = !canPeek;
    $("#peek").textContent = "Peek: spin it";
    $("#peek").disabled = false;
    $("#replay").hidden = q.kind !== "punch";
    $("#replay").textContent = "Watch the folds";
  }

  function nextQuestion() {
    if (!session) return;
    if (session.i >= session.total) return session.exam ? finishExam() : finishSession();
    const q = session.exam ? session.qs[session.i] : P.make(session.kind, session.level);
    renderQuestion(q);
  }

  function answer(i) {
    if (!session || session.locked) return;
    session.locked = true;
    const q = session.q;
    const right = i === q.answer;
    const clean = !session.peeked;
    session.results[session.i] = { q, chosen: i, right, clean };
    recordStat(q.kind, right, clean);
    const opts = [...document.querySelectorAll(".opt")];
    opts.forEach((b) => { b.disabled = true; });
    if (session.exam) {
      save();
      opts[i].classList.add("chosen");
      SFX.tap();
      session.i++;
      setTimeout(nextQuestion, 260);
      return;
    }
    opts[q.answer].classList.add("right");
    if (!right) opts[i].classList.add("wrong");
    right ? SFX.right() : SFX.wrong();
    session.level = adjustLevel(q, right);
    state.level[session.kind] = session.level;
    save();
    $("#peek").hidden = true;
    $("#replay").hidden = true;
    $("#peekNote").hidden = true;
    peekOn = false;
    feedback(q, i, right, clean);
    runReveal(q, i);
  }

  function adjustLevel(q, right) {
    let lv = session.level;
    if (right) { session.up++; session.down = 0; } else { session.down++; session.up = 0; }
    if (session.up >= 2 && lv < 3) { lv++; session.up = 0; session.levelled = true; }
    if (session.down >= 2 && lv > 1) { lv--; session.down = 0; }
    return lv;
  }

  function feedback(q, chosen, right, clean) {
    const say = $("#say");
    say.className = right ? "good" : "bad";
    $("#sayImg").src = A.img[right ? "cubit_happy" : "cubit_oops"];
    const box = $("#sayText");
    box.innerHTML = "";
    const head = right ? (clean ? "Yes, that's it!" : "Right, with a peek.") : `Not this time. It's ${LETTERS[q.answer]}.`;
    box.append(el("h3", null, head));
    const picked = q.options[chosen];
    if (!right && picked && picked.isMirror) box.append(el("p", null, "You picked the mirror twin. So close, and that is the trap this question sets."));
    q.explain.forEach((line) => box.append(el("p", null, line)));
    $("#feedback").hidden = false;
    const last = session.review ? session.reviewIndex >= session.reviewList.length - 1 : session.i + 1 >= session.total;
    $("#next").textContent = session.review ? (last ? "Back to results" : "Next one") : last ? "See my stars" : "Next";
    $("#next").focus({ preventScroll: true });
    requestAnimationFrame(() => { $("#feedback").scrollIntoView({ block: "nearest", behavior: REDUCED ? "auto" : "smooth" }); });
  }

  function finishSession() {
    stopAnimations();
    const r = session.results;
    const points = r.reduce((n, x) => n + (x.right ? (x.clean ? 1 : .5) : 0), 0);
    const got = points >= 5.5 ? 3 : points >= 4 ? 2 : points >= 2 ? 1 : 0;
    const kind = session.kind;
    const before = state.stars[kind] || 0;
    state.stars[kind] = Math.max(before, got);
    save();
    if (got) SFX.win();
    const rightCount = r.filter((x) => x.right).length;
    const lv = levelOf(kind);
    const msg = got === 3 ? "Perfect thinking. Try again to meet harder puzzles."
      : got === 2 ? "Really solid. One more go could make it three stars."
      : got === 1 ? "You've got the idea. The animations show the trick, so watch them closely."
      : "This one is tough. Read Cubit's tip again and give it another try.";
    show("hub");
    modal(`<div class="head"><img src="${A.img[got ? "cubit_happy" : "cubit_think"]}" alt=""><div><h2>${stationOf(kind).name}</h2><div class="bigstars" aria-label="${got} stars">${starsHtml(got)}</div></div></div>
      <p>${rightCount} out of ${r.length} right. ${msg}</p>
      <p class="sub">You are on ${LEVELS[lv]} level here${before > got ? `, and your best is still ${before} stars` : ""}.</p>
      <div class="row"><button class="btn" id="mMap" type="button">Back to the island</button><button class="btn go" id="mAgain" type="button">Play again</button></div>`);
    $("#mMap").onclick = closeModal;
    $("#mAgain").onclick = () => { closeModal(); startSession(kind); };
    session = null;
  }

  function finishExam() {
    stopAnimations();
    const r = session.results;
    const right = r.filter((x) => x && x.right).length;
    const used = Math.min(EXAM_SECONDS, Math.round((Date.now() - session.startedAt) / 1000));
    // Questions left when the clock ran out count as wrong, so the score matches the real thing.
    for (let i = r.filter(Boolean).length; i < session.total; i++) {
      if (!r[i]) { r[i] = { q: session.qs[i], chosen: null, right: false, clean: false }; recordStat(session.qs[i].kind, false, false); }
    }
    state.exams = [...state.exams, { right, of: session.total, seconds: used, at: Date.now() }].slice(-20);
    save();
    if (right >= 7) SFX.win();
    session.finished = { right, used };
    showExamResults();
  }

  const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  function showExamResults() {
    const s = session;
    const { right, used } = s.finished;
    const wrong = s.results.filter((x) => !x.right);
    const stars = right >= 9 ? 3 : right >= 7 ? 2 : right >= 5 ? 1 : 0;
    const best = Math.max(...state.exams.map((e) => e.right));
    show("hub");
    modal(`<div class="head"><img src="${A.img[stars ? "cubit_happy" : "cubit_think"]}" alt=""><div><h2>${right} out of ${s.total}</h2><div class="bigstars">${starsHtml(stars)}</div></div></div>
      <p>Finished in ${fmtTime(used)}. That's about ${Math.round(used / s.total)} second${Math.round(used / s.total) === 1 ? "" : "s"} a question, and the real test allows roughly a minute each. Your best flight is ${best} of ${s.total}.</p>
      ${wrong.length ? `<p class="sub">Watch how the ones you missed work:</p><div class="review" id="rev"></div>` : `<p>Every answer right. Nothing to review!</p>`}
      <div class="row"><button class="btn" id="mMap" type="button">Back to the island</button>${wrong.length ? `<button class="btn go" id="mRev" type="button">Review all ${wrong.length}</button>` : ""}</div>`);
    const list = $("#rev");
    if (list) {
      wrong.forEach((w, i) => {
        const b = el("button", null, `${stationOf(w.q.kind).name}: ${w.chosen == null ? "ran out of time" : "tap to see why"}`);
        b.type = "button";
        b.onclick = () => startReview(wrong, i);
        list.append(b);
      });
      $("#mRev").onclick = () => startReview(wrong, 0);
    }
    $("#mMap").onclick = () => { closeModal(); session = null; };
  }

  function startReview(list, index) {
    closeModal();
    session.review = true;
    session.reviewList = list;
    session.reviewIndex = index;
    show("play");
    showReview();
  }

  function showReview() {
    const w = session.reviewList[session.reviewIndex];
    renderQuestion(w.q);
    session.locked = true;
    $("#peek").hidden = true;
    $("#replay").hidden = true;
    const opts = [...document.querySelectorAll(".opt")];
    opts.forEach((b) => { b.disabled = true; });
    opts[w.q.answer].classList.add("right");
    if (w.chosen != null) opts[w.chosen].classList.add("wrong");
    feedback(w.q, w.chosen, false, false);
    runReveal(w.q, w.chosen);
    $("#clock").hidden = true;
  }

  // ---------------------------------------------------------------- input

  function resize() {
    if (!renderer) return;
    const wrap = $("#stage");
    const W = wrap.clientWidth, H = wrap.clientHeight;
    if (!W || !H) return;
    renderer.setSize(W, H, false);
    applyCam();
    if (screen === "hub") frameHub();
  }
  if (window.ResizeObserver) new ResizeObserver(resize).observe($("#stage"));
  addEventListener("resize", resize);

  let drag = null;
  canvas.addEventListener("pointerdown", (ev) => {
    drag = { x: ev.clientX, y: ev.clientY, moved: 0 };
    if (peekOn) canvas.setPointerCapture(ev.pointerId);
  });
  canvas.addEventListener("pointermove", (ev) => {
    if (screen === "hub" && models.island && ev.pointerType === "mouse") setHover(pickStation(ev), ev);
    if (!drag) return;
    const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    drag.x = ev.clientX; drag.y = ev.clientY;
    if (peekOn) setCam({ az: cam.az - dx * .6, el: Math.min(89.9, Math.max(4, cam.el + dy * .45)) });
  });
  addEventListener("pointerup", (ev) => {
    if (drag && drag.moved < 8 && screen === "hub" && ev.target === canvas && models.island && $("#modal").hidden) {
      const id = pickStation(ev);
      if (id) goStation(id);
    }
    drag = null;
  });
  addEventListener("keydown", (ev) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (screen !== "play" || !session || !session.q) return;
    const k = ev.key.toLowerCase();
    const i = "abcd".indexOf(k) >= 0 && k.length === 1 ? "abcd".indexOf(k) : "1234".indexOf(k);
    if (i >= 0 && k.length === 1 && !session.locked) { ev.preventDefault(); answer(i); }
  });

  $("#playBtn").onclick = () => { SFX.tap(); startGame(); };
  $("#examBtn").onclick = () => {
    SFX.tap();
    modal(`<div class="head"><img src="${A.img.cubit_think}" alt=""><div><h2>Exam Flight</h2><p class="sub">Practice for the real test.</p></div></div>
      <div class="tip">10 mixed questions in 10 minutes. No peeking and no answers until the end, just like the real test. If one is taking too long, make your best guess and keep moving.</div>
      <div class="row"><button class="btn" id="mBack" type="button">Not yet</button><button class="btn go" id="mGo" type="button">Take off</button></div>`);
    $("#mBack").onclick = closeModal;
    $("#mGo").onclick = () => { closeModal(); startExam(); };
  };
  $("#skillsBtn").onclick = () => {
    SFX.tap();
    const rows = STATIONS.map((s) => {
      const st = state.stats[s.id];
      const pct = st && st.total ? Math.round((st.right / st.total) * 100) : 0;
      return `<div class="skill"><span>${s.name}</span><span class="bar"><i style="width:${pct}%"></i></span><span class="val">${st ? pct + "%" : "new"}</span></div>`;
    }).join("");
    const answered = STATIONS.reduce((n, s) => n + ((state.stats[s.id] || {}).total || 0), 0);
    const recent = state.exams.slice(-5).map((e) => `${e.right}/${e.of}`).join(", ");
    modal(`<h2>Skills so far</h2>
      <div class="skills">${rows}</div>
      <p class="sub">${answered} questions answered.${recent ? ` Last Exam Flights: ${recent}.` : " No Exam Flights yet."}</p>
      ${answered ? `<div class="tip">Practise next: ${weakest().name}. ${weakest().skill}.</div>` : ""}
      <div class="row"><button class="btn go" id="mBack" type="button">Close</button></div>`);
    $("#mBack").onclick = closeModal;
  };
  $("#soundBtn").onclick = () => { state.muted = !state.muted; save(); refreshHub(); SFX.tap(); };
  $("#leave").onclick = () => {
    stopAnimations();
    const fromExam = session && session.exam;
    if (session && session.review) { showExamResults(); $("#clock").hidden = true; return; }
    session = null;
    $("#clock").hidden = true;
    show("hub");
    if (fromExam) save();
  };
  $("#peek").onclick = () => {
    if (!session || session.locked) return;
    session.peeked = true;
    peekOn = true;
    $("#peek").disabled = true;
    $("#peek").textContent = "Peeking";
    $("#peekNote").hidden = false;
  };
  $("#replay").onclick = () => {
    if (!session || !session.q) return;
    const q = session.q;
    stageFor(q);
  };
  $("#again").onclick = () => {
    if (!session || !session.q) return;
    const r = session.review ? session.reviewList[session.reviewIndex] : session.results[session.i];
    runReveal(session.q, r ? r.chosen : null);
  };
  $("#next").onclick = () => {
    if (!session) return;
    SFX.tap();
    if (session.review) {
      session.reviewIndex++;
      if (session.reviewIndex >= session.reviewList.length) {
        stopAnimations();
        session.review = false;
        showExamResults();
        return;
      }
      showReview();
      return;
    }
    session.i++;
    nextQuestion();
  };

  // ---------------------------------------------------------------- loop

  let last = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (!renderer) return;
    stepTweens(now);
    const t = now / 1000;
    if (screen === "hub" && hub.cubit) {
      hub.sea.material.uniforms.t.value = t;
      // Cubit breathes, waves and blinks.
      const p = hub.parts;
      if (p.body) p.body.position.y = .52 + Math.sin(t * 2.6) * .025;
      if (p.arm_R) p.arm_R.rotation.z = .16 + Math.sin(t * 2.2) * .18;
      if (p.arm_L) p.arm_L.rotation.z = -.16 - Math.sin(t * 2.2 + 1) * .1;
      if (p.antenna) p.antenna.rotation.z = Math.sin(t * 3.1) * .2;
      if (p.eyes) p.eyes.scale.z = (t % 3.4) > 3.27 ? .1 : 1;
      hub.cubit.rotation.y = Math.sin(t * .5) * .35;
      for (const s of STATIONS) {
        const h = hub.stations[s.id];
        if (!h) continue;
        const target = hub.hover === s.id ? 1.08 : 1;
        h.node.scale.lerp(new THREE.Vector3(target, target, target), .18);
        hub.starSprites[s.id].position.y = h.top + .8 + Math.sin(t * 1.7 + h.base.x) * .08;
      }
      hubCam.position.x = Math.sin(t * .12) * .9;
      hubCam.lookAt(0, 1.3, 0);
      renderer.render(hubScene, hubCam);
    } else if (screen === "play") {
      renderer.render(stageScene, stageCam);
      if (session && session.exam && !session.review && !session.finished) {
        const c = $("#clock");
        const left = Math.max(0, (session.ends - Date.now()) / 1000);
        c.hidden = false;
        c.textContent = fmtTime(Math.ceil(left));
        c.classList.toggle("low", left < 60);
        if (left <= 0) {
          session.locked = true;
          finishExam();
        }
      } else {
        $("#clock").hidden = true;
      }
    }
    last = now;
  }

  // ---------------------------------------------------------------- start up

  let ready = false;
  let wantsGame = false;

  async function loadModels() {
    if (!renderer) return;
    try {
      const [island, cubit, crate] = await Promise.all([parseGlb(A.glb.island), parseGlb(A.glb.cubit), parseGlb(A.glb.crate)]);
      models.island = island;
      models.cubit = cubit;
      const findGeo = (name) => { let g = null; crate.scene.traverse((o) => { if (o.isMesh && o.name.startsWith(name)) g = o.geometry; }); return g; };
      models.frameGeo = findGeo("frame");
      models.panelGeo = findGeo("panel");
      addLights(stageScene, 12);
      buildHub();
      ready = true;
      if (wantsGame) startGame();
    } catch (e) {
      const n = $("#titleNote");
      n.hidden = false;
      n.textContent = "The island could not load. Reload the page to try again.";
      console.error(e);
    }
  }

  function startGame() {
    if (!ready) { wantsGame = true; $("#playBtn").textContent = "Loading the island"; return; }
    show("hub");
  }

  refreshHub();
  resize();
  loadModels();
  connectSavedProgress();
  requestAnimationFrame(frame);

  // Lets the automated check drive the real game.
  window.CubitIsland = {
    get state() { return state; },
    get session() { return session; },
    startSession, startExam, answer, startGame, show, goStation, renderQuestion,
    make: P.make, get cam() { return cam; }, get ready() { return ready; },
    get tweens() { return tweens.length; }, runReveal, setSession(s) { session = s; },
  };
})();
