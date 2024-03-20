/* eslint-disable camelcase, no-unused-vars, no-empty, no-constant-condition */
import {arrayBufferToBase64} from 'ts-browser-helpers';
import {Texture} from 'threepipe';

let blender_texture_cache = {};

export function createThreeJSTexture (image) {
    let parsed_blend_file = image.__blender_file__;
    let texture = null;
    let name = image.aname;

    if (image.packedfile) {

        if (blender_texture_cache[name]) {
            texture = blender_texture_cache[name];
        } else {

            // get the extension
            let ext = name.split('.').pop();

            let data = image.packedfile;

            let size = data.size;

            let offset = data.data.__data_address__;

            let raw_data = parsed_blend_file.byte.slice(offset, offset + size);

            let encodedData = arrayBufferToBase64(raw_data);

            let dataURI;

            switch (ext) {
            case 'png':
                dataURI = 'data:image/png;base64,' + encodedData;
                break;
            case 'jpg':
                dataURI = 'data:image/jpeg;base64,' + encodedData;
                break;
            default:
                console.warn('Unsupported image type', ext);
            }

            // eslint-disable-next-line no-undef
            let img = new Image();

            img.src = dataURI;

            texture = new Texture(img);

            img.onload = () => {
                texture.needsUpdate = true;
                // todo colorspace?
            };

            blender_texture_cache[name] = texture;
        }
    }
    return texture;
}
