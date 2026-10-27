import {ThreeViewer} from 'threepipe'

export interface SplashSample {
    label: string
    /** One line under the name */
    description?: string
    /** 24×24 line icon, stroke currentColor */
    icon: string
    /** 'start': a "New" action in the left column (e.g. an empty scene); default: a sample card */
    group?: 'start' | 'sample'
    /** Load it; the button shows that it loads until this resolves */
    load: () => Promise<void> | void
}

export interface SplashOptions {
    /** The product name in the header */
    title?: string
    /** Shown after the title, e.g. the library version */
    version?: string
    samples: SplashSample[]
    /** A file was dropped or picked; default: clear the scene and load it with viewer.load */
    onFiles?: (files: File[]) => Promise<void> | void
    /** Opened at page load (not from a menu): the "Show at startup" box is checked */
    startup?: boolean
    onClose?: () => void
}

const STARTUP_KEY = 'sux-splash-startup'
const RECENT_KEY = 'sux-splash-recent'

/** Whether the start screen opens with the page (the "Show at startup" box) */
export function splashAtStartup() {
    try {
        return localStorage.getItem(STARTUP_KEY) !== '0'
    } catch (e) {
        return true
    }
}

function recent(): string[] {
    try {
        const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
        return Array.isArray(v) ? v.filter(x => typeof x === 'string') : []
    } catch (e) {
        return []
    }
}

function addRecent(label: string) {
    try {
        localStorage.setItem(RECENT_KEY, JSON.stringify([label, ...recent().filter(l => l !== label)].slice(0, 5)))
    } catch (e) {
        // no storage: no recent list
    }
}

const ic = (d: string) => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`

/** Icons for the samples */
export const SPLASH_ICONS = {
    ring: ic('<circle cx="12" cy="14.5" r="6"/><path d="M9.5 6.5L12 3.5l2.5 3-2.5 2z"/>'),
    watch: ic('<circle cx="12" cy="12" r="5"/><path d="M9 7.5L9.6 3h4.8l.6 4.5M9 16.5l.6 4.5h4.8l.6-4.5M12 9.5V12l1.6 1"/>'),
    helmet: ic('<path d="M4 14a8 8 0 0 1 16 0v3H4z"/><path d="M8 17v-3h8v3M12 6v4"/>'),
    horse: ic('<path d="M7 20v-6l-2-3 3-5 2-2 1 2 4 1 3 4-2 1-3-1v3l3 6"/><circle cx="10.5" cy="7.5" r=".6" fill="currentColor"/>'),
    timeline: ic('<circle cx="8" cy="9" r="4"/><path d="M8 7v2l1.2 1"/><path d="M3 18h18M3 21h18" stroke-opacity=".45"/><rect x="5" y="16.6" width="6" height="2.8" rx="1" fill="currentColor" stroke="none"/><rect x="13" y="19.6" width="6" height="2.8" rx="1" fill="currentColor" stroke="none"/>'),
    lines: ic('<path d="M3 20l4-9 4 5 3-8 3 6 4-9"/>'),
    empty: ic('<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>'),
}

let open: HTMLElement | null = null

const NEW_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.5l5.5 3v7L8 14.5l-5.5-3v-7z"/><path d="M8 5.5v5M5.5 8h5"/></svg>'
const OPEN_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 4V13h11.5l1.5-6H4L2.5 13"/><path d="M1.5 4V2.5h4l1.5 1.5h5V7"/></svg>'
const CLOCK_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.2 1.5"/></svg>'

/**
 * The start screen of a desktop editor (like Blender's splash, the JetBrains welcome or Photoshop's home): a dialog
 * over the dimmed editor with New and Open, the recent samples, the sample cards and "Show at startup". A 3D file
 * dropped anywhere on it opens. Esc, × or a click outside closes it.
 */
export function showSplash(viewer: ThreeViewer, options: SplashOptions) {
    injectStyles()
    open?.remove()
    const title = options.title ?? 'threepipe Editor'
    const el = document.createElement('div')
    el.className = 'spl-root'
    el.setAttribute('role', 'dialog')
    el.setAttribute('aria-modal', 'true')
    el.setAttribute('aria-label', title)
    // text for innerHTML
    const esc = (t: string) => Object.assign(document.createElement('span'), {textContent: t}).innerHTML
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
    el.innerHTML = `
