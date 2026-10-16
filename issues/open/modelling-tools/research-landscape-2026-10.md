# Landscape sweep: LLM procedural 3D / three.js / Blender, 2026-09-10 to 2026-10-16

Compiled 2026-10-16. This picks up from the 2026-09-14 survey and does not repeat what that survey already covered. Every item has a URL. Items marked **UNVERIFIED** could not be checked against a primary source (X/Twitter posts could not be fetched, HTTP 402). Where this file says "Primary", the date or fact was confirmed from the vendor page, arXiv, the npm or PyPI registry, or GitHub commit history.

---

## Executive summary: what changed since mid-September and what it means for threepipe

1. **Claude 5.5 family released.** Opus 5.5 came out 2026-09-22, Sonnet 5.5 on 09-28 and Haiku 5.5 on 10-07. None of the three announcements mentions 3D, Blender, three.js or CAD, and no Anthropic 3D tool, connector or plugin shipped with them. Opus 5.5 costs less than Opus 5 ($4/$20 per million tokens) and runs about 30% faster, so agent-driven modelling sessions get cheaper. Haiku 5.5 is positioned as a subagent. Nothing here forces a change to threepipe's plans.
2. **Someone has already shipped a Blender geometry-nodes evaluator running in three.js.** `achrefelouafi/ProceduralBuildingsThreeJS` (MIT, about 110 stars, commits 09-24 to 09-28, one commit co-authored by "claude") exports GN graphs from `.blend` files to JSON and runs them through a shared evaluator of about 60 nodes (`src/nyc/gn.ts`). It claims Blender float32, hash and multi-input semantics. It went viral through Chiro Visuals' "Opus 5.5 ported 3 procedural buildings" post on 09-28. This is the closest prior art to threepipe's GN port, and its JSON format and hash semantics are worth comparing against ours.
3. **A second GN-in-JS effort started on 09-28: `vibegameengine/geonodes-kit`** (MIT, 0 stars, 11 commits, all co-authored by claude). It is a clean-room, spec-first reimplementation that targets the full 360-node inventory of Blender 5.2.2. It reads `.blend` files directly and verifies against Blender run headless as a black box. Its "capture reference geometry from headless Blender, compare per domain and attribute" harness is the same verification idea threepipe needs. Unlike our approach, it deliberately does not port Blender source.
4. **nodebpy is becoming the de facto text format for GN trees.** It does a Python round-trip of node trees (`to_python()`) and ships an Agent Skill and Claude Code plugin. Releases are very frequent (520.38.0 on 10-13). At the 2026-09 GN workshop, Blender developers named it the leading option for textual node-tree diffs. threepipe should consider reading and writing nodebpy-style source as the agent-facing and interchange syntax for its GN port.
5. **Blender 5.3 is in beta until 2026-11-04, with release expected around 11-10.** New GN nodes: Construct Curves, Combine List, Get Vector Component, Geometry Materials, Rasterize Points, Poisson Solver, Grid Topology Boolean, and Import SPZ / Set Point Cloud Type for Gaussian splats. Three LoopTools operators (Relax, Curve, Gstretch) are now native C++ edit-mode tools, and there is a new Quad-Sphere primitive. These are new port targets for both mesh-kernel and GN, and we need to decide whether to pin 5.2 LTS or follow 5.3.
6. **The GN workshop roadmap (published 10-05) signals structural changes threepipe's node-type system should anticipate.** These are dynamic socket types, list fields with Reduce List, Construct Mesh with list inputs, modal node tools, export nodes, viewer overlays, and C++ auto-layout. No AI items were on the agenda.
7. **The Blender MCP layer is consolidating.** `blender-mcp` was renamed to `mcp-for-blender` on 09-16 (2.1.9 on 10-06, about 31k stars) and cut down to 9 tools, including a `look` tool that renders multi-angle sheets, an X-ray view and an animation strip for self-verification. The official Blender Lab MCP is unchanged (v1.0.3, 09-11). Blender has made no new AI-policy statement since May. threepipe's command API should include an equivalent `look` / multi-view render tool.
8. **Verification with the image in the loop is now standard, and the evidence says images alone are not enough.** img2threejs (about 18k stars, active 08-31 to 10-08) gates every pass with a render-vs-reference sheet and outputs a three.js `Group` factory. The 3DCodeVerse harness runs plan, build, measurement check, VLM judge, then fix. Three papers show where images alone fall short. WorldBench (10-07) finds code-only judges miss 4 of 5 removed features. LEGO-Anything (09-28) names unreliable self-evaluation as a key failure. RealCADBench (09-03) says execution alone is not enough. For threepipe this means agents need deterministic geometry queries (bounds, topology, contacts, manifoldness) alongside renders.
9. **New benchmarks threepipe could adopt or borrow from.** EditHero (10-01) covers long-horizon, part-level 3D editing: code-editing agents beat regenerating models but take minutes per edit. WorldBench evaluates three.js worlds. 3DCodeVerse-2M (10-15) has 269k executable programs including three.js and bpy, and its harness beat "Claude Design (3D Object)" in 90% of pairwise comparisons when both ran on Opus 5.5. Other new papers: ExeWorldBench, StepCAD, ReliCAD, CADFather, LMBuild. EditHero is the best fit for evaluating an edit-mode command API.
10. **three.js has changed little for procedural geometry.** 0.186.0 shipped 09-08 and 0.186.1 on 09-24, and there is no r187 yet. Relevant changes are `compileComputeAsync`, the SunLight addon, a watertight ray-triangle intersection, and `Object3D.dispose()`. At Three.js Conf Paris (09-10/11) WebGPU was presented as the default renderer with automatic WebGL fallback. Nothing about node-based geometry was announced. Upgrade-plan impact is limited to the r186 breaking changes.
11. **WASM mesh kernels.** manifold-3d 3.5.4 shipped 09-25. trueform (Polydera, 0.10.7 on 10-12) is 12.6x faster than Manifold on browser booleans, but it is licensed PolyForm Noncommercial, so threepipe cannot depend on it without a commercial license. Searches found no other maintained TypeScript BMesh port, so `@threepipe/mesh-kernel` still appears to be unique.
12. **Agent-tool packaging has converged on a single pattern:** a JSON document or command API, a CLI whose verbs each return one JSON object, a SKILL.md, and a Claude Code plugin. Examples are glb-buildings-skill, agentcad, nodebpy and threejs-skills.com. No new code-based procedural 3D startup launched in the window (Spline V2 and Plamo date from August), and no web modeller with an agent API launched. threepipe's opening, a web BMesh editor with a command API, still looks uncontested.

