import {IExportParser} from '../IExporter'

export class SimpleJSONExporter implements IExportParser {
    async parseAsync(obj: any, {jsonSpaces = 2}): Promise<Blob> {
        return new Blob([JSON.stringify(obj, null, jsonSpaces)], {type: 'application/json'})
    }
}

