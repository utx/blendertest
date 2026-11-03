# blendertest

Driving Blender from Claude Code through the [Blender MCP](https://github.com/ahujasid/blender-mcp) server.

The MCP server talks to a small add-on running inside Blender over a local socket,
so **Blender and Claude Code must run on the same computer** (this does not work
from a Claude Code cloud session).

## One-time setup

1. **Install the prerequisites**
   - Blender 3.0 or newer
   - [uv](https://docs.astral.sh/uv/getting-started/installation/) (provides `uvx`)
     - macOS: `brew install uv`
     - Windows: `powershell -c "irm https://astral.sh/uv/install.ps1 | iex"`
     - Linux: `curl -LsSf https://astral.sh/uv/install.sh | sh`
   - [Claude Code](https://code.claude.com)

2. **Install the Blender add-on**
   - Download `addon.py` from https://github.com/ahujasid/blender-mcp
   - In Blender: *Edit → Preferences → Add-ons → Install…* (on Blender 4.2+ use the
     drop-down arrow at the top right → *Install from Disk…*), pick `addon.py`, and
     tick the checkbox to enable it.

3. **Connect Blender**
   - In the 3D Viewport press `N` to open the sidebar, open the **MCP for Blender** tab (older versions call it **BlenderMCP**),
     and click **Connect to Claude** (or **Start MCP Server**, depending on the version).

## Using it

```bash
git clone https://github.com/utx/blendertest.git
cd blendertest
claude
```

This repo's `.mcp.json` registers the `blender` MCP server automatically. The first
time you start Claude Code here it asks you to approve the project's MCP server:
approve it. Run `/mcp` inside Claude Code to check that `blender` shows as connected.

Then just ask, for example: *"Create a low-poly island scene with a palm tree and
point the camera at it."*

Keep Blender open with the add-on connected while you work.

## Troubleshooting

- **`blender` shows as failed in `/mcp`:** make sure `uvx --version` works in the
  same terminal. On Windows you may need to restart the terminal after installing uv.
- **Claude says it can't reach Blender:** click Connect in the MCP for Blender sidebar
  tab again, and make sure only one MCP client is connected to it.
- **Undo:** the add-on runs Python inside Blender, so save your `.blend` file before
  big changes. `Ctrl+Z` works for most edits.

## Cubit Island

`game/` holds a 3D spatial reasoning game for NSW Opportunity Class (OC) test practice,
with models and renders built in Blender. It is an unofficial practice game, not made by
or connected with the NSW Department of Education.

- Play it: https://utx.github.io/blendertest/ (once GitHub Pages is on for the `docs/` folder)
- Rebuild the models: `blender --background --factory-startup --python blender/build_assets.py -- assets` from `game/`
- Rebuild the page: `deno run --allow-read --allow-write --allow-net=jsr.io build.ts` from `game/`
- Test the puzzle answers: `deno run --allow-read src/puzzles.test.js` from `game/`
