"""Builds every Blender asset for Cubit Island.

Run headless:
  blender --background --factory-startup --python game/blender/build_assets.py -- <out_dir> [--quick]

Writes island.glb, cubit.glb, crate.glb, title.jpg, badge_<station>.png and
cubit_<pose>.png into <out_dir>. Blender's -Y faces the viewer (it becomes +Z in the game).
"""
import math
import os
import random
import sys

import addon_utils
import bmesh
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else "assets")
QUICK = "--quick" in argv
os.makedirs(OUT, exist_ok=True)
random.seed(7)
addon_utils.enable("cycles")


# ---------------------------------------------------------------- helpers

def linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


MATS = {}


def mat(name, hex_color, rough=0.75, metal=0.0, emit=0.0):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    rgb = [linear(int(hex_color[i:i + 2], 16) / 255) for i in (0, 2, 4)]
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = (*rgb, 1)
        b.inputs["Emission Strength"].default_value = emit
    MATS[name] = m
    return m


def palette():
    for n, c, *rest in [
        ("grass", "7CC644"), ("grass2", "62B23A"), ("sand", "F3D68B"), ("rock", "8B8F9C"),
        ("rock2", "6F7382"), ("wood", "B9793F"), ("wood2", "8F5A2B"), ("plank", "D79B58"),
        ("leaf", "2FA65A"), ("leaf2", "1F8C4E"), ("trunk", "A9794A"),
        ("stone", "9C8BD6"), ("stone2", "7A67BE"), ("paper", "FBFCF7"), ("hole", "26323F"),
        ("brick", "E4644B"), ("brick2", "C24C3A"), ("metal", "AEBBC6", 0.35, 0.4),
        ("roof", "2F5D82"), ("flag", "FF5A4E"), ("sun", "FFC531"),
        ("f_red", "E8443A"), ("f_blue", "2B7DE9"), ("f_yellow", "F5C21B"),
        ("f_green", "3FB550"), ("f_purple", "8D5BE0"), ("f_orange", "F5871F"),
        ("paint", "FF4F8B", 0.25), ("bucket", "D9E2E8", 0.4, 0.3),
        ("robot", "19B7C4", 0.35), ("robot2", "0E8B9B", 0.4), ("screen", "12283A", 0.25),
        ("eye", "E9FBFF", 0.3, 0.0, 1.2), ("spark", "FFC531", 0.4, 0.0, 0.6),
        ("crate_frame", "FFFFFF", 0.6), ("crate_panel", "D8D8D8", 0.8),
    ]:
        mat(n, c, *rest)


def finish(name, bm, material, parent, loc, rot, smooth=False):
    me = bpy.data.meshes.new(name)
    if smooth:
        for f in bm.faces:
            f.smooth = True
    bm.to_mesh(me)
    bm.free()
    if isinstance(material, str):
        material = MATS[material]
    if material:
        me.materials.append(material)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = rot
    if parent:
        ob.parent = parent
    return ob


def box(name, size, loc=(0, 0, 0), material=None, parent=None, bevel=0.0, rot=(0, 0, 0), origin=(0, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    for v in bm.verts:
        v.co = Vector((v.co.x * size[0] - origin[0], v.co.y * size[1] - origin[1], v.co.z * size[2] - origin[2]))
    if bevel:
        bmesh.ops.bevel(bm, geom=bm.edges[:], offset=bevel, segments=1, profile=0.5,
                        affect="EDGES", clamp_overlap=True)
    return finish(name, bm, material, parent, loc, rot)


def cyl(name, r1, r2, h, loc=(0, 0, 0), material=None, parent=None, segs=10, rot=(0, 0, 0), smooth=False):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs, radius1=r1, radius2=r2, depth=h)
    return finish(name, bm, material, parent, loc, rot, smooth)


def ball(name, r, loc=(0, 0, 0), material=None, parent=None, subdiv=1, scale=(1, 1, 1), smooth=False):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=r)
    for v in bm.verts:
        v.co = Vector((v.co.x * scale[0], v.co.y * scale[1], v.co.z * scale[2]))
    return finish(name, bm, material, parent, loc, (0, 0, 0), smooth)


