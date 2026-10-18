/**
 * Numeric input during a modal transform, ported from `editors/util/numinput.cc`.
 *
 * Type digits during `G`/`R`/`S` to be exact; `Tab` moves to the next value (`G 1 Tab 2` moves by
 * (1, 2, 0)); `-` negates, `/` inverts; `=` or `*` switches to full editing where an expression such
 * as `2*pi/3` or `(1+sqrt(2))` is accepted; `Backspace` with nothing typed resets to the mouse value.
 * Blender evaluates expressions with Python; this port uses a small arithmetic parser with the same
 * operators and the common functions, which covers what is typed into a transform header.
 *
 * Each exported function cites the Blender function it ports, with the line in `numinput.cc`.
 */

export const NUM_STR_REP_LEN = 64
export const NUM_MAX_ELEMENTS = 3

/** `NumInput.flag` (`ED_numinput.hh:54`). */
export const NUM_AFFECT_ALL = 1 << 0
/** Enable full editing, with math operators (`numinput.cc:51`). */
const NUM_EDIT_FULL = 1 << 9
/** Fake edited state, avoids an issue with backspace (`numinput.cc:54`). */
const NUM_FAKE_EDITED = 1 << 10

/** `NumInput.val_flag[]` public flags (`ED_numinput.hh:62`). */
export const NUM_NULL_ONE = 1 << 0
export const NUM_NO_NEGATIVE = 1 << 1
export const NUM_NO_ZERO = 1 << 2
export const NUM_NO_FRACTION = 1 << 3
export const NUM_INT_INPUT_VALUE = 1 << 4
/** Internal `val_flag` bits (`numinput.cc:62`). */
const NUM_EDITED = 1 << 9
const NUM_INVALID = 1 << 10
const NUM_NEGATE = 1 << 11
const NUM_INVERSE = 1 << 12

export type NumUnitType = 'none' | 'length' | 'rotation'

/** A keyboard event reduced to what `handleNumInput` reads from `wmEvent`. */
export interface NumInputEvent {
    /** `KeyboardEvent.key`: the character typed, or a named key such as `Backspace`. */
    key: string
    /** `KeyboardEvent.code`, used to tell the numpad period apart from a locale comma. */
    code?: string
    ctrl?: boolean
    shift?: boolean
    alt?: boolean
    /** Blender's `NUM_MODAL_INCREMENT_UP/DOWN`, bound to the arrow keys in the transform keymap. */
    modal?: 'incrementUp' | 'incrementDown'
}

/** The `NumInput` struct (`ED_numinput.hh:23`). */
export class NumInput {
    /** `idx_max < NUM_MAX_ELEMENTS`. */
    idxMax = 0
    unitType: NumUnitType[] = ['none', 'none', 'none']
    unitUseRadians = false
    flag = 0
    valFlag = [0, 0, 0]
    /** Direct value of the input; radians for rotation. */
    val = [0, 0, 0]
    /** Evaluated value before unit scaling (degrees, not radians). */
    valNoUnits = [0, 0, 0]
    /** Original value, for reset. */
    valOrg = [0, 0, 0]
    /** Increment steps. */
    valInc = [1, 1, 1]
    idx = 0
    /** String as typed by the user for the edited value. */
    str = ''
    /** Cursor position in `str`. */
    strCur = 0
    /**
     * `USER_FLAG_NUMINPUT_ADVANCED`: typing any operator character switches to full editing
     * without first pressing `=`. Off in Blender's defaults.
     */
    advanced = false
}

/** `initNumInput` (`numinput.cc:85`). */
export function initNumInput(n: NumInput): void {
    n.idxMax = 0
    n.unitType = ['none', 'none', 'none']
    n.unitUseRadians = false
    n.flag = 0
    n.valFlag = [0, 0, 0]
    n.val = [0, 0, 0]
    n.valNoUnits = [0, 0, 0]
    n.valOrg = [0, 0, 0]
    n.valInc = [1, 1, 1]
    n.idx = 0
    n.str = ''
    n.strCur = 0
}

