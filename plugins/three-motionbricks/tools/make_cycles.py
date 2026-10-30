"""Bake the stride cycles in G1Bricks.ts (G1_BRICKS.cycles) from a recording of the controller.

G1Controller takes each gait target from a stride cycle, at the point of the stride the robot will reach, so the
model never squeezes a step to fit the target. A cycle with a limp in it would teach the limp back, so this makes
it exactly symmetric: it finds the steady stride whose end joins its start best, warps it so the other foot lands
at half the stride, and averages it with its mirror image shifted by half a stride.

The recording is a JSON array of poses at 30 Hz (root XYZ, root XYZW quaternion, 29 joint angles) of the robot
walking or running straight for 15 s or more, such as G1Controller.pose sampled every frame. The shipped cycles
come from two rounds: a run with cycles cut from NVIDIA's sample clips, then a run with cycles from that output.

    pip install numpy
    python make_cycles.py g1_29dof_rev_1_0.xml run.json 18 run_cycle.json
    python make_cycles.py g1_29dof_rev_1_0.xml walk.json 32 walk_cycle.json

The third argument is the stride length in frames (an even number): 18 for the run, 32 for the walk.
"""
import json, sys
import xml.etree.ElementTree as ET
import numpy as np

JOINTS = ['left_hip_pitch', 'left_hip_roll', 'left_hip_yaw', 'left_knee', 'left_ankle_pitch', 'left_ankle_roll',
          'right_hip_pitch', 'right_hip_roll', 'right_hip_yaw', 'right_knee', 'right_ankle_pitch', 'right_ankle_roll',
          'waist_yaw', 'waist_roll', 'waist_pitch',
          'left_shoulder_pitch', 'left_shoulder_roll', 'left_shoulder_yaw', 'left_elbow', 'left_wrist_roll', 'left_wrist_pitch', 'left_wrist_yaw',
          'right_shoulder_pitch', 'right_shoulder_roll', 'right_shoulder_yaw', 'right_elbow', 'right_wrist_roll', 'right_wrist_pitch', 'right_wrist_yaw']
SWAP = [JOINTS.index(n.replace('left_', 'right_') if n.startswith('left_') else n.replace('right_', 'left_')) for n in JOINTS]
SIGN = np.array([-1.0 if ('roll' in n or 'yaw' in n) else 1.0 for n in JOINTS])
SOLE = [[-0.05, 0.025, -0.035], [-0.05, -0.025, -0.035], [0.12, 0.03, -0.035], [0.12, -0.03, -0.035]]


def qmul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return np.array([aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx,
                     aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz])


def qrot(q, v):
    u, w = np.asarray(q[:3]), q[3]
    return 2 * np.dot(u, v) * u + (w * w - np.dot(u, u)) * np.asarray(v) + 2 * w * np.cross(u, v)


def qaxis(axis, angle):
    return np.r_[np.asarray(axis) * np.sin(angle / 2), np.cos(angle / 2)]


def norm(q):
    return q / np.linalg.norm(q)


def mirror(p):
    """The pose reflected in the robot's XZ plane: left and right swap."""
    m = p.copy()
    m[1] = -p[1]
    m[3:7] = [-p[3], p[4], -p[5], p[6]]
    m[7:] = p[7:][SWAP] * SIGN
    return m


class Soles:
    """Sole corners of both feet, from the MJCF."""

    def __init__(self, mjcf):
        self.root = ET.parse(mjcf).getroot().find('worldbody').find('body')

    def __call__(self, p):
        ends = {}

        def walk(body, q, pos):
            pos = pos + qrot(q, [float(v) for v in body.get('pos', '0 0 0').split()])
            w, x, y, z = [float(v) for v in body.get('quat', '1 0 0 0').split()]
            q = qmul(q, [x, y, z, w])
            joint = body.find('joint')
            if joint is not None and joint.get('type') != 'free':
                q = qmul(q, qaxis([float(v) for v in joint.get('axis').split()], p[7 + JOINTS.index(joint.get('name')[:-6])]))
            if body.get('name') in ('left_ankle_roll_link', 'right_ankle_roll_link'):
                ends[body.get('name')] = [pos + qrot(q, c) for c in SOLE]
            for child in body.findall('body'):
                walk(child, q, pos)

        for child in self.root.findall('body'):
            walk(child, norm(p[3:7]), np.asarray(p[:3]))
        return np.array(ends['left_ankle_roll_link'] + ends['right_ankle_roll_link'])


