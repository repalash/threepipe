# FileTransferPlugin.exportFile: no error handling; process state stuck "exporting" on failure

**Severity:** medium
**Found:** 2026-06-13 code audit

## Bug
`exportFile` has no try/catch around the awaited transfer. If `actions.exportFile` rejects (e.g. an S3 upload fails in the AWS subclass this is built for), the `'done'` dispatch never runs and no `'error'` event is emitted. The asset-manager process state for the file is then left stuck in `'exporting'` forever (UI spinner/progress never clears).

## Root Cause
```ts
async exportFile(file: File|Blob, name = ...) {
    this.dispatchEvent({type: 'transferFile', path: name, state: 'exporting', progress: 0})
    await this.actions.exportFile(file, name, ({state, progress})=>{ ... })   // no try/catch
    this.dispatchEvent({type: 'transferFile', path: name, state: 'done'})     // skipped on rejection
}

protected _updateProcessState(data: {path: string, state: string, progress?: number}) {
    if (!this._viewer) return
    this._viewer.assetManager.setProcessState(data.path, data.state !== 'done' ? {
        state: data.state,
        progress: data.progress ? data.progress * 100 : undefined,
    } : undefined)   // process state cleared ONLY when state === 'done'
}
```
`_updateProcessState` clears the process entry only when `state === 'done'`. The event-map even declares an `'error'` state that is never dispatched. (Confirmed in `AssetManager.ts:517-521`: process state is removed only when the value is `undefined`, which only happens on `'done'`.)

## Impact
Any export failure leaves the process entry permanently `'exporting'` — the UI spinner/progress never clears for that file.

## Fix
Wrap the await in try/catch; on error dispatch `{type:'transferFile', state:'error', path:name}` and update `_updateProcessState` to clear the process state for both `'done'` and `'error'` (or clear it in a `finally`).

## Files
- `src/plugins/export/FileTransferPlugin.ts:27-33` — no try/catch; `'error'` never emitted
- `src/plugins/export/FileTransferPlugin.ts:56-62` — process state cleared only on `'done'`
