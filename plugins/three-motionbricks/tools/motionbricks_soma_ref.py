"""NumPy reference for MotionBricks SOMA, ported from NVIDIA's motionbricks/model/soma/kernels.py and engine.py, which
src/MotionBricksSOMA.ts was checked against (to 0.005 mm and 0.05 degrees).

A pose is (J, 7): per joint of the 77-joint runtime skeleton, the local position xyz and quaternion xyzw (Hips
first, in SOMA model space: Y up, metres).
"""
import json, numpy as np, onnxruntime as ort
from scipy.spatial.transform import Rotation as R

MODEL_JOINTS = ['Hips', 'Spine1', 'Spine2', 'Chest', 'Neck1', 'Neck2', 'Head', 'Jaw', 'LeftEye', 'RightEye',
                'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'LeftHandThumbEnd', 'LeftHandMiddleEnd',
                'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'RightHandThumbEnd', 'RightHandMiddleEnd',
                'LeftLeg', 'LeftShin', 'LeftFoot', 'LeftToeBase', 'RightLeg', 'RightShin', 'RightFoot', 'RightToeBase']
FPS, PPT, BOUNDARY = 30, 4, 3


def qmul(a, b):
    ax, ay, az, aw = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    bx, by, bz, bw = b[..., 0], b[..., 1], b[..., 2], b[..., 3]
    return np.stack([aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx,
                     aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz], -1)


def qinv(q): return q * np.array([-1, -1, -1, 1.0])
def qnorm(q): return q / np.linalg.norm(q, axis=-1, keepdims=True)


def qrot(q, v):
    u, w = q[..., :3], q[..., 3:4]
    return 2 * np.sum(u * v, -1, keepdims=True) * u + (w * w - np.sum(u * u, -1, keepdims=True)) * v + 2 * w * np.cross(u, v)


def tmul(a, b):  # transforms as (..., 7)
    return np.concatenate([qrot(a[..., 3:], b[..., :3]) + a[..., :3], qnorm(qmul(a[..., 3:], b[..., 3:]))], -1)


def tinv(a):
    q = qinv(a[..., 3:])
    return np.concatenate([-qrot(q, a[..., :3]), q], -1)


def slerp_id(q, t):  # identity -> q by t, the short way
    q = np.where(q[..., 3:4] < 0, -q, q)
    return R.from_rotvec(R.from_quat(q).as_rotvec() * t).as_quat()


class Skeleton:
    def __init__(self, path='soma_skeleton.json'):  # from soma_skeleton.py
        d = json.load(open(path))
        self.names, self.parents, self.ref = d['names'], d['parents'], np.array(d['local'], float)
        self.J = len(self.names)
        self.model_to_pose = [self.names.index(n) for n in MODEL_JOINTS]
        self.pose_to_model = np.full(self.J, -1)
        for m, p in enumerate(self.model_to_pose):
            parent = self.parents[p]
            if parent == -1 or self.pose_to_model[parent] >= 0:
                self.pose_to_model[p] = m
        self.right_leg, self.left_leg = self.names.index('RightLeg'), self.names.index('LeftLeg')

    def world(self, local):  # (..., J, 7)
        out = np.empty_like(local)
        for j in range(self.J):
            p = self.parents[j]
            out[..., j, :] = local[..., j, :] if p < 0 else tmul(out[..., p, :], local[..., j, :])
        return out


def heading(right, left):
    across = np.array([right[0] - left[0], 0, right[2] - left[2]])
    l = np.linalg.norm(across)
    if l <= 1e-6: return 0.0
    across /= l
    fwd = np.cross([0, 1, 0], across)
    return np.arctan2(fwd[0], fwd[2])


def rot6d(x, y):
    x = x / np.linalg.norm(x); z = np.cross(x, y); z /= np.linalg.norm(z); y = np.cross(z, x)
    return R.from_matrix(np.stack([x, y, z], 1)).as_quat()


