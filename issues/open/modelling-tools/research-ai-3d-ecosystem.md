# AI × 3D ecosystem survey — September 2026

**Date of research:** 2026-09-14. Companion to `research-ecosystem.md` (JS mesh libraries & API
precedents) and `00-synthesis.md`. Read §5 and §7 of `research-ecosystem.md` first — this document
assumes them and does not repeat them.

**Scope interpretation.** The brief said "the current 3D ecosystem around Astra, Fable and all".
Interpreted as: *the intersection of frontier AI agents and 3D content creation / editing tooling*.

**Naming disambiguation — read this, it matters.** As of September 2026 "Astra" is ambiguous and the
ambiguity is load-bearing for this report:

| Name | Who | What | Date | Relevance here |
|---|---|---|---|---|
| **GPT‑6 Astra** | OpenAI | Frontier model whose headline feature is *computer use*; became the centre of a wave of viral Blender/3D demos | released 2026‑09‑03 | **This is almost certainly what was meant.** High relevance. |
| **Project Astra** | Google DeepMind | Long-running research prototype for a "universal AI assistant" (camera-in, phone control, memory); capabilities folding into Gemini Live / Android XR | ongoing since 2024 | Low relevance — no 3D-authoring story found. |
| **Claude Fable 5 / 5.1, Mythos 5 / 5.1** | Anthropic | Fable 5 released 2026‑06‑09; Fable 5.1 + Mythos 5.1 released 2026‑09‑01 | — | High relevance: the Fable 5 launch used a *self-built browser CAD editor* as one of four hero demos. |

The confusion is common enough that third parties publish "GPT Astra vs Google Project Astra: Not the
Same Thing" explainers. **If the maintainer meant Google's Astra, sections 1–2 should be re-read with
that in mind — the answer there is essentially "nothing is happening in 3D authoring".**

---

## 0. Executive summary

1. **Nobody has shipped a working structured *mesh-operator* tool API for LLMs.** Every serious system
   in September 2026 converged on the same shape: `execute_code` (sandboxed) + `describe/measure` +
   `search_docs` + `render_and_look`. Blender's own official MCP server exposes **27 tools and not one
   is a modelling operator**. Trimble's *shipped, official* SketchUp connector is **three tools**:
   `get_docs`, `evaluate_py`, `save_model`. Structured tools are for *scene assembly and inspection*;
   geometry happens in code.