def empty(name, loc=(0, 0, 0), parent=None):
    ob = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    if parent:
        ob.parent = parent
    return ob


def tree_of(ob):
    return [ob] + [c for ch in ob.children for c in tree_of(ch)]


# ---------------------------------------------------------------- island

def edge_radius(theta):
    return 11.2 + 0.9 * math.sin(3 * theta + 0.6) + 0.55 * math.sin(5 * theta + 2.0) + 0.3 * math.sin(9 * theta)


def smoothstep(a, b, x):
    t = min(1, max(0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def ground(x, y):
    r = math.hypot(x, y)
    theta = math.atan2(y, x)
    u = r / edge_radius(theta)
    plateau = 1.0 * (1 - smoothstep(0.68, 0.96, u))
    hill = 1.55 * math.exp(-((r / 3.0) ** 2))
    return plateau + hill + 0.18 - 0.42 * smoothstep(0.9, 1.08, u)


def build_terrain(root):
    rings, segs = 16, 60
    bm = bmesh.new()
    grid = []
    for i in range(rings + 1):
        row = []
        for j in range(segs):
            theta = 2 * math.pi * j / segs
            u = (i + 0.0001) / rings
            r = u * edge_radius(theta) * 1.06
            jx = random.uniform(-0.12, 0.12) if 0 < i < rings else 0
            jy = random.uniform(-0.12, 0.12) if 0 < i < rings else 0
            x, y = r * math.cos(theta) + jx, r * math.sin(theta) + jy
            row.append(bm.verts.new((x, y, ground(x, y) + (random.uniform(-0.05, 0.05) if i < rings else 0))))
        grid.append(row)
    skirt = [bm.verts.new((v.co.x * 1.03, v.co.y * 1.03, -1.6)) for v in grid[-1]]
    faces = []
    for i in range(rings):
        for j in range(segs):
            a, b = grid[i][j], grid[i][(j + 1) % segs]
            c, d = grid[i + 1][(j + 1) % segs], grid[i + 1][j]
            if i == 0:
                faces.append(bm.faces.new((a, d, c)) if a is not b else None)
            else:
                faces.append(bm.faces.new((a, d, c)))
                faces.append(bm.faces.new((a, c, b)))
    for j in range(segs):
        bm.faces.new((grid[-1][j], skirt[j], skirt[(j + 1) % segs], grid[-1][(j + 1) % segs]))
    bm.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    for f in bm.faces:
        z = f.calc_center_median().z
        if z < -0.05:
            f.material_index = 3
        elif z < 0.72:
            f.material_index = 2
        else:
            f.material_index = random.choice((0, 0, 0, 1))
    me = bpy.data.meshes.new("terrain")
    bm.to_mesh(me)
    bm.free()
    for n in ("grass", "grass2", "sand", "rock"):
        me.materials.append(MATS[n])
    ob = bpy.data.objects.new("terrain", me)
    bpy.context.scene.collection.objects.link(ob)
    ob.parent = root
    return ob


def palm(root, x, y, h=2.6, name="palm"):
    p = empty(name, (x, y, ground(x, y) - 0.06), root)
    lean_a = random.uniform(0, math.tau)
    lean = 0.18
    z, px, py = 0, 0, 0
    segs = 4
    for i in range(segs):
        seg = h / segs
        cyl(f"{name}_t{i}", 0.17 - i * 0.022, 0.15 - i * 0.022, seg,
            (px, py, z + seg / 2), "trunk", p, segs=7,
            rot=(math.sin(lean_a) * -lean * (i / segs + 0.3), math.cos(lean_a) * lean * (i / segs + 0.3), 0))
        px += math.cos(lean_a) * lean * seg * (i / segs + 0.3)
        py += math.sin(lean_a) * lean * seg * (i / segs + 0.3)
        z += seg
    for k in range(7):
        a = k / 7 * math.tau + random.uniform(-0.15, 0.15)
        length = random.uniform(1.25, 1.65)
        bm = bmesh.new()
        n = 5
        left, right = [], []
        for s in range(n + 1):
            t = s / n
            d = t * length
            w = 0.26 * math.sin(math.pi * min(1, t * 0.92 + 0.08))
            dz = 0.35 * t - 1.05 * t * t
            cx, cy = math.cos(a) * d, math.sin(a) * d
            nx, ny = -math.sin(a) * w, math.cos(a) * w
            left.append(bm.verts.new((cx + nx, cy + ny, dz - 0.06 * w)))
            right.append(bm.verts.new((cx - nx, cy - ny, dz - 0.06 * w)))
        spine = [bm.verts.new((math.cos(a) * (s / n) * length, math.sin(a) * (s / n) * length,
                               0.35 * (s / n) - 1.05 * (s / n) ** 2 + 0.05)) for s in range(n + 1)]
        for s in range(n):
            bm.faces.new((left[s], left[s + 1], spine[s + 1], spine[s]))
            bm.faces.new((spine[s], spine[s + 1], right[s + 1], right[s]))
        finish(f"{name}_l{k}", bm, "leaf" if k % 2 else "leaf2", p, (px, py, z), (0, 0, 0))
    return p


def rock(root, x, y, r, name="rock"):
    z = ground(x, y)
    ob = ball(name, r, (x, y, z), "rock" if random.random() < 0.5 else "rock2", root, 1,
              (1, random.uniform(0.7, 1.1), random.uniform(0.55, 0.85)))
    me = ob.data
    for v in me.vertices:
        v.co += Vector((random.uniform(-.1, .1), random.uniform(-.1, .1), random.uniform(-.1, .1))) * r
    ob.rotation_euler = (0, 0, random.uniform(0, 6))
    return ob


# ---------------------------------------------------------------- stations

def station_crates(s):
    cols = {"a": "plank", "b": "wood"}
    box("pallet", (2.8, 2.4, 0.14), (0, 0, 0.07), "wood2", s, 0.02)
    layout = [(-.8, -.6, 0), (0, -.6, 0), (.8, -.6, 0), (-.8, .2, 0), (0, .2, 0), (.8, .2, 0),
              (-.8, -.6, .8), (0, -.6, .8), (-.8, .2, .8), (0, .2, .8), (.8, .2, .8), (-.4, .2, 1.6), (.4, .2, 1.6)]
    for i, (x, y, z) in enumerate(layout):
        m = cols["a"] if (i * 7) % 3 else cols["b"]
        c = box(f"crate{i}", (.76, .76, .76), (x, y, z + .52), m, s, 0.05)
        box(f"crate{i}_band", (.8, .8, .14), (0, 0, 0), "wood2", c, 0.02)


def station_lookout(s):
    h = 3.4
    for i, (x, y) in enumerate(((-.8, -.8), (.8, -.8), (-.8, .8), (.8, .8))):
        cyl(f"leg{i}", .13, .1, h, (x * .95, y * .95, h / 2), "wood2", s, segs=6, rot=(y * -.045, x * .045, 0))
    for z in (1.1, 2.2):
        for i, (x1, y1, ang) in enumerate(((0, -.8, 0), (0, .8, 0))):
            box(f"brace{z}{i}", (1.65, .09, .1), (x1, y1, z), "wood", s)
        box(f"braceb{z}", (.09, 1.65, .1), (-.8, 0, z), "wood", s)
        box(f"bracec{z}", (.09, 1.65, .1), (.8, 0, z), "wood", s)
    box("deck", (2.3, 2.3, .16), (0, 0, h), "plank", s, .03)
    for i, (x, y) in enumerate(((-1.05, -1.05), (1.05, -1.05), (-1.05, 1.05), (1.05, 1.05))):
        box(f"post{i}", (.1, .1, 1.0), (x, y, h + .55), "wood2", s)
    box("railf", (2.2, .08, .1), (0, -1.05, h + .55), "wood", s)
    box("railb", (2.2, .08, .1), (0, 1.05, h + .55), "wood", s)
    box("raill", (.08, 2.2, .1), (-1.05, 0, h + .55), "wood", s)
    box("railr", (.08, 2.2, .1), (1.05, 0, h + .55), "wood", s)
    cyl("roof", 1.9, .12, 1.0, (0, 0, h + 1.5), "brick", s, segs=4, rot=(0, 0, math.pi / 4))
    cyl("mast", .04, .04, 1.0, (0, 0, h + 2.4), "metal", s, segs=6)
    box("flag", (.7, .03, .4), (.36, 0, h + 2.68), "sun", s)
    # ladder
    for i in range(9):
        box(f"rung{i}", (.5, .07, .06), (0, -1.25, .3 + i * .36), "plank", s)
    box("rail_a", (.06, .06, 3.3), (-.25, -1.25, 1.65), "wood2", s)
    box("rail_b", (.06, .06, 3.3), (.25, -1.25, 1.65), "wood2", s)


def station_twins(s):
    # Two statues built from the same chunky shape, one the mirror of the other.
    shape = [(0, 0, 0), (0, 0, 1), (0, 0, 2), (1, 0, 2), (1, 1, 2), (0, 0, 3)]
    box("plinth", (3.6, 1.9, .24), (0, 0, .12), "rock", s, .04)
    for side, off in ((-1, -1.05), (1, 1.05)):
        for i, (x, y, z) in enumerate(shape):
            m = "stone" if (x + y + z) % 2 else "stone2"
            box(f"tw{side}_{i}", (.56, .56, .56), (off + side * x * .56, y * .56 - .1, z * .56 + .52), m, s, .04)
    cyl("mirror_stand", .07, .07, 2.4, (0, .2, 1.3), "metal", s, segs=6)
    box("mirror", (.07, .9, 2.0), (0, .2, 1.65), "f_blue", s, .02)


def station_nets(s):
    box("hall", (3.0, 2.2, 1.5), (0, .3, .75), "brick", s, .03)
    for i in range(3):
        x = -1 + i
        bm = bmesh.new()
        vs = [bm.verts.new(p) for p in ((-.5, -1.1, 0), (.5, -1.1, 0), (-.5, -1.1, .62),
                                        (-.5, 1.1, 0), (.5, 1.1, 0), (-.5, 1.1, .62))]
        bm.faces.new((vs[0], vs[1], vs[2]))
        bm.faces.new((vs[5], vs[4], vs[3]))
        bm.faces.new((vs[1], vs[4], vs[5], vs[2]))
        bm.faces.new((vs[0], vs[2], vs[5], vs[3]))
        finish(f"saw{i}", bm, "roof" if i % 2 else "brick2", s, (x, .3, 1.5), (0, 0, 0))
    cyl("chimney", .24, .18, 1.5, (1.1, 1, 2.5), "brick2", s, segs=8)
    box("door", (.8, .06, 1.0), (-.8, -.81, .5), "wood2", s, .02)
    # A giant cube net on the factory wall, and the cube it folds into on the ground.
    cells = [(1, 3, "f_red"), (0, 2, "f_blue"), (1, 2, "f_yellow"), (2, 2, "f_green"), (1, 1, "f_purple"), (1, 0, "f_orange")]
    for i, (cx, cz, m) in enumerate(cells):
        box(f"tile{i}", (.3, .05, .3), (.1 + cx * .33, -.84, .24 + cz * .33), m, s, .012)
    c = box("cube", (.6, .6, .6), (1.05, -1.5, .3), "f_yellow", s, .03)
    box("cube_f", (.45, .02, .45), (0, -.3, 0), "f_blue", c, .01)
    box("cube_s", (.02, .45, .45), (.3, 0, 0), "f_green", c, .01)
    box("cube_t", (.45, .45, .02), (0, 0, .3), "f_red", c, .01)


def station_punch(s):
    # An easel holding a folded sheet with punched holes.
    for i, x in enumerate((-1.1, 1.1)):
        box(f"easel{i}", (.13, .13, 3.2), (x, .18, 1.55), "wood", s, rot=(.12, 0, 0))
    box("easel_back", (.13, .13, 3.0), (0, .75, 1.4), "wood2", s, rot=(-.3, 0, 0))
    box("tray", (2.7, .3, .1), (0, -.08, .72), "wood", s)
    box("sheet", (2.3, .04, 2.3), (0, 0, 1.9), "paper", s, rot=(.12, 0, 0))
    box("fold_v", (.015, .05, 2.28), (0, -.008, 1.9), "rock", s, rot=(.12, 0, 0))
    box("fold_h", (2.28, .05, .015), (0, -.008, 1.9), "rock", s, rot=(.12, 0, 0))
    for i, (x, z) in enumerate(((-.58, .58), (.58, .58), (-.58, -.58), (.58, -.58))):
        tilt = .12
        cyl(f"holep{i}", .19, .19, .05, (x, -.03 - z * math.sin(tilt), 1.9 + z * math.cos(tilt)),
            "hole", s, segs=20, rot=(math.pi / 2 + tilt, 0, 0))
    # A giant punch
    box("punch_base", (1.1, .8, .16), (1.75, -.9, .08), "metal", s, .03)
    box("punch_arm", (.2, .2, .7), (1.75, -.65, .5), "roof", s, .03)
    box("punch_lever", (.24, 1.1, .16), (1.75, -.95, .92), "f_red", s, .03, rot=(-.22, 0, 0))
    cyl("punch_rod", .13, .13, .35, (1.75, -1.22, .42), "metal", s, segs=12)


def station_paint(s):
    cyl("bucket", .92, 1.12, 1.4, (0, 0, .7), "bucket", s, segs=20)
    cyl("paint_top", 1.08, 1.08, .06, (0, 0, 1.36), "paint", s, segs=20)
    cyl("rim", 1.15, 1.15, .1, (0, 0, 1.38), "metal", s, segs=20)
    for i, (a, l) in enumerate(((.4, .9), (1.3, .5), (2.5, 1.05), (3.6, .7), (4.6, .95), (5.5, .55))):
        r = 1.1
        box(f"drip{i}", (.24, .05, l), (math.cos(a) * r, math.sin(a) * r, 1.38 - l / 2), "paint", s, .02,
            rot=(0, 0, a + math.pi / 2))
    # A crane dipping a block in.
    box("crane_foot", (.7, .7, .14), (-1.7, .7, .07), "wood2", s, .02)
    box("crane_mast", (.2, .2, 3.1), (-1.7, .7, 1.6), "wood", s, .02)
    box("crane_arm", (2.1, .16, .16), (-.75, .35, 3.1), "wood", s, .02, rot=(0, 0, -.33))
    cyl("crane_rope", .025, .025, .9, (.1, .05, 2.65), "wood2", s, segs=5)
    c = box("dipblock", (.84, .84, .84), (.1, .05, 1.88), "plank", s, .04)
    box("dipblock_paint", (.88, .88, .44), (0, 0, -.22), "paint", c, .03)


STATIONS = {
    "crates": (station_crates, 240, 6.5),
    "twins": (station_twins, 300, 6.8),
    "nets": (station_nets, 0, 6.8),
    "lookout": (station_lookout, 62, 6.2),
    "punch": (station_punch, 120, 6.6),
    "paint": (station_paint, 180, 6.8),
}


def build_island():
    root = empty("island")
    build_terrain(root)
    stations = {}
    for name, (fn, deg, r) in STATIONS.items():
        a = math.radians(deg)
        x, y = r * math.cos(a), r * math.sin(a)
        s = empty(f"station_{name}", (x, y, ground(x, y) - 0.04), root)
        if name in ("nets", "paint"):
            s.rotation_euler = (0, 0, math.radians(-14 if name == "nets" else 14))
        fn(s)
        stations[name] = s
    pal_spots = [(-3.0, -2.2), (2.4, -2.6), (-1.2, 3.0), (9.2, -3.8), (-9.0, 3.6), (-8.9, -3.9), (0.4, 8.8),
                 (9.3, 3.8), (-3.6, 8.3), (0.4, -8.9), (4.1, -7.6)]
    for i, (x, y) in enumerate(pal_spots):
        palm(root, x, y, random.uniform(2.0, 3.0), f"palm{i}")
    for i, (x, y, r) in enumerate([(-1, -9.8, .45), (5.2, -8.8, .35), (10.5, -.8, .55), (-10.3, -1.2, .5),
                                   (3.9, 9.5, .6), (-6.8, 8.2, .4), (1.4, .4, .4), (-1.0, -.6, .3), (-5.6, -9.2, .55)]):
        rock(root, x, y, r, f"rock{i}")
    # A flag on the summit is where every session starts.
    tz = ground(0, 0)
    summit = empty("summit", (0, 0, tz), root)
    cyl("summit_pad", .95, 1.1, .2, (0, 0, .08), "stone", summit, segs=8)
    # Pier
    pier = empty("pier", (0, 0, 0), root)
    px, py = -2.6, -11.0
    for i in range(6):
        box(f"plank{i}", (1.3, .34, .08), (px + 0.0, py - i * .42 + 1.5, .36), "plank", pier, .01)
    for i, (dx, dy) in enumerate(((-.6, 0), (.6, 0), (-.6, -2.2), (.6, -2.2))):
        cyl(f"pile{i}", .08, .08, 1.5, (px + dx, py + 1.2 + dy, -.25), "wood2", pier, segs=6)
    return root, stations


# ---------------------------------------------------------------- Cubit the robot

def build_cubit(pose="neutral"):
    root = empty(f"cubit_{pose}")
    body = empty("body", (0, 0, .52), root)
    box("torso", (.86, .78, .78), (0, 0, 0), "robot", body, .1)
    box("plate", (.62, .03, .46), (0, -.39, .03), "screen", body, .04)
    box("belly", (.5, .02, .1), (0, -.39, -.3), "robot2", body, .01)
    # Eyes live on their own node so the game can blink them.
    eyes = empty("eyes", (0, -.41, .05), body)
    if pose == "happy":
        for sx in (-1, 1):
            for k, (dx, dz, rz) in enumerate(((-.05, 0, -.75), (.05, 0, .75))):
                box(f"eye{sx}{k}", (.12, .02, .035), (sx * .15 + dx, 0, dz), "eye", eyes, rot=(0, rz, 0))
        box("smile_l", (.09, .02, .03), (-.04, 0, -.14), "eye", eyes, rot=(0, .45, 0))
        box("smile_r", (.09, .02, .03), (.04, 0, -.14), "eye", eyes, rot=(0, -.45, 0))
    elif pose == "oops":
        for sx in (-1, 1):
            ball(f"eye{sx}", .068, (sx * .15, 0, -.01), "eye", eyes, 2, (1, .4, 1), smooth=True)
        box("mouth", (.12, .02, .025), (0, 0, -.13), "eye", eyes, rot=(0, .1, 0))
    else:
        for sx in (-1, 1):
            ball(f"eye{sx}", .08, (sx * .15, 0, 0), "eye", eyes, 2, (1, .4, 1.15), smooth=True)
        if pose == "think":
            box("mouth", (.1, .02, .024), (.03, 0, -.13), "eye", eyes)
    ant = empty("antenna", (0, 0, .4), body)
    cyl("ant_rod", .022, .022, .22, (0, 0, .1), "metal", ant, segs=6)
    ball("ant_ball", .07, (0, 0, .25), "sun" if pose != "oops" else "flag", ant, 2, smooth=True)
    poses = {"neutral": (.15, -.15), "happy": (2.15, -2.15), "think": (2.2, -.2), "oops": (.35, -.35)}
    left, right = poses.get(pose, poses["neutral"])
    arm_l = empty("arm_L", (-.48, 0, .12), body)
    arm_r = empty("arm_R", (.48, 0, .12), body)
    arm_l.rotation_euler = (0, -left if pose != "think" else -.2, 0)
    arm_r.rotation_euler = (0, -right if pose != "think" else 2.5, 0)
    box("arm_L_m", (.13, .13, .4), (0, 0, -.18), "robot2", arm_l, .03)
    box("arm_R_m", (.13, .13, .4), (0, 0, -.18), "robot2", arm_r, .03)
    ball("hand_L", .09, (0, 0, -.4), "sun", arm_l, 1)
    ball("hand_R", .09, (0, 0, -.4), "sun", arm_r, 1)
    for sx, n in ((-1, "foot_L"), (1, "foot_R")):
        box(n, (.26, .32, .12), (sx * .22, -.03, .06), "robot2", root, .03)
    if pose == "think":
        body.rotation_euler = (0, -.08, 0)
    if pose == "oops":
        body.rotation_euler = (0, .12, 0)
    return root


def build_crate():
    root = empty("crate")
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=.96)
    bmesh.ops.bevel(bm, geom=bm.edges[:], offset=.045, segments=1, profile=.5, affect="EDGES", clamp_overlap=True)
    bm.normal_update()
    large = [f for f in bm.faces if f.calc_area() > .5]
    res = bmesh.ops.inset_individual(bm, faces=large, thickness=.1, depth=-.03)
    panel = set(large)
    frame_bm = bm.copy()
    for f in list(bm.faces):
        if f not in panel:
            pass
    # Split the panels from the frame so the game can colour them separately.
    panel_idx = {f.index for f in large}
    bm.faces.ensure_lookup_table()
    frame_bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f not in panel], context="FACES_KEEP_BOUNDARY")
    bmesh.ops.delete(frame_bm, geom=[frame_bm.faces[i] for i in panel_idx], context="FACES_KEEP_BOUNDARY")
    finish("panel", bm, "crate_panel", root, (0, 0, 0), (0, 0, 0))
    finish("frame", frame_bm, "crate_frame", root, (0, 0, 0), (0, 0, 0))
    return root