class Engine:
    def __init__(self, onnx_path, skel=None, threads=4):
        so = ort.SessionOptions(); so.intra_op_num_threads = threads
        self.s = ort.InferenceSession(onnx_path, so, providers=['CPUExecutionProvider'])
        self.k = skel or Skeleton()

    def encode(self, context, targets):
        k = self.k
        nt = len(targets)
        guide = np.concatenate([context, targets, np.repeat(targets[-1:], 4 - nt, 0)])  # (8, J, 7)
        W = k.world(guide)
        hips = W[3, 0, :3]
        cur = heading(W[3, k.right_leg, :3], W[3, k.left_leg, :3])
        desired = np.arctan2(1.0, 0.0)
        align = np.array([hips[0], 0, hips[2], *R.from_rotvec([0, cur - desired, 0]).as_quat()])
        ainv = tinv(align)
        A = tmul(ainv, W)  # aligned world transforms
        g = np.zeros((1, 8, 5), np.float32); l = np.zeros((1, 8, 4), np.float32); lp = np.zeros((1, 8, 267), np.float32)
        for f in range(8):
            nf = f if f == 3 else min(f + 1, 7)
            ch, nh = A[f, 0, :3], A[nf, 0, :3]
            hc = heading(A[f, k.right_leg, :3], A[f, k.left_leg, :3]); hn = heading(A[nf, k.right_leg, :3], A[nf, k.left_leg, :3])
            dh = np.arctan2(np.sin(hn - hc), np.cos(hn - hc))
            g[0, f] = [ch[0], ch[1], ch[2], np.cos(hc), np.sin(hc)]
            l[0, f] = [dh * FPS, (nh[0] - ch[0]) * FPS, (nh[2] - ch[2]) * FPS, ch[1]]
            root = np.array([ch[0], 0, ch[2]])
            for m, p in enumerate(k.model_to_pose):
                if m > 0: lp[0, f, (m - 1) * 3:(m - 1) * 3 + 3] = A[f, p, :3] - root
                q = A[f, p, 3:]
                o = 29 * 3 + m * 6
                lp[0, f, o:o + 3] = qrot(q, np.array([1.0, 0, 0])); lp[0, f, o + 3:o + 6] = qrot(q, np.array([0, 1.0, 0]))
        has = np.array([[1 if i < 4 + nt else 0 for i in range(8)]], np.int32)
        hl = has.copy(); hl[0, 3] = 0; hl[0, 4 + nt - 1] = 0
        return align, dict(global_root_values=g, has_global_root_values=has, local_root_values=l, has_local_root_values=hl, local_poses=lp, has_local_poses=has.copy())

    def generate(self, context, targets, tokens=range(6, 17), correct=True):
        k = self.k
        context = np.asarray(context, float); targets = np.asarray(targets, float)
        align, feeds = self.encode(context, targets)
        feeds['allowed_pred_num_tokens'] = np.array([[1 if 6 + i in tokens else 0 for i in range(11)]], np.int32)
        out = self.s.run(None, feeds)
        pred, ntok = out[0][0], int(out[1][0])
        raw = min(ntok * PPT, pred.shape[0]); n = max(0, raw - 2 * BOUNDARY)
        frames = np.zeros((n, k.J, 7)); contacts = np.zeros((n, 4))
        ro = 5 + 29 * 3
        for f in range(n):
            rf = BOUNDARY + f
            contacts[f] = np.clip(pred[rf, -4:], 0, 1)
            G = [rot6d(pred[rf, ro + m * 6:ro + m * 6 + 3], pred[rf, ro + m * 6 + 3:ro + m * 6 + 6]) for m in range(30)]
            frames[f, 0] = tmul(align, np.array([*pred[rf, :3], *G[0]]))
            for j in range(1, k.J):
                m = k.pose_to_model[j]
                if m < 0: frames[f, j] = k.ref[j]; continue
                pm = k.pose_to_model[k.parents[j]]
                frames[f, j] = [*k.ref[j, :3], *qnorm(qmul(qinv(G[pm]), G[m]))]
        if correct and n >= 2:
            last = n - 1
            start = np.empty((k.J, 7)); end = np.empty((k.J, 7))
            for j in range(k.J):
                if j == 0:
                    for d, gen, guide in ((start, frames[0, 0], context[3, 0]), (end, frames[last, 0], targets[0, 0])):
                        d[0] = [*(guide[:3] - gen[:3]), *qnorm(qmul(qinv(qnorm(gen[3:])), qnorm(guide[3:])))]
                else:
                    start[j] = tmul(tinv(frames[0, j]), context[3, j]); end[j] = tmul(tinv(frames[last, j]), targets[0, j])
            for f in range(n):
                we = f / (n - 1); ws = 1 - we
                r = frames[f, 0]
                q = qnorm(qmul(qmul(r[3:], slerp_id(start[0, 3:], ws)), slerp_id(end[0, 3:], we)))
                frames[f, 0] = [*(r[:3] + start[0, :3] * ws + end[0, :3] * we), *q]
                for j in range(1, k.J):
                    a = frames[f, j]
                    for d, w in ((start[j], ws), (end[j], we)):
                        a = tmul(a, np.array([*(d[:3] * w), *slerp_id(d[3:], w)]))
                    frames[f, j] = a
        return frames, contacts, ntok


def load_bvh(path, skel):
    """A BVH clip at 30 Hz as poses on the runtime skeleton: joints by name, Root dropped (it never moves)."""
    text = open(path).read()
    head, motion = text.split('MOTION')
    names, chans, offsets, stack, end = [], [], [], [], False
    for line in head.split('\n'):
        t = line.split()
        if not t: continue
        if t[0] in ('ROOT', 'JOINT'): names.append(t[1].rsplit(':', 1)[-1]); chans.append([]); offsets.append([0.0, 0, 0]); stack.append(len(names) - 1)
        elif t[0] == 'OFFSET' and not end: offsets[stack[-1]] = [float(v) * 0.01 for v in t[1:4]]
        elif t[:2] == ['End', 'Site']: end = True
        elif t[0] == 'CHANNELS': chans[stack[-1]] = t[2:]
        elif t[0] == '}':
            if end: end = False
            else: stack.pop()
    lines = motion.strip().split('\n')
    rate = round(1 / float(lines[1].split()[2]))
    data = np.array([list(map(float, l.split())) for l in lines[2:]])[::rate // FPS]
    out = np.repeat(skel.ref[None], len(data), 0)
    col = 0
    for j, (n, ch) in enumerate(zip(names, chans)):
        pi = skel.names.index(n) if n in skel.names else -1
        pos = None; rots = []
        for c in ch:
            c = c.lower()
            if c.endswith('position'):
                if pos is None: pos = np.zeros((len(data), 3))
                pos[:, 'xyz'.index(c[0])] = data[:, col] * 0.01
            else: rots.append((c[0], data[:, col]))
            col += 1
        if pi < 0: continue
        # As NVIDIA's loader: a joint without position channels keeps the file's offset.
        out[:, pi, :3] = pos if pos is not None else offsets[j]
        if rots:
            q = np.tile([0, 0, 0, 1.0], (len(data), 1))
            for axis, ang in rots:
                v = np.zeros((len(data), 3)); v[:, 'xyz'.index(axis)] = np.radians(ang)
                q = qmul(q, R.from_rotvec(v).as_quat())
            out[:, pi, 3:] = qnorm(q)
    return out
