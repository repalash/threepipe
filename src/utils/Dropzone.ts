/**
 * Fork of: https://github.com/donmccurdy/simple-dropzone updated: Mar 2021
 * The MIT License (MIT)
 * Copyright (c) 2018 Don McCurdy
 *
 * Changes:
 *      Convert to typescript.
 *      webkitRelativePath for file input select.
 *      Removed unzip and dependency(done in importer).
 *
 * Watches an element for file drops, parses to create a filemap hierarchy,
 * and emits the result.
 */
export class Dropzone {
    get inputEl(): HTMLInputElement|undefined {
        return this._inputEl
    }
    get el(): HTMLElement|undefined {
        return this._el
    }
    private _el?: HTMLElement
    private _inputEl?: HTMLInputElement
    private _listeners: Record<DropEventType, ListenerCallback[]>

    constructor(el?: HTMLElement, inputEl?: HTMLInputElement, listeners?: Partial<Record<DropEventType, ListenerCallback>>) {
        this._el = el
        this._inputEl = inputEl

        this._listeners = {
            drop: [],
            dropstart: [],
            droperror: [],
        }

        this._onDragover = this._onDragover.bind(this)
        this._onDrop = this._onDrop.bind(this)
        this._onSelect = this._onSelect.bind(this)

        el?.addEventListener('dragover', this._onDragover, false)
        el?.addEventListener('drop', this._onDrop, false)
        inputEl?.addEventListener('change', this._onSelect)

        listeners && Object.entries(listeners).forEach(([e, c])=> c && this.on(e as DropEventType, c))
    }

    on(type: DropEventType, callback: ListenerCallback): Dropzone {
        this._listeners[type].push(callback)
        return this
    }

    private _emit(type: DropEventType, data?: {[id:string]: any}) {
        this._listeners[type]
            .forEach((callback) => callback(data))
        return this
    }

    /**
     * Destroys the instance.
     */
    destroy(): void {
        const el = this._el
        const inputEl = this._inputEl

        el?.removeEventListener('dragover', this._onDragover)
        el?.removeEventListener('drop', this._onDrop)
        inputEl?.removeEventListener('change', this._onSelect)

    }

    /**
     * Use dataTransfer.items when available instead of dataTransfer.files (when files are dropped)
     *
     * Set to false to use dataTransfer.files only.
     * This is useful for environments where files cannot be read from FileSystemEntry like in figma plugins/widgets.
     */
    static USE_DATA_TRANSFER_ITEMS = true

    /**
     * References (and horror):
     * - https://developer.mozilla.org/en-US/docs/Web/API/DataTransfer/items
     * - https://developer.mozilla.org/en-US/docs/Web/API/DataTransfer/files
     * - https://code.flickr.net/2012/12/10/drag-n-drop/
     * - https://stackoverflow.com/q/44842247/1314762
     *
     */
    private _onDrop(e: DragEvent) {
        e.stopPropagation()
        e.preventDefault()

        this._emit('dropstart')

        const files = Array.from(e.dataTransfer?.files || []) as DropFile[]
        const items = Array.from(e.dataTransfer?.items || [])

        if (files.length === 0 && items.length === 0) {
            this._fail('Required drag-and-drop APIs are not supported in this browser.')
            return
        }

        // Prefer .items, which allow folder traversal if necessary.
        if (Dropzone.USE_DATA_TRANSFER_ITEMS && items.length > 0) {
            const entries = items.map((item) => item.webkitGetAsEntry())

            // if (entries[0].name.match(/\.zip$/)) {
            //     this._loadZip(items[0].getAsFile())
            // } else {
            this._loadNextEntry(new Map(), entries, e)
            // }

            return
        }

        // Fall back to .files, since folders can't be traversed.
        // if (files.length === 1 && files[0].name.match(/\.zip$/)) {
        //     this._loadZip(files[0])
        // }
        this._emit('drop', {
            nativeEvent: e,
            files: new Map(files.map((file) => {
                file.filePath = file.name
                return [file.filePath, file]
            })),
        })
    }