/** `hasNumInput` (`numinput.cc:188`). */
export function hasNumInput(n: NumInput): boolean {
    if (n.flag & NUM_FAKE_EDITED) return true
    for (let i = 0; i <= n.idxMax; i++) {
        if (n.valFlag[i] & NUM_EDITED) return true
    }
    return false
}

/**
 * `applyNumInput` (`numinput.cc:207`): write the typed values into `vec` and return true; or,
 * when nothing was typed, store `vec` as the values to reset to and return false.
 */
export function applyNumInput(n: NumInput, vec: number[]): boolean {
    if (hasNumInput(n)) {
        for (let j = 0; j <= n.idxMax; j++) {
            let val: number
            if (n.flag & NUM_FAKE_EDITED) {
                val = n.val[j]
            } else {
                // If AFFECTALL and no number typed and cursor not on number, use first number.
                const i = n.flag & NUM_AFFECT_ALL && n.idx !== j && !(n.valFlag[j] & NUM_EDITED) ? 0 : j
                val = !(n.valFlag[i] & NUM_EDITED) && n.valFlag[i] & NUM_NULL_ONE ? 1 : n.val[i]

                if (n.valFlag[i] & NUM_NO_NEGATIVE && val < 0) val = 0
                if (n.valFlag[i] & NUM_NO_FRACTION && val !== Math.floor(val)) {
                    val = Math.floor(val + 0.5)
                    if (n.valFlag[i] & NUM_NO_ZERO && val === 0) val = 1
                } else if (n.valFlag[i] & NUM_NO_ZERO && val === 0) {
                    val = 0.0001
                }
            }
            vec[j] = val
        }
        n.flag &= ~NUM_FAKE_EDITED
        return true
    }

    for (let j = 0; j <= n.idxMax; j++) {
        n.val[j] = n.valOrg[j] = vec[j]
    }
    return false
}

/**
 * `ui::calc_float_precision` (`interface.cc`): raise the precision for small values so `0.00001`
 * is not drawn as `0.00`, as Blender does when drawing the header.
 */
export function calcFloatPrecision(prec: number, value: number): number {
    const maxPrec = 6
    const maxPow = 10000000.0
    value = Math.abs(value)
    if (value < Math.pow(10, -prec) && value > 1.0 / maxPow) {
        let valueI = Math.round(value * maxPow)
        if (valueI !== 0) {
            const precSpan = 3
            let precMin = -1
            let decFlag = 0
            let i = maxPrec
            while (i && valueI) {
                if (valueI % 10) {
                    decFlag |= 1 << i
                    precMin = i
                }
                valueI = Math.floor(valueI / 10)
                i--
            }
            let testPrec = precMin
            decFlag = decFlag >> precMin + 1 & (1 << precSpan) - 1
            while (decFlag) {
                testPrec++
                decFlag = decFlag >> 1
            }
            if (testPrec > prec) prec = testPrec
        }
    }
    return Math.max(0, Math.min(maxPrec, prec))
}

/** `BKE_unit_value_as_string_adaptive` for the unit-less case: fixed precision, trailing zeros stripped. */
export function formatAdaptive(value: number, prec: number): string {
    if (!Number.isFinite(value)) return 'inf'
    let s = value.toFixed(prec)
    if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '')
    if (s === '-0') s = '0'
    return s
}

/** The value as the user sees it: degrees for rotation unless radians are preferred. */
function valueDisplay(n: NumInput, i: number, value: number, prec: number): string {
    if (n.unitType[i] === 'rotation') {
        if (n.unitUseRadians) return formatAdaptive(value, 6) + 'r'
        return formatAdaptive(value * 180 / Math.PI, calcFloatPrecision(prec, value * 180 / Math.PI)) + '°'
    }
    return formatAdaptive(value, calcFloatPrecision(prec, value))
}

