import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
const root=path.resolve(import.meta.dirname,'..');
const dest=path.resolve(process.env.DRVN_PREVIEW_DIR || path.join(root,'..','DRVN Interface Preview'));
if(dest===root||root.startsWith(dest+path.sep))throw new Error('Preview output must not replace the DRVN source checkout.');
const write=(p,s)=>{fs.mkdirSync(path.dirname(path.join(dest,p)),{recursive:true});fs.writeFileSync(path.join(dest,p),s)};
// A generated build snapshot, refreshed from the live source on EVERY build.
// Never edit its components. All fixture adapters live in DRVN 2/preview/.
for(const name of ['src','public']) {
 fs.rmSync(path.join(dest,name),{recursive:true,force:true});
 fs.cpSync(path.join(root,name),path.join(dest,name),{recursive:true,filter:p=>!(/\.(test|stories)\.[^.]+$/.test(p))});
}
for(const name of ['package-lock.json','postcss.config.mjs','tsconfig.json','next-env.d.ts']) if(fs.existsSync(path.join(root,name))) fs.copyFileSync(path.join(root,name),path.join(dest,name));
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json')));pkg.scripts={build:'next build --webpack',dev:'next dev --webpack -p 4382'};write('package.json',JSON.stringify(pkg,null,2));
write('.gitignore','node_modules\n.next/\nout/\ndist/\n*.tar.gz\n');
if(!fs.existsSync(path.join(dest,'node_modules')))fs.symlinkSync(path.join(root,'node_modules'),path.join(dest,'node_modules'),'dir');
write('next.config.ts',`export default {output:'export',trailingSlash:true,images:{unoptimized:true},typescript:{ignoreBuildErrors:true},experimental:{cpus:2},webpack(config:any){config.resolve.alias['@/preview']=require('path').resolve('./src/preview');return config}};`);
const walk=p=>fs.readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(p,e.name)):[path.join(p,e.name)]);
// Exclude infrastructure and admin routes from a public interface demonstration.
for(const name of ['(admin)','api','(docs)'])fs.rmSync(path.join(dest,'src/app',name),{recursive:true,force:true});
for(const p of walk(path.join(dest,'src/app')))if(/(?:route|sitemap|robots|opengraph-image|twitter-image)\.(?:tsx?|png)$/.test(path.basename(p)))fs.rmSync(p);
fs.rmSync(path.join(dest,'src/proxy.ts'),{force:true});
// Server action exports become harmless demo functions, without importing backend dependencies.
for(const p of walk(path.join(dest,'src'))) {
 if(!/\.tsx?$/.test(p))continue;
 let source=fs.readFileSync(p,'utf8');
 if(/^\s*["']use server["'];/.test(source)) {
  const ast=ts.createSourceFile(p,source,ts.ScriptTarget.Latest,true);
  const names=[];
  for(const n of ast.statements)if(ts.isFunctionDeclaration(n)&&n.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword)&&n.name)names.push(n.name.text);
  source='"use client";\n'+names.map(name=>`export async function ${name}(..._args:any[]):Promise<any>{return {error:'Interface preview — changes are not saved.',ok:false,success:false};}`).join('\n');
 }
 // Only platform/data adapters change; canonical UI component files remain byte-identical.
 if(!p.includes('/components/'))source=source.replaceAll('"next/headers"','"@/preview/headers"');
 if(p.includes('/app/')) {
  source=source.replace(/await searchParams/g,'({} as any)');
  const pageAst=ts.createSourceFile(p,source,ts.ScriptTarget.Latest,true);
  for(const n of pageAst.statements)if(ts.isFunctionDeclaration(n)&&n.body&&n.modifiers?.some(m=>m.kind===ts.SyntaxKind.DefaultKeyword)&&n.parameters.some(q=>q.name.getText(pageAst).includes('searchParams'))){const pos=n.body.getStart(pageAst)+1;source=source.slice(0,pos)+'searchParams = Promise.resolve({});'+source.slice(pos);break;}
 }
 fs.writeFileSync(p,source);
}
// Dynamic pages are real DRVN pages, exported for the fixture identities.
const taxonomy=await import("data:text/javascript;base64,"+Buffer.from(ts.transpileModule(fs.readFileSync(path.join(root,"src/lib/marketplace/taxonomy.ts"),"utf8"),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText).toString("base64"));
const dynamic={
 '(discover)/cars/[slug]/page.tsx':[{slug:'golf-r'},{slug:'mr2'}],
 '(discover)/listings/[id]/page.tsx':[1,2,3,4].map(n=>({id:`demo-part-${n}`})),
 '(discover)/u/[username]/page.tsx':[{username:'alex'},{username:'jamie'}],
 '(discover)/marketplace/[category]/page.tsx':taxonomy.CATEGORIES.map(c=>({category:c.slug})),
 '(discover)/marketplace/[category]/[subcategory]/page.tsx':taxonomy.CATEGORIES.flatMap(c=>c.subcategories.map(s=>({category:c.slug,subcategory:s.slug}))),
 '(product)/garage/[id]/edit/page.tsx':[{id:'demo-car-1'},{id:'demo-car-2'}],
 '(product)/garage/[id]/update/new/page.tsx':[{id:'demo-car-1'},{id:'demo-car-2'}],
 '(product)/listings/[id]/edit/page.tsx':[{id:'demo-part-4'}],
};
for(const p of walk(path.join(dest,'src/app')))if(path.basename(p)==='page.tsx'&&p.includes('[')){
 const rel=path.relative(path.join(dest,'src/app'),p);
 if(!dynamic[rel]?.length){fs.rmSync(p);continue;}
 fs.appendFileSync(p,`\nexport function generateStaticParams(){return ${JSON.stringify(dynamic[rel])}}\n`);
}
for(const p of walk(path.join(root,'preview/adapters')))write('src/preview/'+path.basename(p).replace(/\.template$/, ''),fs.readFileSync(p,'utf8'));
for(const entry of JSON.parse(fs.readFileSync(path.join(root,'preview/overrides.json'))))write(entry.target,fs.readFileSync(path.join(root,'preview',entry.source),'utf8'));
// Preserve the real read-model types and helpers; replace only database entrypoints.
const loaders={
 'src/lib/feed.ts':{fetchFeed:'return {items: (await import("@/preview/data")).feed,hasMore:false,total:6,page:1};',fetchFollowedFeed:'return {items:[],hasMore:false,followsNothing:true,total:0,page:1};'},
 'src/lib/marketplace/query.ts':{fetchListings:'const {listingCards}=await import("@/preview/data");const results=listingCards.filter(l=>(!filters.category||l.category===filters.category)&&(!filters.subcategory||l.subcategory===filters.subcategory));return {results,total:results.length,page:1,pageSize:24,hasMore:false};'},
};
for(const [file,functions] of Object.entries(loaders)){
 let s=fs.readFileSync(path.join(dest,file),'utf8');const ast=ts.createSourceFile(file,s,ts.ScriptTarget.Latest,true);const edits=[];
 for(const n of ast.statements)if(ts.isFunctionDeclaration(n)&&n.name&&functions[n.name.text]&&n.body)edits.push([n.body.getStart(ast),n.body.end,'{'+functions[n.name.text]+'}']);
 for(const [a,b,t]of edits.sort((a,b)=>b[0]-a[0]))s=s.slice(0,a)+t+s.slice(b);write(file,s);
}
// Open the current signed-in Home surface at the shared root URL.
write('src/app/page.tsx',`import Page from './(product)/home/page';import Shell from './(product)/layout';export default function PreviewHome(){return <Shell><Page searchParams={Promise.resolve({})}/></Shell>}`);
let layout=fs.readFileSync(path.join(dest,'src/app/layout.tsx'),'utf8');layout=layout.replace('<MotionPolicy>{children}</MotionPolicy>','<div style={{position:"fixed",bottom:8,right:8,zIndex:9999,padding:"6px 10px",background:"#151515",color:"white",fontSize:12,borderRadius:4}}>DRVN 2 · Interface demo · Sample data</div><MotionPolicy>{children}</MotionPolicy>');write('src/app/layout.tsx',layout);
const hashes={};for(const p of [...walk(path.join(root,'src/components')),...walk(path.join(root,'src/features')).filter(p=>p.endsWith('.tsx'))].filter(p=>!(/\.(test|stories)\.[^.]+$/.test(p))))hashes[path.relative(root,p)]=createHash('sha256').update(fs.readFileSync(p)).digest('hex');
hashes['src/app/globals.css']=createHash('sha256').update(fs.readFileSync(path.join(root,'src/app/globals.css'))).digest('hex');
for(const [p,h]of Object.entries(hashes))if(createHash('sha256').update(fs.readFileSync(path.join(dest,p))).digest('hex')!==h)throw Error('Canonical UI changed in preview: '+p);
write('component-source.json',JSON.stringify({source:'DRVN 2',files:hashes},null,2));
write('README.md',fs.readFileSync(path.join(root,'preview/README.md'),'utf8'));
write('preview-build.mjs',fs.readFileSync(import.meta.filename,'utf8'));
fs.rmSync(path.join(dest,'build.py'),{force:true});
console.log(`Prepared current DRVN 2 preview; ${Object.keys(hashes).length} canonical UI files verified byte-for-byte.`);
if(!process.argv.includes('--prepare-only')){const r=spawnSync(process.execPath,[path.join(root,'node_modules/next/dist/bin/next'),'build','--webpack'],{cwd:dest,stdio:'inherit',env:{...process.env,NEXT_TELEMETRY_DISABLED:'1'}});process.exit(r.status??1)}
