/**
 * Turning a failure into `{ok: false, error, hint}`: the hint is the "did you mean" the registry already
 * writes into its errors, or the next thing to try for the failures agents hit most.
 */

export interface Failure {
    ok: false
    error: string
    hint: string | null
    [key: string]: unknown
}

const HINTS: [RegExp, string][] = [
    [/cannot render/, 'rendering needs a browser: `threepipe-modelling look --doc <file.glb>` starts a headless one, or `--connect` to a live editor'],
    [/no object "/, 'run `threepipe-modelling inspect --doc <file>` to list the object names'],
    [/is out of range/, 'indices change after topology edits - run `inspect --object <name> --detail true` again'],
    [/unknown parameter/, 'run `threepipe-modelling help <op>` for its parameters'],
    [/missing required parameter/, 'run `threepipe-modelling help <op>` for its parameters'],
    [/no editor is connected|no relay answered|cannot reach the relay/, 'start a relay (`threepipe-modelling relay`) and open the editor with the `?agent=...&agentToken=...` it prints'],
    [/session page is not built/, 'run `npm run build:page` in plugins/modelling-cli'],
    [/Executable doesn't exist|browserType.launch/, 'install a browser: `npx playwright install chromium`, or set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH'],
    [/no checkpoint/, 'checkpoints come from `{op: "checkpoint", name}`; `start` and `previous` always exist'],
]

export function failure(error: string, extra: Record<string, unknown> = {}): Failure {
    const didYouMean = /did you mean "([^"]+)"/.exec(error)
    let hint: string | null = didYouMean ? `did you mean "${didYouMean[1]}"?` : null
    if (!hint) for (const [re, h] of HINTS) if (re.test(error)) { hint = h; break }
    return {ok: false, error, hint, ...extra}
}

/** The nearest of `names` to `word`, for an unknown verb. */
export function nearest(word: string, names: string[]): string | null {
    let best: string | null = null
    let score = Infinity
    for (const n of names) {
        const d = lev(word, n)
        if (d < score) {
            score = d
            best = n
        }
    }
    return best && score <= 2 ? best : null
}

function lev(a: string, b: string): number {
    const row = Array.from({length: b.length + 1}, (_, j) => j)
    for (let i = 1; i <= a.length; i++) {
        let prev = row[0]
        row[0] = i
        for (let j = 1; j <= b.length; j++) {
            const t = row[j]
            row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
            prev = t
        }
    }
    return row[b.length]
}
