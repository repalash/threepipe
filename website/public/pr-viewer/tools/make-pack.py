#!/usr/bin/env python3
"""Offline packs: one .zip per repository from a snapshot recorded with record-snapshot.cjs --repos.

    python3 tools/make-pack.py snap/<name> <out dir>

Each pack holds <owner>-<repo>/index.json (that repository's recorded responses), repos.json and the response
files. Import it in the viewer (start page or Offline dialog: Import offline pack, or drop it on the page).
A pack of a private repository holds its code: share it like the code."""
import json, os, sys, urllib.parse, zipfile

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
index = json.load(open(os.path.join(src, 'index.json')))
repos = json.load(open(os.path.join(src, 'repos.json')))
for r in repos:
    owner, repo = r['owner'], r['repo']
    path = f'/repos/{owner}/{repo}/'
    q = f'repo:{owner}/{repo}'
    sub = {k: v for k, v in index.items() if k.startswith(path) or q in urllib.parse.unquote(k)}
    name = f'{owner}-{repo}'
    zpath = os.path.join(out, f'{name}.zip')
    with zipfile.ZipFile(zpath, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        z.writestr(f'{name}/index.json', json.dumps(sub))
        z.writestr(f'{name}/repos.json', json.dumps([r]))
        for f in sorted({v['file'] for v in sub.values()}):
            z.write(os.path.join(src, f), f'{name}/{f}')
    print(f'{zpath}: {len(r["prs"])} PRs, {len(sub)} responses, {os.path.getsize(zpath) / 1e6:.1f} MB')
