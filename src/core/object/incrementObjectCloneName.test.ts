import {describe, test, expect} from 'vitest'
import {incrementObjectCloneName} from './IObjectUi'

// minimal mock objects — only need name, parent, children
function mockObj(name: string, siblings: string[] = []): any {
    const parent = {
        children: siblings.map(n => ({name: n})),
    }
    const obj: any = {name, parent}
    parent.children.push(obj)
    return obj
}

describe('incrementObjectCloneName', () => {
    test('adds (copy) suffix to a name without one', () => {
        const obj = mockObj('Cube')
        const clone: any = {name: ''}
        incrementObjectCloneName(obj, clone)
        expect(clone.name).toBe('Cube (copy)')
    })

    test('increments (copy) to (copy 2)', () => {
        const obj = mockObj('Cube (copy)')
        const clone: any = {name: ''}
        incrementObjectCloneName(obj, clone)
        expect(clone.name).toBe('Cube (copy 2)')
    })

    test('increments (copy 2) to (copy 3)', () => {
        const obj = mockObj('Cube (copy 2)')
        const clone: any = {name: ''}
        incrementObjectCloneName(obj, clone)
        expect(clone.name).toBe('Cube (copy 3)')
    })

    test('increments (copy 99) to (copy 100)', () => {
        const obj = mockObj('Cube (copy 99)')
        const clone: any = {name: ''}
        incrementObjectCloneName(obj, clone)
        expect(clone.name).toBe('Cube (copy 100)')
    })

    test('avoids name collisions with siblings', () => {
        const obj = mockObj('Cube (copy)', ['Cube (copy 2)', 'Cube (copy 3)'])
        const clone: any = {name: ''}
        incrementObjectCloneName(obj, clone)
        expect(clone.name).toBe('Cube (copy 4)')
    })

    test('uses custom name parameter', () => {
        const obj = mockObj('Sphere')
        const clone: any = {name: ''}
        incrementObjectCloneName(obj, clone, 'CustomName')
        expect(clone.name).toBe('CustomName (copy)')
    })

    test('uses custom name with existing copy suffix', () => {
        const obj = mockObj('Sphere')
        const clone: any = {name: ''}
        incrementObjectCloneName(obj, clone, 'CustomName (copy 5)')
        expect(clone.name).toBe('CustomName (copy 6)')
    })

    test('empty name string gets (copy) suffix', () => {
        const obj = mockObj('')
        const clone: any = {name: ''}
        incrementObjectCloneName(obj, clone)
        // Empty string has no "(copy)" match, so falls to else branch: '' + ' (copy)'
        expect(clone.name).toBe(' (copy)')
    })

    test('name with nested copy patterns "Cube (copy 2) (copy 3)"', () => {
        // The regex /\(copy( (\d+))?\)$/ matches the LAST "(copy N)" at end of string
        const obj = mockObj('Cube (copy 2) (copy 3)')
        const clone: any = {name: ''}
        incrementObjectCloneName(obj, clone)
        // match[2] = '3', so copyNum = 4
        // replace replaces FIRST match of the regex, but $ anchors it to end
        expect(clone.name).toBe('Cube (copy 2) (copy 4)')
    })

    test('object with no parent (null parent)', () => {
        // Create an object with null parent
        const obj: any = {name: 'Cube (copy)', parent: null}
        const clone: any = {name: ''}
        // The code checks `if (parent && parent !== clone.parent)` — null is falsy, so no sibling check
        incrementObjectCloneName(obj, clone)
        expect(clone.name).toBe('Cube (copy 2)')
    })

    test('object with undefined parent', () => {
        const obj: any = {name: 'Cube', parent: undefined}
        const clone: any = {name: ''}
        incrementObjectCloneName(obj, clone)
        expect(clone.name).toBe('Cube (copy)')
    })
})
