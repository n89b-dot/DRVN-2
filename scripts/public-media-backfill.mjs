// Explicit environment only. Inventory is read-only; apply processes one bounded batch.
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import sharp from "sharp";
const [mode, manifestPath] = process.argv.slice(2);
if (!["inventory", "apply"].includes(mode) || !manifestPath) throw new Error("Usage: node scripts/public-media-backfill.mjs inventory|apply manifest.json");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key || process.env.DRVN_MEDIA_PROJECT_URL !== url) throw new Error("Explicit matching DRVN_MEDIA_PROJECT_URL and service credentials required");
const admin = createClient(url,key,{auth:{persistSession:false}});
const save = (manifest) => { writeFileSync(`${manifestPath}.tmp`,JSON.stringify(manifest,null,2),{mode:0o600}); renameSync(`${manifestPath}.tmp`,manifestPath); };
if (mode === "inventory") {
 const manifest={project:url,created_at:new Date().toISOString(),objects:[]};
 async function walk(bucket,prefix="") {
  for(let offset=0;;offset+=100) {
   const listed=await admin.storage.from(bucket).list(prefix,{limit:100,offset,sortBy:{column:"name",order:"asc"}});
   if(listed.error) throw listed.error;
   for(const entry of listed.data) {
    const path=[prefix,entry.name].filter(Boolean).join("/");
    if(!entry.id) { await walk(bucket,path); continue; }
    if(path.includes("/normalized-backfill/")) continue;
    manifest.objects.push({bucket,path,status:"pending"});
   }
   if(listed.data.length<100) break;
  }
 }
 for(const bucket of ["avatars","car-images","activity-images","listing-images"]) await walk(bucket);
 save(manifest); console.log(`Inventoried ${manifest.objects.length} objects; no storage writes performed.`);
} else {
 const manifest=JSON.parse(readFileSync(manifestPath,"utf8"));
 if(manifest.project!==url) throw new Error("Manifest belongs to another project");
 let processed=0;
 for(const entry of manifest.objects.filter(x=>["pending","failed"].includes(x.status)).slice(0,25)) {
  try {
   const downloaded=await admin.storage.from(entry.bucket).download(entry.path);
   if(downloaded.error) throw downloaded.error;
   if(downloaded.data.size>11*1024*1024) throw new Error("Oversized original requires review");
   const original=Buffer.from(await downloaded.data.arrayBuffer());
   const image=await sharp(original,{limitInputPixels:40_000_000}).rotate().resize({width:2560,height:2560,fit:"inside",withoutEnlargement:true}).webp({quality:85}).toBuffer();
   const metadata=await sharp(image).metadata();
   if(metadata.exif || metadata.icc || metadata.xmp) throw new Error("Metadata survived normalization");
   const digest=createHash("sha256").update(original).digest("hex");
   const newPath=`${entry.path.split("/")[0]}/normalized-backfill/${digest}.webp`;
   const upload=await admin.storage.from(entry.bucket).upload(newPath,image,{contentType:"image/webp",upsert:true});
   if(upload.error) throw upload.error;
   const oldUrl=admin.storage.from(entry.bucket).getPublicUrl(entry.path).data.publicUrl;
   const newUrl=admin.storage.from(entry.bucket).getPublicUrl(newPath).data.publicUrl;
   const remap=await admin.rpc("remap_public_media",{p_old:oldUrl,p_new:newUrl});
   if(remap.error) throw remap.error;
   entry.status=remap.data.outcome; entry.derivative=newPath;
   // Originals are retained pending a reviewed manifest/CDN cleanup pass.
   // This command never mistakes remapping for erasing historical exposure.
   entry.original_cleanup="requires_reference_and_retention_review";
   delete entry.error; processed++;
  } catch(error) { entry.status="failed";entry.error=String(error.message||error).slice(0,300); }
  save(manifest);
 }
 console.log(`Processed ${processed} objects; review retained originals and failures before any cleanup.`);
 if(manifest.objects.some(entry=>entry.status==="failed")) process.exitCode=1;
}
