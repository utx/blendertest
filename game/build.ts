// Bundles the Blender assets and game source into one page.
// Run from game/: deno run --allow-read --allow-write build.ts
import { encodeBase64 } from "jsr:@std/encoding@1/base64";

const asset = (name: string) => encodeBase64(Deno.readFileSync(`assets/${name}`));
const stations = ["crates", "twins", "nets", "lookout", "punch", "paint"];
const poses = ["happy", "think", "oops", "neutral"];

const assets = {
  glb: { island: asset("island.glb"), cubit: asset("cubit.glb"), crate: asset("crate.glb") },
  img: {
    title: `data:image/jpeg;base64,${asset("title.jpg")}`,
    ...Object.fromEntries(stations.map((s) => [`badge_${s}`, `data:image/png;base64,${asset(`badge_${s}.png`)}`])),
    ...Object.fromEntries(poses.map((p) => [`cubit_${p}`, `data:image/png;base64,${asset(`cubit_${p}.png`)}`])),
  },
};

const html = Deno.readTextFileSync("src/template.html")
  .replace("/*ASSETS*/", () => `window.CI_ASSETS=${JSON.stringify(assets)};`)
  .replace("/*PUZZLES*/", () => Deno.readTextFileSync("src/puzzles.js"))
  .replace("/*GAME*/", () => Deno.readTextFileSync("src/game.js"));

Deno.mkdirSync("dist", { recursive: true });
Deno.writeTextFileSync("dist/cubit-island.html", html);
// A wrapped copy for testing in a plain browser, matching what the artifact skeleton adds.
Deno.writeTextFileSync("dist/preview.html", `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style></head><body>${html}</body></html>`);
console.log("built", (html.length / 1e6).toFixed(2), "MB");
