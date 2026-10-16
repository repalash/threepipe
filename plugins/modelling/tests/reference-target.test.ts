import {describe, expect, it} from 'vitest'
import {referenceTarget} from '../src/commands/reference'

/**
 * `reference {name, visible}` must not move a plane. It used to default `plane` to `front` on every
 * call, so hiding the `back` reference re-placed it on the front plane, and `camera {view: "ref:back"}`
 * then framed the model from the front. Found building demos/camera.
 */
describe('referenceTarget', () => {
    const refs = new Map([['back', {plane: 'back'}], ['lens', {plane: 'right'}]])

    it('keeps an existing reference on its plane when the update names no plane', () => {
        expect(referenceTarget({name: 'back', visible: false}, refs)).toMatchObject({name: 'back', planeName: 'back'})
        expect(referenceTarget({name: 'lens', opacity: 0.3}, refs)).toMatchObject({name: 'lens', planeName: 'right'})
    })

    it('moves it only when a plane is given', () => {
        expect(referenceTarget({name: 'back', plane: 'left'}, refs).planeName).toBe('left')
    })

    it('puts a new unnamed, planeless reference on the front plane, named after it', () => {
        const t = referenceTarget({image: 'x.jpg'}, refs)
        expect(t).toMatchObject({name: 'front', planeName: 'front'})
        expect(t.existing).toBeUndefined()
        expect(referenceTarget({image: 'x.jpg', plane: 'top'}, refs)).toMatchObject({name: 'top', planeName: 'top'})
    })
})
