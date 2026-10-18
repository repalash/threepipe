/**
 * A drawing of a navigation gesture: a mouse with the button (or wheel) that does it lit up, or a
 * trackpad with two fingers, plus the modifier key to hold. The kinds come from the engine's
 * `Navigation.gestures()`, which derives them from the active preset, so the drawing always shows
 * what the controls really do.
 */

import type {GestureKind} from '@threepipe/plugin-editor-engine'

const MODIFIER: Partial<Record<GestureKind, string>> = {
    'alt-drag': 'Alt', 'shift-alt-drag': 'Shift Alt', 'space-drag': 'Space', 'shift-middle-drag': 'Shift',
    'shift-two-finger': 'Shift', 'ctrl-two-finger': 'Ctrl',
}

function Mouse({lit}: {lit: 'left' | 'middle' | 'right' | 'wheel'}) {
    const on = 'var(--me-accent)'
    const off = 'none'
    // drawn at 1.15x: the buttons have to be big enough to see which one is lit
    return <g transform="translate(-6 -4) scale(1.15)">
        {/* body; the two buttons are the top half split down the middle */}
        <rect x="17" y="6" width="22" height="36" rx="11" className="me-gesture-line" fill="none" />
        <path d="M28 6 A11 11 0 0 0 17 17 V22 H28 Z" fill={lit === 'left' ? on : off} className="me-gesture-line" />
        <path d="M28 6 A11 11 0 0 1 39 17 V22 H28 Z" fill={lit === 'right' ? on : off} className="me-gesture-line" />
        <rect x="26" y="10" width="4" height="9" rx="2" fill={lit === 'middle' || lit === 'wheel' ? on : 'var(--me-bg-raised)'} className="me-gesture-line" />
        {lit === 'wheel'
            ? <path d="M44 12 L47 8 L50 12 M44 20 L47 24 L50 20" className="me-gesture-arrow" />
            : <path d="M42 34 C46 30 48 26 48 20 M45 18 L48 15 L51 19" className="me-gesture-arrow" />}
    </g>
}

function Trackpad({pinch}: {pinch?: boolean}) {
    return <g>
        <rect x="6" y="8" width="44" height="32" rx="5" className="me-gesture-line" fill="none" />
        {pinch
            ? <>
                <circle cx="22" cy="27" r="4" className="me-gesture-finger" />
                <circle cx="34" cy="21" r="4" className="me-gesture-finger" />
                <path d="M18 31 L13 36 M13 32 V36 H17 M38 17 L43 12 M39 12 H43 V16" className="me-gesture-arrow" />
            </>
            : <>
                <circle cx="23" cy="26" r="4" className="me-gesture-finger" />
                <circle cx="33" cy="26" r="4" className="me-gesture-finger" />
                <path d="M28 18 V11 M25 14 L28 11 L31 14" className="me-gesture-arrow" />
            </>}
    </g>
}

export function GestureIcon({kind, size = 56}: {kind: GestureKind, size?: number}) {
    const modifier = MODIFIER[kind]
    let body
    switch (kind) {
    case 'left-drag': case 'alt-drag': case 'shift-alt-drag': case 'space-drag':
        body = <Mouse lit="left" />
        break
    case 'middle-drag': case 'shift-middle-drag':
        body = <Mouse lit="middle" />
        break
    case 'right-drag':
        body = <Mouse lit="right" />
        break
    case 'wheel':
        body = <Mouse lit="wheel" />
        break
    case 'pinch':
        body = <Trackpad pinch />
        break
    default:
        body = <Trackpad />
    }
    return <svg className="me-gesture-icon" data-gesture={kind} width={size} height={size} viewBox="0 0 56 56" aria-hidden>
        {body}
        {modifier && <g>
            <rect x={28 - modifier.length * 3.3 - 4} y="45" width={modifier.length * 6.6 + 8} height="10" rx="2.5" className="me-gesture-key" />
            <text x="28" y="52.6" textAnchor="middle" className="me-gesture-key-text">{modifier}</text>
        </g>}
    </svg>
}
