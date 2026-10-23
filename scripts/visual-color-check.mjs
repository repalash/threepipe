import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';import {createServer} from 'vite';
const server=await createServer({configFile:'vite.slop-newyork.config.js',server:{port:4201,host:'127.0.0.1',hmr:false}});await server.listen();
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || undefined,headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{const page=await browser.newPage({viewport:{width:256,height:128}});page.on('pageerror',e=>console.log('ERROR',String(e)));await page.route('**/color-check.html',r=>r.fulfill({contentType:'text/html',body:'<style>body{margin:0}</style><canvas id="c"></canvas>'}));await page.goto('http://127.0.0.1:4201/color-check.html');
const result=await page.evaluate(async()=>{
const T=await import('/src/index.ts');const {CityBasicMaterial,TSL}=await import('/examples/slop-newyork/tsl-glsl.js');const r=new T.WebGLRenderer({canvas:document.querySelector('canvas'),preserveDrawingBuffer:true});r.setSize(256,128);r.outputColorSpace=T.SRGBColorSpace;
const scene=new T.Scene();const c=new T.OrthographicCamera(-2,2,1,-1,.1,10);c.position.z=2;const g=new T.PlaneGeometry(1.5,1.5);
const ref=new T.MeshBasicMaterial({color:0x00ff00});const converted=new CityBasicMaterial({color:0xff0000});converted.colorNode=TSL.color(0x00ff00);
const a=new T.Mesh(g,ref);a.position.x=-1;const b=new T.Mesh(g,converted);b.position.x=1;scene.add(a,b);r.render(scene,c);const gl=r.getContext();const pixels=new Uint8Array(8);gl.readPixels(64,64,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixels.subarray(0,4));gl.readPixels(192,64,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixels.subarray(4));return {reference:Array.from(pixels.slice(0,4)),translated:Array.from(pixels.slice(4))};
});assert.deepEqual(result.translated,result.reference);assert.deepEqual(result.reference,[0,255,0,255]);console.log(result);if (process.env.SLOP_SCREENSHOT) await page.screenshot({path:process.env.SLOP_SCREENSHOT});
}finally{await browser.close();await server.close()}