def footfalls(q, soles, skip=0):
    """(frame, foot) of each footfall after the first `skip` frames, foot 0 left and 1 right, in order."""
    s = np.array([soles(p) for p in q])
    low = s[:, :, 2].reshape(len(q), 2, 4).min(2)
    events = []
    for foot in range(2):
        down = low[:, foot] < np.percentile(low[:, foot], 10) + 0.02
        events += [(i, foot) for i in range(max(1, skip + 1), len(q)) if down[i] and not down[i - 1]]
    return sorted(events)


def best_stride(q, soles):
    """
    The stride, footfall to the same foot's next, whose last frame joins its first best and whose two steps are
    closest to even, at the origin along +X.
    """
    # The first 1.5 s start from standing.
    events = footfalls(q, soles, 45)
    strides = []
    for i, (a, foot) in enumerate(events):
        later = [e for e in events[i + 1:] if e[1] == foot]
        between = [e for e in events if a < e[0] < (later[0][0] if later else 0) and e[1] != foot]
        if later and len(between) == 1:
            b = later[0][0]
            split = (between[0][0] - a) / (b - a)
            strides.append((np.abs(q[b][7:19] - q[a][7:19]).max() + abs(split - 0.5), a, b))
    _, a, b = min(strides)
    stride = q[a:b + 1].copy()
    d = stride[-1, :2] - stride[0, :2]
    turn = qaxis([0, 0, 1], -np.arctan2(d[1], d[0]))
    for f in stride:
        f[:2] = qrot(turn, [f[0] - q[a, 0], f[1] - q[a, 1], 0])[:2]
        f[3:7] = norm(qmul(turn, f[3:7]))
    return stride


def symmetric(stride, soles, n):
    """Warp so the other foot lands at half the stride, then average with the mirror image half a stride on."""
    travel = stride[-1, :2] - stride[0, :2]
    m = len(stride) - 1
    events = footfalls(np.concatenate([stride[:-1] + np.r_[k * travel, np.zeros(stride.shape[1] - 2)] for k in range(3)]), soles)
    first = events[0]
    other = next(e[0] for e in events if e[1] != first[1] and e[0] > first[0])

    def sample(t):  # fractional frame of the stride, continuing into the next one
        k, r = divmod(t, m)
        i = int(r)
        p = stride[i] * (1 - (r - i)) + stride[i + 1] * (r - i)
        p[:2] += k * travel
        p[3:7] = norm(p[3:7])
        return p

    h = n // 2
    split = (other - first[0]) / m
    warped = np.array([sample(first[0] + (split * t / h if t < h else split + (1 - split) * (t - h) / h) * m) for t in range(n + 1)])
    warped[:, :2] -= warped[0, :2]
    step = warped[n, :2].copy()

    def at(t):
        k, r = divmod(t, n)
        p = warped[r].copy()
        p[:2] += k * step
        return p

    out = []
    for t in range(n):
        a, b = at(t), mirror(at(t + h))
        b[:2] -= mirror(at(h))[:2]
        p = (a + b) / 2
        p[3:7] = norm(p[3:7])
        out.append(p)
    out = np.array(out)
    out[:, 1] -= out[:, 1].mean()
    return out, np.array([step[0], 0.0])


def main():
    mjcf, recording, n, out = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
    soles = Soles(mjcf)
    q = np.array(json.load(open(recording)), dtype=float)
    frames, travel = symmetric(best_stride(q, soles), soles, n)
    print(f'{n} frames ({n / 30:.2f} s), {travel[0] / n * 30:.2f} m/s, mirror error {np.abs(mirror(frames[n // 2])[7:] - frames[0][7:]).max():.5f}')
    json.dump({'travel': np.round(travel, 5).tolist(), 'frames': np.round(frames, 5).tolist()}, open(out, 'w'))


if __name__ == '__main__':
    main()