/** `outputNumInput` (`numinput.cc:104`): one string per value, for the header. */
export function outputNumInput(n: NumInput): string[] {
    const out: string[] = []
    let prec = 2 // draw-only, avoids too much issues with radian->degrees conversion.

    for (let j = 0; j <= n.idxMax; j++) {
        const i = n.flag & NUM_AFFECT_ALL && n.idx !== j && !(n.valFlag[j] & NUM_EDITED) ? 0 : j

        if (n.valFlag[i] & NUM_EDITED) {
            prec = calcFloatPrecision(prec, n.val[i])
            if (i === n.idx) {
                let headingExp = '', trailingExp = ''
                if (n.valFlag[i] & NUM_NEGATE) {
                    headingExp = n.valFlag[i] & NUM_INVERSE ? '-1/(' : '-('
                    trailingExp = ')'
                } else if (n.valFlag[i] & NUM_INVERSE) {
                    headingExp = '1/('
                    trailingExp = ')'
                }
                const val = n.valFlag[i] & NUM_INVALID ? 'Invalid' : valueDisplay(n, i, n.val[i], prec)
                const before = n.str.slice(0, n.strCur)
                const after = n.str.slice(n.strCur)
                out.push(`[${headingExp}${before}|${after}${trailingExp}] = ${val}`)
            } else {
                const cur = i === n.idx ? '|' : ''
                out.push(`${cur}${valueDisplay(n, i, n.val[i], prec)}${cur}`)
            }
        } else {
            const cur = i === n.idx ? '|' : ''
            out.push(`${cur}NONE${cur}`)
        }
    }
    return out
}

/** `value_to_editstr` (`numinput.cc:253`): put the current value back into the edit string. */
function valueToEditstr(n: NumInput, idx: number): void {
    const prec = 6
    const v = n.val[idx]
    let s: string
    if (n.unitType[idx] === 'rotation' && !n.unitUseRadians) {
        s = formatAdaptive(v * 180 / Math.PI, prec)
    } else {
        s = formatAdaptive(v, prec)
    }
    n.str = s
    n.strCur = s.length
}

/** `editstr_insert_at_cursor` (`numinput.cc:267`). */
function editstrInsertAtCursor(n: NumInput, buf: string): boolean {
    if (n.str.length + buf.length >= NUM_STR_REP_LEN) return false
    n.str = n.str.slice(0, n.strCur) + buf + n.str.slice(n.strCur)
    n.strCur += buf.length
    return true
}

/** `editstr_is_simple_numinput` (`numinput.cc:333`). */
function editstrIsSimpleNuminput(ch: string): boolean {
    return ch >= '0' && ch <= '9' || ch === '.'
}

/**
 * `user_string_to_number` (`numinput.cc:284`): evaluate the typed string. For rotation the result
 * is radians; `valueNoUnits` keeps what was typed (degrees), which the quadrant test reads.
 */
export function userStringToNumber(str: string, unitType: NumUnitType, useRadians: boolean): {value: number, valueNoUnits: number} | null {
    let expr = str.trim()
    let explicitUnit: 'deg' | 'rad' | null = null
    if (unitType === 'rotation') {
        const m = /^(.*?)(°|deg(?:rees?)?|rad(?:ians?)?|[dr])\s*$/i.exec(expr)
        if (m) {
            expr = m[1]
            explicitUnit = /^(°|d)/i.test(m[2]) ? 'deg' : 'rad'
        }
    }
    const value = evaluateExpression(expr)
    if (value === null) return null
    if (unitType === 'rotation') {
        if (explicitUnit === 'deg' || explicitUnit === null && !useRadians) {
            return {value: value * Math.PI / 180, valueNoUnits: value}
        }
        // Explicit radians, or radians are preferred: the typed number is the value itself.
        return {value, valueNoUnits: value}
    }
    return {value, valueNoUnits: value}
}

/** `ED_numinput_double_is_int` (`numinput.cc:73`). */
export function numinputDoubleIsInt(value: number): boolean {
    value = Math.abs(value)
    if (!Number.isFinite(value) || value >= 18446744073709551616) return false
    return value === Math.trunc(value)
}

/**
 * `handleNumInput` (`numinput.cc:344`). Returns true when the event changed the input and a redraw
 * is needed; false when the key is not for the numeric input.
 */
