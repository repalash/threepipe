export type {IEvent, IEventDispatcher} from 'ts-browser-helpers'
export type {ImageCanvasOptions} from 'ts-browser-helpers'
export type {AnyFunction, AnyOptions, Class, IDisposable, IJSONSerializable, PartialPick, PartialRecord, StringKeyOf, Fof, ValOrFunc, ValOrArr, ValOrFuncOp, ValOrArrOp} from 'ts-browser-helpers'
export type {Serializer} from 'ts-browser-helpers'

export {PointerDragHelper} from 'ts-browser-helpers'
export {JSUndoManager} from 'ts-browser-helpers'
export type {JSUndoManagerCommand2, JSUndoManagerCommand, JSUndoManagerOptions, JSUndoManagerCommand1} from 'ts-browser-helpers'
export {Damper} from 'ts-browser-helpers'
export {SimpleEventDispatcher} from 'ts-browser-helpers'

export {createCanvasElement, createDiv, createImage, createStyles, createScriptFromURL, cloneScriptTag, setInnerHTMLWithScripts} from 'ts-browser-helpers'
export {TYPED_ARRAYS, arrayBufferToBase64, base64ToArrayBuffer, getTypedArray} from 'ts-browser-helpers'
export {escapeRegExp, getFilenameFromPath, parseFileExtension, replaceAll, toTitleCase, longestCommonPrefix, toCamelCase, safeReplaceString} from 'ts-browser-helpers'
export {prettyScrollbar} from 'ts-browser-helpers'
export {blobToDataURL, downloadBlob, downloadFile, uploadFile, mobileAndTabletCheck} from 'ts-browser-helpers'
export {LinearToSRGB, SRGBToLinear, colorToDataUrl} from 'ts-browser-helpers'
export {onChange, onChange2, onChange3, onChangeDispatchEvent, serialize, serializable, type OnChangeDispatchEventType} from 'ts-browser-helpers'
export {aesGcmDecrypt, aesGcmEncrypt} from 'ts-browser-helpers'
export {verifyPermission, writeFile, getFileHandle, getNewFileHandle, readFile} from 'ts-browser-helpers'
export {embedUrlRefs, htmlToCanvas, htmlToPng, htmlToSvg} from 'ts-browser-helpers'
export {imageToCanvas, imageBitmapToBase64, imageUrlToImageData, imageDataToCanvas, canvasFlipY, isWebpExportSupported, imageBitmapToBlob, imageBitmapToCanvas, blobToImage} from 'ts-browser-helpers'
export {absMax, clearBit, updateBit, uuidV4} from 'ts-browser-helpers'
export {includesAll, wrapThisFunction, wrapThisFunction2, findLastIndex} from 'ts-browser-helpers'
export {copyProps, getOrCall, getPropertyDescriptor, isPropertyWritable, safeSetProperty} from 'ts-browser-helpers'
export {deepAccessObject, getKeyByValue, objectHasOwn, objectMap2, objectMap} from 'ts-browser-helpers'
export {makeColorSvg, makeTextSvg, makeColorSvgCircle, svgToCanvas, svgToPng} from 'ts-browser-helpers'
export {timeout, now} from 'ts-browser-helpers'
export {pathJoin, getUrlQueryParam, setUrlQueryParam, remoteWorkerURL} from 'ts-browser-helpers'
export {css, glsl, html, svgUrl} from 'ts-browser-helpers'
export {Serialization} from 'ts-browser-helpers'
export {FnCaller} from 'ts-browser-helpers'
export {windowDialogWrapper, type IDialogWrapper} from 'ts-browser-helpers'
export {htmlDialogWrapper} from 'ts-browser-helpers'
export {equalsPrimitive, copyPrimitive, clonePrimitive, type PrimitiveValObject, type PrimitiveVal} from 'ts-browser-helpers'
export {recordUndoCommand, setValueUndoCommand} from 'ts-browser-helpers'
export type {SetValueUndoCommandProps, SetValueUndoCommand, ActionUndoCommand} from 'ts-browser-helpers'

export function getPropDesc(obj: any, prop: keyof typeof obj) {
    let proto = obj
    let protoDesc = undefined
    while (!protoDesc && proto) {
        proto = Object.getPrototypeOf(proto)
        proto && (protoDesc = Object.getOwnPropertyDescriptor(proto, prop))
    }
    return {proto, protoDesc}
}
