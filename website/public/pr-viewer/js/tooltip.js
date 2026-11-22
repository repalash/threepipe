// Tooltips that show at once (the browser's own wait a second or more): any element's `title` is moved to
// `data-tip` on hover and shown under the element after a short delay. Mouse only; touch screens have no hover.

export function installTooltips(delay = 300) {
    if (!matchMedia('(hover: hover)').matches) return
    const tip = document.createElement('div')
    tip.className = 'tip'
    tip.hidden = true
    tip.setAttribute('role', 'tooltip')
    document.body.appendChild(tip)
    let target = null, timer = 0
    const hide = () => { clearTimeout(timer); tip.hidden = true; target = null }
    const show = (el) => {
        if (!el.isConnected || !el.dataset.tip) return
        tip.textContent = el.dataset.tip
        tip.hidden = false
        const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight
        const x = Math.max(6, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 6))
        const y = r.bottom + 6 + h < innerHeight ? r.bottom + 6 : r.top - h - 6
        tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`
    }
    document.addEventListener('pointerover', (e) => {
        if (e.pointerType && e.pointerType !== 'mouse') return
        const el = e.target.closest?.('[title], [data-tip]')
        if (el === target) return
        hide()
        if (!el || el.closest('.monaco-editor')) return
        if (el.hasAttribute('title')) {
            const t = el.getAttribute('title')
            el.removeAttribute('title')
            if (!t) return
            el.dataset.tip = t
            if (!el.hasAttribute('aria-label') && !el.textContent.trim()) el.setAttribute('aria-label', t)
        }
        target = el
        timer = setTimeout(() => show(el), tip.hidden ? delay : 0)
    })
    document.addEventListener('pointerout', (e) => { if (target && !target.contains(e.relatedTarget)) hide() })
    for (const ev of ['pointerdown', 'keydown', 'wheel']) document.addEventListener(ev, hide, true)
    addEventListener('blur', hide)
}
