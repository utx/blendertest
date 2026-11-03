// Puzzle generators for Cubit Island. No rendering in here, so tests can run the same code the game runs.
// Voxel axes: x runs to the viewer's right-front, y is up, z runs to the viewer's left-front.
// The exam camera sits on the (+,+,+) diagonal. FRONT is the +z side, RIGHT is the +x side.
(function (root) {
  "use strict";

  const seeded = (seed) => () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const randInt = (r, a, b) => a + Math.floor(r() * (b - a + 1));
  const pick = (r, list) => list[Math.floor(r() * list.length)];
  const shuffle = (r, list) => {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };
  const sum = (list) => list.reduce((a, b) => a + b, 0);

  // Shuffles the correct option in with three wrong ones.
  function withAnswer(r, correct, wrong) {
    const options = shuffle(r, [{ ...correct, correct: true }, ...wrong.slice(0, 3)]);
    return { options, answer: options.findIndex((o) => o.correct) };
  }

  // Numeric answers read lowest to highest, like a printed test.
  function numericOptions(r, answer, candidates) {
    const seen = new Set([answer]);
    const wrong = [];
    for (const c of candidates) {
      if (Number.isInteger(c) && c >= 0 && !seen.has(c) && wrong.length < 3) { seen.add(c); wrong.push(c); }
    }
    for (let d = 1; wrong.length < 3; d++) {
      for (const c of shuffle(r, [answer + d, answer - d])) {
        if (c >= 0 && !seen.has(c) && wrong.length < 3) { seen.add(c); wrong.push(c); }
      }
    }
    const values = [answer, ...wrong].sort((a, b) => a - b);
    return { options: values.map((v) => ({ type: "number", value: v, correct: v === answer })), answer: values.indexOf(answer) };
  }

  // ---------------------------------------------------------------- stacks

  const cubesFromHeights = (h) => {
    const cubes = [];
    h.forEach((col, x) => col.forEach((n, z) => { for (let y = 0; y < n; y++) cubes.push([x, y, z]); }));
    return cubes;
  };

  // Marches along the (1,1,1) view ray. True when nothing solid blocks the point.
  function rayClear(solid, px, py, pz) {
    for (let t = 0.04; t < 14; t += 0.04) {
      if (solid(Math.floor(px + t), Math.floor(py + t), Math.floor(pz + t))) return false;
    }
    return true;
  }

  // Every cell's top must show, otherwise the printed picture would not pin down one answer.
  function allTopsVisible(h) {
    const solid = (x, y, z) => x >= 0 && z >= 0 && x < h.length && z < h[0].length && y >= 0 && y < h[x][z];
    const samples = [[.5, .5], [.25, .25], [.75, .25], [.25, .75], [.75, .75]];
    for (let x = 0; x < h.length; x++) for (let z = 0; z < h[0].length; z++) {
      const clear = samples.filter(([a, b]) => rayClear(solid, x + a, h[x][z], z + b)).length;
      if (clear < 3) return false;
    }
    return true;
  }

  function heightsConnected(h) {
    const cells = [];
    h.forEach((col, x) => col.forEach((n, z) => { if (n > 0) cells.push(x + "," + z); }));
    if (!cells.length) return false;
    const seen = new Set([cells[0]]);
    const stack = [cells[0]];
    while (stack.length) {
      const [x, z] = stack.pop().split(",").map(Number);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = x + dx + "," + (z + dz);
        if (cells.includes(k) && !seen.has(k)) { seen.add(k); stack.push(k); }
      }
    }
    return seen.size === cells.length;
  }

  function genHeights(r, w, d, maxH, accept) {
    for (let tries = 0; tries < 5000; tries++) {
      const h = [];
      for (let x = 0; x < w; x++) {
        h.push([]);
        for (let z = 0; z < d; z++) h[x].push(r() < 0.14 ? 0 : randInt(r, 1, maxH));
      }
      if (!heightsConnected(h) || !allTopsVisible(h)) continue;
      if (accept && !accept(h)) continue;
      return h;
    }
    throw new Error("no stack found");
  }

  // Crates a quick glance would see. Children often count these and stop.
  function visibleCount(h) {
    const has = (x, y, z) => x >= 0 && z >= 0 && x < h.length && z < h[0].length && y >= 0 && y < h[x][z];
    return cubesFromHeights(h).filter(([x, y, z]) => !has(x, y + 1, z) || !has(x + 1, y, z) || !has(x, y, z + 1)).length;
  }

  // Crates the exam camera cannot see at all, used to light them up in the reveal.
  function hiddenCubes(h) {
    const has = (x, y, z) => x >= 0 && z >= 0 && x < h.length && z < h[0].length && y >= 0 && y < h[x][z];
    return cubesFromHeights(h).filter(([x, y, z]) => has(x, y + 1, z) && has(x + 1, y, z) && has(x, y, z + 1));
  }

  function layerCounts(cubes) {
    const top = Math.max(...cubes.map((c) => c[1]));
    const counts = [];
    for (let y = top; y >= 0; y--) counts.push(cubes.filter((c) => c[1] === y).length);
    return counts;
  }

  function layerStory(counts) {
    const names = counts.map((_, i) => i === 0 ? "Top layer" : i === counts.length - 1 ? "Bottom layer" : "Next layer");
    return counts.map((c, i) => `${names[i]}: ${c}`).join(". ") + ".";
  }

  function makeCrates(r, level) {
    if (level === 3 && r() < 0.6) return makeFill(r);
    const [w, d, maxH] = level === 1 ? pick(r, [[2, 2, 2], [3, 2, 2], [2, 3, 2]]) : level === 2 ? [3, 3, 3] : [4, 3, 4];
    const h = genHeights(r, w, d, maxH, (m) => {
      const n = cubesFromHeights(m).length;
      return n >= (level === 1 ? 5 : 11) && visibleCount(m) < n && Math.max(...m.flat()) >= 2;
    });
    const cubes = cubesFromHeights(h);
    const n = cubes.length;
    const vis = visibleCount(h);
    const counts = layerCounts(cubes);
    return {
      kind: "crates", level, heights: h, cubes,
      prompt: "How many crates are in this stack? Every crate sits on the ground or on another crate.",
      ...numericOptions(r, n, [vis, n + 1, n - 1, n + 2, n - 2]),
      explain: [
        `Count one layer at a time, starting from the top. ${layerStory(counts)}`,
        counts.length > 1 ? `${counts.join(" + ")} = ${n} crates.` : `That makes ${n} crates.`,
        vis < n ? `You can only see ${vis} of them. The other ${n - vis} are holding the top crates up.` : "Every crate is showing in this one.",
      ],
      reveal: "layers",
    };
  }

  function makeFill(r) {
    const [a, b, c] = pick(r, [[3, 3, 3], [4, 3, 3], [3, 3, 4], [4, 3, 2], [4, 2, 3]]);
    const h = genHeights(r, a, b, c, (m) => {
      const n = cubesFromHeights(m).length;
      return n >= a * b * c * 0.35 && n <= a * b * c * 0.8;
    });
    const cubes = cubesFromHeights(h);
    const n = cubes.length;
    const full = a * b * c;
    const ans = full - n;
    return {
      kind: "crates", level: 3, heights: h, cubes, box: [a, c, b],
      prompt: `This box is ${a} crates long, ${b} wide and ${c} high. How many more crates are needed to fill it completely?`,
      ...numericOptions(r, ans, [n, full, ans + 1, ans - 1, ans + a, ans - b]),
      explain: [
        `A full box holds ${a} × ${b} × ${c} = ${full} crates.`,
        `There are already ${n} in it (${layerCounts(cubes).join(" + ")}).`,
        `${full} − ${n} = ${ans} more crates.`,
      ],
      reveal: "fill",
    };
  }

  // ---------------------------------------------------------------- views

  // A view is a grid of booleans. Row 0 is the top of the picture.
  function viewFromColumns(cols, rows) {
    const cells = [];
    for (let row = 0; row < rows; row++) cells.push(cols.map((n) => n >= rows - row));
    return cells;
  }
  const maxOf = (list) => Math.max(0, ...list);

  function sideColumns(h, side) {
    const w = h.length, d = h[0].length;
    if (side === "front") return h.map((col) => maxOf(col));
    if (side === "back") return h.map((col) => maxOf(col)).reverse();
    const byZ = [];
    for (let z = 0; z < d; z++) { let m = 0; for (let x = 0; x < w; x++) m = Math.max(m, h[x][z]); byZ.push(m); }
    return side === "left" ? byZ : byZ.reverse(); // Looking from +x the viewer's right is -z.
  }

  function viewOf(h, side) {
    if (side === "top") {
      const cells = [];
      for (let z = 0; z < h[0].length; z++) cells.push(h.map((col) => col[z] > 0));
      return cells;
    }
    const cols = sideColumns(h, side);
    return viewFromColumns(cols, Math.max(...h.flat()));
  }

  const viewKey = (v) => v.map((row) => row.map((c) => (c ? 1 : 0)).join("")).join("/");
  const flipH = (v) => v.map((row) => row.slice().reverse());
  const flipV = (v) => v.slice().reverse();

  // Changes one column of a side view, or one cell of a top view.
  function nudged(r, v, side) {
    const out = v.map((row) => row.slice());
    if (side === "top") {
      const row = randInt(r, 0, out.length - 1), col = randInt(r, 0, out[0].length - 1);
      out[row][col] = !out[row][col];
      return out;
    }
    const rows = out.length, col = randInt(r, 0, out[0].length - 1);
    const height = out.filter((row) => row[col]).length;
    const next = height > 1 && (height === rows || r() < 0.5) ? height - 1 : Math.min(rows, height + 1);
    for (let i = 0; i < rows; i++) out[i][col] = next >= rows - i;
    return out;
  }

  function makeLookout(r, level) {
    const fromMap = level === 3 && r() < 0.65;
    const side = level === 1 ? pick(r, ["front", "top"])
      : fromMap ? pick(r, ["front", "right"])
      : level === 2 ? pick(r, ["front", "right", "top"])
      : pick(r, ["right", "back", "left", "top"]);
    const [w, d, maxH] = level === 1 ? [3, 2, 2] : level === 2 ? [3, 3, 3] : [4, 3, 3];
    const h = genHeights(r, w, d, maxH, (m) => {
      const v = viewOf(m, side);
      if (viewKey(v) === viewKey(flipH(v))) return false; // A symmetric view would make the mirror option a duplicate.
      if (side === "top" && !m.flat().includes(0)) return false;
      return true;
    });
    const correct = viewOf(h, side);
    const key = viewKey(correct);
    const seen = new Set([key]);
    const wrong = [];
    const add = (v) => { if (v && !seen.has(viewKey(v)) && wrong.length < 3) { seen.add(viewKey(v)); wrong.push(v); } };
    add(flipH(correct));
    if (side === "top") add(flipV(correct));
    else ["front", "right", "back", "left"].filter((s) => s !== side).forEach((s) => add(r() < 0.8 ? viewOf(h, s) : null));
    for (let i = 0; wrong.length < 3 && i < 400; i++) add(nudged(r, correct, side));
    const word = { front: "the front", right: "the right side", back: "the back", left: "the left side", top: "straight above" }[side];
    const picks = withAnswer(r, { type: "grid", cells: correct }, wrong.map((cells) => ({ type: "grid", cells })));
    const cols = side === "top" ? null : sideColumns(h, side);
    return {
      kind: "lookout", level, heights: h, cubes: cubesFromHeights(h), side, fromMap,
      prompt: fromMap
        ? `This map shows how many crates are in each spot, with the front at the bottom. What does the stack look like from ${word}?`
        : side === "back" || side === "left"
          ? `Walk around the stack. What does it look like from ${word}? (${side === "back" ? "The back is opposite the FRONT sign." : "The left is opposite the RIGHT sign."})`
          : `What does this stack look like from ${word}?`,
      ...picks,
      explain: side === "top"
        ? ["From above you only see which spots have crates. Height does not show at all.", "Keep the FRONT side at the bottom of your picture, then mark each spot that has a crate."]
        : [
          `In each column of the view, the tallest pile along that line is what you see. Tall piles hide short ones behind them.`,
          `From ${word}, the columns are ${cols.join(", ")} crates high, reading left to right.`,
          side === "back" || side === "left" ? "Your left and right swap when you walk around to the other side, so the picture flips." : "Picture yourself standing at that sign, looking straight at the stack.",
        ],
      reveal: "view",
    };
  }

  // ---------------------------------------------------------------- twins

  const normalize = (cubes) => {
    const m = [0, 1, 2].map((i) => Math.min(...cubes.map((c) => c[i])));
    return cubes.map((c) => [c[0] - m[0], c[1] - m[1], c[2] - m[2]]).sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  };
  const shapeKey = (cubes) => normalize(cubes).map((c) => c.join(",")).join(";");
  const applyM = (m, c) => [0, 1, 2].map((i) => m[i][0] * c[0] + m[i][1] * c[1] + m[i][2] * c[2]);
  const mulM = (a, b) => a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]));

  // All 24 rotations of a cube, grown from two quarter turns.
  const ROTATIONS = (() => {
    const rx = [[1, 0, 0], [0, 0, -1], [0, 1, 0]];
    const ry = [[0, 0, 1], [0, 1, 0], [-1, 0, 0]];
    const id = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const found = new Map([[JSON.stringify(id), id]]);
    const queue = [id];
    while (queue.length) {
      const m = queue.pop();
      for (const g of [rx, ry]) {
        const n = mulM(g, m);
        const k = JSON.stringify(n);
        if (!found.has(k)) { found.set(k, n); queue.push(n); }
      }
    }
    return [...found.values()];
  })();

  const canonical = (cubes) => ROTATIONS.map((m) => shapeKey(cubes.map((c) => applyM(m, c)))).sort()[0];
  const mirrored = (cubes) => cubes.map(([x, y, z]) => [-x, y, z]);

  function growShape(r, n) {
    const cubes = [[0, 0, 0]];
    const has = (p) => cubes.some((c) => c[0] === p[0] && c[1] === p[1] && c[2] === p[2]);
    const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    while (cubes.length < n) {
      const from = r() < 0.72 ? cubes[cubes.length - 1] : pick(r, cubes);
      const d = pick(r, dirs);
      const p = [from[0] + d[0], from[1] + d[1], from[2] + d[2]];
      if (!has(p)) cubes.push(p);
    }
    return cubes;
  }

  function isConnected(cubes) {
    const keys = new Set(cubes.map((c) => c.join(",")));
    const seen = new Set([cubes[0].join(",")]);
    const stack = [cubes[0]];
    while (stack.length) {
      const [x, y, z] = stack.pop();
      for (const [a, b, c] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const k = [x + a, y + b, z + c].join(",");
        if (keys.has(k) && !seen.has(k)) { seen.add(k); stack.push(k.split(",").map(Number)); }
      }
    }
    return seen.size === cubes.length;
  }

  // True when every cube shows at least one face to the exam camera.
  function allCubesShow(cubes) {
    const keys = new Set(cubes.map((c) => c.join(",")));
    const solid = (x, y, z) => keys.has([x, y, z].join(","));
    return cubes.every(([x, y, z]) =>
      rayClear(solid, x + .5, y + 1.001, z + .5) || rayClear(solid, x + 1.001, y + .5, z + .5) || rayClear(solid, x + .5, y + .5, z + 1.001));
  }

  // Finds a turned copy where nothing is hidden. Never the same picture as the reference.
  function presentable(r, cubes, avoidKey) {
    for (const m of shuffle(r, ROTATIONS)) {
      const turned = normalize(cubes.map((c) => applyM(m, c)));
      if (shapeKey(turned) !== avoidKey && allCubesShow(turned)) return { cubes: turned, m };
    }
    return null;
  }

  function moveOneCube(r, cubes) {
    for (let tries = 0; tries < 300; tries++) {
      const i = randInt(r, 0, cubes.length - 1);
      const rest = cubes.filter((_, k) => k !== i);
      const base = pick(r, rest);
      const d = pick(r, [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]);
      const p = [base[0] + d[0], base[1] + d[1], base[2] + d[2]];
      if (rest.some((c) => c.join() === p.join())) continue;
      const out = [...rest, p];
      if (isConnected(out)) return out;
    }
    return null;
  }

  function makeTwins(r, level) {
    const n = level === 1 ? randInt(r, 4, 5) : level === 2 ? randInt(r, 5, 6) : randInt(r, 6, 7);
    const mirrorCount = level === 1 ? 0 : level === 2 ? 1 : 2;
    for (let tries = 0; tries < 4000; tries++) {
      const raw = normalize(growShape(r, n));
      const can = canonical(raw);
      const mirrorRaw = mirrored(raw);
      const mirrorCan = canonical(mirrorRaw);
      if (can === mirrorCan) continue; // Its mirror must be a genuinely different shape.
      const ref = presentable(r, raw, null);
      if (!ref) continue;
      const refKey = shapeKey(ref.cubes);
      const twin = presentable(r, ref.cubes, refKey);
      if (!twin) continue;
      const wrong = [];
      const seen = new Set([shapeKey(twin.cubes), refKey]);
      for (let i = 0; i < 40 && wrong.filter((w) => w.isMirror).length < mirrorCount; i++) {
        const p = presentable(r, mirrorRaw, null);
        if (p && !seen.has(shapeKey(p.cubes))) { seen.add(shapeKey(p.cubes)); wrong.push({ type: "shape", cubes: p.cubes, isMirror: true }); }
      }
      if (wrong.length < mirrorCount) continue;
      for (let i = 0; i < 300 && wrong.length < 3; i++) {
        const moved = moveOneCube(r, raw);
        if (!moved) continue;
        const c = canonical(moved);
        if (c === can || c === mirrorCan) continue;
        const p = presentable(r, moved, null);
        if (p && !seen.has(c)) { seen.add(c); wrong.push({ type: "shape", cubes: p.cubes, isMirror: false }); }
      }
      if (wrong.length < 3) continue;
      const picks = withAnswer(r, { type: "shape", cubes: twin.cubes, turn: twin.m }, wrong);
      return {
        kind: "twins", level, cubes: ref.cubes, twinTurn: twin.m,
        prompt: "One of these is the same shape, just turned around. Which one is it?",
        ...picks,
        explain: mirrorCount
          ? [
            "Pick one cube you can recognise, like a corner, and follow the arms coming out of it.",
            "Watch out for the mirror twin. It looks right, but no amount of turning makes it match, just like your left and right hands.",
          ]
          : ["Find the long arm first and turn it in your head to line up with the shape.", "Then check that the other cubes stick out on the same sides."],
        reveal: "turn",
      };
    }
    throw new Error("no shape found");
  }

  // ---------------------------------------------------------------- nets

  // Folds printed-side out. Returns the outward direction of each cell, or null if two cells land on the same side.
  function foldNet(cells) {
    const index = new Map(cells.map((c, i) => [c.join(","), i]));
    const frames = new Array(cells.length).fill(null);
    frames[0] = { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1] };
    const neg = (a) => a.map((x) => -x || 0);
    const stack = [0];
    while (stack.length) {
      const i = stack.pop();
      const [x, z] = cells[i];
      const f = frames[i];
      const steps = [
        [x + 1, z, { n: f.u, u: neg(f.n), v: f.v }],
        [x - 1, z, { n: neg(f.u), u: f.n, v: f.v }],
        [x, z + 1, { n: f.v, u: f.u, v: neg(f.n) }],
        [x, z - 1, { n: neg(f.v), u: f.u, v: f.n }],
      ];
      for (const [a, b, frame] of steps) {
        const k = a + "," + b;
        if (index.has(k) && frames[index.get(k)] === null) { frames[index.get(k)] = frame; stack.push(index.get(k)); }
      }
    }
    const normals = frames.map((f) => f.n.join(","));
    return { valid: new Set(normals).size === cells.length, normals, frames };
  }

  const normCells = (cells) => {
    const mx = Math.min(...cells.map((c) => c[0])), mz = Math.min(...cells.map((c) => c[1]));
    return cells.map(([x, z]) => [x - mx, z - mz]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  };
  const cellsKey = (cells) => normCells(cells).map((c) => c.join(",")).join(";");

  // Every placement of a six-square shape, found by growing one square at a time.
  const HEXOMINOES = (() => {
    let level = new Map([["0,0", [[0, 0]]]]);
    for (let n = 1; n < 6; n++) {
      const next = new Map();
      for (const shape of level.values()) {
        for (const [x, z] of shape) for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (shape.some((c) => c[0] === x + a && c[1] === z + b)) continue;
          const grown = normCells([...shape, [x + a, z + b]]);
          next.set(cellsKey(grown), grown);
        }
      }
      level = next;
    }
    return [...level.values()];
  })();
  const VALID_NETS = HEXOMINOES.filter((c) => foldNet(c).valid);
  const BAD_NETS = HEXOMINOES.filter((c) => !foldNet(c).valid && Math.max(...c.map((p) => p[0])) <= 4 && Math.max(...c.map((p) => p[1])) <= 4);

  // Near misses make better wrong answers than obvious blobs.
  const looksLikeNet = (cells) => {
    const set = new Set(cells.map((c) => c.join(",")));
    const has2x2 = cells.some(([x, z]) => set.has([x + 1, z].join()) && set.has([x, z + 1].join()) && set.has([x + 1, z + 1].join()));
    return !has2x2;
  };

  const FACES = [
    { id: "red", label: "Red star" }, { id: "blue", label: "Blue circle" }, { id: "yellow", label: "Yellow ring" },
    { id: "green", label: "Green square" }, { id: "purple", label: "Purple plus" }, { id: "orange", label: "Orange dots" },
  ];

  // All the (top, right, front) views the folded cube can show. Every symbol looks the same after a quarter turn, so a face can't be the wrong way up.
  function cubeCorners(cells, faces) {
    const fold = foldNet(cells);
    const at = new Map(fold.normals.map((n, i) => [n, faces[i]]));
    const views = new Set();
    for (const m of ROTATIONS) {
      const turned = new Map();
      for (const [n, f] of at) turned.set(applyM(m, n.split(",").map(Number)).map((x) => x || 0).join(","), f);
      views.add([turned.get("0,1,0"), turned.get("1,0,0"), turned.get("0,0,1")].join("|"));
    }
    return views;
  }

  function oppositeOf(cells, faces, faceId) {
    const fold = foldNet(cells);
    const i = faces.indexOf(faceId);
    const target = fold.normals[i].split(",").map((x) => -Number(x) || 0).join(",");
    return faces[fold.normals.indexOf(target)];
  }

  const netDrawn = (cells, faces) => ({ type: "net", cells, faces: faces || null });

  function makeNets(r, level) {
    if (level === 1) {
      const cells = pick(r, VALID_NETS);
      const seen = new Set();
      const wrong = [];
      for (const c of shuffle(r, BAD_NETS.filter(looksLikeNet))) {
        const k = freeKey(c);
        if (!seen.has(k) && wrong.length < 3) { seen.add(k); wrong.push(netDrawn(c)); }
      }
      return {
        kind: "nets", level, sub: "fold", cells, faces: null,
        prompt: "Three of these flat shapes cannot fold up into a cube. Which one can?",
        ...withAnswer(r, netDrawn(cells), wrong),
        explain: [
          "Pick one square as the floor, then fold the others up around it in your head.",
          "A cube has six different sides. If two squares land on the same side, that shape cannot work. Two warning signs: a row of five, or four squares in a 2 × 2 block.",
        ],
        reveal: "fold",
      };
    }
    const cells = pick(r, VALID_NETS);
    const faces = shuffle(r, FACES.map((f) => f.id));
    if (level === 2) {
      const target = pick(r, faces);
      const opp = oppositeOf(cells, faces, target);
      const others = shuffle(r, faces.filter((f) => f !== target && f !== opp));
      const label = (id) => FACES.find((f) => f.id === id).label;
      return {
        kind: "nets", level, sub: "opposite", cells, faces, target,
        prompt: `Fold this net into a cube. Which face ends up opposite the ${label(target).toLowerCase()}?`,
        ...withAnswer(r, { type: "face", face: opp, label: label(opp) }, others.map((id) => ({ type: "face", face: id, label: label(id) }))),
        explain: [
          "Squares with exactly one square between them in a straight line always end up opposite each other.",
          `Here the ${label(target).toLowerCase()} and the ${label(opp).toLowerCase()} land on opposite sides, so you can never see them both at once.`,
        ],
        reveal: "fold",
      };
    }
    const corners = cubeCorners(cells, faces);
    const correct = pick(r, [...corners]).split("|");
    const wrong = [];
    const seen = new Set([correct.join("|")]);
    const addWrong = (t) => {
      const k = t.join("|");
      if (!corners.has(k) && !seen.has(k) && wrong.length < 3) { seen.add(k); wrong.push({ type: "cube", faces: t }); }
    };
    addWrong([correct[0], correct[2], correct[1]]); // Same three faces, wrong way round.
    for (const t of shuffle(r, [...corners])) { const p = t.split("|"); addWrong([p[1], p[0], p[2]]); if (wrong.length === 2) break; }
    const opp = oppositeOf(cells, faces, correct[0]);
    addWrong([correct[0], opp, correct[2]]); // Shows two faces that can never be seen together.
    for (let i = 0; wrong.length < 3 && i < 400; i++) addWrong(shuffle(r, faces).slice(0, 3));
    return {
      kind: "nets", level, sub: "cube", cells, faces,
      prompt: "Which of these cubes could be folded from this net?",
      ...withAnswer(r, { type: "cube", faces: correct }, wrong),
      explain: [
        "First cross out any cube showing two faces that are opposite each other. You can never see both at once.",
        "Then choose a corner and read its three faces in order, going clockwise. The order has to match the net, or it is a mirror-image cube.",
      ],
      reveal: "fold",
    };
  }

  function freeKey(cells) {
    const variants = [];
    let c = cells;
    for (let i = 0; i < 4; i++) {
      c = c.map(([x, z]) => [z, -x]);
      variants.push(cellsKey(c), cellsKey(c.map(([x, z]) => [-x, z])));
    }
    return variants.sort()[0];
  }

  // ---------------------------------------------------------------- hole punch
  // Paper is a 4 × 4 sheet: x runs right, y runs down. Fold lines are a·x + b·y = c and the part where a·x + b·y < c moves.

  function foldOf(type, box) {
    const [x0, x1, y0, y1] = box;
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    const defs = {
      L: { a: 1, b: 0, c: mx, nextBox: [mx, x1, y0, y1], text: "Fold the left side over to the right." },
      R: { a: -1, b: 0, c: -mx, nextBox: [x0, mx, y0, y1], text: "Fold the right side over to the left." },
      T: { a: 0, b: 1, c: my, nextBox: [x0, x1, my, y1], text: "Fold the top down to the bottom." },
      B: { a: 0, b: -1, c: -my, nextBox: [x0, x1, y0, my], text: "Fold the bottom up to the top." },
      // Corner folds along a diagonal of a square.
      DBR: { a: -1, b: -1, c: -(x0 + y1), nextBox: box, text: "Fold the bottom-right corner up to the top-left." },
      DTL: { a: 1, b: 1, c: x0 + y1, nextBox: box, text: "Fold the top-left corner down to the bottom-right." },
      DTR: { a: -1, b: 1, c: y0 - x0, nextBox: box, text: "Fold the top-right corner down to the bottom-left." },
      DBL: { a: 1, b: -1, c: x0 - y0, nextBox: box, text: "Fold the bottom-left corner up to the top-right." },
    };
    return { type, ...defs[type] };
  }
  const moves = (f, [x, y]) => f.a * x + f.b * y < f.c - 1e-9;
  const onLine = (f, [x, y]) => Math.abs(f.a * x + f.b * y - f.c) < 1e-9;
  const reflect = (f, [x, y]) => {
    const t = (2 * (f.a * x + f.b * y - f.c)) / (f.a * f.a + f.b * f.b);
    return [x - t * f.a, y - t * f.b];
  };

  function planFolds(r, level) {
    const seqs = level === 1
      ? [["H"], ["V"]]
      : level === 2
        ? [["H", "V"], ["V", "H"], ["D"]]
        : [["H", "V", "D"], ["V", "H", "D"], ["H", "V", "H"], ["V", "H", "V"]];
    const seq = pick(r, seqs);
    const folds = [];
    let box = [0, 4, 0, 4];
    for (const s of seq) {
      const type = s === "H" ? pick(r, ["L", "R"]) : s === "V" ? pick(r, ["T", "B"]) : pick(r, ["DBR", "DTL", "DTR", "DBL"]);
      const f = foldOf(type, box);
      folds.push(f);
      box = f.nextBox;
    }
    return folds;
  }

  function punchCandidates(folds) {
    const out = [];
    for (let x = 0.5; x < 4; x++) for (let y = 0.5; y < 4; y++) {
      if (folds.every((f) => !moves(f, [x, y]) && !onLine(f, [x, y]))) out.push([x, y]);
    }
    return out;
  }

  // Unfolds in reverse order. Each fold line works as a mirror and doubles the holes.
  function unfoldHoles(folds, p) {
    let holes = [p];
    for (let i = folds.length - 1; i >= 0; i--) holes = [...holes, ...holes.map((h) => reflect(folds[i], h))];
    return holes;
  }
  const holesKey = (holes) => holes.map((h) => h.join(",")).sort().join(";");
  const onSheet = (holes) => holes.every(([x, y]) => x > 0 && x < 4 && y > 0 && y < 4);

  function makePunch(r, level) {
    for (let tries = 0; tries < 500; tries++) {
      const folds = planFolds(r, level);
      const cands = punchCandidates(folds);
      if (!cands.length) continue;
      const p = pick(r, cands);
      const holes = unfoldHoles(folds, p);
      const key = holesKey(holes);
      const seen = new Set([key]);
      const wrong = [];
      const add = (hs) => {
        const k = holesKey(hs);
        if (hs.length && onSheet(hs) && !seen.has(k) && new Set(hs.map(String)).size === hs.length && wrong.length < 3) {
          seen.add(k); wrong.push({ type: "paper", holes: hs });
        }
      };
      const flipX = (hs) => hs.map(([x, y]) => [4 - x, y]);
      const flipY = (hs) => hs.map(([x, y]) => [x, 4 - y]);
      const shift = (hs, dx, dy) => hs.map(([x, y]) => [x + dx, y + dy]);
      const options = shuffle(r, [
        flipX(holes), flipY(holes),
        unfoldHoles(folds.slice(-1), p), unfoldHoles(folds.slice(0, 1), p),
        shift(holes, 1, 0), shift(holes, -1, 0), shift(holes, 0, 1), shift(holes, 0, -1),
        holes.map(([x, y]) => [y, x]),
      ]);
      options.forEach(add);
      for (let i = 0; wrong.length < 3 && i < 200; i++) {
        const hs = holes.slice();
        hs[randInt(r, 0, hs.length - 1)] = [randInt(r, 0, 3) + .5, randInt(r, 0, 3) + .5];
        add(hs);
      }
      if (wrong.length < 3) continue;
      const n = folds.length;
      return {
        kind: "punch", level, folds, punch: p, holes,
        prompt: `A square sheet is folded ${n === 1 ? "once" : n === 2 ? "twice" : "three times"}, then a hole is punched through all the layers. What does the sheet look like opened out flat?`,
        ...withAnswer(r, { type: "paper", holes }, wrong),
        explain: [
          `${n === 1 ? "One fold makes 2 layers" : n === 2 ? "Two folds make 4 layers" : "Three folds make 8 layers"}, so one punch makes ${holes.length} holes.`,
          "Now unfold one step at a time, last fold first. Every fold line works like a mirror: each hole gets a partner the same distance away on the other side.",
        ],
        reveal: "unfold",
      };
    }
    throw new Error("no fold plan found");
  }

  // ---------------------------------------------------------------- paint

  // Number of painted faces on each small cube. Set openBottom when the block stood on a table.
  function paintFaces(a, b, c, openBottom) {
    const out = [];
    for (let x = 0; x < a; x++) for (let y = 0; y < b; y++) for (let z = 0; z < c; z++) {
      const faces = [];
      if (x === 0) faces.push("x-");
      if (x === a - 1) faces.push("x+");
      if (y === 0 && !openBottom) faces.push("y-");
      if (y === b - 1) faces.push("y+");
      if (z === 0) faces.push("z-");
      if (z === c - 1) faces.push("z+");
      out.push({ pos: [x, y, z], faces });
    }
    return out;
  }

  function makePaint(r, level) {
    const dims = level === 1 ? pick(r, [[3, 3, 3], [2, 2, 3], [3, 2, 2], [2, 2, 2]])
      : level === 2 ? pick(r, [[3, 3, 3], [4, 3, 3], [3, 3, 4], [4, 4, 3], [4, 4, 4]])
      : pick(r, [[4, 3, 3], [5, 3, 3], [4, 4, 3], [5, 4, 3], [4, 4, 4]]);
    const [a, b, c] = dims;
    const openBottom = level === 3 && r() < 0.55;
    const pieces = paintFaces(a, b, c, openBottom);
    const counts = [0, 1, 2, 3].map((k) => pieces.filter((p) => p.faces.length === k).length);
    const ks = level === 1 ? [3, 3, 2].filter((k) => counts[k] > 0) : [0, 1, 2, 3].filter((k) => counts[k] > 0 && (k < 3 || openBottom));
    const k = pick(r, ks);
    const ans = counts[k];
    const word = k === 0 ? "no paint at all" : k === 1 ? "paint on exactly 1 face" : `paint on exactly ${k} faces`;
    const total = a * b * c;
    let explain;
    const m = (n) => Math.max(0, n - 2);
    if (!openBottom && k === 3) {
      explain = ["A small cube with 3 painted faces must sit on a corner of the block.", `Every cuboid has 8 corners, however big it is, so the answer is ${ans}.`];
    } else if (!openBottom && k === 2) {
      explain = [
        "A small cube with exactly 2 painted faces sits on an edge, but not on a corner.",
        `Take the corners off each edge. There are 4 edges of each length, so 4 × ${m(a)} + 4 × ${m(c)} + 4 × ${m(b)} = ${ans}.`,
      ];
    } else if (!openBottom && k === 1) {
      explain = [
        "A small cube with exactly 1 painted face sits in the middle part of a big face.",
        `Take off the outside ring on each face, then count the opposite pairs: 2 × (${m(a)} × ${m(c)} + ${m(a)} × ${m(b)} + ${m(c)} × ${m(b)}) = ${ans}.`,
      ];
    } else if (!openBottom && k === 0) {
      explain = [
        "Clean cubes are the ones buried inside. Peel one layer off every side of the block.",
        `That leaves ${m(a)} × ${m(c)} × ${m(b)} = ${ans}.`,
      ];
    } else {
      const byLayer = [];
      for (let y = b - 1; y >= 0; y--) byLayer.push(pieces.filter((p) => p.pos[1] === y && p.faces.length === k).length);
      explain = [
        "The block stood on the table, so the bottom never touched the paint. That changes the bottom layer, so count one layer at a time.",
        `From top to bottom: ${byLayer.join(" + ")} = ${ans}.`,
      ];
    }
    return {
      kind: "paint", level, dims, openBottom, pieces, k,
      prompt: `This ${a} × ${c} × ${b} block ${openBottom ? "stood on a table and got painted on the top and all four sides" : "was dipped in paint so every outside face is covered"}. Then it was cut into ${total} small cubes. How many small cubes have ${word}?`,
      ...numericOptions(r, ans, shuffle(r, [counts[0], counts[1], counts[2], counts[3], total - ans, ans + 2, ans + 4, ans * 2])),
      explain,
      reveal: "paint",
    };
  }

  // ---------------------------------------------------------------- catalogue

  const MAKERS = { crates: makeCrates, lookout: makeLookout, twins: makeTwins, nets: makeNets, punch: makePunch, paint: makePaint };
  const KINDS = Object.keys(MAKERS);
  const make = (kind, level, r = Math.random) => MAKERS[kind](r, Math.min(3, Math.max(1, level)));

  root.Puzzles = {
    KINDS, FACES, make, seeded, shuffle,
    cubesFromHeights, hiddenCubes, viewOf, viewKey, sideColumns, allTopsVisible, heightsConnected, allCubesShow,
    canonical, mirrored, shapeKey, ROTATIONS, applyM, normalize,
    foldNet, HEXOMINOES, VALID_NETS, freeKey, cubeCorners, oppositeOf,
    moves, onLine, reflect, unfoldHoles, holesKey, foldOf, paintFaces,
  };
})(globalThis);
