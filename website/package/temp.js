// nodejs script to parse ./readme.md and create a file for each section

import fs from 'node:fs';

const contents = fs.readFileSync('./_plugins.md', 'utf8');
const sections = contents.split('\n## ');
const fm = (p, n)=>`---
prev: ${p ? `
    text: '${p}'
    link: './${p.replace(/@threepipe\//, '')}'
` : 'false'}
next: ${n ? `
    text: '${n}'
    link: './${n.replace(/@threepipe\//, '')}'
` : 'false'}
---\n\n`
for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const title = section.split('\n')[0].replace(/@threepipe\//, '').trim();
    const content = section.replace('\n#', '\n');
    if(!title && !content) continue
    const prev = sections[i - 1]?.split('\n')[0]?.trim()
    const next = sections[i + 1]?.split('\n')[0]?.trim();
    fs.writeFileSync(`./${title.replace(/\s/g, '_')}.md`, fm(prev, next) + '# ' + content);
}
