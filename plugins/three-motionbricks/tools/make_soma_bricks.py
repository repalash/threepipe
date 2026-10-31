"""Bake the SOMA controller targets in src/SOMABricks.ts from the model's own output, seeded with NVIDIA's sample clips
(which are not shipped): a standing pose, and four frames each of a steady walk and run. Bricks stand at the ground
origin facing +X (controller angle 0, a SOMA hip heading of 90 degrees). make_soma_cycles.py adds the strides.

    python make_soma_bricks.py mmm_v6_soma_fp32.onnx soma_clips_dir soma_skeleton.json soma_bricks.json
"""
import sys, json, numpy as np
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from motionbricks_soma_ref import Engine, Skeleton, load_bvh, heading, qmul, qnorm, qrot, R
MODEL, D, SKELETON, OUT = sys.argv[1], sys.argv[2].rstrip('/') + '/', sys.argv[3], sys.argv[4]
k = Skeleton(SKELETON); e = Engine(MODEL, k)

def hips_heading(p):
    w = k.world(p); return heading(w[k.right_leg, :3], w[k.left_leg, :3])

def normalize(frames, by=0):
    """Turn and move frames so frame `by` stands at the ground origin facing +X."""
    f = np.array(frames, float)
    turn = np.pi / 2 - hips_heading(f[by]); q = R.from_rotvec([0, turn, 0]).as_quat()
    o = f[by, 0, :3].copy(); o[1] = 0
    for i in range(len(f)):
        f[i, 0, :3] = qrot(q, f[i, 0, :3] - o); f[i, 0, 3:] = qnorm(qmul(q, f[i, 0, 3:]))
    return f

def place(window, x, z, ang, speed=None):
    """A window authored at the origin facing +X, at (x, z) on the ground, turned by ang about +Y."""
    w = np.array(window, float)
    if speed:
        d = np.linalg.norm(w[-1, 0, [0, 2]] - w[0, 0, [0, 2]]) * 30 / (len(w) - 1)
        if d > 1e-3: w[:, 0, [0, 2]] = w[0, 0, [0, 2]] + (w[:, 0, [0, 2]] - w[0, 0, [0, 2]]) * speed / d
    q = R.from_rotvec([0, ang, 0]).as_quat()
    for i in range(len(w)):
        w[i, 0, :3] = qrot(q, w[i, 0, :3]) + [x, 0, z]; w[i, 0, 3:] = qnorm(qmul(q, w[i, 0, 3:]))
    return w

def speed_of(frames):
    return np.linalg.norm(frames[-1, 0, [0, 2]] - frames[0, 0, [0, 2]]) * 30 / (len(frames) - 1)

def chain(start, brick, v, steps, early=8):
    hist = list(start); played = []
    for _ in range(steps):
        c = np.array(hist[-4:])
        ang = hips_heading(c[-1]) - np.pi / 2  # keep going the way it faces... along +X here
        ang = 0.0
        x, z = c[-1, 0, 0] + v * 1.0, c[-1, 0, 2]
        o = e.generate(c, place(brick, x, z, ang, v))[0]
        for f in o[1:max(2, len(o) - early)]: hist.append(f); played.append(f)
    return np.array(played)

idle = load_bvh(D + 'idle_loop_001__A268.bvh', k)
start = normalize(idle[:4], 3)
rest = e.generate(start, start[3:4], correct=False)[0]
bricks = {'rest': normalize(rest[-1:])}
speeds = {}
for gait, clip, at in (('walk', 'Neutral_walk_forward_002__A057.bvh', 120), ('run', 'run_loop_180_R_003__A326.bvh', 24)):
    frames = load_bvh(D + clip, k)
    seed = normalize(frames[at:at + 4]); v = speed_of(frames[at - 8:at + 12])
    played = chain(start, seed, v, 8)
    brick = normalize(played[-24:-20])
    bricks[gait] = brick; speeds[gait] = round(float(v), 3)
    later = chain(start, brick, v, 10)
    w = k.world(later)
    sp = [speed_of(later[i:i + 8]) for i in range(len(later) - 8)]
    print(f'{gait}: clip speed {v:.2f} m/s; chained on its own brick: hips y {w[:, 0, 1].min():.2f}..{w[:, 0, 1].max():.2f}, speed {np.mean(sp[len(sp)//3:]):.2f}, sideways drift {abs(later[-1,0,2]-later[0,0,2]):.2f} m over {later[-1,0,0]-later[0,0,0]:.1f} m')
json.dump({'rest': bricks['rest'].reshape(1, -1).round(5).tolist(), 'walk': bricks['walk'].reshape(4, -1).round(5).tolist(), 'run': bricks['run'].reshape(4, -1).round(5).tolist(), 'speeds': speeds}, open(OUT, 'w'))
print('speeds', speeds, 'rest hips y %.3f' % bricks['rest'][0, 0, 1])
