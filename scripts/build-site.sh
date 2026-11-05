set -euo pipefail

# Builds what it copies: since npm workspaces (#93) nothing is built during npm install, and docs-all builds only the
# packages other packages' docs need (not the core), so a fresh checkout (Cloudflare Pages runs only this script) has no
# dist. Core and plugins come from the turbo cache when already built (GitHub Pages restores it).
npm run build:all
npm run docs-all
rm -rf _site
mkdir _site
cp -r src docs dist examples README.md LICENSE NOTICE _site
cp -r website/.vitepress/dist/* _site
mkdir -p _site/plugins
find plugins -maxdepth 2 -type d \( -name dist -o -name docs -o -name src \) -exec sh -c "mkdir -p _site/{} && cp -r {} _site/{}/.." \;

# Branch previews on Cloudflare Pages (any branch but master, e.g. dev.threepipe.org) are copies of
# threepipe.org: keep them out of search results. Crawling stays allowed, so that crawlers see the
# noindex header. The branch comes from Cloudflare Pages (CF_PAGES_BRANCH) or Workers Builds
# (WORKERS_CI_BRANCH); local and GitHub Actions builds set neither.
branch="${CF_PAGES_BRANCH:-${WORKERS_CI_BRANCH:-}}"
if [ -n "$branch" ] && [ "$branch" != "master" ]; then
  printf 'User-agent: *\nAllow: /\n' > _site/robots.txt
  printf '/*\n  X-Robots-Tag: noindex\n' > _site/_headers
fi
