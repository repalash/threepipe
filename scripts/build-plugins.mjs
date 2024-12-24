import {execEachPlugin} from './utils.mjs';

// Each plugin should have "prepare" that will also build the plugin
execEachPlugin('npm ci') // install dependencies
execEachPlugin('npm run docs')
