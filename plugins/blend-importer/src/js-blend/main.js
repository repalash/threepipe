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

export async function parseBlend (buffer, name = '') {
    return new Promise((res, rej) => {
        parser.onParseReady = (file, error) => {
            // todo throw error if no objects?
            if (error) console.error(error)
            res(file)
        }
        parser.loadBlendFromArrayBuffer(buffer, name)
    })
}