<div class="spl-card">
  <div class="spl-head">
    <div class="spl-brand"><span class="spl-logo">${SPLASH_ICONS.empty}</span><span class="spl-name">${esc(title)}</span>${options.version ? `<span class="spl-ver">${esc(options.version)}</span>` : ''}</div>
    <button class="spl-x" aria-label="Close (Esc)" title="Close (Esc)">×</button>
  </div>
  <div class="spl-body">
    <nav class="spl-side">
      <div class="spl-h">Start</div>
      <div class="spl-start"></div>
      <button class="spl-act spl-open">${OPEN_ICON}<span>Open file…</span><kbd>${isMac ? '⌘' : 'Ctrl+'}O</kbd></button>
      <div class="spl-h spl-h-recent">Recent</div>
      <div class="spl-recent"></div>
    </nav>
    <section class="spl-main">
      <div class="spl-h">Samples</div>
      <div class="spl-samples"></div>
      <div class="spl-sub" role="status"></div>
    </section>
  </div>
  <div class="spl-foot">
    <span class="spl-hint">Drop a .glb, .gltf, .fbx, .obj, .stl, .3dm or .usdz file anywhere to open it</span>
    <label class="spl-check"><input type="checkbox" class="spl-startup"> Show at startup</label>
  </div>
  <div class="spl-dropzone"><div>Drop to open</div></div>
</div>
<input type="file" multiple hidden accept=".glb,.gltf,.fbx,.obj,.stl,.ply,.3dm,.usdz,.drc,.json,.hdr,.exr,.jpg,.png">`
    const sub = el.querySelector<HTMLElement>('.spl-sub')!
    const load = async(s: SplashSample, b: HTMLElement) => {
        el.classList.add('spl-busy')
        b.classList.add('spl-loading')
        sub.classList.remove('spl-error')
        sub.textContent = `Opening “${s.label}”…`
        try {
            await s.load()
            addRecent(s.label)
            close()
        } catch (e) {
            console.error(e)
            b.classList.remove('spl-loading')
            el.classList.remove('spl-busy')
            sub.textContent = `Could not load “${s.label}”. Pick another sample, or drop a file.`
            sub.classList.add('spl-error')
        }
    }
    const button = (s: SplashSample, cls: string, html: string) => {
        const b = document.createElement('button')
        b.className = cls
        b.innerHTML = html
        b.setAttribute('aria-label', s.label)
        if (s.description) b.title = s.description
        b.addEventListener('click', () => void load(s, b))
        return b
    }
    for (const s of options.samples) {
        if (s.group === 'start') {
            el.querySelector('.spl-start')!.appendChild(button(s, 'spl-act spl-sample', `${NEW_ICON}<span>${s.label === 'Empty scene' ? 'New empty scene' : esc(s.label)}</span>`))
        } else {
            el.querySelector('.spl-samples')!.appendChild(button(s, 'spl-sample spl-tile',
                `<span class="spl-thumb">${s.icon}</span><span class="spl-label">${esc(s.label)}</span>${s.description ? `<span class="spl-desc">${esc(s.description)}</span>` : ''}`))
        }
    }
    const rec = recent().map(l => options.samples.find(s => s.label === l)).filter(Boolean) as SplashSample[]
    const recEl = el.querySelector<HTMLElement>('.spl-recent')!
    for (const s of rec) recEl.appendChild(button(s, 'spl-act spl-rec', `${CLOCK_ICON}<span>${esc(s.label)}</span>`))
    if (!rec.length) recEl.innerHTML = '<div class="spl-none">The samples you open show here.</div>'

    const startup = el.querySelector<HTMLInputElement>('.spl-startup')!
    startup.checked = splashAtStartup()
    startup.addEventListener('change', () => {
        try {
            localStorage.setItem(STARTUP_KEY, startup.checked ? '1' : '0')
        } catch (e) {
            // no storage: this page only
        }
    })

    const input = el.querySelector<HTMLInputElement>('input[type=file]')!
    const loadFiles = async(files: File[]) => {
        if (!files.length) return
        el.classList.add('spl-busy')
        sub.classList.remove('spl-error')
        sub.textContent = `Opening ${files.map(f => f.name).join(', ')}…`
        try {
            if (options.onFiles) await options.onFiles(files)
            else {
                viewer.scene.disposeSceneModels()
                for (const f of files) await viewer.load(f, {autoScale: true, autoCenter: true})
                await viewer.fitToView(undefined, 1.2, 0)
            }
        } finally {
            close()
        }
    }
    el.querySelector('.spl-open')!.addEventListener('click', () => input.click())
    input.addEventListener('change', () => void loadFiles(Array.from(input.files ?? [])))
    let depth = 0
    el.addEventListener('dragenter', e => {
        e.preventDefault()
        depth++
        el.classList.add('spl-over')
    })
    el.addEventListener('dragover', e => e.preventDefault())
    el.addEventListener('dragleave', () => {
        if (--depth <= 0) {
            depth = 0
            el.classList.remove('spl-over')
        }
    })
    el.addEventListener('drop', e => {
        e.preventDefault()
        e.stopPropagation()
        depth = 0
        el.classList.remove('spl-over')
        void loadFiles(Array.from(e.dataTransfer?.files ?? []))
    })
    // a click outside the card closes it, like Blender's splash
    el.addEventListener('pointerdown', e => {
        if (e.target === el && !el.classList.contains('spl-busy')) close()
    })
    const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            e.stopImmediatePropagation()
            close()
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
            e.preventDefault()
            e.stopImmediatePropagation()
            input.click()
        }
    }
    window.addEventListener('keydown', onKey, {capture: true})
    // the open splash has the focus and the keys: W, E, Delete... do not reach the scene behind it
    el.tabIndex = -1
    el.dataset.ownKeys = ''
    el.addEventListener('keydown', e => e.stopPropagation())
    function close() {
        window.removeEventListener('keydown', onKey, {capture: true})
        el.classList.add('spl-out')
        setTimeout(() => el.remove(), 160)
        if (open === el) open = null
        options.onClose?.()
    }
    el.querySelector('.spl-x')!.addEventListener('click', close)
    document.body.appendChild(el)
    el.focus({preventScroll: true})
    open = el
    return {close}
}

let stylesAdded = false
function injectStyles() {
    if (stylesAdded) return
    stylesAdded = true
    const st = document.createElement('style')
    st.textContent = `
