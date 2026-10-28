# MotionBricks G1

Real-time generative motion in threepipe with [NVIDIA MotionBricks](https://github.com/NVlabs/motionbricks) ([paper](https://arxiv.org/abs/2604.24833)).
The Unitree G1 model runs in the browser with ONNX Runtime Web (WebAssembly), in a Web Worker so it never stalls the frames.
Click the floor and the robot walks or runs there, or drive it with WASD or the arrow keys (relative to the camera, Shift to run). Every frame of motion comes from the model; there are no animation clips at runtime.

The scene is lit by an HDR environment, a warm key light with soft shadows and a cool rim light, with the webgi plugins for screen-space reflections, screen-space GI, contact shadows, temporal AA (with a velocity buffer for the moving robot) and a light bloom. The Effects button, or `?fx=0`, turns them off for slower GPUs.

## How it works

MotionBricks fills in the motion between four recent poses (the context) and one to four target poses, choosing a duration of 6 to 16 tokens (0.6 to 1.9 s at 30 Hz).
Longer motion comes from chaining generations.

| File | Role |
| --- | --- |
| `MotionBricksG1.ts` | The engine. Port of the reference runtime (`motionbricks/model/unitree_g1`): aligns the inputs to the last context pose, decodes the output into world space, smooths the root, and corrects the endpoints. It has no threepipe dependency. |
| `G1Controller.ts` | Point-to-point locomotion. While far from the goal it places a gait target one second of travel ahead; near the goal it places a standing target on it. The next segment is generated ahead of time from frames that are already planned, so it takes over without a jump. |
| `G1Bricks.ts` | The standing pose and four-frame walk and run targets, baked by `tools/make_bricks.py`. |
| `G1Robot.ts` | Builds the robot from NVIDIA's MuJoCo description (MJCF) and STL meshes, and applies a pose: root transform plus 29 joint angles. |
| `script.ts` | Viewer, lighting and render plugins, floor picking, WASD driving, camera follow, and UI. |

The engine's output matches NVIDIA's reference runtime (checked against a NumPy port, `tools/motionbricks_ref.py`, to within 0.001 degrees on the same ONNX file).

## Model sources

By default the example streams the original `mmm_v6_g1_fp32.onnx` (730 MB) and the robot from NVIDIA's GitHub LFS. Override them with URL parameters:

- `?model=<url>` an original MotionBricks G1 `.onnx` file, or a folder (ending in `/`) with a pack from `tools/pack_model.py`
- `?robot=<url>` the G1 MJCF file; meshes resolve against its `meshdir`
- `?backend=webgpu` to try ONNX Runtime's WebGPU backend. With onnxruntime-web 1.30 it computes this model wrongly (the robot sinks, sprints, or walks away from its goal), so WebAssembly is the default
- `?worker=0` to run the model on the page instead of a worker, which stalls rendering during each generation
- `?environment=<url>` the HDR environment map
- `?fx=0` to start with the screen-space effects off

Pages can set the same keys, plus `ort` and `wasm`, on `window.MOTIONBRICKS_CONFIG`.

`tools/pack_model.py` shrinks the model to about 190 MB: large weights become int8 with an fp16 scale per 64 values, and the browser expands them back to fp32 external data before creating the session. It also stores a DOUBLE constant as FLOAT, because the WebGPU build of ONNX Runtime Web has no CPU kernel to cast it. 8-bit weights change some of the model's discrete token choices, so the motion differs from fp32 (as fp16 and TF32 also do), but it stays plausible.

```bash
pip install onnx onnxruntime numpy scipy
python tools/pack_model.py mmm_v6_g1_fp32.onnx pack/
```

## Performance

A generation takes about 0.2 to 0.6 s on one WebAssembly thread, depending on the CPU. It runs in `MotionBricksWorker.ts`, and the controller starts each one ahead of playback, so the robot never waits. On the page's own thread the same work would freeze rendering mid-stride on every generation, which reads as a limp. The model needs about 1.5 GB of memory while the session is created, so this is a desktop demo.

## Licenses

- MotionBricks code: Apache 2.0. The ONNX models: [NVIDIA Open Model Agreement](https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-agreement/).
- The G1 description and meshes keep their own license (see the MotionBricks repository's `licenses` folder).
- `tools/make_bricks.py` seeds the gaits with NVIDIA's sample clips, which are under the NVIDIA Sample Data Evaluation License. The values in `G1Bricks.ts` are the model's own output after several chained generations, and no clip data ships with this example.
