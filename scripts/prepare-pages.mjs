import {cp,mkdir,writeFile,readdir,readFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const source = resolve('dist');
const destination = resolve('docs');
// This directory is reserved exclusively for generated Pages output.
if (destination !== join(process.cwd(),'docs')) throw new Error('Unexpected output directory');
await mkdir(destination,{recursive:true});
for (const entry of await readdir(destination)) {
  const path = join(destination,entry);
  if (!path.startsWith(destination + '/')) {
    if (!path.startsWith(destination + '\\')) throw new Error('Unsafe output path');
  }
  await rm(path,{recursive:true,force:true});
}
await cp(source,destination,{recursive:true});
await writeFile(join(destination,'.nojekyll'),'');
const html = await readFile(join(destination,'index.html'),'utf8');
if (!html.includes('/ikimiz/assets/')) throw new Error('Unexpected Pages base path');
console.log('GitHub Pages output prepared in docs/.');