    /**
     * @param  {Event} e
     */
    private _onDragover(e: DragEvent) {
        e.stopPropagation()
        e.preventDefault()
        e.dataTransfer && (e.dataTransfer.dropEffect = 'copy') // Explicitly show this is a copy.
    }

    private _onSelect(e: Event) {
        if (!this._inputEl) {
            console.warn('Invalid Dropzone event ', e)
            return
        }
        this._emit('dropstart')

        // HTML file inputs do not seem to support folders, so assume this is a flat file list.
        const files: DropFile[] = [].slice.call(this._inputEl.files ?? new FileList())

        // Automatically decompress a zip archive if it is the only file given.
        // if (files.length === 1 && this._isZip(files[0])) {
        //     this._loadZip(files[0])
        //     return
        // }

        const fileMap = new Map()
        files.forEach((file) => {
            file.filePath = (file as any).webkitRelativePath || file.name
            fileMap.set(file.filePath, file)
        })
        this._emit('drop', {files: fileMap, nativeEvent: e})
    }

    /**
     * Iterates through a list of FileSystemEntry objects, creates the fileMap
     * tree, and emits the result.
     * @param fileMap
     * @param  {Array<FileSystemEntry>} entries
     * @param e
     */
    private _loadNextEntry(fileMap: Map<string, DropFile>, entries: (FileSystemEntry|null)[], e: DragEvent) {
        const entry = entries.pop()

        if (!entry) {
            this._emit('drop', {files: fileMap, nativeEvent: e})
            return
        }

        if (entry.isFile) {
            (entry as FileSystemFileEntry).file((file: DropFile) => {
                file.filePath = entry.fullPath
                fileMap.set(entry.fullPath, file)
                this._loadNextEntry(fileMap, entries, e)
            }, (err) => console.error('Could not load file: %s', entry.fullPath, err, 'Try setting Dropzone.USE_DATA_TRANSFER_ITEMS to false.'))
        } else if (entry.isDirectory) {
            // readEntries() must be called repeatedly until it stops returning results.
            // https://www.w3.org/TR/2012/WD-file-system-api-20120417/#the-directoryreader-interface
            // https://bugs.chromium.org/p/chromium/issues/detail?id=378883
            const reader = (entry as FileSystemDirectoryEntry).createReader()
            const readerCallback = (newEntries: any[]) => {
                if (newEntries.length) {
                    entries = entries.concat(newEntries)
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
                    reader.readEntries(readerCallback)
                } else {
                    this._loadNextEntry(fileMap, entries, e)
                }
            }
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call
            reader.readEntries(readerCallback)
        } else {
            console.warn('Unknown asset type: ' + entry.fullPath)
            this._loadNextEntry(fileMap, entries, e)
        }
    }

    // /**
    //  * Inflates a File in .ZIP format, creates the fileMap tree, and emits the
    //  * result.
    //  * @param  {File} file
    //  */
    // _loadZip(file) {
    //     const pending = []
    //     const fileMap = new Map()
    //     const archive = new fs.FS()
    //
    //     const traverse = (node) => {
    //         if (node.directory) {
    //             node.children.forEach(traverse)
    //         } else if (node.name[0] !== '.') {
    //             pending.push(new Promise((resolve) => {
    //                 node.getData(new zip.BlobWriter(), (blob) => {
    //                     blob.name = node.name
    //                     fileMap.set(node.getFullname(), blob)
    //                     resolve()
    //                 })
    //             }))
    //         }
    //     }
    //
    //     archive.importBlob(file, () => {
    //         traverse(archive.root)
    //         Promise.all(pending).then(() => {
    //             this._emit('drop', {files: fileMap, archive: file})
    //         })
    //     })
    // }

    // /**
    //  * @param  {File} file
    //  * @return {Boolean}
    //  */
    // _isZip(file) {
    //     return file.type === 'application/zip' || file.name.match(/\.zip$/)
    // }

    /**
     * @throws
     */
    private _fail(message: string) {
        this._emit('droperror', {message: message})
    }
}

export type DropEventType = 'drop'|'dropstart'|'droperror'
export type ListenerCallback = ((data?:{files?:Map<string, DropFile>, message?:string})=>void)
export interface DropFile extends File{
    filePath: string
}
