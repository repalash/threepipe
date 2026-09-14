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

1. **The single most important finding for threepipe's design is negative and very well evidenced:
   nobody has shipped a working *structured mesh-operator tool API* for LLMs. Every serious system in
   September 2026 converged on the same shape: `execute_code` + `describe/summarise` + `search_docs` +
   `render_and_look`.** Blender's own official MCP server (below) exposes 27 tools and *not one of them
   is a modelling operator*.
2. **The viral GPT‑6 Astra "computer use does Blender" story is a misnomer.** The demos do not drive
   Blender's GUI. They run `blender --background --python script.py`, render a PNG, and feed the PNG
   back. Headless script-execute + render-inspect is the entire mechanism. (Verified against Simon
   Willison's published transcript, scripts and generated skill file, 2026‑09‑05.)
3. **Render-in-the-loop is the biggest measured win in the literature, not operator coverage.** VIGA
   (arXiv 2601.11109, Jan 2026) reports **+35.32 % on BlenderGym and +124.70 % on BlenderBench** for a
   code→render→inspect loop vs one-shot generation. This directly confirms principle **P9** of the
   prior survey ("give agents eyes and a ruler") and raises its priority above adding operators.
4. **Blender Foundation has explicitly closed the door on in-product generative AI** (2026‑05‑01, after
   reversing Anthropic's Development Fund patronage following community backlash). Its Sept‑2026
   two-year strategy document mentions AI zero times. Blender's agent surface will remain a
   *bolt-on MCP server over `bpy`*, which is exactly the surface everyone reports as fragile.
5. **Anthropic shipped first-party creative-tool connectors** (2026‑04‑28: Blender, Autodesk Fusion,
   SketchUp, Adobe CC, Ableton, Affinity, Splice, Resolume), all MCP-based. This normalises MCP as the
   integration protocol, but the connectors are scene-assembly/analysis tools, not modelling tools.
6. **Practitioner reports converge on the same failure list:** hidden mode/selection state, name
   collisions, stale element references, silent no-ops, and "looks right in the viewport, is not
   watertight on export". Blender's own LLM system prompt is, almost line by line, a list of
   mitigations for these — i.e. a free specification of what *not* to build.
7. **The realistic differentiator for threepipe is not "an MCP server". It is: a typed TS operator
   layer that is deterministic, node-safe, headless-renderable, glTF-native, and whose schemas are
   mechanically derivable — so the code path and the tool path are the same surface.** No one else in
   the web 3D space has all five.

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

---

## 3. Benchmarks and research — what the 2025–2026 evidence says about API design

### 3.1 The benchmark landscape

| Name | URL | Date | What it measures | Headline result | Relevance |
|---|---|---|---|---|---|
| **BlenderGym** | arxiv.org/abs/2504.01786 | 2025‑04 | First comprehensive VLM-system benchmark for **3D graphics editing**, framed as code-based 3D reconstruction across Blend Shape / Placement / Geometry / Lighting / Material | "even the state-of-the-art VLM system struggles with tasks relatively easy for human Blender users" | The canonical prior benchmark; VIGA and others report against it. |
| **BlenderAlchemy** | arxiv.org/abs/2404.17672 | 2024‑04 | VLM iteratively refines a **Blender Python program**; adds text-to-image "visual imagination" to make a concrete visual target | Establishes program-refinement-with-vision as SOTA pipeline for graphics editing | The origin of "edit the program, not the scene". |
| **VIGA** (Vision-as-Inverse-Graphics Agent) | arxiv.org/abs/2601.11109 · fugtemypt123.github.io/VIGA-website/ · github.com/Fugtemypt123/VIGA | 2026‑01 | Agent reconstructs images as **editable scene programs** via analysis-by-synthesis; generator/verifier alternation with an evolving contextual memory | **+35.32 % on BlenderGym, +124.70 % on BlenderBench, +117.17 % on SlideBench vs one-shot baselines** | **The strongest quantitative case for render-in-the-loop.** |
| **BlenderBench** | huggingface.co/datasets/DietCoke4671/BlenderBench (CC BY 4.0) | 2026 | **30 tasks** (27 public in the runner below): camera adjustment, multi-step editing, compositional editing. Explicitly targets *multi-step, dynamic agentic* behaviour rather than one-shot generation | GPT‑4o one-shot baselines are low across all three task groups | Closest existing thing to "agentic mesh editing eval" — but it is still *scene/camera/attribute* editing, not topology editing. |
| **BlenderBench-direct runner** | github.com/bpy-dev/blender-mcp `benchmarks/blenderbench_direct/` | 2026‑09 | Portable model-neutral re-run of the 27 public tasks; **10 sequential saved edit/render/visual-inspection rounds per task**; scoring by CLIP image-embedding cosine similarity + photometric loss (VIGA's `ref_based_eval.py`, hash-pinned) | Compilation covers **27 tasks / 270 rounds** | **Read its protocol.** It is the most rigorous reproducibility setup found (hash-pinned CLIP snapshot, locked torch wheel, sandboxed Codex, no evaluator feedback during generation). |
| **SEIG** ("Thinking in Blender: Staged Executable Inverse Graphics with VLMs") | arxiv.org/abs/2606.02580 | 2026‑06‑01 | Single image → editable Blender program by **progressively refining** geometry → materials → composition → lighting, no 3D foundation models | Staged refinement improves fidelity over monolithic generation | The *staging* idea: don't ask for everything at once; give the agent named phases. |
| **CADGenBench** | benchmarklist.com/benchmarks/cadgenbench/ (⚠ 403 to my fetcher, numbers from search summaries) | 2026 | CAD generation and editing from natural language | *"Top models achieve usable geometry in around **82–91 % of editing tasks but only 2–10 % of generation tasks**."* Leaderboard June 2026: Claude Fable 5 HF baseline aggregate **0.451**; build123d-mcp raised the same model **0.360 → 0.457** with **CAD validity 88 % → 100 %** | ⚠ **Partly unverified** — see §7. If the editing-vs-generation gap holds it is a major strategic fact (see below). |

**The editing-vs-generation asymmetry is the most strategically useful number in this section, if it
holds.** Agents are ~10× better at *modifying an existing model to spec* than at *creating one from
nothing*. threepipe's use case — an editable mesh already exists (imported glTF, a primitive, a
previous step) and the agent modifies it — is squarely on the good side of that gap.

### 3.2 `build123d-mcp` — the most mature agent-facing geometry API in existence, and the best template

`github.com/pzfreo/build123d-mcp` (MCP server wrapping build123d). I read its `llms.md` in full
(38 KB, fetched 2026‑09‑14). This is not a toy; it is the closest thing to a reference design for what
the maintainer wants to build, and it independently arrives at most of §7's principles from
`research-ecosystem.md`. Structure:

**Tool inventory (27 tools), grouped by purpose:**

| Purpose | Tools |
|---|---|
| Code execution | `execute` (persistent Python session, sandboxed) |
| Session / state | `session_state`, `save_snapshot`, `restore_snapshot`, `diff_snapshot`, `reset`, `version`, `health_check` |
| **Measure** (numeric truth) | `measure`, `clearance`, `cross_sections`, `interference`, `shape_compare` |
| **Validate** (correctness gates) | `validate`, `design_audit`, `suggest_spec`, `verify_spec` |
| **Eyes** | `render_view` |
| Error recovery | `last_error`, `repair_hints`, `workflow_hints` |
| I/O | `export`, `import_cad_file`, `search_library`, `load_part` |
| Read-only resources (no round-trip) | `build123d://quickref`, `://selectors`, `://drafting`, `://session`, `://bd_warehouse` |
| Prompt | `start-cad-session` |

**Design decisions worth stealing verbatim:**

1. **Sandboxed code execution is the primary surface, and it is a *real* sandbox.** Three layers before
   any user code runs: (a) import allowlist — only `build123d`, `math`, `numpy`, `inspect`, a curated
   safe-stdlib subset and curated geometric OCP submodules; `os`/`pathlib`/`shutil`/`socket`/`urllib`/
   `requests`/`subprocess` all blocked; (b) restricted builtins — `open`/`eval`/`exec`/`compile`/
   `getattr`/`vars` removed, dunder-attribute access AST-blocked (`hasattr` and `dir()` deliberately
   *allowed*, because they leak nothing and enable API discovery); (c) a 120 s wall-clock timeout.
   *"File I/O happens through MCP tools … never directly."* Sandbox violations return a named error and
   the model is told: *"don't try to bypass it, just use the MCP tools or change approach."*
2. **Persistent session, explicitly documented.** *"All tool calls share a single Python namespace.
   Variables and shapes you create with `execute` persist across subsequent calls. Use this to build
   geometry step by step, checking your work after each step."*
3. **Analysis functions are callable both as MCP tools and *inside* `execute`.** *"`measure`,
   `clearance`, `cross_sections`, `find_holes` … are callable inside `execute` and return real Python
   objects, so you compute over results — `measure(part)["volume"]`."* This is P10 ("the scripting API
   *is* the agent API") implemented properly: one implementation, two entry points.
4. **Measure *before* render — the most counter-intuitive and most valuable rule.** From "Common
   mistakes": *"**Using `render_view` as geometric proof:** renders can look correct even when geometry
   is wrong. Use `measure()` to verify numerically first."* And from the workflow: *"**Do not proceed to
   `render_view` until `measure` passes** — a failed boolean leaves counts unchanged."* This refines
   VIGA's result: vision is necessary but is the *second* check, not the first. Cheap numeric
   invariants (face/edge/vertex counts, volume, validity) catch silent no-ops that pixels do not.
5. **`render_view(highlights=[…])` — labelled element indices in the render.** Each entry is
   `{"object", "type": "face"|"edge"|"vertex", "index", "label"}`; the PNG comes back with those
   elements annotated. The documented purpose: *"Use this to verify 'edge 5 is the one I want to
   fillet' **before committing to the operation**."* **This is a direct, proven answer to threepipe's
   hardest agent problem — "which edges do I bevel?"** A `renderPreview({ highlight: selection })`
   affordance turns an unverifiable selection into a checkable one. Also supports `clip_plane` to
   expose internal geometry, and `format: "dxf"` to return *parseable* projected geometry rather than
   pixels.
6. **`verify_spec` — declared design intent checked against built geometry, with evidence tiers.** The
   agent (or user) declares a JSON spec (`envelope_mm`, `volume_mm3`, `solid {count, valid}`,
   `parameters`, `features: [{kind:"hole", count, diameter_mm, …}]`) and gets back per-requirement
   `PASS | FAIL | UNVERIFIED` with a tier: `measured` (kernel query) > `structural` (validity gate) >
   `recognised` (heuristic) > `unverified`. Critically: *"`conforms` = no FAILs **and ≥1 requirement
   actually checked** … a spec that verifies nothing reports `conforms:false` with a warning, **never a
   vacuous true**; UNVERIFIED requirements are never counted as met."* Feature kinds with no recogniser
   read UNVERIFIED, *"never a false FAIL"*. **This three-valued, anti-vacuous-truth design is the right
   answer to "how does the agent know it did the job", and it is directly portable to a mesh kernel**
   (euler characteristic, manifoldness, boundary loops, face/edge counts, group membership, bbox).
7. **Snapshots as a scratch layer for "what-if" proposals**, explicitly instead of the model
   hallucinating an analysis: `save_snapshot("before")` → mutate → analyse → `restore_snapshot`.
   Documented rationale: *"Don't redraw the geometry in matplotlib to evaluate it — that's lossy and
   disagrees with the model."* Note the honest limitation: snapshots capture geometry, **not** the
   Python variable namespace.
8. **Error recovery as a first-class tool trio.** `execute()` appends matched repair hints *inline* on
   error; `last_error` returns exception type, message, line number and a 5-line excerpt around the
   failing line *"to get the exact failing line without re-reading the submitted code"*; `repair_hints`
   is a keyed library of known-mistake fixes; `workflow_hints` tells the agent which tool to reach for.
9. **Read-only MCP *resources* for docs** (`quickref`, `selectors`, `drafting`) rather than tool calls:
   *"Read-only resources that LLM clients can fetch **without spending a tool-call round-trip**"*, and
   *"Every example is tested on each release"* with the version stamped at the top. Same conclusion as
   Blender's three doc-search tools, reached differently and more cheaply.
10. **A published "Common mistakes" list shipped to the model**, including several that are pure mesh
    analogues: *"Coincident faces don't reliably fuse — don't butt additive features exactly coplanar
    with the base"*; *"Failed `execute` advancing state: it doesn't — failed code preserves the previous
    `current_shape`"* (transactional semantics, stated explicitly to the agent).

### 3.3 Distilled conclusions about API design for LLMs (2026 evidence)

Superseding/refining §5.1 of `research-ecosystem.md`:

1. **Feedback loop > operator coverage.** VIGA's +35 %/+125 % comes from `code → render → inspect`, not
   from more operators. Every independently-built system found (VIGA, SEIG, BlenderAlchemy, ViveCAD,
   build123d-mcp, Astra-via-Codex, the Blender Lab MCP) converged on the same loop.
2. **Numeric measurement is the *first* gate, vision is the *second*.** build123d-mcp's explicit
   ordering, plus the MakersCAD watertightness failure, plus "a successfully saved render is not
   visual QA" from Willison's skill file. A mesh kernel's equivalents are cheap: element counts, Euler
   characteristic, manifoldness, volume, boundary loop count, bbox.
3. **Editing beats generation by roughly an order of magnitude** (CADGenBench, ⚠ unverified figure).
   Design for "modify this mesh", not "make me a chair".
4. **Code execution wins, but only when sandboxed and given a persistent, inspectable session.** Both
   the anti-pattern (BlenderMCP's unguarded `execute_blender_code`; Blender Lab's own explicit
   "run it in a VM" warning) and the good pattern (build123d-mcp's three-layer sandbox) are documented.
5. **The agent needs to *point at* geometry and have that confirmed.** `render_view(highlights=…)` is
   the only found solution to selection ambiguity, and it is empirical rather than theoretical.
6. **Three-valued verification.** `PASS / FAIL / UNVERIFIED` with evidence tiers, never a vacuous
   `true`. Silent success is the worst outcome in geometry.
7. **Ship the docs, the mistakes list and the workflow as data the model can read.** `prompts.yml`,
   `llms.md`, `SKILL.md`, MCP resources — three independent projects, three formats, same idea.
8. **Staging works** (SEIG): name the phases (topology → attributes → materials → framing) rather than
   asking for a finished result in one shot.

