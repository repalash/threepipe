// Sign in with threepipe: the key in the URL fragment after signIn() is taken only when it brings back the state this
// tab kept (a link with someone else's key does not sign the page in), and only from the configured endpoint.
import {afterEach, describe, expect, test, vi} from 'vitest'
import {CloudAuth} from '../src/auth/CloudAuth'

const API = 'https://cloud.example'
const KEY = 'eyJhbGciOiJIUzI1NiJ9.' + btoa(JSON.stringify({exp: Math.floor(Date.now() / 1000) + 3600})).replace(/=+$/, '') + '.sig'

function page(o: {storage?: boolean} = {}) {
    const store = new Map<string, string>()
    const loc = {href: 'https://files.example/p/app/index.html', hash: '', pathname: '/p/app/index.html', search: '', assign: vi.fn()}
    vi.stubGlobal('location', loc)
    vi.stubGlobal('history', {state: null, replaceState: vi.fn()})
    vi.stubGlobal('sessionStorage', o.storage === false
        ? {getItem: () => { throw new Error('sandboxed') }, setItem: () => { throw new Error('sandboxed') }, removeItem: () => { throw new Error('sandboxed') }}
        : {getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k)})
    return {loc, store}
}
const back = (loc: {hash: string}, p: Record<string, string>) => { loc.hash = '#' + new URLSearchParams(p) }
const stateOf = (loc: {assign: ReturnType<typeof vi.fn>}) => new URL(loc.assign.mock.calls[0][0] as string).searchParams.get('state')

describe('CloudAuth.handleRedirect', () => {
    afterEach(() => vi.unstubAllGlobals())

    test('signIn() sends a state, and the key that brings it back signs in', () => {
        const {loc} = page()
        const auth = new CloudAuth(() => API)
        auth.signIn()
        const state = stateOf(loc)
        expect(state).toMatch(/^[0-9a-f]{32}$/)
        back(loc, {tp_cloud_key: KEY, tp_cloud_user: 'me', tp_cloud_folder: 'f1', tp_cloud_api: API, tp_cloud_state: state!})
        expect(auth.handleRedirect()).toBe('signed-in')
        expect(auth.key).toBe(KEY)
        expect(auth.user).toBe('me')
    })

    test('a key in a link the page did not ask for (no state, or another one) is ignored', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        for (const state of [undefined, 'someone-elses-state']) {
            const {loc} = page()
            const auth = new CloudAuth(() => API)
            if (state) auth.signIn()
            back(loc, {tp_cloud_key: KEY, tp_cloud_user: 'victim', tp_cloud_folder: 'f1', tp_cloud_api: API, ...state ? {tp_cloud_state: state} : {}})
            expect(auth.handleRedirect()).toBeNull()
            expect(auth.signedIn).toBe(false)
        }
        warn.mockRestore()
    })

    test('a key from another endpoint is ignored', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        const {loc} = page()
        const auth = new CloudAuth(() => API)
        auth.signIn()
        back(loc, {tp_cloud_key: KEY, tp_cloud_user: 'me', tp_cloud_folder: 'f1', tp_cloud_api: 'https://evil.example', tp_cloud_state: stateOf(loc)!})
        expect(auth.handleRedirect()).toBeNull()
        expect(auth.signedIn).toBe(false)
        warn.mockRestore()
    })

    test('a sandboxed page (no storage) takes the key as it comes', () => {
        const {loc} = page({storage: false})
        const auth = new CloudAuth(() => API)
        auth.signIn()
        expect(stateOf(loc)).toBeNull()
        back(loc, {tp_cloud_key: KEY, tp_cloud_user: 'me', tp_cloud_folder: 'f1', tp_cloud_api: API})
        expect(auth.handleRedirect()).toBe('signed-in')
    })

    test('Cancel comes back as denied with the state', () => {
        const {loc} = page()
        const auth = new CloudAuth(() => API)
        auth.signIn()
        back(loc, {tp_cloud_error: 'denied', tp_cloud_state: stateOf(loc)!})
        expect(auth.handleRedirect()).toBe('denied')
    })
})
