import {expect, it} from 'vitest'
import {AttributeStorage} from './attributes'
import {AttrDomain} from './constants'

it('setBuiltins replaces the enforced table and checks existing layers', () => {
    const s = new AttributeStorage({[AttrDomain.Point]: 2, [AttrDomain.Face]: 1})
    expect(() => s.add({name: '.select_poly', domain: AttrDomain.Point, type: 'bool'})).toThrow(/must be face\/bool/)
    s.setBuiltins({position: {domain: AttrDomain.Point, type: 'float3'}})
    s.add({name: '.select_poly', domain: AttrDomain.Point, type: 'bool'})
    expect(() => s.setBuiltins({'.select_poly': {domain: AttrDomain.Face, type: 'bool'}})).toThrow(/does not fit/)
    expect(s.clone().builtins).toBe(s.builtins)
})
