set -euo pipefail

npm run docs-all
rm -rf _site
mkdir _site
cp -r src docs dist examples README.md LICENSE NOTICE _site
cp -r website/.vitepress/dist/* _site
mkdir -p _site/plugins
find plugins -maxdepth 2 -type d \( -name dist -o -name docs -o -name src \) -exec sh -c "mkdir -p _site/{} && cp -r {} _site/{}/.." \;
