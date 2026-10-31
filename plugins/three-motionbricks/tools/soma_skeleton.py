"""Extract the SOMA runtime skeleton from NVIDIA's soma_base_skel_minimal_no_root.usd: joint names, parents and
rest (local) transforms in metres, for motionbricks_soma_ref.py and src/SOMASkeleton.ts.

    pip install usd-core numpy scipy
    python soma_skeleton.py soma_base_skel_minimal_no_root.usd soma_skeleton.json
"""
import json, sys, numpy as np
from pxr import Usd, UsdSkel, UsdGeom
from scipy.spatial.transform import Rotation as R
stage = Usd.Stage.Open(sys.argv[1])
skel = UsdSkel.Skeleton(stage.GetPrimAtPath('/OUTPUT/c_skeleton_grp/Hips'))
paths = [str(p) for p in skel.GetJointsAttr().Get()]
rest = skel.GetRestTransformsAttr().Get()
mpu = UsdGeom.GetStageMetersPerUnit(stage)
print('joints', len(paths), 'metersPerUnit', mpu, 'up', UsdGeom.GetStageUpAxis(stage))
names = [p.rsplit('/', 1)[-1] for p in paths]
index = {p: i for i, p in enumerate(paths)}
parents = [index.get(p.rsplit('/', 1)[0], -1) if '/' in p else -1 for p in paths]
local = []
for m in rest:
    m = np.array(m, float)  # row-major, translation in the last row
    rot = m[:3, :3]; t = m[3, :3] * mpu
    q = R.from_matrix(rot.T).as_quat()  # USD row vectors: the matrix acts on the right
    local.append([*t, *q])
json.dump({'names': names, 'parents': parents, 'local': np.round(local, 7).tolist()}, open(sys.argv[2], 'w'))
print(names[:12], parents[:12])
print('Hips', np.round(local[0], 4), 'LeftLeg', np.round(local[names.index('LeftLeg')], 4) if 'LeftLeg' in names else None)