# ---------------------------------------------------------------- rendering

def world(top="7FC8EE", low="F9E9C2", strength=1.0):
    w = bpy.data.worlds.new("sky")
    w.use_nodes = True
    nt = w.node_tree
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    nt.links.new(tc.outputs["Generated"], sep.inputs[0])
    nt.links.new(sep.outputs["Z"], ramp.inputs[0])
    to = lambda h: (*[linear(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)], 1)
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = to(low)
    ramp.color_ramp.elements[1].position = 0.32
    ramp.color_ramp.elements[1].color = to(top)
    nt.links.new(ramp.outputs[0], nt.nodes["Background"].inputs[0])
    nt.nodes["Background"].inputs[1].default_value = strength
    return w


def sea_material():
    m = bpy.data.materials.new("sea")
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = .28
    tc = nt.nodes.new("ShaderNodeTexCoord")
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = .55
    noise.inputs["Detail"].default_value = 5
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = .28
    nt.links.new(tc.outputs["Object"], noise.inputs["Vector"])
    nt.links.new(noise.outputs[0], bump.inputs["Height"])
    nt.links.new(bump.outputs[0], b.inputs["Normal"])
    # Shallow water close to the shore, deep water further out.
    dist = nt.nodes.new("ShaderNodeVectorMath")
    dist.operation = "LENGTH"
    nt.links.new(tc.outputs["Object"], dist.inputs[0])
    ramp = nt.nodes.new("ShaderNodeMapRange")
    ramp.inputs["From Min"].default_value = 10
    ramp.inputs["From Max"].default_value = 20
    nt.links.new(dist.outputs["Value"], ramp.inputs["Value"])
    cr = nt.nodes.new("ShaderNodeValToRGB")
    cr.color_ramp.elements[0].color = (.15, .78, .72, 1)
    cr.color_ramp.elements[1].color = (.012, .24, .42, 1)
    nt.links.new(ramp.outputs[0], cr.inputs[0])
    nt.links.new(cr.outputs[0], b.inputs["Base Color"])
    return m


