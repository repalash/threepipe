import {FBXLoader} from 'three/examples/jsm/loaders/FBXLoader.js'
import {Group, Texture} from 'three'
import {AssetImporter} from '../AssetImporter'

/**
 * Extended FBXLoader that sets the default image from AssetImporter (for invalid/missing textures)
 */
export class FBXLoader2 extends FBXLoader {
    async loadAsync(url: string, onProgress?: (event: ProgressEvent) => void): Promise<Group> {

        const val = Texture.DEFAULT_IMAGE

        // this will be used when doing new Texture(). Which is done for not found images or when some error happens in loading. See FBXLoader.
        // todo save the path of invalid textures, check if they can be found in the loaded libs, and ask the user in UI to remap it to something else manually
        if (!Texture.DEFAULT_IMAGE) Texture.DEFAULT_IMAGE = AssetImporter.WHITE_IMAGE_DATA

        const res = await super.loadAsync(url, onProgress)

        Texture.DEFAULT_IMAGE = val

        return res
    }
}