export function handleNumInput(n: NumInput, event: NumInputEvent): boolean {
    const ascii = event.key.length === 1 ? event.key : ''
    let updated = false
    const idx = n.idx, idxMax = n.idxMax
    let dir = 1
    let utf8: string | null = null

    if (n.advanced) {
        if (!event.ctrl && !event.alt && ascii && '01234567890@%^&*-+/{}()[]<>.|'.includes(ascii)) {
            if (!(n.flag & NUM_EDIT_FULL)) {
                n.flag |= NUM_EDIT_FULL
                n.valFlag[idx] |= NUM_EDITED
            }
        }
    }

    // Hack around keyboards without direct access to '=' nor '*' (`numinput.cc:371`).
    if (ascii === '=' || ascii === '*') {
        if (!(n.flag & NUM_EDIT_FULL)) {
            n.flag |= NUM_EDIT_FULL
            n.valFlag[idx] |= NUM_EDITED
            return true
        }
        if (event.ctrl) {
            n.flag &= ~NUM_EDIT_FULL
            return true
        }
    }

    const type = event.modal ? 'modal' : event.key
    switch (type) {
    case 'modal':
        n.val[idx] += event.modal === 'incrementUp' ? n.valInc[idx] : -n.valInc[idx]
        valueToEditstr(n, idx)
        n.valFlag[idx] |= NUM_EDITED
        updated = true
        break
    case 'Backspace':
        if (!(n.valFlag[idx] & NUM_EDITED)) {
            n.val = n.valOrg.slice()
            n.valFlag[0] &= ~NUM_EDITED
            n.valFlag[1] &= ~NUM_EDITED
            n.valFlag[2] &= ~NUM_EDITED
            n.flag |= NUM_FAKE_EDITED
            updated = true
            break
        } else if (event.shift || !n.str) {
            n.val[idx] = n.valOrg[idx]
            n.valFlag[idx] &= ~NUM_EDITED
            n.str = ''
            n.strCur = 0
            updated = true
            break
        }
        dir = -1
    // falls through: common behaviour with Delete, removing before/after the cursor.
    case 'Delete': {
        if (n.valFlag[idx] & NUM_EDITED && n.str) {
            const cur = n.strCur
            let tCur = cur
            if (event.ctrl) {
                // Jump over a run of the same character class, as `STRCUR_JUMP_DELIM` does.
                tCur = jumpDelim(n.str, cur, dir)
            } else {
                tCur = Math.max(0, Math.min(n.str.length, cur + dir))
            }
            if (tCur !== cur) {
                const a = Math.min(tCur, cur), b = Math.max(tCur, cur)
                n.str = n.str.slice(0, a) + n.str.slice(b)
                n.strCur = a
                updated = true
            }
            if (!n.str) n.val[idx] = n.valOrg[idx]
        } else {
            return false
        }
        break
    }
    case 'ArrowLeft':
        dir = -1
    // falls through
    case 'ArrowRight': {
        const cur = event.ctrl ? jumpDelim(n.str, n.strCur, dir) : Math.max(0, Math.min(n.str.length, n.strCur + dir))
        if (cur !== n.strCur) {
            n.strCur = cur
            return true
        }
        return false
    }
    case 'Home':
        if (n.str) {
            n.strCur = 0
            return true
        }
        return false
    case 'End':
        if (n.str) {
            n.strCur = n.str.length
            return true
        }
        return false
    case 'Tab': {
        n.valFlag[idx] &= ~(NUM_NEGATE | NUM_INVERSE)
        const next = (idx + idxMax + (event.ctrl ? 0 : 2)) % (idxMax + 1)
        n.idx = next
        if (n.valFlag[next] & NUM_EDITED) {
            valueToEditstr(n, next)
        } else {
            n.str = ''
            n.strCur = 0
        }
        return true
    }
    case '-':
        if (event.ctrl || !(n.flag & NUM_EDIT_FULL)) {
            n.valFlag[idx] ^= NUM_NEGATE
            updated = true
        }
        break
    case '/':
        if (event.ctrl || !(n.flag & NUM_EDIT_FULL)) {
            n.valFlag[idx] ^= NUM_INVERSE
            updated = true
        }
        break
    default:
        break
    }

    if (event.code === 'NumpadDecimal' || event.key === '.' || event.key === ',' && event.code === 'NumpadDecimal') {
        // Force number-pad "." since some OS's/countries generate a comma char (`numinput.cc:500`).
        utf8 = '.'
    }

    if (!updated && !utf8 && ascii) utf8 = ascii

    // Up to this point, if we have a ctrl modifier, skip. This allows most modal shortcuts to work
    // even in numinput mode.
    if (!updated && event.ctrl) return false

    if (utf8) {
        if (!(n.flag & NUM_EDIT_FULL)) {
            // In simple edit mode, only a few chars are valid.
            if (!editstrIsSimpleNuminput(utf8)) return false
        }
        if (!editstrInsertAtCursor(n, utf8)) return false
        n.valFlag[idx] |= NUM_EDITED
    } else if (!updated) {
        return false
    }

    // At this point our value has changed, try to interpret it (if str is not empty).
    if (n.str) {
        const valPrev = n.val[idx]
        const result = userStringToNumber(n.str, n.unitType[idx], n.unitUseRadians)
        if (result) {
            n.val[idx] = result.value
            n.valFlag[idx] &= ~NUM_INVALID
            n.valNoUnits[idx] = result.valueNoUnits
            if (numinputDoubleIsInt(result.valueNoUnits)) n.valFlag[idx] |= NUM_INT_INPUT_VALUE
            else n.valFlag[idx] &= ~NUM_INT_INPUT_VALUE
        } else {
            n.valFlag[idx] |= NUM_INVALID
            n.valFlag[idx] &= ~NUM_INT_INPUT_VALUE
        }

        if (n.valFlag[idx] & NUM_NEGATE) {
            n.val[idx] = -n.val[idx]
            n.valNoUnits[idx] = -n.valNoUnits[idx]
        }
        if (n.valFlag[idx] & NUM_INVERSE) {
            let val = n.val[idx]
            // If we invert on radians when the user is in degrees, you get unexpected results (#53463).
            if (!n.unitUseRadians && n.unitType[idx] === 'rotation') val = val * 180 / Math.PI
            val = 1.0 / val
            if (!n.unitUseRadians && n.unitType[idx] === 'rotation') val = val * Math.PI / 180
            n.val[idx] = val
            n.valNoUnits[idx] = 1.0 / n.valNoUnits[idx]
            n.valFlag[idx] &= ~NUM_INT_INPUT_VALUE
        }

        if (!Number.isFinite(n.val[idx])) {
            n.val[idx] = valPrev
            n.valFlag[idx] |= NUM_INVALID
        }
    }

    return true
}

