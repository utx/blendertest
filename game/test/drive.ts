// Plays the real built game in headless Edge: every station and level, plus Exam Flight.
// Reports errors and saves screenshots. Run from game/: deno run -A test/drive.ts <shot_dir>
const shots = Deno.args[0] ?? "test/shots";
Deno.mkdirSync(shots, { recursive: true });
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const url = "file:///" + Deno.realPathSync("dist/preview.html").replaceAll("\\", "/");
const prof = Deno.makeTempDirSync();
const proc = new Deno.Command(EDGE, {
  args: ["--headless=new", "--remote-debugging-port=9333", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist", `--user-data-dir=${prof}`, "--no-first-run", "--window-size=1280,800", "about:blank"],
  stdout: "null", stderr: "null",
}).spawn();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let target: any;
for (let i = 0; i < 60 && !target; i++) {
  try {
    target = (await (await fetch("http://127.0.0.1:9333/json")).json()).find((t: any) => t.type === "page");
  } catch { await sleep(300); }
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map<number, (v: any) => void>();
const errors: string[] = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id); }
  if (m.method === "Runtime.exceptionThrown") {
    errors.push("EXC " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 500));
  }
  if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params.type)) {
    const t = m.params.args.map((a: any) => a.value ?? a.description).join(" ");
    if (!/GPU stall|GL Driver Message/.test(t)) errors.push("CON " + t.slice(0, 300));
  }
  if (m.method === "Log.entryAdded" && m.params.entry.level === "error") {
    errors.push("LOG " + m.params.entry.text.slice(0, 200) + " " + (m.params.entry.url ?? "").slice(0, 120));
  }
};
const send = (method: string, params: any = {}) =>
  new Promise<any>((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr: string) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) {
    errors.push("EVAL " + expr.slice(0, 70) + " :: " + (r.result.exceptionDetails.exception?.description ?? "").slice(0, 400));
    return null;
  }
  return r.result.result.value;
};
const shot = async (name: string) => {
  const r = await send("Page.captureScreenshot", { format: "jpeg", quality: 72 });
  Deno.writeFileSync(`${shots}/${name}.jpg`, Uint8Array.from(atob(r.result.data), (c) => c.charCodeAt(0)));
};
const size = (w: number, h: number, mobile = false) =>
  send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
const settle = async (max = 16000) => {
  const t = Date.now();
  await sleep(150);
  while (Date.now() - t < max) {
    if ((await ev("CubitIsland.tweens")) === 0) {
      await sleep(150);
      if ((await ev("CubitIsland.tweens")) === 0) return;
    }
    await sleep(200);
  }
  errors.push("animation never settled");
};
const click = (sel: string) => ev(`document.querySelector(${JSON.stringify(sel)}).click()`);

await send("Runtime.enable");
await send("Log.enable");
await send("Page.enable");
await size(1280, 800);
await send("Page.navigate", { url });
for (let i = 0; i < 160 && !(await ev("!!(window.CubitIsland&&CubitIsland.ready)")); i++) await sleep(250);
console.log("ready", await ev("!!(window.CubitIsland&&CubitIsland.ready)"));
await shot("00_title");
await click("#playBtn");
await sleep(1500);
await shot("01_hub");

for (const k of ["crates", "lookout", "twins", "nets", "punch", "paint"]) {
  for (const lv of [1, 2, 3]) {
    await ev(`CubitIsland.startSession('${k}'); CubitIsland.session.level=${lv}; CubitIsland.renderQuestion(CubitIsland.make('${k}',${lv}));1`);
    await settle();
    await shot(`q_${k}${lv}`);
    await ev(`(()=>{const q=CubitIsland.session.q;CubitIsland.answer((q.answer+1)%4)})()`);
    await settle();
    await shot(`r_${k}${lv}`);
    await ev("document.querySelector('#again').click()");
    await sleep(1400);
    await shot(`m_${k}${lv}`);
    await settle();
    if (await ev(`document.querySelector('#feedback').hidden`)) errors.push(`no feedback ${k}${lv}`);
    console.log(k, lv, "played");
  }
}

// The randomly chosen variants, forced so each one is seen at least once.
const force = async (name: string, kind: string, lv: number, test: string) => {
  await ev(`(()=>{CubitIsland.startSession('${kind}');let q;for(let i=0;i<500;i++){q=CubitIsland.make('${kind}',${lv});if(${test})break}CubitIsland.renderQuestion(q);})()`);
  await settle();
  await shot(`q_${name}`);
  await ev(`(()=>{const q=CubitIsland.session.q;CubitIsland.answer((q.answer+1)%4)})()`);
  await settle();
  await shot(`r_${name}`);
};
await force("fill", "crates", 3, "q.box");
await force("map", "lookout", 3, "q.fromMap");
await force("back", "lookout", 3, "q.side==='back'");
await force("right", "lookout", 2, "q.side==='right'");
await force("top", "lookout", 2, "q.side==='top'");
await force("openbottom", "paint", 3, "q.openBottom");

// A whole session through the real buttons.
await click("#leave");
await sleep(300);
await click(".st[data-id=crates]");
await sleep(1100);
await shot("02_briefing");
await click("#mGo");
for (let i = 0; i < 6; i++) {
  await sleep(200);
  await ev(`document.querySelectorAll('.opt')[CubitIsland.session.q.answer].click()`);
  await sleep(200);
  await click("#next");
}
await sleep(900);
await shot("03_results");
console.log("state", await ev(`JSON.stringify({stars:CubitIsland.state.stars,level:CubitIsland.state.level,crates:CubitIsland.state.stats.crates})`));
await click("#mMap");
await sleep(700);
await shot("04_hub_after");
await click("#skillsBtn");
await sleep(200);
await shot("05_skills");
await click("#mBack");

// Exam Flight end to end with some wrong answers, then the review.
await click("#examBtn");
await sleep(100);
await click("#mGo");
await sleep(500);
await shot("06_exam");
for (let i = 0; i < 10; i++) {
  await ev(`(()=>{const q=CubitIsland.session.q;const pick=${i}%3==0?(q.answer+1)%4:q.answer;document.querySelectorAll('.opt')[pick].click()})()`);
  await sleep(500);
}
await sleep(500);
await shot("07_exam_results");
console.log("exams", await ev(`JSON.stringify(CubitIsland.state.exams)`));
await click("#mRev");
await settle();
await shot("08_review");
await click("#leave");
await sleep(300);
await click("#mMap");
await sleep(300);

// Phone size.
await size(400, 800, true);
await sleep(1000);
await shot("p_hub");
await ev(`CubitIsland.startSession('punch'); CubitIsland.session.level=3; CubitIsland.renderQuestion(CubitIsland.make('punch',3));1`);
await settle();
await shot("p_q_punch");
await ev(`(()=>{const q=CubitIsland.session.q;CubitIsland.answer(q.answer)})()`);
await settle();
await shot("p_r_punch");
await ev(`CubitIsland.startSession('twins'); CubitIsland.session.level=3; CubitIsland.renderQuestion(CubitIsland.make('twins',3));1`);
await settle();
await shot("p_q_twins");
console.log("overflow", await ev(`[document.documentElement.scrollWidth, innerWidth, document.querySelector('#scroll').scrollWidth, document.querySelector('#scroll').clientWidth].join()`));
console.log("ERRORS", errors.length);
console.log([...new Set(errors)].slice(0, 25).join("\n"));
ws.close();
proc.kill();
Deno.exit(0);
