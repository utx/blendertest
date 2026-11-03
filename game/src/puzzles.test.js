// Checks answers by a second route where possible, so a shared bug in the generators cannot hide.
// Run: deno run --allow-read src/puzzles.test.js
import "./puzzles.js";

const P = globalThis.Puzzles;
let failures = 0, checks = 0;
const ok = (cond, msg, data) => {
  checks++;
  if (!cond) { failures++; if (failures < 25) console.log("FAIL", msg, data ? JSON.stringify(data).slice(0, 400) : ""); }
};
const eq = (a, b, msg, data) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`, data);

// ---- nets: known maths facts
const free = new Set(P.HEXOMINOES.map(P.freeKey));
eq(free.size, 35, "free hexominoes");
eq(new Set(P.VALID_NETS.map(P.freeKey)).size, 11, "a cube has 11 distinct nets");
eq(P.ROTATIONS.length, 24, "cube rotations");
for (const m of P.ROTATIONS) {
  const d = m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1]) - m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0]) + m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0]);
  eq(d, 1, "rotations must not mirror");
}
// The familiar cross: centre (1,1). Up/down/left/right wrap round it and the tail is opposite the centre.
const cross = [[1, 1], [1, 0], [0, 1], [2, 1], [1, 2], [1, 3]];
const crossFaces = ["a", "b", "c", "d", "e", "f"];
ok(P.foldNet(cross).valid, "cross folds");
eq(P.oppositeOf(cross, crossFaces, "a"), "f", "centre is opposite the tail");
eq(P.oppositeOf(cross, crossFaces, "c"), "d", "left arm is opposite right arm");
eq(P.oppositeOf(cross, crossFaces, "b"), "e", "cell above is opposite cell below");
// A real cube seen from above: looking down on the printed centre, +x is right and +z is toward the viewer.
ok(P.cubeCorners(cross, crossFaces).has("a|d|e"), "centre top, right arm right, lower cell front");
ok(!P.cubeCorners(cross, crossFaces).has("a|e|d"), "the mirror order cannot occur");
eq(P.cubeCorners(cross, crossFaces).size, 24, "a cube shows 24 oriented corner views");

// ---- paint: known formula for a 3x3x3
const p3 = P.paintFaces(3, 3, 3, false);
eq([0, 1, 2, 3].map((k) => p3.filter((p) => p.faces.length === k).length), [1, 6, 12, 8], "3x3x3 painted counts");
const p4 = P.paintFaces(4, 4, 4, false);
eq([0, 1, 2, 3].map((k) => p4.filter((p) => p.faces.length === k).length), [8, 24, 24, 8], "4x4x4 painted counts");

// ---- punch: a by-hand case. Fold left over right, punch (2.5, 0.5): holes at (2.5,.5) and (1.5,.5).
eq(P.holesKey(P.unfoldHoles([P.foldOf("L", [0, 4, 0, 4])], [2.5, .5])), P.holesKey([[2.5, .5], [1.5, .5]]), "single fold mirror");

// Independent check: walk every hole forward through the folds and see that it lands on the punch.
function forward(folds, pt) {
  let q = pt;
  for (const f of folds) if (P.moves(f, q)) q = P.reflect(f, q);
  return q;
}

// Independent view check, by actually sighting along each direction through the voxels.
function sight(cubes, side) {
  const set = new Set(cubes.map((c) => c.join()));
  const maxX = Math.max(...cubes.map((c) => c[0])), maxY = Math.max(...cubes.map((c) => c[1])), maxZ = Math.max(...cubes.map((c) => c[2]));
  return { set, maxX, maxY, maxZ, side };
}
function trueView(h, side) {
  const cubes = P.cubesFromHeights(h);
  const { set, maxY } = sight(cubes, side);
  const w = h.length, d = h[0].length;
  const hit = (a, b, c) => set.has([a, b, c].join());
  const rows = [];
  if (side === "top") {
    // Viewer above with FRONT (+z) at the bottom of the picture and +x to the right.
    for (let z = 0; z < d; z++) { const row = []; for (let x = 0; x < w; x++) { let any = false; for (let y = 0; y <= maxY; y++) any = any || hit(x, y, z); row.push(any); } rows.push(row); }
    return rows;
  }
  for (let y = maxY; y >= 0; y--) {
    const row = [];
    if (side === "front") for (let x = 0; x < w; x++) { let any = false; for (let z = 0; z < d; z++) any = any || hit(x, y, z); row.push(any); }
    if (side === "back") for (let x = w - 1; x >= 0; x--) { let any = false; for (let z = 0; z < d; z++) any = any || hit(x, y, z); row.push(any); }
    if (side === "right") for (let z = d - 1; z >= 0; z--) { let any = false; for (let x = 0; x < w; x++) any = any || hit(x, y, z); row.push(any); }
    if (side === "left") for (let z = 0; z < d; z++) { let any = false; for (let x = 0; x < w; x++) any = any || hit(x, y, z); row.push(any); }
    rows.push(row);
  }
  return rows;
}

const key = (o) => JSON.stringify(o, (k, v) => (k === "correct" || k === "isMirror" || k === "turn" ? undefined : v));
const samples = {};
for (const kind of P.KINDS) for (const level of [1, 2, 3]) {
  for (let seed = 1; seed <= 400; seed++) {
    const r = P.seeded(seed * 31 + level);
    const q = P.make(kind, level, r);
    const tag = `${kind} L${level} seed ${seed}`;
    samples[`${kind}${level}`] ??= q;
    // Common to every puzzle
    eq(q.options.length, 4, `${tag} four options`, q.options);
    ok(q.answer >= 0 && q.answer < 4 && q.options[q.answer].correct, `${tag} answer index`);
    eq(q.options.filter((o) => o.correct).length, 1, `${tag} one correct`);
    eq(new Set(q.options.map(key)).size, 4, `${tag} options all differ`, q.options);
    ok(q.prompt && q.explain.length >= 2 && q.explain.every((s) => s && !/undefined|NaN|null/.test(s)), `${tag} text`, q.explain);
    ok(!/undefined|NaN|null/.test(q.prompt), `${tag} prompt`, q.prompt);

    if (kind === "crates") {
      ok(P.allTopsVisible(q.heights), `${tag} tops visible`);
      ok(P.heightsConnected(q.heights), `${tag} connected`);
      const n = q.heights.flat().reduce((a, b) => a + b, 0);
      eq(q.cubes.length, n, `${tag} cube count`);
      if (q.box) {
        const [a, c, b] = q.box;
        eq(q.options[q.answer].value, a * b * c - n, `${tag} fill`);
        ok(Math.max(...q.heights.flat()) <= c && q.heights.length === a && q.heights[0].length === b, `${tag} stack fits in box`);
      } else eq(q.options[q.answer].value, n, `${tag} count`);
    }
    if (kind === "lookout") {
      eq(P.viewKey(q.options[q.answer].cells), P.viewKey(trueView(q.heights, q.side)), `${tag} ${q.side} view`, q.heights);
      for (const o of q.options) if (!o.correct) ok(P.viewKey(o.cells) !== P.viewKey(trueView(q.heights, q.side)), `${tag} distractor`);
      ok(P.allTopsVisible(q.heights), `${tag} tops visible`);
    }
    if (kind === "twins") {
      const can = P.canonical(q.cubes);
      eq(P.canonical(q.options[q.answer].cubes), can, `${tag} twin matches`);
      for (const o of q.options) {
        if (o.correct) continue;
        ok(P.canonical(o.cubes) !== can, `${tag} distractor is different`);
        if (o.isMirror) eq(P.canonical(o.cubes), P.canonical(P.mirrored(q.cubes)), `${tag} mirror really is mirror`);
      }
      ok(P.canonical(P.mirrored(q.cubes)) !== can, `${tag} chiral`);
      eq(q.options.filter((o) => o.isMirror).length, { 1: 0, 2: 1, 3: 2 }[level], `${tag} mirror count`);
      ok(P.allCubesShow(q.cubes), `${tag} ref visible`);
      for (const o of q.options) ok(P.allCubesShow(o.cubes), `${tag} option visible`);
      // The turn stored for the reveal must carry the reference onto the option.
      eq(P.shapeKey(q.cubes.map((c) => P.applyM(q.twinTurn, c))), P.shapeKey(q.options[q.answer].cubes), `${tag} stored turn`);
      eq(new Set(q.cubes.map(String)).size, q.cubes.length, `${tag} no overlapping cubes`);
    }
    if (kind === "nets") {
      ok(P.foldNet(q.cells).valid, `${tag} net folds`);
      if (q.sub === "fold") {
        for (const o of q.options) eq(P.foldNet(o.cells).valid, !!o.correct, `${tag} fold truth`, o.cells);
      }
      if (q.sub === "opposite") {
        const opp = P.oppositeOf(q.cells, q.faces, q.target);
        eq(q.options[q.answer].face, opp, `${tag} opposite`);
        eq(P.oppositeOf(q.cells, q.faces, opp), q.target, `${tag} opposite is mutual`);
      }
      if (q.sub === "cube") {
        const corners = P.cubeCorners(q.cells, q.faces);
        for (const o of q.options) eq(corners.has(o.faces.join("|")), !!o.correct, `${tag} cube truth`, o.faces);
      }
    }
    if (kind === "punch") {
      eq(q.holes.length, 2 ** q.folds.length, `${tag} holes double`);
      eq(new Set(q.holes.map(String)).size, q.holes.length, `${tag} holes distinct`);
      eq(P.holesKey(q.options[q.answer].holes), P.holesKey(q.holes), `${tag} answer holes`);
      for (const h of q.holes) {
        eq(forward(q.folds, h).map((v) => +v.toFixed(6)), q.punch, `${tag} hole folds onto punch`, { h, q: q.folds });
        ok(h[0] > 0 && h[0] < 4 && h[1] > 0 && h[1] < 4, `${tag} on sheet`);
      }
      // Brute force: every other grid point must NOT fold onto the punch.
      const set = new Set(q.holes.map(String));
      for (let x = .5; x < 4; x++) for (let y = .5; y < 4; y++) {
        const same = forward(q.folds, [x, y]).every((v, i) => Math.abs(v - q.punch[i]) < 1e-6);
        eq(same, set.has(String([x, y])), `${tag} brute force ${x},${y}`);
      }
    }
    if (kind === "paint") {
      const [a, b, c] = q.dims;
      // Second route: paint is on a face when its neighbour in that direction is missing.
      let count = 0;
      for (let x = 0; x < a; x++) for (let y = 0; y < b; y++) for (let z = 0; z < c; z++) {
        let f = 0;
        for (const [dx, dy, dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
          const nx = x + dx, ny = y + dy, nz = z + dz;
          const outside = nx < 0 || ny < 0 || nz < 0 || nx >= a || ny >= b || nz >= c;
          if (outside && !(q.openBottom && dy === -1)) f++;
        }
        if (f === q.k) count++;
      }
      eq(q.options[q.answer].value, count, `${tag} paint count`);
      ok(count > 0, `${tag} nonzero answer`);
      // The worked sum printed for the child has to come out to the answer.
      const line = q.explain.join(" ");
      const m = line.match(/= (\d+)\.?$/);
      if (m) eq(Number(m[1]), count, `${tag} explanation total`);
      for (const s of q.explain) {
        const sum = s.match(/(\d+(?: \+ \d+)+) = (\d+)/);
        if (sum) eq(sum[1].split(" + ").reduce((t, v) => t + Number(v), 0), Number(sum[2]), `${tag} printed sum`, s);
        const formula = s.match(/((?:\d+ × \d+)(?: \+ \d+ × \d+)+) = (\d+)/);
        if (formula) eq(formula[1].split(" + ").reduce((t, v) => t + v.split(" × ").reduce((p, n) => p * Number(n), 1), 0), Number(formula[2]), `${tag} printed formula`, s);
        const pairs = s.match(/2 × \((.+)\) = (\d+)/);
        if (pairs) eq(2 * pairs[1].split(" + ").reduce((t, v) => t + v.split(" × ").reduce((p, n) => p * Number(n), 1), 0), Number(pairs[2]), `${tag} printed pairs`, s);
        const vol = s.match(/= ?(\d+) × (\d+) × (\d+) = (\d+)|That leaves (\d+) × (\d+) × (\d+) = (\d+)/);
        if (vol && vol[5]) eq(vol[5] * vol[6] * vol[7], Number(vol[8]), `${tag} printed volume`, s);
      }
    }
  }
}

console.log(`${checks} checks, ${failures} failures`);
console.log("EXAMPLES");
for (const k of ["crates2", "lookout3", "punch2", "paint3", "nets2"]) console.log(k, "->", samples[k].prompt, "| A:", JSON.stringify(samples[k].options[samples[k].answer]).slice(0, 80), "|", samples[k].explain.join(" "));
if (failures) Deno.exit(1);
