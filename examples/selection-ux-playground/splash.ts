import {ThreeViewer} from 'threepipe'

export interface SplashSample {
    label: string
    /** 24×24 line icon, stroke currentColor */
    icon: string
    /** Load it; the splash shows a spinner on the button until this resolves */
    load: () => Promise<void> | void
}

export interface SplashOptions {
    /** Title, the last word in the accent colour */
    title?: string
    samples: SplashSample[]
    /** A file was dropped or picked; default: clear the scene and load it with viewer.load */
    onFiles?: (files: File[]) => Promise<void> | void
    onClose?: () => void
}

const ic = (d: string) => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`

/** Icons for the samples */
export const SPLASH_ICONS = {
    ring: ic('<circle cx="12" cy="14.5" r="6"/><path d="M9.5 6.5L12 3.5l2.5 3-2.5 2z"/>'),
    watch: ic('<circle cx="12" cy="12" r="5"/><path d="M9 7.5L9.6 3h4.8l.6 4.5M9 16.5l.6 4.5h4.8l.6-4.5M12 9.5V12l1.6 1"/>'),
    helmet: ic('<path d="M4 14a8 8 0 0 1 16 0v3H4z"/><path d="M8 17v-3h8v3M12 6v4"/>'),
    horse: ic('<path d="M7 20v-6l-2-3 3-5 2-2 1 2 4 1 3 4-2 1-3-1v3l3 6"/><circle cx="10.5" cy="7.5" r=".6" fill="currentColor"/>'),
    lines: ic('<path d="M3 20l4-9 4 5 3-8 3 6 4-9"/>'),
    empty: ic('<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>'),
}

let open: HTMLElement | null = null

/** A welcome screen like the iJewel playground: drop a 3D file, pick one, or load a sample */
export function showSplash(viewer: ThreeViewer, options: SplashOptions) {
    injectStyles()
    open?.remove()
    const title = options.title ?? 'Welcome to the threepipe Editor'
    const words = title.split(' ')
    const last = words.pop()
    const el = document.createElement('div')
    el.className = 'spl-root'
    el.setAttribute('role', 'dialog')
    el.setAttribute('aria-label', title)
    el.innerHTML = `
<button class="spl-x" aria-label="Close (Esc)">×</button>
<div class="spl-center">
  <button class="spl-drop" aria-label="Choose a 3D file">
    <svg viewBox="0 0 48 48" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
      <path d="M24 32V16M17 23l7-7 7 7"/><circle cx="24" cy="24" r="17" stroke-dasharray="7 5"/>
    </svg>
  </button>
  <div class="spl-pill">Drag and drop a 3D file here <span>or click to choose</span></div>
  <h1>${words.join(' ')} <em>${last}</em></h1>
  <div class="spl-sub">Load a sample</div>
  <div class="spl-samples"></div>