def setup_render(scene):
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.use_denoising = True
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.max_bounces = 5
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.render.image_settings.compression = 90


def add_camera():
    cam = bpy.data.cameras.new("cam")
    ob = bpy.data.objects.new("cam", cam)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.scene.camera = ob
    return ob


def aim(cam, loc, target, lens):
    cam.location = loc
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = lens


def show_only(objects, keep):
    keep_set = set(keep)
    for ob in objects:
        ob.hide_render = ob not in keep_set


def render(scene, path, w, h, samples, transparent, fmt="PNG"):
    scene.render.resolution_x, scene.render.resolution_y = (w // 2, h // 2) if QUICK else (w, h)
    scene.render.resolution_percentage = 100
    scene.cycles.samples = 12 if QUICK else samples
    scene.render.film_transparent = transparent
    scene.render.image_settings.file_format = fmt
    if fmt == "PNG":
        scene.render.image_settings.color_mode = "RGBA"
    else:
        scene.render.image_settings.color_mode = "RGB"
        scene.render.image_settings.quality = 82
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("WROTE", path, flush=True)


def export_glb(root, path):
    bpy.ops.object.select_all(action="DESELECT")
    for ob in tree_of(root):
        ob.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True,
                              export_yup=True, export_cameras=False, export_lights=False,
                              export_animations=False, export_materials="EXPORT")
    print("WROTE", path, os.path.getsize(path), flush=True)