---

## 1. Claude Opus 5.5 / Sonnet 5.5 / Haiku 5.5 / Fable 5.1

| Item | Date | What | Why it matters to threepipe |
|---|---|---|---|
| [Claude Opus 5.5 announcement](https://www.anthropic.com/news/claude-opus-5-5) | 2026-09-22 (Primary) | Anthropic says it performs at Fable 5.1 level on most work, at $4/$20 per million tokens, generates more than 30% faster than Opus 5, and ships with Fable-5.1-class safeguards. The announcement has **no mention** of 3D, Blender, three.js, CAD or procedural generation, and no new tools or connectors launched with it. | Cheaper and faster agent loops for edit-mode and GN agents. No official 3D surface to integrate with. |
| [Claude Sonnet 5.5 announcement](https://www.anthropic.com/news/claude-sonnet-5-5) | 2026-09-28 (Primary) | $2/$10, Terminal-Bench 4.0 at 70.6%, "sharp eye for design". No 3D mentions. | Probably the best price/performance model for running the command-API agent. |
| [Claude Haiku 5.5 announcement](https://www.anthropic.com/news/claude-haiku-5-5) | 2026-10-07 (Primary) | About 75% cheaper than Haiku 4.5, first Haiku with an effort setting, pitched as a subagent. Sonnet 5.5 cache-read price halved. No 3D mentions. | Candidate for cheap verification and judge subagents. |
| Fable 5.1 | 2026-09-01 per [OrcaRouter](https://www.orcarouter.ai/sv/blog/claude-fable-5-1-opus-5-1-delay-leak) / [Emergent](https://emergent.sh/news/claude-fable-5-1-release-date) | Released before the window; mentioned for context only. Rumours of a "Fable 5.5" have not been confirmed by Anthropic as of 10-14 ([OrcaRouter](https://orcarouter.ai/blog/claude-fable-5-5-this-week-leak)). **UNVERIFIED (secondary sources)** | Not relevant. |
| Alex Albert (Anthropic): "Opus 5.5 can use Blender to make claymations with a single prompt in claude.ai" ([X](https://x.com/alexalbert__/status/2102458348511879448)) | 2026-09-22 | Blender driven from claude.ai. The mechanism (sandbox with Blender installed, connector, or skill) is not documented anywhere I could find. **UNVERIFIED** | Suggests claude.ai's code sandbox can now run Blender headless. If so, Blender-reference workflows (GN ground truth) become reachable from claude.ai. |
| Anthropic official demos via [@claudeai](https://x.com/claudeai/status/2102471870692180179): Earthrise photo 3D camera reconstruction and a sketch-to-physics catapult | 2026-09-22 | Launch videos, per [ohmyopus](https://ohmyopus.com/en/s/three). Tooling not stated. **UNVERIFIED** | Low relevance. |
| Claude Design "3D object" skill | Leaked system prompt ([asgeirtj/system_prompts_leaks](https://github.com/asgeirtj/system_prompts_leaks/blob/main/Anthropic/claude-design/claude-design.md)); used as a named baseline "Claude Design (3D Object)" in [3DCodeVerse](https://arxiv.org/abs/2610.22341) (10-15) | A three.js model generator inside Claude Design, with OBJ/GLB download. No official Anthropic documentation found. **UNVERIFIED (existence corroborated by the arXiv paper)** | Anthropic's own three.js 3D generator exists in some form. It overlaps with threepipe-hosted generation, and its output is a single code artifact with no editable mesh. |
| Official Anthropic Claude Code plugins or skills for 3D | – | **Search came back empty.** Every Blender skill found is community-made: [RobLe3/cc-blender-skill](https://github.com/RobLe3/cc-blender-skill), [ra100/blender-claude-plugin](https://github.com/ra100/blender-claude-plugin), [kevinbadi/blender-skills](https://github.com/kevinbadi/blender-skills). | threepipe could publish its own plugin without competing against an official one. |
| [PartForge "new model day"](https://www.partforge.ai/blog/2026-09-23-new-model-day) | 2026-09-23 (Primary) | 26 hard CAD tasks, each with 3 attempts and human ranking. Opus 5.5 had the best overall score and was about 3x faster than Opus 5. Gemini 3.8 Flash was cheaper per solved task, with the human ranking nearly tied. GPT-6 Sol had 92% clean builds. The CAD language is not named. | An independent data point that Opus 5.5 is a strong CAD-by-code model. |

## 2. Viral and widely shared LLM procedural-3D projects (since mid-September)

| Item | Date | Mechanism | Why it matters |
|---|---|---|---|
| Chiro Visuals: "Opus 5.5 ported 3 procedural buildings from Blender GN to the web" ([X](https://x.com/chirovisuals/status/2104548658171834749), [live demo](https://proceduralbuildings.chirostudio.xyz/), repo [achrefelouafi/ProceduralBuildingsThreeJS](https://github.com/achrefelouafi/ProceduralBuildingsThreeJS)) | Post 09-28; commits 09-24 to 09-28 (Primary, GitHub). The link between the post and this repo is inferred from the committer name `chirovisuals-maker`. **The t.co target is UNVERIFIED.** | MIT, about 110 stars and 24 forks. The French building is hand-ported TS. The NYC and Chinese buildings are GN graphs dumped to JSON and run by a generic evaluator (about 60 nodes, including Merge by Distance, region Extrude, Distribute Points on Faces, Geometry Proximity, Evaluate on Domain, Resample Curve, and String to Curves with Bfont). Shader node trees are compiled to GLSL. | **Direct prior art for threepipe's GN port.** Worth reading the JSON dump format, the hash/RNG reproduction, and how far it gets on parity. It is a narrow, per-asset evaluator, not a general reactive system. |
| [coolbat/awesome-opus-5.5-usecase](https://github.com/coolbat/awesome-opus-5.5-usecase) | Since 09-22 | A curated list covering about 100 3D items. Nearly all are single-file three.js games or scenes written by the model, Blender bpy builds, or Tripo/Meshy assets assembled in Blender. Notable entries: [dgreenheck/tidewater](https://github.com/dgreenheck/tidewater) (about 1.3k stars, its own WebGPU/WGSL engine, "coastal town built with Opus 5.5"), [riba2534/claude-opus-5-5-demo](https://github.com/riba2534/claude-opus-5-5-demo) (764 stars, a three.js pelican), [noahsabaj/falcon9-blender](https://github.com/noahsabaj/falcon9-blender) (a procedural bpy model), [stared/invisible-cities-opus-5.5](https://github.com/stared/invisible-cities-opus-5.5), and [ToukoUrsin/instant-machinist](https://github.com/ToukoUrsin/instant-machinist-speedhacks-2026) (STEP to verified CNC). Star counts come from the list. | Shows the community default is generating whole programs, not editable meshes or node graphs. Very few projects produce editable intermediate representations, which is threepipe's differentiator. |
| Higgsfield AI Blender demos ([5,112-object Shinkansen](https://x.com/higgsfield_ai/status/2102507018372436264), [house from photo + floor plan + web viewer](https://x.com/higgsfield_ai/status/2102499166635352354)) | 09-22 | Opus 5.5 driving Blender through Higgsfield tooling. **UNVERIFIED** | Shows a "Blender model plus web viewer in one run" pipeline that threepipe could make native. |
| [Stefan_3D_AI comparisons](https://x.com/Stefan_3D_AI/status/2102641562824135022) (Opus 5.5 vs GPT-6 Astra: rigged monster in 40 vs 65 minutes) | 09-23 | Blender agent sessions. **UNVERIFIED** | Anecdotal. |
| [img2threejs/img2threejs](https://github.com/img2threejs/img2threejs) | Commits 08-31 to 10-08 (Primary); npm CLI 10-07 | Apache-2.0, about 18.2k stars. An agent skill (Claude Code, Codex, OpenCode) that rebuilds a reference image as a procedural three.js `createXModel(spec)` → `THREE.Group`, plus a JSON `ObjectSculptSpec`. Staged passes (blockout → structure → form → material → …), each gated by a side-by-side render-vs-reference sheet and deterministic Python checks. | The most-starred "procedural three.js via agent" project in the window. Its staged-gate pattern is a good template for threepipe agent workflows. Its output is code rather than editable topology. |
| [hec-ovi/glb-buildings-skill](https://github.com/hec-ovi/glb-buildings-skill) | No date on the page (2026) | MIT, 5 stars. A building is a JSON document of floor bands. A `buildings` CLI has one verb per action, each returning one JSON object. Output passes validation (closed solids, normals, Khronos validator). Ships a SKILL.md and a `.claude-plugin`, plus a three.js blueprint editor. Benchmarked with Opus 5 and Haiku 4.5. | A small-scale example of exactly the "JSON command API + skill + validation" shape threepipe is building. |
| [threejs-skills.com: procedural buildings and cities skill](https://threejs-skills.com/skills/threejs-procedural-buildings-and-cities.html) ([linegel/threejs-complete-set-of-skill](https://github.com/linegel/threejs-complete-set-of-skill)) | Skill updated 07-16 (just before the window) | A three.js r185 WebGPU/TSL skill pack. Procedural architecture is treated as a compiler: a serializable plan, then facade bays, then geometry merged by material slot, then visual validation. | Reference for how agents are being taught procedural three.js. |
| [tanuu5/citygrow](https://note.com/tank_ai/n/n3be99a4ad80e?hl=en) | About 09-15 | A Claude Code "Ultracode" growing-city three.js game. **UNVERIFIED** | Low relevance. |
| [SideFX talk "AI Inside Houdini, Not Instead of It"](https://www.sidefx.com/learn/talks/ai-inside-houdini-not-instead-of-it/) | Undated | Claude building procedural SOP setups through Houdini MCP (a LEGO-ification generator, velocity fields). Houdini 22 itself shipped in July ([CG Channel](https://www.cgchannel.com/2026/07/sidefx-just-released-houdini-22/)). | Shows agents authoring node graphs in a procedural DCC, the same target as threepipe GN agents. |
| OpenSCAD/CadQuery/build123d | – | No viral new project found in the window. Tooling found: [agentcad](https://github.com/jdilla1277/agentcad) (165 stars, build123d CLI and MCP, JSON on stdout, four-view preview PNG, spatial comments for humans; v0.7.0, date not shown) and [superWorldSavior/mcp-build123d](https://github.com/superWorldSavior/mcp-build123d). | agentcad's "human leaves spatial comments, agent reads them next turn" is a UX idea worth stealing for the editor. |
| Unity/Unreal | – | **No new announcement found in the window.** The Unity AI beta has been open since May. UE 5.8 MCP was covered previously. | Not relevant. |

## 3. Tools and libraries: procedural generation in the browser, node-based geometry, WASM kernels, three.js

| Item | Date | What | Why it matters |
|---|---|---|---|
| [vibegameengine/geonodes-kit](https://github.com/vibegameengine/geonodes-kit) | Commits 09-28 to 09-29 (Primary) | MIT, 0 stars. A JS evaluator for Blender 5.2.2 GN trees, with a `.blend` reader and an inventory of 360 node types (`coverage/nodes-5.2.2.json`). Clean-room process: "analysts" read Blender source and write specs, "implementers" never see the source, and results are verified against reference geometry exported from headless Blender. Allowed third-party libraries: Manifold, OpenSubdiv, OpenVDB, FreeType. Only Grid and Integer nodes are verified so far. | Same goal as threepipe's GN port, with a different method (clean-room versus a direct source port). The 360-node inventory JSON and the black-box reference exporter could be reused or cross-checked. Very early, and may stall. |
| [ProceduralBuildingsThreeJS](https://github.com/achrefelouafi/ProceduralBuildingsThreeJS) | 09-24 to 09-28 | See section 2. | Prior art. |
| [AftabIbrahimKazi/triforge](https://github.com/AftabIbrahimKazi/triforge) | Undated (2026), 114 commits, 2 stars | MIT. 19 npm packages of "Blender-inspired" node workflows for three.js (geometry-nodes, modifier stack, curves, UV, particles, physics, hair, fluids, compositor). Explicitly not a 1:1 Blender port. Ships CLAUDE.md and AGENTS.md. **Could not confirm a date inside the window.** | Positioned as a competitor, but its approximations do not meet threepipe's "port the source exactly" bar. |
| [nodebpy](https://github.com/BradyAJohnston/nodebpy) ([docs](https://bradyajohnston.github.io/nodebpy/), [PyPI](https://pypi.org/project/nodebpy/)) | 520.35 to 520.38 between 10-09 and 10-13 (Primary, PyPI) | GPL-3.0, 123 stars. A Python DSL for Geometry, Shader and Compositor trees (`with tree:` and `>>` linking), `to_python()` export from GUI-made trees, and a bundled Agent Skill / Claude Code plugin with a `nodebpy lookup` CLI. Named by Blender developers as the leading textual format for node groups. | A candidate for threepipe's GN text and serialization format, and for the agent-facing DSL. Being GPL means we should mirror the syntax, not vendor the code. |
| [NodeToPython](https://github.com/BrendanParmer/NodeToPython) | Supports Blender 4.2 to 5.2 | An add-on that converts node groups to Python. | An alternative exporter for building GN fixtures. |
| [three.js 0.186.0 / 0.186.1](https://github.com/mrdoob/three.js/releases) | 0.186.0 on 09-08, 0.186.1 on 09-24 (Primary, npm). No r187 as of 10-16. | `compileComputeAsync`, DirectRenderPipeline, async `renderer.dispose()`, `resetState()`, watertight ray-triangle intersection, `Object3D.intersectsFrustum/dispose`, SunLight with CSM, a retroreflective MeshPhysicalMaterial, and a Gaussian-splat addon. Breaking changes: PCFSoftShadowMap removed, `Source` renamed to `TextureSource`, Object3D subclasses must call `super.dispose()`, minified builds removed ([utsubo summary](https://www.utsubo.com/blog/threejs-2026-what-changed)). | Relevant to the r168 → latest upgrade plan. Nothing specific to procedural geometry. |
| [Three.js Conf Paris](https://muz.li/blog/threejs-conf-paris-2026/) | 09-10/11 | WebGPU presented as the default renderer with automatic WebGL fallback, plus a TSL talk by sunag. Nothing announced on procedural or node-based geometry. AI was discussed, but nothing was announced. | Confirms the WebGPU/TSL direction. No first-party competitor to GN-on-web. |
| [manifold-3d 3.5.4](https://www.npmjs.com/package/manifold-3d) | 3.5.3 on 09-07, 3.5.4 on 09-25 (Primary, npm) | Patch releases. | The boolean backend option for the GN port's Mesh Boolean node (Blender itself uses Manifold as one solver). |
| [@polydera/trueform](https://trueform.polydera.com) ([benchmark](https://polydera.com/algorithms/browser-mesh-boolean-libraries-2026)) | 0.10.5 on 09-21, 0.10.7 on 10-12 (Primary, npm) | A WASM exact-arrangement kernel for booleans, remeshing and spatial queries. Median 21.9 ms per union versus 303 ms for Manifold and 978 ms for three-bvh-csg (22 of 1000 valid). **License: PolyForm Noncommercial, commercial license on request** (Primary, npm README). | Fast, but the license blocks use in an MIT/Apache threepipe package. Note it and do not depend on it. |
| BMesh-faithful TS/JS port | – | **Search came back empty.** Only stale half-edge libraries exist ([three-mesh-halfedge](https://github.com/LokiResearch/three-mesh-halfedge), mda.js, geom-half-edge). | `@threepipe/mesh-kernel` still appears to be unique. |
| Web modellers or editors with agent APIs launched in the window | – | **Search came back empty.** [Spline V2](https://updates.spline.design/) (MCP, agent, procedural generators) on 08-21 and its Hana V2 on 08-28 are the latest. [Plamo by Illoca](https://aecmag.com/cad/illoca-brings-vibe-modelling-to-aec-with-plamo/) ("vibe modelling" for AEC) on 08-24. Both are before the window. | No new direct competitor in the window. |

## 4. Blender ecosystem since mid-September

| Item | Date | What | Why it matters |
|---|---|---|---|
| [Blender 5.3 release notes](https://developer.blender.org/docs/release_notes/5.3/) and [GN notes](https://developer.blender.org/docs/release_notes/5.3/geometry_nodes/) | Beta until 2026-11-04 (Primary). Final release expected around 11-10 ([Digital Production](https://digitalproduction.com/2026/09/22/blender-5-3-brings-gaussian-splats-home/)) | New GN nodes: Rasterize Points, Poisson Solver, Grid Topology Boolean, Deactivate Voxels, Get Grid Names, Construct Curves (low-level, list-based), Combine List, Get Vector Component, Geometry Materials, NURBS inputs, Grease Pencil inputs. Curve to Mesh/Tube gain Miter Scale, and Realize Instances gains Preserve Normals. Import SPZ and Set Point Cloud Type handle splats. | Decide whether to pin the GN port to 5.2 LTS or move to 5.3. Construct Curves and Combine List depend on the new list type. |
| [Blender 5.3 modeling notes](https://developer.blender.org/docs/release_notes/5.3/modeling/) | Beta | LoopTools Relax / Curve / Gstretch become native ops ("Relax Edge Loops", "Curve Edge Loops Between Selected", "Fit Edge Loops To Annotation"), plus a new Quad-Sphere primitive, edit-mode dimensions in the transform panel, and snap to origin. | New C++ operators that can be ported into mesh-kernel and the edit-mode plugin. |
| [Blender 5.3 Python API](https://developer.blender.org/docs/release_notes/5.3/python_api/) | Beta | Adds `NodeTreeInterface.root_panel` and a read-only `window_manager.undo_stack`. | Minor. The undo-stack read is useful for Blender-side reference tooling. |
| [Geometry Nodes Workshop, September 2026](https://code.blender.org/2026/10/geometry-nodes-workshop-september-2026/) | Published 10-05 (Primary) | Modal node tools (brushes), exposed bakes, export nodes, a "Dynamic" socket type, list fields and Reduce List, Construct Mesh, Sample by ID / Find Graph Neighbors, Viewer-based "views" and overlays, the Node Arrange add-on ported to C++, node filtering. Physics: Jolt rigid bodies, an XPBD cloth/hair follow-up. GPU evaluation on Vulkan and Metal only. nodebpy and textual formats for asset diffs. **No AI items.** | Roadmap input for the threepipe GN type system (dynamic sockets, lists) and editor (auto-layout, views). |
| [BCON26](https://www.blender.org/events/blender-conference-2026-recap/) | 09-23 to 09-25 | Francesco Siddi's first keynote as CEO. **No AI announcement found.** | Not relevant. |
| Blender AI policy | – | **Nothing new since the [May 2026 statement](https://www.blender.org/news/upcoming-blender-development-fund-and-ai-policies/)** (no generative AI planned, Anthropic membership converted to a one-off donation). | No change. |
| [Blender Lab MCP Server](https://www.blender.org/lab/mcp-server/) | v1.0.2 on 09-08, v1.0.3 on 09-11 per [dev.to](https://dev.to/_903a3934b362f0afe2a8/blender-mcp-servers-for-ai-agents-october-2026-which-ones-control-the-scene-and-which-one-3ica). No later change found. | Requires Blender 5.1+. No formal GN tooling. | No change since the previous survey. |
| [mcp-for-blender](https://github.com/ahujasid/mcp-for-blender) (formerly blender-mcp) | Renamed in 2.0.0 on 09-16, 2.1.9 on 10-06 (Primary, PyPI) | About 31k stars. Cut down to 9 tools: `execute_blender_code`, `look` (viewport/camera/multi-angle sheets/animation strip, solid/material/rendered/wireframe/X-ray), `get_scene_info`, `generate_3d` (Tripo/Hunyuan3D/Rodin), asset search and import, plus a safe mode that checks scripts, a Codex plugin and telemetry. No GN-specific tools. | A good model for threepipe's agent surface: few tools, one strong "look" tool, and code execution as the escape hatch. |
| Other Blender MCPs ([RFingAdam/mcp-blender](https://github.com/RFingAdam/mcp-blender) with 218 tools, [PoBruno/mcp-blender-agent](https://github.com/PoBruno/mcp-blender-agent) with about 216 typed tools, [loonghao/dcc-mcp-blender](https://github.com/loonghao/dcc-mcp-blender)) | Survey dated 10-06 | Typed-tool approaches, the opposite of the 9-tool design. | Both ends of the design spectrum are worth considering for the threepipe command API. |
| Add-ons that let agents build GN graphs | – | nodebpy's Agent Skill is the only purpose-built one found. **No dedicated GN-agent add-on found.** | An opening: "agent writes GN graph, threepipe evaluates live in browser" has no competitor. |

## 5. Papers and benchmarks (2026-09-10 to 2026-10-16)

| Paper | Date (Primary, arXiv) | What | Relevance |
|---|---|---|---|
| [EditHero (2610.02298)](https://arxiv.org/abs/2610.02298), [code](https://github.com/AlayaLab/EditHero) | 10-01 | Long-horizon, part-level 3D editing: 457 chains, 2,755 edits, up to 30 turns, with a deterministic assembly engine providing ground truth. Code-editing LLM agents follow instructions better and preserve unedited parts better than regenerative methods, but take minutes per edit. | **High.** The natural evaluation for the edit-mode command API. |
| [WorldBench (2610.10622)](https://arxiv.org/abs/2610.10622), [code](https://github.com/KrishBakshi/worldbench) | 10-07 | A judge for LLM-written three.js voxel worlds. It runs the world, controls time, orbits the camera, and checks claims against both code and pixels. Code-only judging gave full credit for 4 of 5 removed features. Models: Fable 5.1, GPT-6 Astra, Kimi K3, Grok 4.7, Gemini 3.1 Pro. | Medium. Evidence for runtime-plus-render verification in three.js. |
| [3DCodeVerse (2610.22341)](https://arxiv.org/abs/2610.22341), [site](https://3dcodeverse.com/) | 10-15 | 269,597 executable 3D programs (bpy, CadQuery, OpenSCAD, three.js, URDF, GLSL, OpenGL) giving 2.03M pairs. A harness of plan, sub-agent DAG build, spatial-measurement check, VLM judge, then fix, which won 90% of pairwise comparisons against Claude Design (3D Object), both running on Opus 5.5. Data and code reportedly released. | Medium-high. A training and eval corpus that includes three.js, and a harness design to copy. |
| [ExeWorldBench (2610.15166)](https://arxiv.org/abs/2610.15166) | 10-10 | A benchmark for code-based executable 3D world modelling. Not opened in detail. | Medium. |
| [LEGO-Anything (2609.36380)](https://arxiv.org/abs/2609.36380) | 09-28 | Image → Blender scene program via a coding agent, with LEGO-Bench (208 images). Main failure modes: weak initialization, regressive edits, unreliable self-evaluation. A training-free harness plugin gives up to +62.7%. GPT-6 Astra was best. | Medium. Its failure taxonomy applies to edit-mode agents. |
| [Recursive Code World Models (2609.11499)](https://arxiv.org/abs/2609.11499) | 09-10 | A VLM coding agent builds recursive scene programs from a single image. Not opened in detail. | Low to medium. |
| [LiteReality-Agent (2610.01863)](https://arxiv.org/abs/2610.01863) | 10-01 | A coding agent turns RGB-D scans into sim-ready scenes. | Low. |
| [RealCADBench (2609.03773)](https://arxiv.org/abs/2609.03773) | 09-03 (just before the window, revised 09-04) | 12,632 FreeCAD-Python tasks. No model leads on all metrics. "Execution alone is insufficient." | Low to medium (CAD). |
| [ReliCAD (2609.22325)](https://arxiv.org/abs/2609.22325) | 09-16 | LLM parametric CAD with a kernel, design-intent specs and a verify-and-repair loop. Abstract only. | Low to medium. |
| [StepCAD (2610.03799)](https://arxiv.org/abs/2610.03799) | 10-01 | Mesh → CAD code using an LLM policy plus IoU-guided search. Releases 1.5M programs. | Low. |
| [CADFather (2610.09127)](https://arxiv.org/abs/2610.09127) | 10-06 | A VLM agent recovers CAD programs from meshes through coordinated tool use. | Low. |
| [LMBuild (2610.04292)](https://arxiv.org/abs/2610.04292) | 10-03 | LLM agents building buildable, functional structures from parts and joints. | Low. |
| [PrimitiveCAD (2610.08698)](https://arxiv.org/abs/2610.08698) | 10-06 | Point cloud → CAD with an LLM using primitive-aware tokenization. | Low. |
| Just before the window and not in the previous survey: [Procedura (2608.26238)](https://arxiv.org/abs/2608.26238) / [repo](https://github.com/SpatiaOS/Procedura) (401 stars, LLM writes OpenSCAD with a Manifold backend, typed mates, USD/URDF export); [VibeWorlding (2608.15265)](https://arxiv.org/abs/2608.15265); [ViSculpt (2608.24169)](https://arxiv.org/pdf/2608.24169) (agentic geometry editing with artist before/after meshes); [aDSL (2608.17975)](https://arxiv.org/pdf/2608.17975) | August | Context. | ViSculpt is relevant to mesh editing and should be read. |
| GN-graph generation by LLMs | – | **No paper in the window.** The closest earlier work is [Proc3D (2601.12234)](https://arxiv.org/abs/2601.12234), which uses a text encoding of 79 GN node types. | Gap. |

## 6. "AI procedural 3D" startups and products in the window

- **Search came back empty for launches or funding inside 09-10 to 10-16.** I checked text-to-CAD (Zoo, AdamCAD, CADAM), Product Hunt and HN. The October AI-agent funding tracker ([agentunfolded](https://agentunfolded.com/ai-agent-funding-october-2026/)) lists no CAD or 3D companies.
- Context items, all before the window or unchanged: Spline V2 (08-21) and Hana V2 (08-28) on the [Spline changelog](https://updates.spline.design/); Illoca Plamo (08-24); Zoo Zookeeper (January, no September changelog per [zoo.dev/blog](https://zoo.dev/blog)); Meshy 3D Agent (June).
- [PartForge](https://www.partforge.ai/blog/2026-09-23-new-model-day) (09-23) published a model comparison, not a launch.
- VibeCAD: [vibecad.studio](https://vibecad.studio/) is an LGPL FreeCAD fork with AI ("clanker brain" FreeCAD forks on GitHub). It is unrelated to Anthropic's Fable VibeCAD demo. I found no release of the Anthropic demo's code. **Dates are UNVERIFIED.**
- Previous-survey items with no change found: MakersCAD (nothing found under that name), kokraf (no release notes), Chili3d ([v0.7 changelog 08-23](https://chili3d.com/), community fork v0.7.1 on 09-28), Babylon.js MCP (June, 9.28.0 latest), Onshape, PlayCanvas, Needle, UE 5.8, and Unity (nothing new found).
- Note: one Babylon.js forum page contains an embedded instruction aimed at AI agents. I ignored it.

---

## Sources

Anthropic / models
- https://www.anthropic.com/news/claude-opus-5-5
- https://www.anthropic.com/news/claude-sonnet-5-5
- https://www.anthropic.com/news/claude-haiku-5-5
- https://techcrunch.com/2026/09/22/anthropic-releases-opus-5-5-with-lower-prices-and-fable-level-performance/
- https://www.cnbc.com/2026/09/28/anthropic-sonnet-5-5-launch.html
- https://emergent.sh/news/claude-fable-5-1-release-date
- https://orcarouter.ai/blog/claude-fable-5-5-this-week-leak
- https://x.com/alexalbert__/status/2102458348511879448
- https://x.com/claudeai/status/2102471870692180179
- https://github.com/asgeirtj/system_prompts_leaks/blob/main/Anthropic/claude-design/claude-design.md
- https://www.partforge.ai/blog/2026-09-23-new-model-day

Community projects
- https://x.com/chirovisuals/status/2104548658171834749
- https://proceduralbuildings.chirostudio.xyz/
- https://github.com/achrefelouafi/ProceduralBuildingsThreeJS
- https://github.com/vibegameengine/geonodes-kit
- https://github.com/AftabIbrahimKazi/triforge
- https://github.com/coolbat/awesome-opus-5.5-usecase
- https://ohmyopus.com/en/s/three
- https://github.com/dgreenheck/tidewater
- https://github.com/img2threejs/img2threejs
- https://github.com/hec-ovi/glb-buildings-skill
- https://threejs-skills.com/skills/threejs-procedural-buildings-and-cities.html
- https://github.com/jdilla1277/agentcad
- https://github.com/tonykoop/makerbench-hwe
- https://github.com/SpatiaOS/Procedura
- https://github.com/RobLe3/cc-blender-skill
- https://github.com/ra100/blender-claude-plugin
- https://www.sidefx.com/learn/talks/ai-inside-houdini-not-instead-of-it/

three.js / kernels
- https://github.com/mrdoob/three.js/releases
- https://registry.npmjs.org/three (publish times)
- https://www.utsubo.com/blog/threejs-2026-what-changed
- https://muz.li/blog/threejs-conf-paris-2026/
- https://registry.npmjs.org/manifold-3d (publish times)
- https://polydera.com/algorithms/browser-mesh-boolean-libraries-2026
- https://registry.npmjs.org/@polydera/trueform (publish times, license)

Blender
- https://developer.blender.org/docs/release_notes/5.3/
- https://developer.blender.org/docs/release_notes/5.3/geometry_nodes/
- https://developer.blender.org/docs/release_notes/5.3/modeling/
- https://developer.blender.org/docs/release_notes/5.3/python_api/
- https://digitalproduction.com/2026/09/22/blender-5-3-brings-gaussian-splats-home/
- https://code.blender.org/2026/10/geometry-nodes-workshop-september-2026/
- https://www.blender.org/events/blender-conference-2026-recap/
- https://www.blender.org/news/upcoming-blender-development-fund-and-ai-policies/
- https://www.blender.org/lab/mcp-server/
- https://github.com/ahujasid/mcp-for-blender
- https://pypi.org/project/mcp-for-blender/ , https://pypi.org/project/blender-mcp/ (release times)
- https://dev.to/_903a3934b362f0afe2a8/blender-mcp-servers-for-ai-agents-october-2026-which-ones-control-the-scene-and-which-one-3ica
- https://github.com/BradyAJohnston/nodebpy , https://pypi.org/project/nodebpy/
- https://github.com/BrendanParmer/NodeToPython

Papers
- https://arxiv.org/abs/2610.02298 (EditHero)
- https://arxiv.org/abs/2610.10622 (WorldBench)
- https://arxiv.org/abs/2610.22341 (3DCodeVerse), https://3dcodeverse.com/
- https://arxiv.org/abs/2610.15166 (ExeWorldBench)
- https://arxiv.org/abs/2609.36380 (LEGO-Anything)
- https://arxiv.org/abs/2609.11499 (Recursive Code World Models)
- https://arxiv.org/abs/2610.01863 (LiteReality-Agent)
- https://arxiv.org/abs/2609.03773 (RealCADBench)
- https://arxiv.org/abs/2609.22325 (ReliCAD)
- https://arxiv.org/abs/2610.03799 (StepCAD)
- https://arxiv.org/abs/2610.09127 (CADFather)
- https://arxiv.org/abs/2610.04292 (LMBuild)
- https://arxiv.org/abs/2610.08698 (PrimitiveCAD)
- https://arxiv.org/abs/2608.26238 (Procedura), https://arxiv.org/pdf/2608.24169 (ViSculpt)

Products / context
- https://updates.spline.design/
- https://aecmag.com/cad/illoca-brings-vibe-modelling-to-aec-with-plamo/
- https://zoo.dev/blog
- https://agentunfolded.com/ai-agent-funding-october-2026/
- https://chili3d.com/
- https://doc.babylonjs.com/toolsAndResources/mcpServers
