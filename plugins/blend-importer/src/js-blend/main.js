/* eslint-disable camelcase */
/**
 * JS.Blend
 * Original Repo: https://github.com/acweathersby/js.blend
 * Slightly modified for three.js and js updates, minor refactor.
 * Object-creation part re-written for latest three.js and typescript
 * MIT License
 * Copyright (c) 2020 Anthony C, Weathersby
 * @license
 */
import parser from './parser/parser.js';

const noop = () => {}

export async function parseBlend (buffer, name = '') {
    return new Promise((res, rej) => {
        parser.onParseReady = (file, error) => {
            // Don't leave this callback on the module: it holds the promise, and so the parsed file, until
            // the next parse. (A no-op from outside this function: one made here would keep `buffer`.)
            parser.onParseReady = noop
            // Soft-error: log but still resolve with the partial result. Several
            // .blend files (notably geometry-nodes scenes in Blender 4.x) trigger
            // mid-parse errors but produce a usable partial scene; rejecting would
            // strip all rendered geometry. todo Re-evaluate if we should throw once the parser is hardened.
            if (error) console.error(error)
            res(file)
        }
        parser.loadBlendFromArrayBuffer(buffer, name)
    })
}