def main():
    scene = bpy.context.scene
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob)
    palette()
    setup_render(scene)
    scene.world = world()

    island, stations = build_island()
    crate = build_crate()
    cubit_export = build_cubit("neutral")

    bpy.context.view_layer.update()
    export_glb(island, os.path.join(OUT, "island.glb"))
    export_glb(cubit_export, os.path.join(OUT, "cubit.glb"))
    export_glb(crate, os.path.join(OUT, "crate.glb"))

    sun_data = bpy.data.lights.new("sun", "SUN")
    sun_data.energy = 3.4
    sun_data.angle = math.radians(6)
    sun_data.color = (1, .93, .8)
    sun = bpy.data.objects.new("sun", sun_data)
    scene.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(52), 0, math.radians(-38))
    cam = add_camera()
    lights = [sun, cam]

    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=300)
    sea = finish("sea", bm, sea_material(), None, (0, 0, 0), (0, 0, 0))

    # The hero shot: Cubit on the beach in front of the whole island.
    hero = build_cubit("happy")
    hero.location = (1.5, -9.8, ground(1.5, -9.8) - .02)
    hero.scale = (1.5, 1.5, 1.5)
    hero.rotation_euler = (0, 0, math.radians(-12))
    bpy.context.view_layer.update()
    everything = list(bpy.data.objects)
    show_only(everything, tree_of(island) + tree_of(hero) + [sea] + lights)
    aim(cam, (3.5, -27, 12.5), (0, -1.2, 1.1), 36)
    render(scene, os.path.join(OUT, "title.jpg"), 1600, 900, 96, False, "JPEG")

    # Badges: each station as a little diorama on a clear background.
    for name, s in stations.items():
        pad = cyl(f"pad_{name}", 2.5, 2.2, .42, (s.location.x, s.location.y, s.location.z - .22), "grass", None, segs=14)
        bpy.context.view_layer.update()
        everything = list(bpy.data.objects)
        show_only(everything, tree_of(s) + [pad] + lights)
        heights = {"lookout": 6.3, "nets": 3.2, "twins": 3, "crates": 2.4, "punch": 3.4, "paint": 3.4}
        h = heights[name]
        target = Vector((s.location.x, s.location.y, s.location.z + h * .42))
        dist = max(h * 1.9, 8.2)
        loc = target + Vector((dist * .44, -dist * .8, dist * .5))
        aim(cam, loc, target, 46)
        render(scene, os.path.join(OUT, f"badge_{name}.png"), 300, 300, 48, True)
        bpy.data.objects.remove(pad)

    # Cubit's faces, used next to feedback.
    for pose in ("happy", "think", "oops", "neutral"):
        c = build_cubit(pose)
        bpy.context.view_layer.update()
        everything = list(bpy.data.objects)
        show_only(everything, tree_of(c) + lights)
        aim(cam, (1.0, -3.7, 1.55), (0, 0, .62 if pose != "happy" else .74), 72)
        render(scene, os.path.join(OUT, f"cubit_{pose}.png"), 280, 280, 48, True)
        for ob in tree_of(c):
            bpy.data.objects.remove(ob)
    print("DONE", flush=True)


main()
