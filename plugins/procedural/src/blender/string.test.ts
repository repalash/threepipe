import {expect, it} from 'vitest'
import {strcasecmpNatural} from './string'

it('orders names as BLI_strcasecmp_natural does', () => {
    const sorted = ['Wall.010', 'wall.2', 'Wall.1', 'foo 1.bar', 'foo.bar', 'a02', 'a2', 'a10', 'B', 'a'].sort(strcasecmpNatural)
    // Numbers by value, case-insensitive letters, '.' before other characters, leading zeros as the tie breaker
    // (more zeros sort later), shorter strings first.
    expect(sorted).toEqual(['a', 'a2', 'a02', 'a10', 'B', 'foo.bar', 'foo 1.bar', 'Wall.1', 'wall.2', 'Wall.010'])
    expect(strcasecmpNatural('abc', 'ABC')).toBe(1) // equal ignoring case: strcmp decides ('a' > 'A')
})
