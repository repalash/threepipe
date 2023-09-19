// (echo export const VERSION = '$npm_package_version') > src/viewer/version.ts

// in nodejs

import {writeFileSync} from "node:fs"

writeFileSync("src/viewer/version.ts", `export const VERSION = '${process.env.npm_package_version}'\n`)
