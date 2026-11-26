import {test} from 'node:test'
import assert from 'node:assert/strict'
import {redactLog} from '../src/env.ts'

test('redactLog', () => {
    assert.equal(redactLog('--> GET /api/v1/access/Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4z/key 200 3ms'), '--> GET /api/v1/access/…/key 200 3ms')
    assert.equal(redactLog('{"path":"/_files/t/1793000000.c2lnbmF0dXJlLXZhbHVlLTEyMzQ1/d/jane/abc/scene.glb"}'), '{"path":"/_files/t/…/d/jane/abc/scene.glb"}')
    assert.equal(redactLog('POST /api/v1/access/key 200'), 'POST /api/v1/access/key 200')
    assert.equal(redactLog('GET /api/v1/drive/items/abc 200'), 'GET /api/v1/drive/items/abc 200')
})
