/* global monaco, pako, untar */

const monacoPrefix = 'file:///node_modules/'
const maxLevel = 2
const fileLoadState = {
    packages: new Map(), // name to version
    files: new Map(),
}

export function registerFile (path, text, prefix = monacoPrefix) {
    path = prefix + path
    if(fileLoadState.files.has(path)) {
        console.warn('Replacing existing file', path, 'with new content');
    }
    fileLoadState.files.set(path, text)
    monaco.languages.typescript.typescriptDefaults.addExtraLib(text, path);
}

export function urlToUri (absUrl) {
    return 'file:///' + absUrl
        .replace(/\\/g, '/')
        .replace(/https?:\/\//, '')
        .replace(/:/g, '/')
        .replace(/\?raw/g, '')
}

export async function loadFileFromPath (path) {
    if(fileLoadState.packages.has(path)) {
        // const version = fileLoadState.packages.get(path).version || '0.0.0';
        // console.warn('File already loaded');
        return;
    }
    fileLoadState.packages.set(path, {version: '<unknown>'});

    const file = await fetch(path).then(r => r.text()).catch(e => {
        console.error('Error loading file from path', path, e);
        return null;
    })
    monaco.languages.typescript.typescriptDefaults.addExtraLib(file, urlToUri(path));
}

const ignoredPackages = new Set([
    'three',
    // 'react',
    // 'react-dom',
    'react-reconciler',
    '@mediapipe/tasks-vision',
    'cross-spawn',
    'bidi-js',
    '@babel/runtime',
    '@monogrid/gainmap-js',
    'troika-three-text',
    '@types/webxr',
    'style-value-types',
    'tslib',
    'hey-listen',
    'framesync',
    '@types/wicg-file-system-access',
])

export function loadTypesFromTarGz (packageName, version1 = 'latest', level = 0) {
    if(packageName.startsWith('react/')) packageName = 'react'
    if(packageName.startsWith('react-dom')) packageName = 'react-dom'
    if(ignoredPackages.has(packageName)) return // too big, @types/three is already there...
    if(packageName === 'react') packageName = '@types/react'
    if(packageName === 'react-dom') packageName = '@types/react-dom'
    if(packageName === 'three') packageName = '@types/three'
    if(packageName === '@types/three' && !version1.startsWith('https')) return // dont load @types/three from npm, use the fork

    // console.log('Loading package', packageName, 'version', version1, 'at level', level);
    if(fileLoadState.packages.has(packageName)) {
        const version = fileLoadState.packages.get(packageName).version || '0.0.0';
        if(version1 !== 'latest' && version1 !== version) {
            console.warn('Package already loaded with another version', packageName, 'current:', version, 'requested:', version1);
        }
        return;
    }
    if(level > maxLevel) {
        console.warn('Max level reached, skipping', packageName, 'at level', level);
        return;
    }
    fileLoadState.packages.set(packageName, {version: '<loading>'});
    // package.json - https://registry.npmjs.org/threepipe/latest
    // tgz - https://registry.npmjs.org/threepipe/-/threepipe-0.0.52.tgz
    // tgz - https://registry.npmjs.org/@threepipe/plugin-tweakpane/-/plugin-tweakpane-0.6.2.tgz

    // json - https://registry.npmjs.org/@threepipe/plugin-tweakpane/latest
    (async ()=>{
        let tarball
        if(version1 === 'latest') {
            let url = 'https://registry.npmjs.org/' + packageName + '/latest'
            const jsonText = await fetch(url).catch(e => null)
            if (!jsonText?.ok) {
                console.error('Unable to load package', packageName)
                return
            }
            const packageJson = await jsonText.json()
            const version = packageJson.version;
            tarball = 'https://registry.npmjs.org/' + packageName + '/-/' + packageName.split('/').pop() + '-' + version + '.tgz';
        }else {
            // todo
            if(version1.startsWith('http'))
                tarball = 'https://cors-proxy.r2cache.com/' + version1;
            else
                tarball = 'https://registry.npmjs.org/' + packageName + '/-/' + packageName.split('/').pop() + '-' + version1 + '.tgz';
        }

        let files
        try {
            const cache = await caches.open('node-modules-tarball');
            const cacheKey = tarball.replace('https://', 'cc-')
            const cached = await cache.match(cacheKey);
            if(cached) files = await cached.arrayBuffer().then(buf => untar(buf));
            else {
                // console.log('cache miss')
                const buffer = await fetch(tarball).then(r => r.arrayBuffer())
                const decompressed = pako.inflate(buffer);
                await cache.put(cacheKey, new Response(decompressed.buffer));
                files = await untar(decompressed.buffer);
            }
        }catch (e) {
            console.error(e)
            console.error('Unable to load tarball for', packageName, version1);
            return
        }
        // const tarEntry = Object.values(ungzipped)[0]; // Usually only one .tar inside .tgz
        // const files = fflate.untarSync(tarEntry);

        // https://stackoverflow.com/questions/43058191/how-to-use-addextralib-in-monaco-with-an-external-type-definition
        // https://github.com/Microsoft/monaco-editor/issues/1415
        // packageName = '@types/' + packageName;
        let packageJsonS = ''
        const contents = []
        let hasTypes = false
        for (const file of files) {
            try {
                // name "package/dist/assetmanager/import/ZipLoader.d.ts"
                const pp = packageName.split('/').pop() + '/'
                // Adjust to remove leading "package/" if needed
                const name = file.name.startsWith('package/') ? file.name.slice(8) :
                    file.name.startsWith(pp) ? file.name.slice(pp.length) : file.name;
                if (name === 'package.json') {
                    packageJsonS = new TextDecoder().decode(file.buffer);
                }

                else if (true
                    || name.startsWith('dist/')
                    || name.startsWith('index.')
                    || name.endsWith('.ts')
                    // || name.endsWith('.map')
                    // || name.endsWith('.json')
                    // || name.endsWith('.js')
                ) {
                    const content = new TextDecoder().decode(file.buffer);
                    const virtualPath = name;
                    // fileLoadState.files.set(virtualPath, content)
                    contents.push([virtualPath, content]);
                }

                if(name === 'index.d.ts') hasTypes = name
            }catch(e) {
                console.error('Error while adding file', file.name.replace(/^package\//, packageName), e);
            }
        }
        // console.log(contents)

        if(packageJsonS) {
            const packageJson = JSON.parse(packageJsonS);
            fileLoadState.packages.set(packageName, packageJson);
            registerFile(packageName + '/package.json', packageJsonS);
            const typesFile = packageJson.types || packageJson.typings;
            if (typesFile && !hasTypes) {
                const types = `export * from './${typesFile}';`// + `\nexport { default } from './${typesFile}';`;
                // const types = `export * from './dist/index';`// + `\nexport { default } from './${typesFile}';`;
                // fileContents[typesPath] = types
                registerFile(packageName + '/index.d.ts', types);
            }else if(typesFile && hasTypes !== typesFile) {
                console.error('Package', packageName, 'has types file', typesFile, 'but also has index.d.ts file', hasTypes, 'skipping', packageName);
            }
            for (const [key, value] of Object.entries(packageJson.dependencies || {})) {
                let version = value
                if(value[0] === '^') version = value.slice(1);
                else if(value[0] === '~') version = value.slice(1);
                else if(value[0] === '>') version = value.slice(1);
                if(!version.includes('.')) version = 'latest'
                console.log('Loading dependency', key, 'version', version, 'for package', packageName);
                loadTypesFromTarGz(key, version, level + 1)
            }
            for (const content of contents) {
                registerFile(packageName + '/' + content[0], content[1]);
            }
        }else {
            console.error('No package.json found in tarball for', packageName, version1, 'skipping', tarball, contents);
        }
    })()
}
