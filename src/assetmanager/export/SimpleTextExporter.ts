import {IExportParser} from '../IExporter'
import {AnyOptions} from 'ts-browser-helpers'

export class SimpleTextExporter implements IExportParser {
    async parseAsync(obj: any, _: AnyOptions): Promise<Blob> {
        return new Blob([obj], {type: 'text/plain'})
    }
}
