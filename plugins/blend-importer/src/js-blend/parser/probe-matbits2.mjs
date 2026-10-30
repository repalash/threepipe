import {readFileSync} from 'node:fs'
import {decompress as z} from '/Users/palash/Projects/threepipe/plugins/blend-importer/node_modules/fzstd/esm/index.mjs'
const {parseBlend}=await import('/Users/palash/Projects/threepipe/plugins/blend-importer/src/js-blend/main.js')
function toArr(x){if(x==null)return[];return(Array.isArray(x)||x.length!==undefined)?Array.from(x):[x]}
const raw=readFileSync('/Users/palash/Projects/threepipe/tmp/blend-fixtures/blender-3.5-splash.blend')
let u=new Uint8Array(raw.buffer,raw.byteOffset,raw.byteLength); if(u[0]===0x28&&u[1]===0xb5)u=z(u)
const blend=await parseBlend(u.buffer.slice(u.byteOffset,u.byteOffset+u.byteLength))
for(const name of ['Circle.122','Circle.111']){
  const o=(blend.objects.Object||[]).find(o=>o.data&&o.data.aname===name)
  if(!o){console.log(name,'not found');continue}
  const om=toArr(o.mat), dm=toArr(o.data.mat), mb=toArr(o.matbits)
  console.log(`${name}: totcol=${o.totcol}`)
  console.log(`  o.mat  = [${om.map(m=>m?m.aname:'null').join(', ')}]`)
  console.log(`  d.mat  = [${dm.map(m=>m?m.aname:'null').join(', ')}]`)
  console.log(`  matbits= [${mb.join(', ')}]`)
}