2. **The viral "GPT‑6 Astra uses computer-use to drive Blender" story is a misnomer.** The demos do not
   drive Blender's GUI. They run `blender --background --python scene.py`, render a PNG headlessly, and
   feed the PNG back. **Headless script-execute + render-inspect is the entire mechanism** (verified
   against Simon Willison's published transcript, scripts and generated skill file, 2026‑09‑05).
   *No one in 3D ships computer-use as the primary interface.*
3. **Feedback loops are the biggest win — but the components are not interchangeable, and the ordering
   matters.** Error messages buy **validity** almost for free and buy nothing else (3DCodeBench:
   executability 0.702 → 0.974, **+27.2 pp**, but conditional visual similarity **−0.010**). Numeric
   measurements and executable assertions are what buy **geometric correctness** (CADTests **+~10 pp**;
   test-based metrics match human judgement at **0.938** vs Chamfer's 0.663). Renders are a *weak
   verifier* and a *catastrophic specification* (BenchCAD: a target render instead of a text
   instruction "collapses every model to near-zero"). VIGA's headline **+35.32 % BlenderGym /
   +124.70 % BlenderBench** comes from the *whole* loop. **Build `measure()` and `validate()` before
   `renderPreview()`** — build123d-mcp states it flatly: *"Do not proceed to `render_view` until
   `measure` passes … renders can look correct even when geometry is wrong."*
4. **The dominant editing failure is collateral damage, not the target edit.** BenchCAD (2026‑05):
   simple edits are nearly solved (0.837–0.865) but **"~64 % of nominally successful edits silently
   corrupt unrelated features."** BIM-Edit (2026‑06): geometry 68.9 vs **topology 37.8**, strict solve
   rate **3.4 %**. This makes **edit locality + attribute preservation** the primary design constraint
   for a BMesh API, and retroactively strengthens the "per-corner attribute layers are core" principle
   far beyond what the prior survey argued.
5. **P3D-Bench (2026‑06‑09) benchmarked Three.js as a code-generation target and named threepipe's
   exact opportunity.** Three.js scored **tied-best on validity (1.000)** and **level with OpenSCAD on
   geometry (0.556 vs 0.567)** — and lost only on topology/part because *"Three.js … outputs
   triangulated meshes rather than parametric solids, so it scores poorly on Topo and Part: such meshes
   are **not guaranteed to be watertight**."* **An n-gon kernel with a manifold gate closes precisely
   that measured deficit.** This is the strongest published quantitative rationale for the project.
6. **Blender Foundation has explicitly closed the door on in-product generative AI** (2026‑05‑01, after
   reversing Anthropic's Development Fund patronage following community backlash): *"No generative AI
   functionality is currently available or planned to be integrated in Blender."* Its Sept‑2026
   two-year strategy mentions AI zero times. Blender's agent surface stays a bolt-on MCP over `bpy`,
   scoped to analysis/documentation — and its own page tells you to run it in a VM.
7. **Every serious 3D vendor shipped an agent surface between April and September 2026** — Anthropic's
   nine creative connectors (2026‑04‑28), Babylon.js (06‑04), Epic UE 5.8 (06‑17), Unity (05‑11, then
   **29 Skills** on 09‑09), Onshape FeatureScript MCP (08‑13), Spline V2 (08‑27), PlayCanvas, Needle.
   **The pattern is `agent ↔ typed/scriptable API`, with the GUI as one of two equal front-ends** —
   Zoo/KCL, Onshape/FeatureScript, Spline ("MCP *is* the API"), PartMode ("permissioned typed agents").
   Godot is the lone refusenik (2026‑06‑30 policy banning autonomous agents from contributions).
   **threepipe and the three.js editor have nothing.**
8. **Blender's own LLM system prompt is a free specification of what *not* to build** (§2.3): hidden
   modal state, active-vs-selected divergence, bmesh flush-or-lose-your-edits, `.001` name collisions,
   manual depsgraph updates, silent no-ops on the wrong property. Every line is a mitigation for a
   design flaw threepipe can simply not have.
9. **Two open gaps worth claiming.** (a) **No benchmark exists for agentic polygon-level mesh editing**
   — building the API means building the only thing that can measure it, so publish the harness
   ("BMeshBench"). (b) **No funded, open, general-purpose browser polygon modeller exists** (Chili3d
   4,833★ is CAD; kokraf 576★ is one person; PartMode 524★ is parametric).
10. **The realistic differentiator is not "an MCP server".** It is a typed TS operator layer that is
    **deterministic, node-safe, headless-renderable, glTF-native, locality-measured, and whose schemas
    are mechanically derivable** — so the code path and the tool path are the same surface. Nobody in
    open-source web 3D has all six, and threepipe already has three of them for free.

---

## 1. Agent-built 3D tools — who actually shipped a modeller with a frontier model

### 1.1 The kokraf premise — **NOT VERIFIED, and the evidence points the other way**

The brief states "author says they built Blender-like modelling tools fast with Fable". I could not
find any public statement to that effect, and the public record is weak evidence against it.

Verified facts (GitHub REST API + site, checked 2026‑09‑14):

| Fact | Value | Source |
|---|---|---|
| Repo | `sengchor/kokraf`, "Collaborative 3D Modeling Application on the Web" | api.github.com |
| Stars / forks | 576 / 74 | api.github.com, 2026‑09‑14 |
| Created | 2025‑05‑11 | api.github.com |
| Last push | 2026‑09‑13 (active) | api.github.com |
| Contributors | **1** (`sengchor`), 510 commits | api.github.com |
| Language | JavaScript, custom VEF adjacency mesh → BufferGeometry for render only | README |
| AI mentions in README | **none** | README |
| AI on roadmap | "Phase 3: Product launch with **AI features**, and scaling improvements"; elsewhere "AI-driven texturing" | kokraf.com/about (last updated Jan 2026) |

Commit-history evidence: I scanned the most recent 200 commits on `dev` (2026‑04‑14 → 2026‑09‑13).
**Zero `Co-Authored-By: Claude` / agent trailers.** Messages are small, granular and human-shaped
("fix: stall reference in vertex dissolve", "Mask texture island after patch fill", "Create plane
constraint for edit transform"). 510 commits over ~16 months ≈ 1/day — a normal sustained solo pace,
not an agent sprint. Feature cadence over Apr–Sep 2026 was: selection/normals → texture painting
(xatlas, projection painting, paint commands) → transform plane constraints.

**Conclusion: treat "kokraf was built fast with Fable" as unverified.** It may well be true and stated
in the kokraf Discord or on the *Jourverse* YouTube channel, which I cannot read. If it matters,
ask the author directly (taingsengchor@gmail.com, listed on kokraf.com/about) or check
discord → kokraf. What *is* verifiable is that kokraf is a one-person, 16-month, steadily-built
project — which is the more useful data point anyway: **the reference architecture from
`research-kokraf.md` was reached by a human at human pace, and its weaknesses (side-car UV maps,
snapshot undo) are the kind an agent would have copied, not fixed.**

### 1.2 VibeCAD — Anthropic's Claude Fable 5 launch demo (the real headline case)

The most concrete, primary-sourced instance of "a frontier model built a 3D modeller".

- **Date:** 2026‑06‑09, one of four autonomous-capability demos in the Claude Fable 5 / Mythos 5
  launch (anthropic.com/news/claude-fable-5-mythos-5).
- **Anthropic's own wording, verbatim:** *"Claude Fable 5 designs a complete 3D-printable model in a
  browser-based CAD editor. The editor itself was also created by Fable 5, including the built-in AI
  copilot that does the modeling."*
- Published as a video on Anthropic's YouTube channel; the editor is referred to as **VibeCAD**.
  Reported task: from a one-sentence brief, build the editor, then inside it design a desk lighthouse,
  adjusting proportions once it inferred the object should sit beside a monitor.
- **Architecture is not published.** No repo, no source, no tool schema. ⚠ Treat capability claims as
  vendor-reported. What is genuinely informative is the *shape*: a model that builds its own
  browser-based authoring environment and then a copilot inside it — i.e. the model preferred
  **writing a tool then using the tool** over one-shotting geometry.

### 1.3 MakersCAD — independent reproduction (useful because it reports the failure)

- **Who/when:** 東京九段工作ラボ (Tokyo Kudan Makers Lab), note.com, 2026‑07‑04.
- Built a browser CAD app, initially named VibeCAD, renamed **MakersCAD** to avoid confusion with
  Anthropic's demo. **Build time 16 min 28 s**, no code written by hand, instructions in Japanese only.
- **~1,200 LOC** (1,009 core + 201 settings). Three.js for viewport. STL export.
- **The important part — the failure:** the first STL export was **not watertight**. Author's line:
  *"A model that looks clean on screen and data that can actually be printed are two different
  things."* Fix took a further 27 minutes and consisted of **bolting on Manifold** as the guaranteed-
  watertight kernel.
- The model also inferred unstated print constraints (≥1.2 mm wall thickness, ≤45° overhangs).

**Reading for threepipe:** an agent will happily produce a viewport-correct, topologically-invalid
mesh and not notice. This is exactly principle **P8** ("validity is queryable, not exceptional") and
argues for `isManifold()` / `validate()` / `volume()` being cheap, always-available, and *mentioned in
the tool descriptions* so the agent is nudged to call them.

### 1.4 Other agent-built 3D/CAD projects found

| Project | URL | Date | What | Notes |
|---|---|---|---|---|
| `awesome-gpt-6-astra` | github.com/magiccreator-ai/awesome-gpt-6-astra | updated 2026‑09‑14 | Curated directory of **171 GPT‑6 Astra demos**, of which **23 are "Blender & 3D"** | Explicitly *"a case directory, not … an independent benchmark"*; build times are creator-reported. Good for scale-of-the-moment, bad for rigour. |
| `simonw/gpt-6-astra-blender-pelican-bicycle` | github.com | 2026‑09‑05 | Full transcripts + `.blend` + Python + a generated `SKILL.md` | **Best primary artefact in this whole report.** See §2.4. |
| ViveCAD (`hghalebi/vibecad`) | github.com | 2026 | Fine-tuning pipeline mapping NL → OpenSCAD/Python CAD; incremental per-feature construction with a VLM reviewing renders against the goal | Independent re-derivation of the render-in-the-loop pattern. |
| `fa-mc/vibe-cading` | github.com | 2026 | "3D model generators with CadQuery **for humans and LLM agents**"; drivable from Python, the OCP CAD viewer, or any MCP client; multi-role generate/validate/review agents | Closest philosophical match to the "one surface for humans and agents" idea (P10). |
| SynapsCAD | — | 2026 | OpenSCAD editor + viewport + AI assistant that edits the code | Code-as-truth, viewport as preview. ⚠ found via secondary sources only. |
| `three.ws` | github.com/nirholas/three.ws, HF blog 2026‑08‑29 | Apache‑2.0 | Agent *avatar* stack (body/brain/wallet); includes a "Scene Studio" built on the three.js editor and text→world "Diorama" | **Adjacent, not modelling.** Heavy crypto/x402 payment framing. Tool surface is `wave`, `lookAt`, `play_clip`, `speak`, `remember`, `see_screen` — embodiment, not geometry. Low relevance. |

**Not found (searched, no result):** any case of a person shipping a *polygonal mesh kernel* (BMesh-
class: n-gons, half-edge/radial, Euler ops, per-corner attribute layers) primarily by agent. Every
agent-built "3D editor" located is either CSG/parametric (OpenSCAD, CadQuery, manifold) or a
scene-assembly layer over an existing engine. **This is a real gap and it is the thing threepipe is
proposing to build.**

---

## 2. AI agents operating 3D software — what surface they actually get

### 2.1 Blender — the official position, dated

This is the most important vendor story because Blender is threepipe's algorithm reference.

| Date | Event | Source |
|---|---|---|
| 2026‑03‑17 | Blender 5.1 released | blender.org |
| 2026‑04‑24 | **Blender Lab Activity Report Q1 2026** announces an official **MCP Server** project | blender.org/development/blender-lab-activity-report-q1-2026/ |
| 2026‑04‑28 | Anthropic joins Blender Development Fund as Corporate Patron (≥€240k/yr, earmarked for core dev incl. the Python API) | blender.org/news/anthropic-joins-the-blender-development-fund-as-corporate-patron/ |
| 2026‑04‑28 | Anthropic ships a **Blender connector** for Claude, one of nine creative-tool connectors | anthropic.com/news/claude-for-creative-work |
| **2026‑05‑01** | **Reversal.** Foundation converts the patronage to a one-off donation after community backlash | blender.org/news/upcoming-blender-development-fund-and-ai-policies/ |
| 2026‑09‑10 | Two-year strategy ("Small Teams, Ambitious Projects") — **AI/agents appear zero times** | code.blender.org/2026/09/small-teams-ambitious-projects/ |

The 2026‑05‑01 statement, verbatim and unambiguous:

> "Blender is a tool for artists and creators, it's made by humans for humans. **No generative AI
> functionality is currently available or planned to be integrated in Blender.**"

And from the Q1 Lab report:

> "The Blender project keeps a firm artist-centric policy when it comes to AI. With this in mind, some
> exploration of LLM powered tools has started, with an implementation of an MCP connector for
> Blender. … The MCP Server offers a natural language interface with Blender's Python API, improving
> access to documentation, and allowing users to explore and understand complex setups."

**Note the careful framing: the sanctioned use is *analysis, documentation and comprehension*, not
authoring.** The published example use cases are: polycount-vs-screen-area outlier analysis on the
Classroom benchmark file; data-block typo fixing and renaming; "which objects use material X";
"explain what this geometry-nodes setup does and add frame annotations". Not a single modelling task.

blender.org/lab/mcp-server/ also carries this, which is worth quoting in any threepipe design doc:

> "**Security Warning** The MCP server will execute LLM generated code in Blender without any guards
> in place to protect your data from removal or being sent to a remote location. To keep your data
> safe it is recommended to use a virtual machine, or a system without access to sensitive
> information."

### 2.2 The official Blender MCP tool list — the single best API-shape data point in this report

Fetched verbatim from `projects.blender.org/lab/blender_mcp/raw/branch/main/readme_tools.rst`
(2026‑09‑14). Generated from tool docstrings, so this is authoritative. **27 tools, grouped:**

| Group | Tools | Count |
|---|---|---|
| **Code execution (the escape hatch)** | `execute_blender_code`, `execute_blender_code_for_cli` | 2 |
| **Describe / inspect** | `get_blendfile_summary_datablocks`, `…_missing_files`, `…_of_linked_libraries`, `…_path_info`, `…_usage_guess` (each with a `_for_cli` twin), `get_object_detail_summary`, `get_objects_summary` | 12 |
| **Documentation retrieval** | `get_python_api_docs`, `search_api_docs`, `search_manual_docs` | 3 |
| **Eyes** | `get_screenshot_of_area_as_image`, `get_screenshot_of_window_as_image`, `get_screenshot_of_window_as_json`, `render_thumbnail_to_path`, `render_viewport_to_path` | 5 |
| **Navigation / UI state** | `jump_to_tab_by_name`, `jump_to_tab_by_space_type`, `jump_to_view3d_object_by_name`, `jump_to_view3d_object_data_by_name` | 4 |
| **Modelling operators** | — | **0** |

Structural observations that should drive threepipe's design:

1. **Zero modelling operators.** The vendor with the world's largest mesh-operator library chose not to
   expose any of them as tools. The operator surface reaches the model **only through code**.
2. **`_for_cli` twins are the killer feature.** Every read tool has a headless variant that opens a
   saved file in a fresh subprocess. That's determinism + isolation + no UI dependency — i.e. *exactly*
   what threepipe gets for free from node-safe kernel + polyfilled headless rendering.
3. **Documentation is a first-class tool.** Three of 27 tools exist purely to let the model look up
   API signatures. A typed TS API with generated `.d.ts` + JSDoc makes this cheap for threepipe; an
   equivalent `docs(symbol)` tool is low effort and evidently high value.
4. **Eyes are 5 of 27.** Two rendering modes (cheap thumbnail vs full) + a *JSON description of the
   window* alongside the screenshot. The JSON-alongside-image pattern is worth copying: cheap
   structured state first, pixels only when needed.

### 2.3 Blender's LLM system prompt is a free specification of what *not* to build

`mcp/blmcp/data/prompts.yml` (obtained from `bpy-dev/blender-mcp`, a GPL‑3.0 downstream distribution
of Blender Lab's MCP; created 2026‑09‑09, 84★ at 2026‑09‑14). Nearly every paragraph is a workaround
for an API property that an LLM cannot infer. Verbatim excerpts, with the threepipe implication:

| Blender's warning to the model (verbatim) | Root cause | threepipe should instead |
|---|---|---|
| "Many operators depend on the current mode (Object, Edit, Sculpt, etc.) and which objects are active/selected. Verify or set the mode first — **wrong mode either fails or silently does nothing**." | Hidden global modal state | No global mode. Operators take explicit mesh + explicit element sets (P2/P3). |
| "The **active object** and **selection** are distinct. … Operators change selection and active state **as a side effect**, so re-set both between sequential operator calls on different objects." | Implicit + mutated selection | `Selection` as a first-class inspectable value; operators *return* created elements (P3). |
| "In edit mode, access mesh geometry through the bmesh API, not the regular mesh data API. **Flush bmesh changes back to the mesh — forgetting this silently loses all edits.**" | Dual representation with a manual sync step | One editable mesh as source of truth; `BufferGeometry` is a derived cache, never round-tripped (P5). |
| "Names auto-append `.001`, `.002` on collision — **capture references immediately after creation, never look up by assumed name**." | Name-based identity | Stable IDs + re-evaluable queries, never name lookup (P3). |
| "**Update the dependency graph** after changes before reading computed properties (world matrices, modifier results…)." | Lazy eval with manual flush | Reads are either always-consistent or explicitly `await`ed; never silently stale. |
| "Rotation mode determines which property to use … **writing to the wrong property is silently ignored**." | Silent no-op on wrong field | Typed options objects + reject unknown/conflicting keys loudly. |
| "**Return compact structured results** (dicts, lists) from generated code; avoid scene dumps and print output." | Token blowout | `describe()` must be compact and paginated by construction. |
| "Prefer **non-destructive** workflows: modifiers over direct mesh edits where possible." | Irreversibility | Transactional ops + deltas (P6) give this without a modifier stack. |
| "Don't dump entire scenes — inspect progressively for large scenes." | No summarisation affordance | Budgeted, level-of-detail `describe()`. |

**This table is the most actionable artefact in this report.** Every row is a design flaw threepipe can
simply not have, and the fact that Blender must spend ~2,000 prompt tokens per session warning about
them is the cost of not having avoided them.

### 2.4 GPT‑6 Astra + Blender — the mechanism is headless code + render, not GUI computer-use

Widely reported as "Astra uses Blender via computer use". **It does not.** Verified from Simon
Willison's published transcript, scripts and the skill file the model itself wrote:

- **Source:** `til.simonwillison.net/llms/blender-coding-agents-macos` (2026‑09‑05) and
  `github.com/simonw/gpt-6-astra-blender-pelican-bicycle` (full Codex transcript + `.blend` + `.py`).
- **The loop:** agent writes a `bpy` script → runs
  `/Applications/Blender.app/Contents/MacOS/Blender --background --python work/scene.py` → Blender
  renders a PNG headlessly → agent reads the PNG back → revises the script. Requires Codex CLI
  ≥ 0.153.0 (or ChatGPT desktop in Codex mode) with local command permission.
- One secondary write-up puts it bluntly: *"a model can execute a scene script on a machine with no
  window open, write an image with a render call, and read that image back as its next input. **That
  loop is the whole trick.**"*
- Three iterations on the same scene: **2 m 39 s, 3 m 51 s, 5 m 59 s**.
- Willison: *"Modern frontier models have got really good at using Blender … models can produce
  `.blend` files you can edit in Blender itself, and can also render images and even movies."*

The generated `outputs/blender-local/SKILL.md` is worth reading in full. Its content is ~20 % API
facts and ~80 % **visual-QA discipline and host-quirk workarounds**:

> "**Inspect the rendered image after meaningful changes.** Check the silhouette, grip and pedal
> contacts, floating parts, frame cropping, shadows, and whether background details are actually
> visible. **A successfully saved render is not visual QA.**"
> "Avoid overlapping coplanar surfaces. The retained studio floor hid the new beach and ocean;
> coincident surfaces produced black bands."
> "Smooth shading does not fix a faceted silhouette: give focal shapes enough geometry."
> "Saving before rendering preserves the scene if rendering fails."
> "Background rendering can produce little output for tens of seconds. If execution returns a session
> ID, **poll that session** until completion instead of launching duplicate renders."

**Implications for threepipe, in priority order:**
1. Headless render must be **fast, cheap and non-blocking**, with a session/poll model for long ones.
   threepipe already renders offscreen in Node with the polyfill — this is the moat.
2. `saveScene()` before every render; the `.blend`-equivalent deliverable is a **glTF the human can
   open**. threepipe is glTF-native; this is free.
3. Ship a *skill/instructions* artefact alongside the API. Both OpenAI (Codex skills) and Anthropic
   (Claude Skills) consume Markdown skill files; Blender ships `prompts.yml`. A `threepipe-modelling`
   skill file is a deliverable, not an afterthought.

### 2.5 Anthropic "Claude for Creative Work" — MCP connectors as the industry default

anthropic.com/news/claude-for-creative-work, **2026‑04‑28**. Nine connectors: **Ableton, Adobe (50+
Creative Cloud tools), Affinity by Canva, Autodesk Fusion, Blender, Resolume Arena/Wire, SketchUp,
Splice**. Explicitly: *"Because the connector is built on MCP, it is accessible to other LLMs in
addition to Claude."*

3D-relevant claims, verbatim:
- *"Autodesk Fusion allows designers and engineers with a Fusion subscription to create and modify 3D
  models through conversations with Claude."*
- *"SketchUp turns a conversation with Claude into a starting point for 3D modeling — describe a room,
  a piece of furniture, or a site concept, then open it in SketchUp to refine."*
- *"3D artists can use the Blender connector to **analyze and debug entire Blender scenes**, or build
  custom scripts to batch-apply changes to objects in a scene."*

Note the verbs: *analyze, debug, batch-apply, a starting point*. Even the vendor is not claiming
mesh-level authoring.

### 2.6 What practitioners report as broken (BlenderMCP and the Claude connector)

Community BlenderMCP (`ahujasid/blender-mcp`, MIT) remains the most-installed bridge. Reported, dated:

| Symptom | Source | Date |
|---|---|---|
| Complex organic modelling, **fine-tuned mesh topology**, complex node trees / Geometry Nodes, animation & rigging, precise spatial reasoning — all fail. *"Think of it as a rapid prototyping tool rather than a modeling replacement."* | mindstudio.ai review of the Claude Blender connector | 2026‑05‑06 |
| `execute_blender_code` hangs at session start — handler registered via `bpy.app.timers.register()` only fires when Blender's main loop is pumping; requests queue and are never serviced | ahujasid/blender-mcp issue #219 and related | 2026 |
| Code payload arrives `undefined` at the tool boundary | CodebuffAI/freebuff issue #1004 | 2026 |
| Windows: TCP server on `localhost:9876` accepts but never responds | community reports | 2026 |

Two of those four are *not model failures* — they are **the host app not being designed to be driven
headlessly and deterministically**. threepipe has no such constraint: no main-loop pump, no TCP hop,
no UI thread. That is a category-level advantage, not an incremental one.

### 2.7 Vendor landscape — who exposes what to the model (Sept 2026)

Full detail in `/Users/palash/Projects/threepipe/tmp/agent-comm/ai-3d-ecosystem/sub-vendors.md`. API-shape legend:
**(a)** structured JSON-schema tools · **(b)** code execution in the host · **(c)** GUI computer-use ·
**(d)** a DSL that *is* the persisted artifact.

**Game engines — all converged on (a) generated from existing editor APIs:**

| Vendor | What / date | Shape | Notes |
|---|---|---|---|
| **Unity** (official) | MCP server bundled in `com.unity.ai.assistant` **2.11+** (blog 2026‑05‑11); **Unity plugin for Claude Code with 29 Skills, 2026‑09‑09** | (a) + Skills | Open beta; requires Unity Cloud link + AI subscription. **The most recent first-party move was not more tools — it was 29 skills** (`/new-unity-project`, `/urp-postprocessing`, `/shader-graph-create-custom-node`, …) written by Unity engineers so the model follows Unity conventions. |
| **Unity MCP** (`CoplayDev/unity-mcp`, ~14.2 k★, pushed 2026‑09‑05) | De-facto community standard, 48 tools in groups, MIT | (a)+(b) with **progressive disclosure** | Three ideas worth stealing: **`manage_tools`** gates which tool groups are visible per session; **`batch_execute`** collapses N round-trips into one; **`script_apply_edits`** is recommended *over* raw text edits ("safer boundaries"). `execute_code` (arbitrary C#) exists but is **quarantined in a separate `scripting_ext` group**. |
| **Unreal Engine** (Epic, first-party) | MCP embedded in the editor, **UE 5.8, 2026‑06‑17**, Experimental | (a), **reflection-generated** | **The most reusable architectural idea in this survey: a "Toolset Registry" that reflects existing `UFUNCTION`s into MCP tools**, so the tool surface *derives from* the engine API rather than being hand-written. Toolsets: `SceneTools`, `ActorTools`, `MaterialInstanceTools`, `ObjectTools`. HTTP+SSE only, `127.0.0.1:8000/mcp`, **no auth**, serial on the game thread. Trade press: "early-stage plumbing rather than a hands-off technical director." |
| **Godot** | **Contribution policy 2026‑06‑30: bans autonomous AI agents / "vibe coding" in engine contributions**; bans AI generating "substantial pieces of code"; allows "menial things". Reason: volume of low-quality AI PRs made review "demoralizing" | — | **The only engine vendor with an explicitly restrictive posture. No official Godot MCP.** Community: `Coding-Solo/godot-mcp` (~5.7 k★), `hi-godot/godot-ai` (~2.4 k★, 46 tools). |

**DCC / CAD vendors — the two most instructive are at opposite extremes:**

| Vendor | What / date | Shape | Why it matters |
|---|---|---|---|
| **Trimble SketchUp Connector for Claude** | announced **2026‑04‑28**, "version 1" | **(b), three tools total** | **`get_docs`** (Claude loads the full SDK) + **`evaluate_py`** (run Python against the live model) + **`save_model`** (save, return a URL). **A major DCC vendor's production agent integration is three tools: load-the-docs, run-code, save.** Uses Python, not SketchUp's Ruby API. Limits: **generate-only — cannot edit or render an existing `.skp`**; free tier capped at 30 models; no persistence between sessions; preview is a static thumbnail. |
| **`jingcheng-chen/rhinomcp`** (~1.1 k★) | community Rhino/Grasshopper MCP | **(a)+(b), explicitly both** | **The best-published geometry-op tool taxonomy anywhere.** Ops: `create_object(s)`, `modify_object(s)`, `delete_object`, `boolean_union/difference/intersection`, `loft`, `extrude_curve`, `sweep1`, `offset_curve`, `pipe`, `project_curve`, `intersect_curves`, `split_curve`. Query: `analyze_objects`, `select_objects`, `get_object_info`, `get_document_summary`, **`capture_viewport`**. History: **`undo`, `redo` as tools**. Docs-as-tools: `search_rhinoscript_functions`, `get_rhinoscript_docs`, `list_rhinoscript_modules`. Escape hatches `execute_rhinoscript_python_code` / `execute_rhinocommon_csharp_code`, **env-gated**. **Read this in full before designing threepipe's tool list.** |
| **McNeel "RhinoAI"** | official free MCP for Rhino + Grasshopper, live 2026‑09 | (a)/(b) | Official but thinly documented; tool names unpublished. Rhino 9 public beta ~late June 2026. |
| **Autodesk Fusion MCP** (Claude connector) | **2026‑04‑28**; local MCP in a live Fusion session (port 27182) + a cloud Fusion Data MCP | **(b)+(c) mixed** | Reads geometry, **takes screenshots**, runs scripts, writes parametric timeline history, and **pulls current Fusion API docs so the agent isn't working from stale training data**. ⚠ tool names not published (Autodesk's own dev blog 403s). A PromptArmor connector-risk write-up exists — read it before copying. |
| **Autodesk Assistant** | SIGGRAPH **2026**; Maya 2027 ships an early tech preview (doc-search chatbot); planned for 3ds Max | (c)/chat | **Agentic control announced, not shipped.** |
| **Autodesk Project Bernini** | unveiled May 2024, still listed as research; 10 M shapes, ~3 B params | generative model | **Still research, no product path.** Do not model an agent API on it. |
| **PTC Onshape FeatureScript MCP** | **2026‑08‑13**, via Onshape Labs | **(d)+(b)** | The agent **authors, tests, debugs and refines a reusable FeatureScript custom feature until it works**. PTC's stated thesis: *"The real value of AI is helping engineers turn proven ideas into tools they can use again and again"* — i.e. **the agent writes a reusable parametric feature, not a mesh.** |
| **Zoo / KittyCAD KCL MCP** (`KittyCAD/mcp`) | active Sept 2026 | **(d), purest example** | Tools: `execute_kcl` (runs KCL, returns status + an **artifact-graph path**), `export_kcl` (→ STEP/STL/GLB), `format_kcl`, `list_kcl_samples`, plus explicit **session management** (`start/stop/get_modeling_sessions`, at most one per server). **The model's output is source code that *is* the parametric model.** |
| **SideFX Houdini 22** | APEX Script Comfort Package, shown at the H22 keynote / SIGGRAPH 2026; **SideFX Labs experimental channel, not core** | **(d) + knowledge retrieval** | **They shipped a documentation/DSL-grounding MCP server, not a geometry-op server.** Its job is to feed the model token-efficient, *correct* APEX syntax; the model then writes APEX Script. Deliberately narrow: one bounded high-value problem (rigging code). |
| **Adobe** | "Adobe for creativity" Claude connector, **2026‑04‑28**, 50+ tools across Photoshop/Illustrator/Firefly/Express/Premiere/Lightroom/InDesign | (a) | **Substance 3D is *not* in the list.** Adobe's first-party agent story is 2D/video; 3D is absent. Community fills it (`substance-designer-mcp`, `substance-painter-mcp` wrapping Painter's remote-scripting REST API). |
| **Shapr3D / Plasticity / Vectary / Womp** | — | none | **No agent/MCP API found.** Shapr3D's "AI" is a help chatbot + generative render. |
| **Affinity by Canva** | AI connector **2026‑04‑28** | (a)+(b) | Can **write persistent scripts into the Scripts panel for later reuse** — the same "agent leaves behind a reusable artifact" pattern as Onshape. |
| **Figma MCP** | server Jun 2025; **write mode still beta in 2026**; ships pre-built Agent Skills | (a)+skills | Exposes a frame as **structured design data, not a flat image** — the 2D analogue of "scene-graph-as-MCP-resource". |
| **Spline V2** | **2026‑08‑27** full rebuild "for the agentic era" | (a) | **The closest direct precedent to an agent-native threepipe.** They rebuilt the editor so that **MCP *is* the API** — the in-app agent and external agents (Claude Code, Cursor, ChatGPT, Codex, VS Code) share **one tool surface**. Agent manipulates objects/materials/lights/cameras/booleans/particles/cloners/lathes/variables, builds interactivity via events and states, generates HTML/JS, and **uses a constraint solver for layout rather than emitting raw coordinates**. ⚠ official tool names unpublished; the `*-spline-mcp` community repos are unrelated and largely non-functional. |

**Generation-to-edit pipelines — quads are table stakes, history is not:**

| Product | Output topology | Agent API | Verdict |
|---|---|---|---|
| **Meshy 6** (GA **2026‑01‑18**) | **Quad topology selectable at generation time** ("Smart Topology"), ~600 K faces max; remesh keeps textures following the new topology | third-party MCPs only | Quads yes, **parametric no**. |
| **Tripo 3.1** | **Quad mode** (FBX), "Smart Low Poly" | **official `VAST-AI-Research/tripo-mcp`** (~202★) via a Blender add-on | Quads yes, explicitly not parametric. |
| **Hyper3D Rodin** (Deemos) | strongest raw detail, **needs a retopo pass** | vendor-published Rodin3D Skills MCP + Blender-MCP integration | Dense mesh out. |
| **Sloyd** | **Procedural parametric templates, not diffusion** — every output editable via sliders, auto-rigged, GLB/FBX/OBJ/STL | SDK + Unity/Unreal plugins (enterprise) | **The only generator whose output is genuinely parametric/reactive**, because it never was a diffusion mesh. |
| **CSM.ai** | — | — | **Acquired by Alphabet 2026‑01‑24**, ~12 people into DeepMind. **Do not build on it.** |

> **Nobody in the diffusion-generator camp outputs parametric history or node graphs.** The industry
> answered the "tri soup is painful to refine" complaint with **quads, not with history.** That is
> precisely the niche an n-gon editing kernel occupies: quad/n-gon meshes arrive from generators, and
> something has to edit them non-destructively.

**Google — essentially absent from 3D authoring:**
Gemini computer use became a **built-in tool in Gemini 3.5 Flash on 2026‑06‑24** (public preview,
browser/mobile/desktop) — **but no Gemini-in-DCC integration exists.** Genie 3 / Project Genie
(web app 2026‑01) generates *frames*, not geometry: no exportable scene graph, no assets, no mesh.
The CSM acquisition signals intent; nothing is shipped. `model-viewer` / Scene Viewer have no AI
features. **If the maintainer meant Google's Astra, the honest answer is: there is nothing there yet.**

### 2.8 Cross-cutting: which API shape actually works, with the measured costs

| Shape | Who ships it | Evidence for | Evidence against |
|---|---|---|---|
| **(a) Structured tools** | Unity, Epic, Godot community, Spline, Figma, Adobe, generation APIs | Safety/scoping, predictable undo, no sandbox-escape surface, works with any MCP client | **Tool-count collapse:** *"a model choosing between 131 tools outperforms one choosing from 404"* (StraySpark, **2026‑07‑31**). **Round-trip cost:** a ten-step operation is ten round trips; a 40-object cleanup ≈ **400 protocol calls** (Mixar, 2026). Tools only expose what the vendor thought of. |
| **(b) Code execution** | **SketchUp (officially!)**, Fusion, rhinomcp, Unity `execute_code`, Substance MCPs | One call does N operations — solves the round-trip problem; escape hatch for anything the tool surface missed. **Anthropic's own "code execution with MCP" pattern measured 150 K → 2 K tokens (−98.7 %)** by presenting MCP servers as code APIs rather than direct tool calls | **Security:** StraySpark's red team calls sandboxed Python *"a speed bump, not a security boundary"*, and found AST allowlists miss runtime name resolution — e.g. `"{0.__class__.__bases__[0]}".format(())` traverses dunders past attribute checks. **Version drift:** generated code fails because training-data host version ≠ runtime host version. |
| **(c) GUI computer-use** | Gemini 3.5 Flash built-in tool (preview, 2026‑06‑24); screenshots used as *feedback* inside (a)/(b) systems | Needed for visual verification | **Nobody in 3D ships computer-use as the primary interface** — including GPT‑6 Astra's own Blender demos (§2.4). Vision is expensive: StraySpark cut capture cost **~178 KB → ~8 KB** per frame via JPEG. VLM hallucination of objects/attributes/spatial relations is a documented leading failure source. |
| **(d) DSL as the artifact** | Zoo/KCL, Onshape FeatureScript, Houdini APEX, Sloyd, Affinity scripts | The artifact is **reusable, diffable, re-parameterisable**. Onshape: the agent builds a reusable custom feature, not a one-shot part | Requires the host to *have* a DSL and a fast execute/verify loop; needs doc-grounding or the model writes plausible-but-wrong syntax. |

**Seven things the field converged on by Sept 2026 — treat as a checklist:**

1. **Hybrid, with the code path quarantined.** Every mature server is (a) with a *flagged* (b) escape
   hatch. Unity puts `execute_code` in a separate `scripting_ext` group; rhinomcp gates code-exec
   behind env vars; StraySpark denies it by default. Rationale (Mixar, 2026): *"structured tools alone
   prove insufficient for … complexity."*
2. **Progressive disclosure beats a big tool list.** StraySpark ships 404 tools but *hides* most:
   `describe_tools(query)` searches hidden ones, `enable_tool_category(category)` reveals a group,
   `set_tool_profile(profile)` opens everything — and a `meta` category is **forced into every profile
   in code** so the agent can never lose the ability to self-discover. Unity has the same idea as
   `manage_tools`. Independently matches TraceCAD's "progressive API grounding" (§3.5).
3. **Batch, or die of round trips.** Unity's `batch_execute`; Anthropic's code-execution pattern is the
   same insight generalised.
4. **Transactions and self-undo.** StraySpark wraps multi-step edits so they **roll back wholly rather
   than half-applying**, offers checkpoints before risky ops, and prompts before destructive ops that
   would *"orphan children, discard a dense mesh, or remove the only camera."* rhinomcp exposes
   `undo`/`redo` as tools.
5. **Ship docs as tools.** rhinomcp, Unity (`unity_docs`, `unity_reflect` = *live reflection over the
   C# API*), SketchUp (`get_docs`), Fusion (pulls current API docs), Houdini (the entire APEX server is
   this), Blender Lab (3 of 27 tools). **The single most repeated pattern in the whole survey.**
6. **Skills/prompts, not just tools.** Unity's latest first-party move (2026‑09‑09) was **29 Skills**;
   Figma ships Agent Skills; Epic ships workflow prompts. *Vendors that already have tools are now
   shipping procedural knowledge.*
7. **A verification loop.** SketchUp "verifies dimensions iteratively"; Onshape's MCP "build, test,
   debug and refine… until it works"; Unity has `validate_script` + `run_tests`/`get_test_job`; Epic
   exposes automation tests as tools. **Deterministic verification beats screenshots wherever it's
   available** — same conclusion as §3.2.

**Practitioner failure modes, dated — worth reading as a pre-mortem:**

- **Spatial precision.** *"Claude's spatial understanding is imprecise and places objects approximately
  where described; exact positioning often requires several rounds of correction"* (MindStudio,
  2026‑05‑06). **Spline V2's answer: a constraint solver in the agent's layout tool instead of raw
  coordinates.** For a mesh kernel the analogue is snapping/alignment/relative-placement operators
  rather than raw vertex coordinates.
- **Topology.** Agents generate tri soup; quads are needed for loop cuts, UV unwrap, subdiv. Sculpt
  mode is unreachable over a text protocol.
- **Rigging and weight painting are out of reach in practice** — *"too much iterative visual judgement
  to drive through a text protocol"* (two independent 2026 reports).
- **Node graphs / shader networks are the most brittle surface** across host versions.
- **Setup fragility dominates real bug reports** — double-spawned servers, add-on installed but server
  not started, client launched before server with no retry.
- **An agent API will expose latent bugs in your own core.** StraySpark found **13 real bugs** testing
  against Blender 5.2, including a wholly broken vision path (`imbuf.write_to_buffer()` wanting a file
  object, not a format string), JPEG unable to write to memory, undocumented property names
  (`stiffness` was actually `Stretchiness`), and `mathutils.Vector` lacking `__iter__` so it wouldn't
  JSON-serialise. **Budget for this.**
- **Timeouts** — heavy ops exceed windows with no queuing; hence async job + poll everywhere.
- *"Having an MCP server does not mean the AI agent using it will do useful work"* (2026‑07‑28).
- **Downstream-bottleneck critique** (CoLab, 2026‑05‑19, re Fusion MCP): faster generation doesn't help
  because *review* is the constraint. **Relevant if threepipe's agent API optimises throughput without
  a review/diff surface** — which is the same conclusion as the collateral-damage evidence in §3.4.

---

## 3. Benchmarks and research — what the 2025–2026 evidence says about API design

Full detail (267 lines, per-model numbers) in `/Users/palash/Projects/threepipe/tmp/agent-comm/ai-3d-ecosystem/sub-benchmarks.md`.
⚠ Two numbers I initially picked up from search snippets ("82–91 % editing vs 2–10 % generation";
"build123d-mcp 0.360 → 0.457") did **not** survive checking against primary data — see §3.1 and §7.

### 3.1 The benchmark landscape (primary sources, dated)

| Name | URL | Date | What it measures | Headline result | Relevance |
|---|---|---|---|---|---|
| **CADGenBench** (Hugging Face × Mecado) | github.com/huggingface/cadgenbench · leaderboard `hf.co/spaces/HuggingAI4Engineering/CADGenBench` | ~2026‑06; submission rows read cover **2026‑06‑05 → 06‑11 only** | 81 mechanical-part fixtures: **49 generation** (drawing → solid) + **32 editing** (STEP + change request → edited solid). Output STEP/BREP, tool-agnostic. "CAD Score" = hard **validity gate** (well-formed, watertight, closed manifold) → weighted mean of shape similarity (surface-distance F1, volume IoU), **interface match** (keep-in/keep-out sub-volumes), **topology match** (Betti numbers b0/b1/b2). Apache‑2.0 | Best row read: **Claude Fable 5 — CAD Score 0.4514 (gen 0.3728 / edit 0.5718), validity 96.3 %** (2026‑06‑10). Then GPT‑5.5 Pro 0.3871 (0.3208/0.4886, 87.7 %); Claude Opus 4.7 0.3691; GPT‑5.5 0.3596 (87.7 %); Gemini 3.1 Pro 0.3106 (77.8 %); two Codex validation rows at 0.011 / **3.7 % validity**. **All 14 rows read used build123d.** | **Editing scores are uniformly ~1.5–2× generation scores.** The validity-gate-then-score shape is exactly how a mesh API should be judged. |
| **BenchCAD** | arxiv.org/abs/2605.10865 | 2026‑05 | 17,900 execution-verified **CadQuery** programs, 106 industrial part families; tasks incl. **Code Edit (748 instruction→edit pairs)** | Code Edit accuracy GPT‑5.3 (thinking) **0.865**, Claude Opus 4.7 0.853, Gemini 3.1 Pro 0.837. **"~64 % of nominally successful edits silently corrupt unrelated features."** "Simple API-level edits are nearly solved… compositional edits remain difficult." **"Replacing the textual instruction with a target render collapses every model to near-zero."** Also names a "CAD Operational Blindspot": helical sweeps, twist-extrudes and lofts are largely absent from generated code, replaced by simplified sketch-and-extrude | **The single most transferable result to a mesh-editing API.** See §3.4. |
| **BIM-Edit** | arxiv.org/abs/2606.20146 | 2026‑06‑18 | **324 NL-driven editing tasks** on IFC building models; Create/Update/Delete × **Direct (108, element IDs) / Spatial (108) / Topological (108)** instruction types; agent writes Python against `ifcopenshell`. Scored **Geometry (Chamfer) / Semantic / Topology (graph-relation F1)** | Best Gemini 3.0 Flash **49.48 ± 32.72** (geo 68.87 / sem 41.81 / **topo 37.77**). **Strict solve rate (98 % threshold): 3.4 %.** Runtime failure rates up to 46.3 %. Verbatim: *"current LLM agents often approximate correct shape while failing to preserve … semantics and relational consistency"* | **Structurally the closest analogue to agentic mesh editing.** The shape-right/topology-wrong pathology is exactly what a BMesh API must defend against. Its Direct/Spatial/Topological split is the only benchmark that categorises by reference mode (per-mode numbers not extractable — §7). |
| **P3D-Bench** | arxiv.org/abs/2606.11152 | 2026‑06‑09 | 400 Text→3D + 400 Image→3D + 203 Assembly-3D cases. **Four code formats head-to-head: minimal JSON / OpenSCAD / CadQuery / Three.js.** Scores Geometry, **Topology (open-edge ratio, inverted-normal ratio, non-manifold ratios)**, Judge, Part | **"OpenSCAD is the strongest format… no clear weakness on any of them."** CadQuery lost mainly on *invalid programs*. **Three.js: Geometry 0.556 (vs OpenSCAD 0.567), validity 1.000 (tied best), but poor Topo/Part** — verbatim: *"Three.js instead outputs triangulated meshes rather than parametric solids, so it scores poorly on Topo and Part: such meshes are **not guaranteed to be watertight** and do not yield clean per-part solids for matching."* Best model overall reaches J‑Sem ≈ 0.8 but only **J‑Geo ≈ 0.35** | **The single most relevant paper for a TS/three.js API — read it first.** See §3.3. |
| **3DCodeBench** (Google DeepMind + USC) | arxiv.org/abs/2606.01057 | 2026‑05‑31 | 26 K prompts → procedural **Blender 5.0 `bpy`** code, sandboxed execution; executability, SigLIP‑2/DINOv3 similarity, Chamfer, Elo arena (~3,100 human votes); ships a **Mesh Analyzer** for invalid/non-manifold geometry | GPT‑5.5 exec 0.906 / Elo 1163; Claude Opus 4.7 exec **0.910** / Elo 1006 (highest executability, below-median Elo). **Multi-turn error feedback lifts executability 0.702 → 0.974 (+27.2 pp) but conditional visual similarity moves −0.010.** *"Physical plausibility, not mere executability, drives human preference"* — disconnected/floating parts dominate residual failures | **The key negative result.** See §3.2. |
| **Text2CAD-Bench** | arxiv.org/abs/2605.18430 | 2026‑05‑18 | 600 curated text→CAD examples, L1–L4; dual prompt styles (geometric description vs procedural sequence); Chamfer / **Invalidity Rate** / IoU | Best (GPT‑5.2, geometric prompts) L1 IR 11.1 % → **L3 IR 68.0 %**. **Representation ablation: replacing CadQuery *code* with a CAD *command sequence* raised invalidity 13.3 % → 67.3 %** on the same model/task | **The cleanest representation ablation in the literature.** Code ≫ data-structure IR. |
| **CADTests / CADTestBench** | arxiv.org/abs/2605.07807 | 2026‑05‑08 | 200 CAD programs, **5,937 executable property-based tests (~15/sample)** against CadQuery's B-rep inspection API (topology counts, bbox dims, geometric queries) | Best `CADTests+Log` with Claude: Pass-Rate 0.810, Requirement Score 0.962. **In-loop test feedback: ~+10 pp pass rate, +3 % requirement score on abstract prompts.** Test-based metrics align with human judgement at **0.938** vs Chamfer 0.663 AUC | **Assertions beat similarity metrics as a correctness signal.** Directly portable to a mesh kernel. |
| **CADCodeVerify** | arxiv.org/abs/2410.05340 (ICLR 2025) | 2024‑10 | VLM generates + answers validation questions over renders → structural/dimensional/positional feedback | **−7.30 % point-cloud distance, +5.5 % successful generation** (GPT‑4). Introduced CADPrompt | Vision-as-verifier, quantified and modest. |
| **TraceCAD** | arxiv.org/abs/2608.03062 | 2026‑08‑04 | Instruments generated code with feature-level scopes; records a **StepTrace** per operation (identity, intent, status, timing, exception evidence); failures + render feedback **persist across repair attempts** | Full system: Recovery 0.9167, Success 100 %, avg 1.5 retries. **Ablation without persistent recovery state: Recovery 0.9167 → 0.4872, Geometric Regression 0.5299.** Also introduces **"progressive API grounding"** — tiered signature disclosure, full details only when an operation needs them | **Two directly portable ideas:** per-operation traces, and tiered API-doc disclosure. |
| **BlenderGym** | arxiv.org/abs/2504.01786 · CVPR 2025 Highlight | 2025‑04‑02 | **245 handcrafted start→goal scene pairs**, 5 task families incl. **procedural geometry editing** and procedural material editing | *"Even the state-of-the-art VLM system struggles with tasks relatively easy for human Blender users."* Inference-scaling finding: *"the verifier … can itself be improved through inference scaling"* and compute *"can be optimized by strategically distributing it between generation and verification"* | **Invest in a cheap, strong programmatic verifier rather than more generation samples.** |
| **BlenderAlchemy** | arxiv.org/abs/2404.17672 · ECCV 2024 | 2024‑04 | Iterative refinement of Blender visual programs; **vision-based edit generator + visual state evaluator + search with an edit-reversion mechanism**; "visual imagination" grounds abstract text in a generated reference image | 73 % human preference over Paint3D, 56 % over TEXTure | **Edit-reversion/search-with-rollback maps onto snapshot/undo primitives.** |
| **VIGA** | arxiv.org/abs/2601.11109 · github.com/Fugtemypt123/VIGA | 2026‑01 | Analysis-by-synthesis: reconstruct an image as an **editable scene program**; generator/verifier alternation with evolving contextual memory | **+35.32 % BlenderGym, +124.70 % BlenderBench, +117.17 % SlideBench vs one-shot** | The strongest headline number for code→render→inspect. |
| **BlenderBench** | huggingface.co/datasets/DietCoke4671/BlenderBench (CC BY 4.0) | 2026 | **30 tasks** (27 public): camera adjustment, multi-step editing, compositional editing; explicitly targets multi-step agentic behaviour | — | Scene/camera/attribute editing, **not topology editing**. |
| **BlenderBench-direct runner** | github.com/bpy-dev/blender-mcp `benchmarks/blenderbench_direct/` | 2026‑09 | Model-neutral re-run of the 27 public tasks, **10 sequential saved edit/render/visual-inspection rounds per task**; CLIP cosine + photometric loss via VIGA's hash-pinned `ref_based_eval.py` | 27 tasks / 270 rounds | **Read its protocol** — hash-pinned CLIP snapshot, locked torch wheel, sandboxed Codex, no evaluator feedback during generation. Most rigorous reproducibility setup found. |
| **SEIG** ("Thinking in Blender") | arxiv.org/abs/2606.02580 | 2026‑06‑01 | Single image → editable Blender program by **staged** refinement: geometry → materials → composition → lighting | Staging improves fidelity over monolithic generation | Name the phases; don't ask for everything at once. |
| **ShapeCraft** | arxiv.org/abs/2510.17603 | 2025‑10‑20 | **Graph-based Procedural Shape**: flat single-level DAG, each node = description + **bounding volume (cx,cy,cz,h,w,l)** + an executable Blender code snippet; serialised as JSONL | IoGT **0.471** vs 3D‑PREMISE (pure code) 0.385, CADCodeVerify 0.334 on the same subset | **Hybrid graph-of-code beats pure code.** The per-node declared bounding volume is a cheap machine-checkable contract. |
| **LL3M** | arxiv.org/abs/2508.08228 · github.com/threedle/ll3m | 2025‑08‑11 | Multi-agent Blender Python with **BlenderRAG** — retrieval over 1,729 pages of the Blender 4.4 Python API docs — plus a Gemini visual-critique loop | Qualitative | **The mitigation for a large API surface is retrieval, not memorisation.** |
| **CAD-Recode** | arxiv.org/abs/2412.14042 · ICCV 2025 | 2024‑12 / 2025‑03 | Point cloud → **CadQuery Python code** | Outperforms prior methods on DeepCAD/Fusion360/CC3D. Secondary claim: *"our CAD Python code output is interpretable by off-the-shelf LLMs, enabling CAD editing and CAD-specific question answering"* | **Code is the interoperable IR that a *different* model can then edit** — the argument for scripting-API-first. |
| **CADBench** (MIT DeCoDE) | arxiv.org/abs/2605.10873 | 2026‑05‑11 / 06‑18 | 18 K samples, 5 input modalities, 6 metrics incl. **program compactness** | *"specialized mesh-to-CAD models substantially outperform code-generating VLMs, which remain far from reliable CAD program reconstruction"* | **The only benchmark that scores verbosity directly.** ⚠ name collision with a different "CADBench" from the BlenderLLM project — disambiguate before citing. |
| **MUSE** | arxiv.org/abs/2605.28579 | 2026‑05‑27 | Text→editable B-Rep assemblies; 3-stage gate: code validation → geometric verification → design-intent alignment | *"failure cascade from executable code to valid geometry and finally to engineering-ready design"* | The staged gate is a good scoring skeleton. |
| **ShapeUP** | arxiv.org/pdf/2602.05676 | 2026‑02 | 24 meshes × 100 edit conditions, "global 3D mesh editing" | — | **Image-conditioned neural/diffusion editing, not agentic.** No operations, no element selection. |

### 3.2 Feedback loops: what they actually buy (and what they don't)

This is the biggest refinement to §5.1 of the prior survey. The effects are *not* interchangeable:

| Feedback type | Effect on **validity** | Effect on **geometric correctness** | Source |
|---|---|---|---|
| **Execution error messages, multi-turn retry** | **Huge: 0.702 → 0.974 executability (+27.2 pp)** | **≈ none: −0.010 conditional visual similarity** | 3DCodeBench, 2026‑05‑31 |
| **Executable assertions / property-based tests in the loop** | — | **+~10 pp pass rate, +3 % requirement score**; test-based metrics match human judgement at 0.938 vs Chamfer 0.663 | CADTests, 2026‑05‑08 |
| **Numeric measurement before render** | — | prescribed as *"the primary proof"*; "using `render_view` as geometric proof" is a listed top LLM mistake | build123d-mcp llms.md |
| **VLM validation questions over renders** | — | **−7.30 % point-cloud distance, +5.5 % success** | CADCodeVerify, 2024‑10 |
| **Iterative refinement with visual feedback** | — | **model-dependent**: +0.030 avg for Gemini 3.1 Pro, ≈ unchanged for GPT‑5.5 | P3D-Bench Table 5, 2026‑06‑09 |
| **Renders used as the *goal spec*** | — | **catastrophic: "collapses every model to near-zero"** | BenchCAD, 2026‑05 |
| **More input views** | — | *"largely insensitive to the input-view budget"* — no consistent gain over N=1 | 3DCodeBench |
| **Persistent structured state across repair attempts** | — | **Recovery Score 0.9167 → 0.4872 without it** | TraceCAD, 2026‑08 |

**Consolidated:** error messages buy *syntactic* correctness almost for free and buy nothing else.
**Deterministic measurements and assertions are what buy geometric correctness**, at a consistent but
modest 5–10 pp. Renders are a *weak verifier* and a *catastrophic specification*. Persistent,
re-attachable state across repairs is worth more than any prompt change.

This tempers §0.3 and VIGA's headline: the VIGA/BlenderGym gains come from the *whole* loop, of which
the render is one part and the cheapest part to over-invest in. **Build `measure()` and `validate()`
before `renderPreview()`.**

### 3.3 P3D-Bench's Three.js result — read this twice

P3D-Bench is the only benchmark that scored **Three.js as a code-generation target**, head to head with
JSON, OpenSCAD and CadQuery on identical models. The result:

- **Validity: 1.000** — tied best, better than CadQuery's 0.937. LLMs write valid three.js.
- **Geometry: 0.556** — essentially level with OpenSCAD's 0.567 and ahead of CadQuery's 0.524.
- **Topology and Part: poor.** Verbatim: *"Three.js instead outputs triangulated meshes rather than
  parametric solids, so it scores poorly on Topo and Part: such meshes are **not guaranteed to be
  watertight** and do not yield clean per-part solids for matching."*

**The deficit is not the language, the ecosystem, or the model's familiarity — it is precisely the
absence of a topology-aware representation with a watertightness guarantee.** That is the exact thing
threepipe's proposed n‑gon/BMesh kernel plus a manifold gate supplies. This is the strongest
published, quantitative argument for building it, and it should be quoted in the project's rationale.

### 3.4 The dominant editing failure is collateral damage, not the target edit

Two independent 2026 benchmarks report the same pathology:

- **BenchCAD (2026‑05):** simple API-level edits are *nearly solved* (0.837–0.865 for frontier models),
  but **"~64 % of nominally successful edits silently corrupt unrelated features."**
- **BIM-Edit (2026‑06‑18):** geometry 68.87 vs **topology 37.77**; strict (98 %) solve rate **3.4 %**.
  *"LLM agents often approximate correct shape while failing to preserve … semantics and relational
  consistency."*

**Design consequences, and these are the ones that matter most for a BMesh API:**
1. **Edit locality must be measurable.** After every transaction, a cheap `diff(before, after)` that
   reports which elements/groups/attribute layers changed — and, critically, which changed that the
   operator did not claim to touch. build123d-mcp has exactly this (`shape_compare()` flags "regions
   that moved" with added/removed volumes; `diff_snapshot`), and says it exists *because* of this
   problem.
2. **Attribute/topology preservation is the scored quantity, not vertex positions.** This retroactively
   justifies P4 (per-corner `CustomData` layers as core, not bolted on) far more strongly than the
   original survey argued: if UVs/creases/seams/material indices silently drop, the agent cannot tell,
   and the published evidence says that is the *majority* failure case.
3. **A re-runnable spec contract** (`verifySpec`) applied after each edit turns silent corruption into
   a FAIL. Re-run it as an acceptance gate after *every* subsequent edit, not just the one it was
   written for.

### 3.5 Representation and API-surface size

| Question | Verified finding | Source |
|---|---|---|
| **Executable code vs a JSON/command-sequence IR** | **Code wins decisively.** Text2CAD-Bench: swapping CadQuery code for a command sequence raised invalidity **13.3 % → 67.3 %**. P3D-Bench: JSON worst on multi-part assemblies | 2026‑05 / 2026‑06 |
| **But a *small* surface beats a large fluent one** | P3D-Bench: OpenSCAD strongest overall, CadQuery lost on *invalid programs* not on reasoning. GrandpaCAD (⚠ vendor blog, undated, single cheap model, confounded CadQuery arm): OpenSCAD ~0.4 code errors/generation vs build123d ~1.4–1.7 — *"a large, fluent, chainable API with hundreds of methods and strict expectations"* is the failure mode | 2026‑06 / undated |
| **Docs-in-context mitigation** | Real but small: adding an API reference cut build123d errors 40 → 33 (~18 %), nowhere near closing a 3–4× gap (⚠ same vendor source) | undated |
| **Tiered / progressive API disclosure** | TraceCAD's *"progressive API grounding"*: common operations and constraints at the entry point, *"detailed signatures, examples, and modeling notes … disclosed only when a requested operation needs them"* | 2026‑08 |
| **RAG over API docs** | LL3M's BlenderRAG over 1,729 doc pages, as a dedicated retrieval agent before the coding agent | 2025‑08 |
| **Program compactness** | Scored as a first-class metric only by CADBench (MIT) | 2026‑05 |
| **Hybrid graph-of-code** | ShapeCraft's flat DAG with code in the leaves beat pure-code baselines (IoGT 0.471 vs 0.385/0.334) | 2025‑10 |

**Synthesis, and it is a real tension:** code beats data structures, *and* a small surface beats a
large one. For threepipe that means: **one small, orthogonal, well-named operator core** (the BMesh
operator set is already exactly this — ~30 ops, each one options-object), **plus tiered docs and
retrieval** rather than a sprawling fluent/chainable API. Resist adding convenience method chains;
they are what made CadQuery/build123d lose to OpenSCAD on validity. Also note: an options-object
operator is *closer to OpenSCAD's descriptive style* than to a fluent chain — which is the good side
of this result.

### 3.6 Element referencing — practice is ahead of the literature

**No controlled quantitative study exists** comparing integer element IDs vs re-evaluable selectors vs
named handles for LLM agents (⚠ §7). The best-documented production tool made a clear choice:

- **build123d-mcp uses named handles — explicitly "not IDs and not selectors."** Geometry is registered
  with human-readable labels (`show(frame, "frame")`); tools take an `object_name` string defaulting
  to the current shape.
- **Sub-element access is via query *functions returning plain records*, filtered in ordinary code:**
  `find_holes()`, `find_bosses()`, `cross_sections()` return structured records, so the agent writes
  `[h for h in find_holes(part) if h.location[0] < 5]`. **The query is a first-class function whose
  result is ordinary data — not an opaque selector string.** (This is the concrete refutation of
  CadQuery-style `".faces('>Z')"` string DSLs that the prior survey suspected LLMs hallucinate.)
- **`design_audit()` detects brittle references automatically:** it perturbs each top-level numeric
  assignment by ±ε, rebuilds out-of-process, and classifies each parameter `robust` / `brittle` /
  `coupling` / `not_a_design_parameter`, returning `needs_review` because *"coupling and degenerate
  selectors are ambiguous."* **This is an automated topological-naming check, and the idea ports
  directly:** perturb an operator parameter, re-run, and report whether the selection resolved to the
  same elements.
- **Semantic feature queries beat geometric selectors:** *"Curved-sheet hole centers: face centers can
  be off-axis on BSpline faces; trust the bore axis from `find_holes()`."*
- **Relationships survive re-evaluation; absolute placement does not:** *"Assembling with raw `.move()`
  instead of joints — absolute positioning breaks when parent geometry changes."*

**Revision to P3:** keep stable IDs for the UI/undo layer, but make the *agent-facing* reference model
**(a) named groups/handles registered by the script, and (b) query functions returning plain inspectable
records** — not an ID soup and not a selector-string DSL. Add a `design_audit`-style perturbation check.

### 3.7 Procedural / node-graph generation — thin, and it fails predictably

**There is no benchmark for LLM generation of Blender Geometry Nodes trees, and none for Houdini
HDA/VEX generation.** What exists: `treegen-llm` (Blender add-on, Sept 2025, MIT, Qwen2.5‑7B — the LLM
*fills parameters into a fixed node template* and ships a "few-shot + retry mechanism [that] ensures
valid socket values even if inference fails"); `blender-mcp-Geometry_Nodes` (unbenchmarked);
NodeArchitect for Houdini (commercial, no published numbers).

Practitioner report (mindstudio.ai, 2026): *"Claude can generate basic node graphs, but anything beyond
a few nodes tends to produce errors or incorrect connections. Geometry Nodes in particular is brittle;
the API changes between Blender versions."* Concrete failure: socket/link construction from Python —
virtual sockets don't auto-create (cf. Blender bug #105619).

**Consolidated failure modes:** (a) socket/link type-validity — the graph is a typed bipartite
structure and models produce dangling or type-invalid links; (b) API/version drift vs stale priors;
(c) degradation past a handful of nodes; (d) no evaluation exists, so none of it is quantified.

**Design implication:** the two systems that got usable results both **constrained the graph** —
ShapeCraft to a flat DAG with code in the leaves, treegen-llm to parameter-filling on a fixed template.
If threepipe ever exposes a procedural graph to agents, constrain it the same way; do not ask a model
to author arbitrary node+link topology.

### 3.8 The gap: nobody benchmarks agentic *polygon* mesh editing

**Explicit finding, searched five ways: as of 2026‑09‑14 there is no benchmark, paper or leaderboard
evaluating an agent performing extrude / bevel / inset / loop-cut / boolean / merge on an existing
mesh, with element selection and topology preservation as the scored quantity.**

Closest neighbours and why each isn't it: BenchCAD edits *CadQuery source*, not mesh topology;
CADGenBench's 32 editing tasks are B-rep/STEP with text-described changes; BIM-Edit edits *building
elements*; BlenderGym edits *scripts driving procedural parameters*; ShapeUP is *image-conditioned
neural* editing with no operations.

**Two consequences.** First, building this API means building the only thing that can currently measure
it — budget for the harness, not just the kernel. Second, **a small n-gon mesh-editing benchmark
("BMeshBench": start mesh + instruction + validity/locality/attribute-preservation scoring) is an
unclaimed contribution** that would also be threepipe's regression suite. Given that both editing
benchmarks that *do* exist report the same collateral-damage pathology, the scoring axes are already
clear: target-edit correctness, **edit locality**, **attribute preservation**, and manifoldness.

---

## 4. Web 3D engine / editor landscape, September 2026

Full detail (5 tables, ~300 lines) is in `/Users/palash/Projects/threepipe/tmp/agent-comm/ai-3d-ecosystem/sub-webland.md`;
this section keeps what changes threepipe's decisions. All GitHub/npm numbers pulled from
`api.github.com` / `registry.npmjs.org` on 2026‑09‑14.

### 4.1 three.js — WebGPU is *still not* the default, and that is the important news

| Item | Value |
|---|---|
| Latest release | **r186**, 2026‑09‑08 (npm `three@0.186.0`) |
| 2026 cadence | r183 2026‑02‑20 · r184 2026‑04‑16 · r185 2026‑07‑01 · r186 2026‑09‑08 |
| Stars | 115,505 |

**Verified directly from `dev/package.json` (v0.186.0):** `"."` → `./build/three.module.js` (the
**WebGL** build); `"./webgpu"` and `"./tsl"` are opt-in subpaths. **There is no WebGLRenderer
deprecation notice and no announced removal date.** Every blog claiming otherwise is wrong (the
sub-agent flagged utsubo.com, buildmvpfast.com, threejsroadmap.com, webo360solutions.com and
byteiota.com as containing verifiable factual errors — do not cite them).

**The most important 2026 three.js change for threepipe:** r184 (2026‑04‑16) added a **`NodeMaterial`
compatibility layer to `WebGLRenderer`** (#32851, @gkjohnson/@sunag), hardened in r186 with
"Support Node Materials in `compile()`" (#34232). TSL/node materials no longer require
`WebGPURenderer`. r186 also landed **SunLight + cascaded shadow maps on `WebGLRenderer`** (#34221) —
a major *new* feature on the "legacy" renderer. The direction is convergence, not replacement.

**Shader-fork hazard for `three.js-modded`, r184→r186:** PMREM switched from separable to spiral blur
on both renderers (#32367); multi-scatter energy compensation reworked (#33983/#34046); iridescence
IBL fix (#33984); `MeshPhysicalMaterial` retroreflectivity (#33949/#33995); **`PCFSoftShadowMap`
removed** from the new `Renderer` path (#33987). Expect conflicts. *(Flagging here since it affects
the modelling work's base branch; belongs in a separate issue.)*

Also directly useful to a modeller: `Ray` got a **watertight `intersectTriangle()`** (#33661),
`Object3D.dispose()` (#34141), `Object3D.intersectsFrustum()` (#34065).

**The bundled `editor/` is alive but incremental** (group selection 2026‑08‑24 #34144; orthographic
cameras 2026‑06‑05; Rhino3dm import 2026‑08‑07). It remains a **scene assembler with no sub-object
mode and no mesh-editing ops**. Nothing in the 2026 changelog suggests an official Blender-alike is
coming. **That is the gap.**

### 4.2 Verified: frontier agents are already committing to three.js core

Counted directly from the release-note co-author credits on github.com/mrdoob/three.js/releases:

| Release | Date | `@claude` co-author credits | `@cursoragent` |
|---|---|---|---|
| r183 | 2026‑02‑20 | **32** | 0 |
| r184 | 2026‑04‑16 | **25** | 0 |
| r185 | 2026‑07‑01 | **36** | 0 |
| r186 | 2026‑09‑08 | **54** | 2 |

These are not docs typos — they include shader work: PMREM spiral blur (#32367), the
`PCFSoftShadowMap` removal (#33987), reversed-depth renderOrder (#33945), render-target viewport
scaling (#34333). **Agent-co-authored commits to the flagship WebGL library are now routine and
rising.** This is the strongest single answer to "is this real or hype" in the web 3D space, and it
is a *primary* source.

### 4.3 Every serious web 3D editor shipped an agent surface between June and September 2026

| Product | Agent surface | Date | Shape | Note |
|---|---|---|---|---|
| **Babylon.js** | MCP-servers suite — every tool (Node Material Editor, Node Particle Editor, GUI editor, Editor) gets an "MCP-Session" section so an agent drives it via a session URL | **2026‑06‑04** (forum 63591; docs `doc.babylonjs.com/toolsAndResources/mcpServers`) | Structured tools over a live session | |
| **PlayCanvas** | `playcanvas/editor-mcp-server` — attaches to a **live Editor session** (toolbar button, default port 52000); **20+ tools**: create/modify/delete entities & assets, scene settings, launch the app in a real browser, **capture viewport screenshots**, search the store | 2026 | Structured tools + screenshots | **Cleanest design to copy** for a web editor. |
| **Spline** | MCP server; external agents (Claude Code, Cursor) drive the 3D editor; in-app AI creates objects/materials/lights/cameras/**booleans**/particles; a Code tab for procedural generation | V2 **2026‑08‑21**, Hana V2 **2026‑08‑28** | Structured tools + code tab | Spline V2 ships a **WebGPU renderer on a TSL-based backend** with WebGL fallback — a commercial product already on three.js's WebGPU/TSL stack. **The bar to clear.** |
| **Needle Engine** | Needle Inspector (Chrome DevTools extension) works on *any* three.js / R3F site — hierarchy, live transform/material/light/texture editing with undo/redo; **Pro adds AI editing via MCP** | v5.0.0 March 2026 | DevTools + MCP | **Closest architectural sibling to threepipe** (three.js, glTF-centric, Blender/Unity exporters). They chose "author in Blender, ship to three.js" instead of "model in the browser". |
| **Onshape (PTC)** | **FeatureScript MCP Server** — LLMs author, test and debug reusable FeatureScript features from natural language. Plus Onshape Labs (July 2026): engineering agents, prompt-based CAD | Aug 2026 | **MCP over their modelling DSL** | Enterprise CAD vendor endorsing "expose your DSL, let the agent write features". |
| **Zoo / KittyCAD Design Studio** | **KCL** — every UI action emits KCL; bidirectional code↔CAD. Plus "Zookeeper" conversational CAD agent and the ML‑ephant API | v1.4.8 2026‑09‑11 | DSL round-trip | **The pattern threepipe should study most closely.** |
| **PartMode** | Tagline: *"local-first 3D parametric CAD that runs in the browser **for people and permissioned typed agents**"* (OpenCascade WASM + replicad + three.js) | 524★, last commit 2026‑08‑17 | Typed ops + permission boundary | The only browser CAD naming agents as a first-class user. "Permissioned typed agents" is the phrase to steal. |
| **three.js editor / threepipe** | — | — | — | **Nothing.** |

**The 2026 pattern is not "AI draws a mesh". It is `agent ↔ typed/scriptable modelling API`, with the
GUI as one of two equal front-ends.** Making every GUI operation emit a scriptable op buys undo/redo,
headless Node execution, deterministic tests and the agent API in a single design decision.

### 4.4 Browser Blender-alikes: traction ranking and the open category

| Project | ★ (2026‑09‑14) | Last commit | What | Verdict |
|---|---|---|---|---|
| **Chili3d** | **4,833** | 2026‑09‑08 (v0.7.0, 2026‑08‑23) | Browser CAD: OCCT→WASM + three.js, TypeScript | Highest-traction open browser 3D CAD. Read its command/undo architecture. |
| **kokraf** | 576 | 2026‑09‑13 | VEF-adjacency mesh core → BufferGeometry for render only; three.js + vanilla JS + Supabase | The closest comparable. **No AI/agent features, no MCP.** |
| **PartMode** | 524 | 2026‑08‑17 | OCCT-WASM parametric CAD "for people and permissioned typed agents" | The agent-native framing. |
| **blender-wasm** (Puter) | 87 | 2026‑09‑11 (v1.0.0 2026‑07‑30) | **Real Blender compiled to WASM with a WebGPU backend**, full UI in a tab | Technically the headline 2026 result; 87★ = demo, not platform. Gives you no embeddable/scriptable library. |
| SculptGL | 1,504 | **2023‑09‑16** | banner: "DEVELOPMENT STOPPED" | Dead (author → Nomad Sculpt). |
| Clara.io | — | — | — | **Shut down 2022‑12‑31.** The cautionary tale. |
| CADmium / opencascade.js | — | 2023 | — | Dead / stale ~3.5 yrs. Downstreams maintain their own OCCT-WASM builds. |

**None of the live ones has disclosed funding. There is no funded, open, general-purpose browser
polygon modeller. The category is open.**

Supporting libraries worth noting: **manifold-3d v3.5.3 (2026‑09‑07)**, 2,271★, last commit
2026‑09‑13, and the Sept‑2026 commit adds **optional ID tracking and no degenerates (#1790)** — ID
tracking is what lets face/material attribution survive a boolean, which matters for an agent that
must re-reference geometry afterwards. Babylon's `CSG2` (`InitializeCSG2Async` + `manifold-3d`) is
**proven to work headless in Node** — the strongest prior art for threepipe's boolean backend.
`three-bvh-csg` is still 0.0.x. `three-mesh-bvh` v0.9.15 (2026‑09‑09) is essential for
selection/raycast/snapping.

### 4.5 WebGPU status (gpuweb Implementation-Status wiki, read 2026‑09‑14)

Shipping by default: Chrome/Edge (macOS, Windows x86/64, ChromeOS, Android), **Safari 26** (macOS,
iOS, iPadOS, visionOS), Firefox **141** (Windows) / **145–147** (Apple Silicon macOS).
**Still gaps: Firefox on Linux and Android (Nightly only), Firefox on Intel Mac, Chrome on Windows
ARM64, Chrome on X11 Linux** (Intel Gen12+ from Chrome 144; NVIDIA Wayland from 147).

Shipped WebGPU-by-default in a product: **SuperSplat Editor 3.0 (2026‑09‑09, WebGPU-only)**,
**Spline Hana (2026‑08‑28)**, Spline V2 (TSL backend + WebGL fallback), blender-wasm, Bevy on web.
Not default: three.js, Babylon.js, PlayCanvas engine, Godot web (WebGL2 only — WebGPU not
implemented).

**Read for threepipe: keep the WebGL2 path. A compute-shader-dependent modelling kernel silently
degrades on Linux Firefox and X11 Chrome.**

### 4.6 2026 entrants, with funding

| Name | Funding / date | What | Relevance |
|---|---|---|---|
| **Meshy** | **~$400 M Series B at $1.5 B, July 2026** — largest AI‑3D round to date | text/image → 3D assets; Meshy 6 GA 2026‑01‑18, "sculpting-level", ~600 K faces, topology/polycount/symmetry/remesh controls, Low Poly Mode | Asset **supply**. A browser modeller is the *editing layer on top of generated meshes* — that is the integration point. |
| **Tripo AI** | ~$200 M (2026‑06‑01), cumulative ~¥3 B | text/image → 3D; **quad-topology model announced with the round** | **Generated meshes are becoming editable-by-a-modeller rather than triangle soup.** This makes an n‑gon editor *more* valuable, not less. |
| **Backflip AI** | $30 M Series A (a16z, NEA); CAD copilot launched **2026‑08‑03** | scan/STL/mesh → **editable parametric CAD**; Fusion add-in + web app | The hardest version of the reverse problem. |
| **AdamCAD / CADAM** | YC W25; **$4.1 M seed 2025‑10‑31**; >1 M models generated | text → parametric CAD in browser; conversational copilot replaces the CAD UI | text→script→geometry is now a fundable category. |
| **Autodesk Wonder 3D** (Flow Studio) | March 2026 | text/image → 3D characters & objects | Incumbent entering gen‑3D. |

---

## 5. Implications for threepipe — what an agent-native modelling API should look like

These build on, and in several places *revise*, §7 of `research-ecosystem.md`. Nothing here is a
decision; they are recommendations with the evidence attached.

### 5.1 Revisions to the existing principles

| Prior principle | Status after this survey |
|---|---|
| **P2 — options-object operators, mechanically convertible to JSON-schema tools** | **Confirmed, and the mechanism now has prior art: Epic's UE 5.8 "Toolset Registry" reflects existing `UFUNCTION`s into MCP tools** so the tool surface *derives from* the engine API. For a typed TS codebase this maps directly (schema from the options-object type). But see the next row — generating 400 tools is a mistake. |
| **P3 — stable IDs + re-evaluable queries** | **Revised.** Keep stable IDs for UI/undo. But the agent-facing reference model should be **(a) named handles/groups the script registers** and **(b) query *functions returning plain records*, filtered in ordinary code** — not integer-ID soup and **not a selector-string DSL**. This is build123d-mcp's explicit choice ("named handles, not IDs or selectors"), and it dissolves the hallucinated-selector-syntax risk the prior survey worried about. Add a **`design_audit`-style perturbation check**: perturb a parameter by ±ε, re-run, report whether the selection resolved to the same elements — an automated topological-naming test. Also add an affordance to *see* what a selection resolved to (`render(highlight: sel)`). |
| **P4 — per-corner attribute layers are core** | **Strongly strengthened.** BenchCAD: **~64 % of nominally successful edits silently corrupt unrelated features**; BIM-Edit: geometry 68.9 vs topology 37.8. If UVs/creases/seams/material indices silently drop, the agent cannot tell — and the published evidence says that is the *majority* failure case, not an edge case. |
| **P8 — validity is queryable** | **Upgraded to a three-valued contract:** `PASS / FAIL / UNVERIFIED` with evidence tiers and an anti-vacuous-truth rule (build123d-mcp's `verify_spec`). Also: CADGenBench gates on validity *before* scoring anything else — mirror that ordering. |
| **P9 — "give agents eyes and a ruler"** | **Promoted to the #1 deliverable, but reordered: ruler first, eyes second.** 3DCodeBench: error feedback lifts executability +27.2 pp but geometric quality −0.010. CADTests: assertions give +~10 pp and match human judgement at 0.938 vs Chamfer's 0.663. BenchCAD: renders as a *goal spec* "collapse every model to near-zero". build123d-mcp: *"Do not proceed to `render_view` until `measure` passes."* |
| **P10 — the scripting API *is* the agent API** | **Confirmed with a reference implementation** (build123d-mcp: analysis functions callable both as tools and inside `execute`, returning real objects) and **commercially** (Spline V2 rebuilt so "MCP *is* the API" — in-app agent and external agents share one tool surface; Zoo/KCL; Onshape FeatureScript). |
| **P7 — node-safe by construction** | **Promoted to the core differentiator.** Two of the four top BlenderMCP failure modes are "the host can't be driven headlessly". Blender's own MCP had to grow `_for_cli` twins and a standalone-`bpy` backend to get there; GPT‑6 Astra's demos are `--background` subprocess spawns. threepipe starts there. |
| **— new — P12: edit locality is a first-class, measured guarantee** | Not in the prior survey. After every transaction, report which elements/groups/attribute layers changed **and which changed that the operator did not claim to touch**. This is the single most-supported new requirement in the 2026 literature (§3.4). build123d-mcp's `shape_compare()` / `diff_snapshot` exist precisely for this. |
| **— new — P13: keep the surface small; disclose progressively** | P3D-Bench: OpenSCAD (small, declarative) beat CadQuery (large, fluent) — and lost on *validity*, not reasoning. StraySpark: *"a model choosing between 131 tools outperforms one choosing from 404."* TraceCAD's "progressive API grounding"; Unity's `manage_tools`; StraySpark's `describe_tools` / `enable_tool_category`. **Resist convenience method chains.** An options-object operator is closer to OpenSCAD's descriptive style than to a fluent chain — that is the good side of this result. |

### 5.2 The recommended agent surface (concrete)

Seven groups. Blender Lab MCP (27 tools), build123d-mcp (27 tools), rhinomcp and PlayCanvas
editor-mcp-server (20+) independently landed on the same taxonomy.

**A. Execute — the primary surface, sandboxed.**
`execute(code)` against a **persistent, inspectable TS session** holding meshes, named objects and
variables. The evidence is unambiguous that agents fall through to code (SketchUp's *official* vendor
integration is literally `get_docs` + `evaluate_py` + `save_model`), and equally unambiguous that
unguarded code-exec is a liability (Blender Lab: "run it in a VM").
- Module allowlist (threepipe's `/graph` + modelling subpath, `three` types, `Math`); **no** `fs`,
  `child_process`, `net`, `http`, no dynamic `import()`.
- No `eval` / `Function` / prototype-chain escape; wall-clock + heap budget per call.
- All file I/O through tools (`exportGltf`, `renderPreview({ saveTo })`), never from user code.
- On a blocked call, a named error saying *which* rule fired and *what to do instead*.
- A `--no-sandbox` trusted-mode switch for local dev (build123d-mcp's pattern).
- ⚠ **Be honest in the docs**: StraySpark's red team calls a language-level sandbox *"a speed bump,
  not a security boundary"* and demonstrated `"{0.__class__.__bases__[0]}".format(())` defeating AST
  allowlists. For untrusted input the real boundary is a worker/process/VM, not a linter. In a browser
  a Worker + structured-clone boundary is genuinely strong; in Node it is not.
- **A failed `execute` must not advance state** — state it explicitly to the model.
- **`batch(ops[])`** — a 40-object cleanup over structured tools is ~400 protocol calls. Anthropic's
  own code-execution-with-MCP pattern measured **150 K → 2 K tokens** by presenting servers as code
  APIs; `execute` already gives threepipe that, but a structured `batch` is needed for the tool path.

**B. Measure / describe — called first, always.**
`describe(target, { depth })` — compact, budgeted, LOD-aware; never a full dump.
`measure(mesh)` → `{ verts, edges, faces, tris, bbox, volume, area, eulerCharacteristic,
boundaryLoops, nonManifoldEdges, materialSlots, attributeLayers }`.
`selectionInfo(sel)` → what a query *actually* resolved to, with representative ids + bboxes.
`diff(a, b)` → **P12**: changed elements/groups/attribute layers, split into *claimed* and *collateral*.
All of these must also be **plain importable TS functions** so code can compute over them
(`measure(mesh).volume`), not tool-only.

**C. Validate — three-valued, never vacuously true.**
`validate(mesh)` (port `bmesh_mesh_validate.cc`) → structural tier.
`verifySpec(mesh, spec)` → per-requirement `PASS | FAIL | UNVERIFIED`, each tagged
`measured | structural | derived | unverified`; `conforms` is false unless ≥1 requirement was
*actually checked*. Mesh spec keys: `bbox`, `volume`, `counts`, `manifold {closed, orientable}`,
`genus`, `boundaryLoops`, `groups: [{name, faceCount}]`, `attributeLayers`, `materialSlots`,
plus **`unchanged: [group…]`** for locality. **Re-run the spec as an acceptance gate after *every*
subsequent edit**, not just the one it was written for.

**D. Eyes — second, not first.**
`renderPreview({ camera, size, highlight?: Selection, clip?: axis, labels?: bool, format })` returning
a PNG **plus** a JSON description of what was rendered.
- **`highlight` is the high-value one.** build123d-mcp's `render_view(highlights=[{object, type:
  face|edge|vertex, index, label}])` exists to *"verify 'edge 5 is the one I want to fillet' before
  committing to the operation."* **That is a proven answer to threepipe's hardest agent problem, and
  it is a cheap second pass with an overlay material.**
- Two quality tiers (cheap thumbnail / full); keep captures small (StraySpark: ~178 KB → ~8 KB per
  frame via JPEG materially changed cost).
- `format: 'json'` — return projected topology as *parseable data*, not pixels, when the question is
  geometric rather than aesthetic (build123d-mcp uses DXF for this).
- Headless, in Node, via the existing polyfill. **This is the moat.**

**E. Session / history.**
`transact(label, fn)` (P6) is the unit of undo; it must **roll back wholly rather than half-apply**.
Expose `snapshot(name)` / `restore(name)` / `diffSnapshot(a, b)` as the agent-facing wrapper, and be
honest about what is *not* captured. Document the **"proposal" pattern**: snapshot → mutate → measure →
restore, so the agent evaluates "what if" on real geometry rather than reasoning about it
(build123d-mcp: *"Don't redraw the geometry … to evaluate it — that's lossy and disagrees with the
model"*). Prompt before destructive ops (StraySpark: ops that "orphan children, discard a dense mesh,
or remove the only camera"). TraceCAD: **persistent state across repair attempts is worth more than any
prompt change** (Recovery 0.92 → 0.49 without it) — so the session must survive a failed op.
**Deterministic replay:** a session is a list of `(opName, params)` transactions; replaying it on the
same input must produce a byte-identical glTF. One mechanism gives you regression tests, reproducible
bug reports, and the `.blend`-equivalent deliverable. It requires no `Math.random()`, no wall-clock, and
**stable iteration order over element maps — decide this at kernel-design time, it is unfixable later.**

**F. Error recovery.**
Operators return `{ ok, warnings, created, removed }` rather than throwing for recoverable conditions.
On a thrown error: failing line + a 5-line excerpt (`lastError()`), **matched repair hints appended
inline**, a keyed `repairHints(errorText)` library, and a `workflowHints()` telling the agent which tool
to reach for next. Cheap, and it buys the +27.2 pp executability effect.
Also: **an agent API will expose latent bugs in threepipe's own core** (StraySpark found 13 in Blender
5.2 this way). Treat those as issues in `issues/open`, not as agent problems.

**G. Docs as tools and as zero-round-trip resources.**
The most repeated pattern in the entire survey — rhinomcp, Unity (`unity_docs`, `unity_reflect` = live
reflection), SketchUp (`get_docs`), Fusion (pulls *current* API docs so the agent isn't on stale
training data), Houdini (the whole APEX server is this), Blender Lab (3 of 27 tools), build123d-mcp
(5 read-only URIs). threepipe already generates `.d.ts` + typedoc.
- `docs(symbol)` / `searchDocs(query)` + static resources: `quickref`, **task-indexed selector
  cookbook**, operator list.
- **Every example executed in CI**, with the version stamped at the top (build123d-mcp: *"Every example
  is tested on each release"*). Stale examples are worse than none.
- **Progressive disclosure** (P13): a small default tool/doc surface, with `describeTools(query)` and
  `enableToolGroup(name)` to widen it — and a `meta` group that can never be hidden.

### 5.3 Ship the instructions artefact — it is a deliverable, not an afterthought

Unity's most recent first-party move was **29 Skills**, not more tools. Figma ships Agent Skills. Epic
ships workflow prompts. Blender ships `prompts.yml`. build123d ships `llms.md`. Willison's model wrote
its own `SKILL.md`. Generate all of these from one source:
1. The workflow ordering (execute → measure → validate → render → snapshot → export).
2. The **anti-mistake list**, as imperatives.
3. A **task-indexed** selector/query cookbook ("get the top face", "find the boundary loop", "the 4
   vertical edges of the face created by the last extrude").
4. An explicit statement of the **transactional and determinism guarantees**, so the agent doesn't
   defensively re-check.

### 5.4 Realistic differentiators (ranked by defensibility)

1. **Headless deterministic render-in-the-loop in Node.** The mechanism every 2026 result depends on,
   and the thing Blender/Unity/Unreal all bolted on painfully (main-loop pumps, TCP sockets,
   `--background` spawns, `_for_cli` twins, standalone-`bpy` backends, game-thread serialisation).
   threepipe has it natively. **Lead with this.**
2. **A topology-aware representation with a watertightness guarantee — quantified as the exact deficit.**
   P3D-Bench scored Three.js *tied-best on validity* and *level with OpenSCAD on geometry*, and it lost
   only on Topo/Part because *"Three.js … outputs triangulated meshes rather than parametric solids …
   not guaranteed to be watertight."* **An n-gon kernel with a manifold gate closes precisely that
   measured gap.** Quote this in the project rationale.
3. **One typed TS surface for humans, GUI and agents.** Zoo (KCL) and Onshape (FeatureScript) prove it
   at enterprise scale; Spline V2 proves it in the browser; PartMode names it ("permissioned typed
   agents"). Nobody has it in open-source web *polygon* modelling.
4. **Edit locality + attribute preservation as measured guarantees** — directly responsive to the
   single most-replicated 2026 failure finding (BenchCAD 64 %, BIM-Edit topo 37.8).
5. **glTF-native round-trip.** The deliverable is a file the human opens anywhere. Combined with Tripo
   3.1 quads and Meshy 6 topology controls, "generate elsewhere → edit here → glTF out" is a coherent
   pipeline that **nobody currently serves** — the diffusion generators all stop at a static mesh.
6. **Open source + web + zero install.** Blender's MCP needs three external tools and a VM; the Claude
   Fusion connector needs a subscription; SketchUp's is capped at 30 models and doesn't persist.
7. **Determinism/replay as a product feature.** Nobody offers "here is the exact op list that produced
   this mesh, re-run it."
8. **A "BMeshBench".** §3.8: no benchmark exists for agentic polygon-level mesh editing. Building the
   API means building the only thing that can measure it — so publish the harness. It doubles as the
   regression suite, and it is an unclaimed contribution.

### 5.5 What to avoid

1. **Don't build an MCP server as the primary thing.** It is a thin generated wrapper over the typed
   API. Everyone who built MCP-first ended up with an `execute_code` escape hatch anyway.
2. **Don't ship 400 tools.** 131 > 404 on tool-selection accuracy. Small surface + progressive
   disclosure + code path.
3. **Don't ship an unguarded `execute`** — and don't *claim* a language-level sandbox is a security
   boundary. Be precise about the threat model.
4. **Don't replicate hidden modal state.** Re-read §2.3 before designing anything with a "current
   mode", a "current object", or an implicit selection.
5. **Don't use names as identity for *elements*.** Named handles for *objects* are good (build123d-mcp);
   Blender's `.001` auto-suffix for *data-blocks* is the failure mode.
6. **Don't let `BufferGeometry` become a second source of truth.** Blender's "flush bmesh back to the
   mesh — forgetting this silently loses all edits" is exactly this failure, in production, in the
   reference implementation.
7. **Don't treat a successful render as verification**, and don't accept a render as a *specification*
   ("collapses every model to near-zero").
8. **Don't build a selector-string DSL.** Query functions returning plain records.
9. **Don't optimise throughput without a review/diff surface** — the CoLab critique (2026‑05‑19) and the
   64 % collateral-corruption finding are the same point from two directions.
10. **Don't chase generation over editing.** CADGenBench: editing scores are uniformly ~1.5–2×
    generation scores. "Bevel these edges and check it's still manifold" is the winning framing.
11. **Don't assume WebGPU.** three.js still defaults to WebGL; Firefox-on-Linux has no WebGPU.
12. **Don't copy kokraf's side-car attribute maps or snapshot undo.**
13. **Don't expose an unconstrained node graph to an agent.** The only node-graph systems that worked
    constrained it (flat DAG with code in the leaves; parameter-filling on a fixed template).
14. **Don't bolt on a parallel "AI mode" UI.** The agent is a second front-end onto the same op layer.

### 5.6 Suggested sequencing

1. **Kernel + operators with deterministic iteration order and no ambient randomness** — decided at
   kernel-design time, otherwise unfixable.
2. **`measure()` / `validate()` / `describe()` alongside the first five operators**, not after. They are
   also the best unit-test harness available, and they are what buys geometric correctness.
3. **`diff()` / edit-locality reporting** — same milestone as the first destructive operator.
4. `renderPreview()` headless in Node with `highlight` — reuses the existing e2e snapshot infra.
5. `transact()` → `snapshot/restore/diff` → replay-from-op-list; add a **replay-determinism test to
   `test:unit` early** (it will catch real kernel bugs).
6. Sandboxed `execute()` over the typed API, with `batch()`.
7. Generated `SKILL.md` / `llms.md` / docs resources, with CI-executed examples.
8. A small BMeshBench harness (start mesh + instruction + validity/locality/attribute scoring).
9. *Only then*, a generated MCP wrapper, if wanted.

---

## 6. Sources

**Primary artefacts fetched and read in full (the most load-bearing items):**
- `https://projects.blender.org/lab/blender_mcp/raw/branch/main/readme_tools.rst` — the official Blender MCP 27-tool listing, generated from docstrings
- `mcp/blmcp/data/prompts.yml` from `https://github.com/bpy-dev/blender-mcp` — Blender's LLM system prompt (§2.3)
- `https://raw.githubusercontent.com/pzfreo/build123d-mcp/main/llms.md` — 38 KB agent-facing API reference (§3.2)
- `https://raw.githubusercontent.com/simonw/gpt-6-astra-blender-pelican-bicycle/main/outputs/blender-local/SKILL.md`
- `https://raw.githubusercontent.com/mrdoob/three.js/dev/package.json` (v0.186.0 exports)
- `https://github.com/mrdoob/three.js/releases/tag/r183|r184|r185|r186` (co-author credit counts)
- `https://api.github.com/repos/sengchor/kokraf` + `/commits` (200 commits, 2026‑04‑14 → 2026‑09‑13)

**Anthropic / Blender / OpenAI**
- https://www.anthropic.com/news/claude-fable-5-mythos-5 (2026‑06‑09) · https://www.anthropic.com/claude-fable-and-mythos-5-1 (2026‑09‑01)
- https://www.anthropic.com/news/claude-for-creative-work (2026‑04‑28)
- https://www.blender.org/development/blender-lab-activity-report-q1-2026/ (2026‑04‑24)
- https://www.blender.org/news/anthropic-joins-the-blender-development-fund-as-corporate-patron/ (2026‑04‑28)
- https://www.blender.org/news/upcoming-blender-development-fund-and-ai-policies/ (**2026‑05‑01, the reversal**)
- https://code.blender.org/2026/09/small-teams-ambitious-projects/ (2026‑09‑10)
- https://www.blender.org/lab/mcp-server/ · https://projects.blender.org/lab/blender_mcp
- https://github.com/ahujasid/blender-mcp · https://www.mindstudio.ai/blog/claude-blender-mcp-real-world-performance (2026‑05‑06)
- https://til.simonwillison.net/llms/blender-coding-agents-macos (2026‑09‑05) · https://github.com/simonw/gpt-6-astra-blender-pelican-bicycle
- https://ciyo.ai/blog/gpt-6-astra-blender-3d (2026‑09‑07) · https://github.com/magiccreator-ai/awesome-gpt-6-astra
- https://en.wikipedia.org/wiki/GPT-6_Astra · https://www.cnbc.com/2026/09/03/open-ai-astra-gpt-6-cyber.html
- https://codersera.com/blog/gpt-astra-vs-google-project-astra-2026/ (the naming disambiguation)
- https://3druck.com/en/programs/claude-fable-5-ki-creates-cad-editor-and-designs-printable-model-36158327/ (⚠ 403 to my fetcher; via search summary)
- https://note.com/tokyomakers/n/n578f23d9588e (MakersCAD, 2026‑07‑04)

**kokraf** — https://github.com/sengchor/kokraf · https://kokraf.com/about/ · https://kokraf.com/

**Benchmarks & papers** — see `sub-benchmarks.md` for the full list with per-model numbers:
arxiv.org/abs/ **2601.11109** (VIGA) · **2504.01786** (BlenderGym) · **2404.17672** (BlenderAlchemy) ·
**2606.02580** (SEIG) · **2605.10865** (BenchCAD) · **2606.20146** (BIM-Edit) · **2606.11152** (P3D-Bench) ·
**2606.01057** (3DCodeBench) · **2605.18430** (Text2CAD-Bench) · **2605.07807** (CADTests) ·
**2410.05340** (CADCodeVerify) · **2608.03062** (TraceCAD) · **2605.10873** (CADBench/MIT) ·
**2605.28579** (MUSE) · **2412.14042** (CAD-Recode) · **2510.17603** (ShapeCraft) · **2508.08228** (LL3M) ·
**2602.05676** (ShapeUP) · **2510.11631** (EvoCAD).
Data/leaderboards: github.com/huggingface/cadgenbench · huggingface.co/datasets/DietCoke4671/BlenderBench ·
huggingface.co/datasets/HuggingAI4Engineering/cadgenbench-submissions · github.com/Fugtemypt123/VIGA

**Vendors & engines** — see `sub-vendors.md`:
unity.com/blog/unity-ai-mcp-how-to-get-started (2026‑05‑11) · unity.com/blog/unity-plugin-for-claude-code (2026‑09‑09) ·
github.com/CoplayDev/unity-mcp · dev.epicgames.com/documentation/unreal-engine/unreal-mcp-in-unreal-editor (UE 5.8, 2026‑06‑17) ·
godotengine.org/article/contribution-policy-2026/ (2026‑06‑30) · help.sketchup.com/en/sketchup-claude-connector ·
github.com/jingcheng-chen/rhinomcp · mcneel.github.io/RhinoAI/ · aps.autodesk.com/blog/bringing-fusion-claude-creative-work ·
ptc.com/en/news/2026/onshape-launches-featurescript-mcp-server (2026‑08‑13) · github.com/KittyCAD/mcp ·
gfxspeak.com/featured/the-buzz-on-mcp-inside-the-sidefx-houdini-hive/ · blog.spline.design/spline-v2 (2026‑08‑27) ·
blog.adobe.com/en/publish/2026/04/28/adobe-for-creativity-connector · research.autodesk.com/projects/project-bernini/ ·
meshy.ai · tripo3d.ai · sloyd.ai · blog.google/…/introducing-computer-use-gemini-3-5-flash/ (2026‑06‑24) ·
deepmind.google/blog/genie-3-a-new-frontier-for-world-models/

**Web 3D landscape** — see `sub-webland.md`:
github.com/mrdoob/three.js (r186, 2026‑09‑08) · blogs.windows.com/windowsdeveloper/2026/03/26/announcing-babylon-js-9-0/ ·
forum.babylonjs.com/t/babylon-js-mcp-servers-are-out/63591 (2026‑06‑04) ·
developer.playcanvas.com/user-manual/editor/mcp-server/ · blog.playcanvas.com/new-in-supersplat-editor-3-0-rebuilt-on-webgpu/ (2026‑09‑09) ·
needle.tools · github.com/xiangechen/chili3d · github.com/BOMWiki/partmode · github.com/elalish/manifold ·
github.com/HeyPuter/blender-wasm · github.com/gpuweb/gpuweb/wiki/Implementation-Status · zoo.dev/design-studio

**Sources explicitly rejected as unreliable** (verified to contain factual errors about three.js/WebGPU
dates and adoption figures, per the web-landscape sub-agent): utsubo.com, buildmvpfast.com,
threejsroadmap.com, webo360solutions.com, byteiota.com, rendimension.com, altersquare.io, vr.org.

---

## 7. Unverified / could not find

**Load-bearing, flagged:**

1. **The kokraf premise — "the author says they built Blender-like modelling tools fast with Fable" —
   is UNVERIFIED, and the public record is weak evidence against it.** No such statement found in the
   README, on kokraf.com, or in 200 commits (2026‑04‑14 → 2026‑09‑13, zero agent co-author trailers,
   510 commits over 16 months by one person). It may be stated in the kokraf **Discord** or on the
   **Jourverse YouTube channel**, neither of which I can read. *Ask the author directly
   (taingsengchor@gmail.com) or check Discord before relying on this.*
2. **"Astra" is ambiguous.** This report assumes OpenAI's **GPT‑6 Astra** (2026‑09‑03). If Google's
   Project Astra was meant, the answer is that **Google has nothing in 3D authoring** — Gemini
   computer-use is a preview built-in tool with no DCC integration, and Genie 3 produces frames, not
   geometry. Please confirm which was meant.
3. **build123d-mcp's "0.360 → 0.457, CAD validity 88 % → 100 %" CADGenBench claim — PARTIALLY
   UNVERIFIED.** The 0.360 / 88 % baseline matches the GPT‑5.5 HF baseline row exactly (0.3596 /
   87.7 %, 2026‑06‑05), but the 16-row `results.jsonl` read (latest 2026‑06‑11) contains **no row
   labelled MCP/agent/tools and no row scoring 0.457**. Vendor-reported; direction credible, magnitude
   unconfirmed. *(This was already flagged in `research-ecosystem.md` §5.1 and remains flagged.)*
4. **The CADGenBench live leaderboard as of 2026‑09‑14 was NOT obtained** — the HF Space renders
   client-side; benchmarklist.com returns HTTP 403. All CADGenBench numbers here cover **2026‑06‑05 →
   06‑11 only**; three months of newer submissions are likely missing. **Re-pull before quoting.**
5. **An earlier search snippet claimed "82–91 % of editing tasks vs 2–10 % of generation tasks."** The
   primary data contradicts the magnitude (Claude Fable 5: gen 0.3728 / edit 0.5718 — a ~1.5× ratio,
   not ~10×). **Direction confirmed, magnitude rejected. Do not use the 82/2 figures.**
6. **`CADBench` is an ambiguous name** — MIT DeCoDE's (arXiv 2605.10873) vs a different CADBench from
   the BlenderLLM project. Disambiguate before citing.

**Could not find (stated as findings, but these are absence-of-evidence):**

7. **No benchmark, paper or leaderboard for agentic polygon-level mesh editing** (extrude/bevel/inset/
   loop-cut/boolean/merge on an existing mesh, scored on selection + topology preservation). Searched
   five ways. See §3.8 — this is presented as an opportunity, not a proof of non-existence.
8. **No benchmark for LLM generation of Blender Geometry Nodes trees**; none for Houdini HDA/VEX.
9. **No controlled study of named-argument vs positional-argument API design** for LLM geometry
   code-gen. Zero results. P2 remains a well-reasoned inference, not an empirical finding.
10. **No controlled study of integer element IDs vs re-evaluable selectors vs named handles.**
    build123d-mcp's `design_audit()` brittleness classifier and the classical topological-naming
    literature are the best available; neither is a controlled comparison. **BIM-Edit's per-reference-
    mode breakdown (Direct/Spatial/Topological, 108 tasks each) is the single most valuable missing
    number for this decision** — it exists in the paper but could not be extracted from the HTML.
    *Worth a targeted PDF re-fetch.*
11. **No public architecture, source or tool schema for Anthropic's VibeCAD demo.** Capability claims
    are vendor-reported.
12. **Official tool names unpublished** for: Autodesk Fusion MCP (Autodesk's own dev blog 403s),
    McNeel RhinoAI, Spline V2's MCP, Babylon.js MCP npm package names.
13. **Blender's `readme_tools.rst` lists 27 tools** but I did not verify each one's parameter schema —
    only the names and docstring summaries.
14. **BlenderGym's per-task metrics and the specific visual-feedback ablation magnitudes** — abstract
    only; the tables were not retrieved. The "verifier can itself be improved by inference scaling"
    quote is verbatim from the abstract; the numbers are not.
15. **GrandpaCAD's "3–4× fewer code errors for OpenSCAD than build123d"** is undated vendor content,
    single cheap model, single harness, no raw data, and the CadQuery arm is confounded by an exporter
    bug. **Directional only.** The P3D-Bench result (peer-reviewed, 4 formats, same models) is the one
    to cite for the same point.
16. **StraySpark / Mixar practitioner reports** (tool-count collapse, sandbox-escape demo, 13 Blender
    bugs, capture-size figures) are vendor/blog sources, not peer-reviewed. Directionally consistent
    with everything else here, but single-source.
17. **GitHub star counts in `sub-vendors.md` marked `~`** were page-scraped under API rate limiting;
    last-push dates for most of those repos are unknown. The kokraf, three.js, manifold, Chili3d and
    bpy-dev figures in this document *were* API-verified.
18. **Genie 3 / world models** — one search pass only; technical details are not fully public. "No
    editable geometry export" is an absence-of-evidence statement.
19. **Adobe Substance 3D agent story** — searched; no first-party MCP found, and Substance is absent
    from Adobe's own connector announcement. If it exists it is unannounced.
20. **Canva/Affinity 3D** — searched; **no 3D product exists**. That premise in the brief was wrong.
