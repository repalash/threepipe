import {ImportResult} from './IAssetImporter'

export type IAssetID = string

export type IFile = Blob & Partial<File> & {
    objectUrl?: string, // URL created from URL.createObjectURL, used to revoke the objectUrl with URL.revokeObjectURL
    ext?: string // extension of the file without the dot
    mime?: string // mime type of the file
    filePath?: string // from Dropzone, the path of the file in the zip or folder

    // eslint-disable-next-line @typescript-eslint/naming-convention
    __loadedAsset?: ImportResult | ImportResult[] // used by asset manager to store the loaded asset
}
export interface IAsset {
    id?: IAssetID;
    path: string;
    file?: IFile,
    // variants?: IAssetID[],
    preImportedRaw?: Promise<ImportResult | ImportResult[] | undefined> // todo type
    preImported?: ImportResult[] // todo type

    [id: string]: any
}

export interface IAssetList {
    basePath?: string;
    assets: IAsset[];
}
