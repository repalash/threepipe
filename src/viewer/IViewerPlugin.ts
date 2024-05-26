import {IUiConfigContainer, UiConfigContainer} from 'uiconfig.js'
import {Class, IDisposable, IJSONSerializable} from 'ts-browser-helpers'
import {SerializationMetaType} from '../utils'
import {ISerializedConfig, ThreeViewer} from './ThreeViewer'

/**
 * Interface for Viewer Plugins
 * @category Viewer
 */
export interface IViewerPlugin<TViewer extends ThreeViewer = ThreeViewer, IsSync extends boolean = boolean>
    extends IUiConfigContainer, Partial<IJSONSerializable<ISerializedConfig, SerializationMetaType>>, IDisposable, Partial<UiConfigContainer> {
    // all classes must have this static property with a unique identifier value for this plugin
    constructor: {
        PluginType: string
        OldPluginType?: string // rename to type alias maybe
    }

    // these plugins will be added automatically(with default settings), if they are not added yet.
    dependencies?: Class<IViewerPlugin<TViewer, IsSync>>[]

    // Called when this plug-in is added to the viewer
    onAdded(viewer: TViewer): IsSync extends false ? Promise<void> : void;

    // Called when this plug-in is removed from the viewer
    onRemove(viewer: TViewer): IsSync extends false ? Promise<void> : void;

    // the viewer will render the next frame if this is set to true
    dirty?: boolean;

    serializeWithViewer?: boolean | undefined // default = true (if toJSON is implemented)

    // store and load state to/from local storage
    storeState?: (prefix?: string, storage?: Storage, data?: any) => void;
    loadState?: (prefix?: string, storage?: Storage) => Promise<void>;

}

export interface IViewerPluginSync<TViewer extends ThreeViewer = ThreeViewer> extends IViewerPlugin<TViewer, true> {
    onAdded(viewer: TViewer): void;
    onRemove(viewer: TViewer): void;
    dependencies?: Class<IViewerPluginSync>[]
}

export interface IViewerPluginAsync<TViewer extends ThreeViewer = ThreeViewer> extends IViewerPlugin<TViewer, false> {
    onAdded(viewer: TViewer): Promise<void>;
    onRemove(viewer: TViewer): Promise<void>;
    dependencies?: Class<IViewerPlugin>[]
}