.spl-root {
  --spl-accent: #0d99ff; --spl-fg: #1e1e1e; --spl-dim: #6b6b70; --spl-bg: #fff; --spl-side: #f5f5f6; --spl-line: #e6e6e9;
  --spl-hover: #eef0f3; --spl-tile: #f2f3f5;
  position: fixed; inset: 0; z-index: 5000; display: flex; align-items: center; justify-content: center; padding: 16px;
  color: var(--spl-fg); font: 13px/1.4 var(--tp-font-family, Inter, ui-sans-serif, system-ui, sans-serif);
  background: rgba(20, 20, 24, .38); backdrop-filter: blur(3px); animation: spl-in .16s ease-out;
}
.spl-root.spl-out { opacity: 0; transition: opacity .16s; }
@keyframes spl-in { from { opacity: 0; } }
@keyframes spl-up { from { transform: translateY(8px) scale(.99); } }
.spl-root:focus { outline: none; }
.spl-card {
  position: relative; width: min(820px, 100%); max-height: min(560px, 100%); display: flex; flex-direction: column;
  background: var(--spl-bg); border-radius: 12px; overflow: hidden; box-shadow: 0 24px 64px rgba(0,0,0,.28), 0 0 0 1px rgba(0,0,0,.06);
  animation: spl-up .2s ease-out;
}
/* the header band: a quiet picture of the product, like the art on a splash */
.spl-head {
  position: relative; height: 92px; flex: none; display: flex; align-items: flex-end; justify-content: space-between; padding: 0 16px 14px 20px;
  color: #fff; background:
    radial-gradient(ellipse 60% 140% at 85% 120%, rgba(13,153,255,.55), rgba(13,153,255,0) 70%),
    radial-gradient(ellipse 40% 120% at 60% -20%, rgba(162,89,255,.45), rgba(162,89,255,0) 70%),
    repeating-linear-gradient(90deg, rgba(255,255,255,.05) 0 1px, transparent 1px 24px),
    repeating-linear-gradient(0deg, rgba(255,255,255,.05) 0 1px, transparent 1px 24px),
    linear-gradient(135deg, #17171c, #23232b);
}
.spl-brand { display: flex; align-items: center; gap: 10px; }
.spl-logo { display: flex; width: 34px; height: 34px; border-radius: 8px; align-items: center; justify-content: center; background: rgba(255,255,255,.12); }
.spl-name { font-size: 18px; font-weight: 600; letter-spacing: -.01em; }
.spl-ver { font-size: 11px; color: rgba(255,255,255,.6); padding-top: 4px; }
.spl-x {
  position: absolute; right: 12px; top: 12px; width: 28px; height: 28px; border-radius: 6px; border: 0; background: transparent;
  color: rgba(255,255,255,.75); font-size: 20px; line-height: 1; cursor: pointer;
}
.spl-x:hover { background: rgba(255,255,255,.14); color: #fff; }
.spl-body { display: flex; min-height: 0; flex: 1; }
.spl-side { width: 220px; flex: none; background: var(--spl-side); border-right: 1px solid var(--spl-line); padding: 14px 10px; overflow: auto; }
.spl-main { flex: 1; padding: 14px 18px 16px; overflow: auto; min-width: 0; }
.spl-h { font-size: 11px; font-weight: 600; color: var(--spl-dim); text-transform: uppercase; letter-spacing: .04em; padding: 0 8px 8px; }
.spl-main .spl-h { padding-left: 0; }
.spl-h-recent { margin-top: 16px; }
.spl-act {
  width: 100%; display: flex; align-items: center; gap: 9px; height: 32px; padding: 0 8px; border: 0; border-radius: 6px;
  background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer;
}
.spl-act span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.spl-act svg { flex: none; color: var(--spl-dim); }
.spl-act:hover { background: var(--spl-hover); }
.spl-act:hover svg { color: var(--spl-accent); }
.spl-act kbd { font-family: inherit; font-size: 11px; color: var(--spl-dim); }
.spl-none { color: var(--spl-dim); font-size: 12px; padding: 2px 8px; }
.spl-samples { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
.spl-tile {
  display: flex; flex-direction: column; align-items: stretch; gap: 0; padding: 0; text-align: left; overflow: hidden;
  border: 1px solid var(--spl-line); border-radius: 8px; background: var(--spl-bg); color: inherit; font: inherit; cursor: pointer;
  transition: border-color .12s, box-shadow .12s;
}
.spl-tile:hover { border-color: var(--spl-accent); box-shadow: 0 0 0 1px var(--spl-accent); }
.spl-thumb { height: 76px; display: flex; align-items: center; justify-content: center; background: var(--spl-tile); color: var(--spl-dim); }
.spl-thumb svg { width: 34px; height: 34px; }
.spl-tile:hover .spl-thumb { color: var(--spl-accent); }
.spl-label { padding: 8px 10px 0; font-weight: 500; }
.spl-desc { padding: 2px 10px 9px; font-size: 11.5px; color: var(--spl-dim); line-height: 1.35; }
.spl-label:last-child { padding-bottom: 9px; }
.spl-sub { min-height: 18px; margin-top: 10px; font-size: 12px; color: var(--spl-dim); }
.spl-sub.spl-error { color: #dc2626; }
.spl-foot {
  flex: none; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 16px 10px 20px;
  border-top: 1px solid var(--spl-line); font-size: 12px; color: var(--spl-dim);
}
.spl-check { display: flex; align-items: center; gap: 6px; cursor: pointer; white-space: nowrap; color: var(--spl-fg); }
.spl-check input { margin: 0; accent-color: var(--spl-accent); }
.spl-dropzone {
  position: absolute; inset: 8px; border: 2px dashed var(--spl-accent); border-radius: 10px; display: none;
  align-items: center; justify-content: center; background: color-mix(in srgb, var(--spl-bg) 86%, var(--spl-accent));
  font-size: 15px; font-weight: 600; color: var(--spl-accent); pointer-events: none;
}
.spl-over .spl-dropzone { display: flex; }
.spl-busy .spl-sample, .spl-busy .spl-act { pointer-events: none; }
.spl-busy .spl-sample:not(.spl-loading) { opacity: .55; }
.spl-sample.spl-loading { border-color: var(--spl-accent); animation: spl-pulse .9s ease-in-out infinite; }
@keyframes spl-pulse { 50% { opacity: .5; } }
.spl-root button:focus-visible { outline: 2px solid var(--spl-accent); outline-offset: 1px; }
@media (max-width: 600px) {
  .spl-body { flex-direction: column; overflow: auto; }
  .spl-side { width: auto; border-right: 0; border-bottom: 1px solid var(--spl-line); }
  .spl-hint { display: none; }
}
body.tpTheme-clean-dark .spl-root, body.tpTheme-dark .spl-root, body.tpTheme-black .spl-root, body.tpTheme-blue .spl-root {
  --spl-fg: #ececef; --spl-dim: #9a9aa2; --spl-bg: #232327; --spl-side: #1c1c20; --spl-line: #34343a; --spl-hover: #2d2d33; --spl-tile: #2b2b31;
  background: rgba(0, 0, 0, .5);
}
`
    document.head.appendChild(st)
}
