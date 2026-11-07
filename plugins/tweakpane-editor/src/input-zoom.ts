/**
 * iOS and iPadOS: an iPhone, an iPod or an iPad (an iPad says Macintosh, but has a touch screen). The browsers there use
 * WebKit, and zoom the page into a focused text field whose text is under 16 px.
 */
export function isIOS(nav: Navigator = navigator) {
    const ua = nav.userAgent || ''
    return /iPad|iPhone|iPod/.test(ua) || /Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1
}

/**
 * Stops the zoom of iOS into a focused text field (a search field, a Tweakpane text field), which does not zoom back out
 * when the field loses the focus. It adds `maximum-scale=1` to the viewport meta tag of the page (a new tag when the page
 * has none). iOS ignores it for a pinch zoom, so the person can still zoom the page with two fingers.
 *
 * On other systems it does nothing: they do not zoom into a field, and an Android browser would block the pinch zoom.
 * @param doc - the document of the page
 * @param nav - the navigator, for the system
 * @returns a function that puts the viewport tag back as it was
 */
export function preventIosInputZoom(doc: Document = document, nav: Navigator = navigator): () => void {
    if (!isIOS(nav)) return () => {}
    const found = doc.querySelector<HTMLMetaElement>('meta[name="viewport"]')
    const meta = found ?? doc.createElement('meta')
    const old = found ? meta.content : ''
    if (!found) {
        meta.name = 'viewport'
        doc.head.appendChild(meta)
    }
    // the other parts of the tag stay; a maximum-scale of the page is replaced
    const parts = (found ? old : 'width=device-width, initial-scale=1').split(',').map(s => s.trim())
        .filter(s => s && !/^maximum-scale\s*=/i.test(s))
    meta.content = [...parts, 'maximum-scale=1'].join(', ')
    return () => {
        if (found) meta.content = old
        else meta.remove()
    }
}