/** The `STRCUR_JUMP_DELIM` cursor step: over a run of alphanumerics, else one delimiter. */
function jumpDelim(str: string, cur: number, dir: number): number {
    const isWord = (c: string) => /[0-9a-zA-Z.]/.test(c)
    let i = cur
    if (dir < 0) {
        if (i === 0) return 0
        i--
        while (i > 0 && isWord(str[i]) && isWord(str[i - 1])) i--
        return i
    }
    if (i >= str.length) return str.length
    i++
    while (i < str.length && isWord(str[i - 1]) && isWord(str[i])) i++
    return i
}

/** Which index of a typed vector is being edited, 0..idxMax. */
export function numInputIndex(n: NumInput): number {
    return n.idx
}

/** Whether the value at `i` was edited. */
export function numInputEdited(n: NumInput, i: number): boolean {
    return (n.valFlag[i] & NUM_EDITED) !== 0
}

/** Whether a value was typed as a whole number (`NUM_INT_INPUT_VALUE`), for the rotation quadrant test. */
export function numInputIsInt(n: NumInput, i: number): boolean {
    return (n.valFlag[i] & NUM_INT_INPUT_VALUE) !== 0
}

// region expression evaluation

/**
 * Evaluate an arithmetic expression: `+ - * / % ^` (and `**`), parentheses, unary minus, the
 * constants `pi` and `e`, and `sin cos tan asin acos atan sqrt abs floor ceil round radians degrees`.
 * Trigonometry takes radians, as Python's `math` module does. Returns null when it does not parse.
 */
