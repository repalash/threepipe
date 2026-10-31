/** HTML-escapes text, also for attribute values */
function esc(s: string) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** Escaped text with **bold** and *italic* */
function inline(s: string) {
    return esc(s)
        .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
        .replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, '$1<i>$2</i>')
}

/**
 * The text of an annotation as HTML: line breaks, `- ` bullets, `**bold**`, `*italic*`, `[label](https://…)` and bare
 * `https://` links (they open in a new tab). All other text is escaped, so the result is safe to set as `innerHTML`.
 */
export function renderAnnotationText(text: string) {
    const re = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"])/g
    const link = (href: string, label: string) => `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`
    return text.split('\n').map(line => {
        let out = ''
        let last = 0
        const bullet = /^\s*[-•]\s+/.exec(line)
        if (bullet) line = line.slice(bullet[0].length)
        for (const m of line.matchAll(re)) {
            out += inline(line.slice(last, m.index))
            out += m[1] ? link(m[2], inline(m[1])) : link(m[3], esc(m[3]))
            last = m.index! + m[0].length
        }
        out += inline(line.slice(last))
        return bullet ? `<span class="anp-li">${out}</span>` : out
    }).join('<br>')
}