</div>
<input type="file" multiple hidden accept=".glb,.gltf,.fbx,.obj,.stl,.ply,.3dm,.usdz,.drc,.json,.hdr,.exr,.jpg,.png">`
    const row = el.querySelector<HTMLElement>('.spl-samples')!
    const sub = el.querySelector<HTMLElement>('.spl-sub')!
    for (const s of options.samples) {
        const b = document.createElement('button')
        b.className = 'spl-sample'
        b.innerHTML = `${s.icon}<span>${s.label}</span>`
        b.setAttribute('aria-label', s.label)
        b.addEventListener('click', async() => {
            el.classList.add('spl-busy')
            b.classList.add('spl-loading')
            try {
                await s.load()
                close()
            } catch (e) {
                console.error(e)
                b.classList.remove('spl-loading')
                el.classList.remove('spl-busy')
                sub.textContent = `Could not load “${s.label}”. Pick another sample, or drop a file.`
                sub.classList.add('spl-error')
            }
        })
        row.appendChild(b)
    }
    const input = el.querySelector('input')!
    const loadFiles = async(files: File[]) => {
        if (!files.length) return
        el.classList.add('spl-busy')
        el.querySelector('.spl-pill')!.textContent = `Loading ${files.map(f => f.name).join(', ')}…`
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
    el.querySelector('.spl-drop')!.addEventListener('click', () => input.click())
    el.querySelector('.spl-pill')!.addEventListener('click', () => input.click())
    input.addEventListener('change', () => void loadFiles(Array.from(input.files ?? [])))
    el.addEventListener('dragover', e => {
        e.preventDefault()
        el.classList.add('spl-over')
    })
    el.addEventListener('dragleave', e => {
        if (e.target === el) el.classList.remove('spl-over')
    })
    el.addEventListener('drop', e => {
        e.preventDefault()
        e.stopPropagation()
        el.classList.remove('spl-over')
        void loadFiles(Array.from(e.dataTransfer?.files ?? []))
    })
    const onKey = (e: KeyboardEvent) => {
        if (e.key !== 'Escape') return
        e.stopImmediatePropagation()
        close()
    }
    window.addEventListener('keydown', onKey, {capture: true})
    // the open splash has the focus and the keys: W, E, Delete... do not reach the scene behind it
    el.tabIndex = -1
    el.dataset.ownKeys = ''
    el.addEventListener('keydown', e => e.stopPropagation())
    function close() {
        window.removeEventListener('keydown', onKey, {capture: true})
        el.classList.add('spl-out')
        setTimeout(() => el.remove(), 200)
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
  --spl-accent: #6e72f2; --spl-fg: #1e1e1e; --spl-dim: #6b6b6b;
  position: fixed; inset: 0; z-index: 5000; display: flex; align-items: center; justify-content: center; color: var(--spl-fg);
  font: 15px/1.4 var(--tp-font-family, Inter, ui-sans-serif, system-ui, sans-serif);
  /* soft ripples, like a drop in water */
  background:
    repeating-radial-gradient(ellipse 120% 70% at 62% 48%, rgba(0,0,0,0) 0 70px, rgba(0,0,0,.035) 110px, rgba(0,0,0,0) 150px),
    radial-gradient(ellipse at 50% 50%, #ffffff 0%, #f6f6f7 70%, #efeff1 100%);
  animation: spl-in .25s ease-out;
}
.spl-root.spl-out { opacity: 0; transition: opacity .2s; }
@keyframes spl-in { from { opacity: 0; } }
.spl-center { display: flex; flex-direction: column; align-items: center; gap: 18px; padding: 24px; text-align: center; }
.spl-drop {
  width: 132px; height: 112px; border-radius: 18px; border: 0; cursor: pointer; color: var(--spl-accent);
  background: color-mix(in srgb, var(--spl-accent) 9%, #fff); box-shadow: 0 10px 30px rgba(110,114,242,.18), inset 0 0 0 1px rgba(110,114,242,.15);
  display: flex; align-items: center; justify-content: center; transition: transform .15s, box-shadow .15s;
}
.spl-drop:hover, .spl-over .spl-drop { transform: translateY(-2px) scale(1.03); box-shadow: 0 14px 36px rgba(110,114,242,.28), inset 0 0 0 2px var(--spl-accent); }
.spl-pill { border: 1px solid #dedee3; background: #fff; border-radius: 999px; padding: 9px 22px; cursor: pointer; }
.spl-pill span { color: var(--spl-dim); }
.spl-root h1 { margin: 26px 0 8px; font: 400 clamp(32px, 5vw, 58px)/1.05 'Instrument Serif', 'Playfair Display', Georgia, serif; letter-spacing: -.01em; }
.spl-root h1 em { font-style: normal; color: var(--spl-accent); }
.spl-sub { font-size: 14px; color: var(--spl-fg); opacity: .8; margin-top: 18px; }
.spl-sub.spl-error { color: #dc2626; opacity: 1; }
.spl-root:focus { outline: none; }
.spl-samples { display: flex; flex-wrap: wrap; justify-content: center; gap: 12px; }
.spl-sample {
  position: relative; width: 50px; height: 50px; border-radius: 8px; border: 1px solid #dedee3; background: #fff; color: #6b6b6b; cursor: pointer;
  display: flex; align-items: center; justify-content: center; transition: border-color .12s, color .12s, transform .12s;
}
.spl-sample:hover { border-color: var(--spl-accent); color: var(--spl-accent); transform: translateY(-1px); }
.spl-sample span {
  position: absolute; top: calc(100% + 8px); left: 50%; transform: translateX(-50%); white-space: nowrap; font-size: 11px; color: var(--spl-dim);
  opacity: 0; transition: opacity .12s; pointer-events: none;
}
.spl-sample:hover span, .spl-sample:focus-visible span { opacity: 1; }
.spl-busy .spl-sample, .spl-busy .spl-drop { pointer-events: none; }
.spl-sample.spl-loading { color: var(--spl-accent); border-color: var(--spl-accent); animation: spl-pulse .9s ease-in-out infinite; }
@keyframes spl-pulse { 50% { opacity: .45; } }
.spl-x {
  position: absolute; right: 22px; top: 22px; width: 40px; height: 40px; border-radius: 50%; border: 0; background: #e9e9ec; color: #1e1e1e;
  font-size: 24px; line-height: 1; cursor: pointer;
}
.spl-x:hover { background: #dcdce0; }
.spl-root button:focus-visible { outline: 2px solid var(--spl-accent); outline-offset: 2px; }
body.tpTheme-figma-dark .spl-root, body.tpTheme-dark .spl-root, body.tpTheme-black .spl-root, body.tpTheme-blue .spl-root {
  --spl-fg: #f2f2f2; --spl-dim: #a8a8a8;
  background:
    repeating-radial-gradient(ellipse 120% 70% at 62% 48%, rgba(255,255,255,0) 0 70px, rgba(255,255,255,.035) 110px, rgba(255,255,255,0) 150px),
    radial-gradient(ellipse at 50% 50%, #26262b 0%, #1d1d21 70%, #18181b 100%);
}
body.tpTheme-figma-dark .spl-pill, body.tpTheme-dark .spl-pill, body.tpTheme-black .spl-pill, body.tpTheme-blue .spl-pill,
body.tpTheme-figma-dark .spl-sample, body.tpTheme-dark .spl-sample, body.tpTheme-black .spl-sample, body.tpTheme-blue .spl-sample { background: #2a2a2f; border-color: #3a3a40; }
body.tpTheme-figma-dark .spl-x, body.tpTheme-dark .spl-x, body.tpTheme-black .spl-x, body.tpTheme-blue .spl-x { background: #333338; color: #f2f2f2; }
body.tpTheme-figma-dark .spl-drop, body.tpTheme-dark .spl-drop, body.tpTheme-black .spl-drop, body.tpTheme-blue .spl-drop { background: color-mix(in srgb, var(--spl-accent) 16%, #222); }
`
    document.head.appendChild(st)
}