export function evaluateExpression(src: string): number | null {
    const tokens = tokenize(src)
    if (!tokens) return null
    let pos = 0
    const peek = () => tokens[pos]
    const next = () => tokens[pos++]

    const parseExpr = (): number | null => {
        let v = parseTerm()
        if (v === null) return null
        while (peek() && (peek()!.t === '+' || peek()!.t === '-')) {
            const op = next()!.t
            const r = parseTerm()
            if (r === null) return null
            v = op === '+' ? v + r : v - r
        }
        return v
    }
    const parseTerm = (): number | null => {
        let v = parseUnary()
        if (v === null) return null
        while (peek() && (peek()!.t === '*' || peek()!.t === '/' || peek()!.t === '%')) {
            const op = next()!.t
            const r = parseUnary()
            if (r === null) return null
            v = op === '*' ? v * r : op === '/' ? v / r : v % r
        }
        return v
    }
    const parseUnary = (): number | null => {
        if (peek() && peek()!.t === '-') {
            next()
            const v = parseUnary()
            return v === null ? null : -v
        }
        if (peek() && peek()!.t === '+') {
            next()
            return parseUnary()
        }
        return parsePower()
    }
    const parsePower = (): number | null => {
        const base = parseAtom()
        if (base === null) return null
        if (peek() && peek()!.t === '^') {
            next()
            const exp = parseUnary()
            if (exp === null) return null
            return Math.pow(base, exp)
        }
        return base
    }
    const parseAtom = (): number | null => {
        const tok = next()
        if (!tok) return null
        if (tok.t === 'num') return tok.v!
        if (tok.t === '(') {
            const v = parseExpr()
            if (v === null) return null
            const close = next()
            if (!close || close.t !== ')') return null
            return v
        }
        if (tok.t === 'id') {
            const name = tok.s!.toLowerCase()
            if (name === 'pi') return Math.PI
            if (name === 'e') return Math.E
            const fn = FUNCTIONS[name]
            if (!fn) return null
            const open = next()
            if (!open || open.t !== '(') return null
            const arg = parseExpr()
            if (arg === null) return null
            const close = next()
            if (!close || close.t !== ')') return null
            return fn(arg)
        }
        return null
    }

    const value = parseExpr()
    if (value === null || pos !== tokens.length) return null
    return value
}

const FUNCTIONS: Record<string, (x: number) => number> = {
    sin: Math.sin, cos: Math.cos, tan: Math.tan,
    asin: Math.asin, acos: Math.acos, atan: Math.atan,
    sqrt: Math.sqrt, abs: Math.abs, floor: Math.floor, ceil: Math.ceil, round: Math.round,
    radians: x => x * Math.PI / 180, degrees: x => x * 180 / Math.PI,
}

interface Token {
    t: string
    v?: number
    s?: string
}

function tokenize(src: string): Token[] | null {
    const out: Token[] = []
    let i = 0
    while (i < src.length) {
        const c = src[i]
        if (c === ' ' || c === '\t') {
            i++
            continue
        }
        if (c >= '0' && c <= '9' || c === '.') {
            const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i))
            if (!m) return null
            out.push({t: 'num', v: Number(m[0])})
            i += m[0].length
            continue
        }
        if (/[a-zA-Z_]/.test(c)) {
            const m = /^[a-zA-Z_]+/.exec(src.slice(i))!
            out.push({t: 'id', s: m[0]})
            i += m[0].length
            continue
        }
        if (c === '*' && src[i + 1] === '*') {
            out.push({t: '^'})
            i += 2
            continue
        }
        if ('+-*/%^()'.includes(c)) {
            out.push({t: c})
            i++
            continue
        }
        return null
    }
    return out
}

// endregion
