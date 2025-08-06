import {Texture} from 'three'

export const whiteImageData = new ImageData(new Uint8ClampedArray([255, 255, 255, 255]), 1, 1)
export const whiteTexture = new Texture(whiteImageData)
