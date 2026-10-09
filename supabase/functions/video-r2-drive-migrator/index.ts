
import "jsr:@supabase/functions-js@2.4.5/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.93.1";

const TENANT_ID="00000000-0000-0000-0000-000000000001";
const AUTH_HASH="e330cb8e006ec406ddd7d1eb357d82a7986bcdf22b0f34338e7c528f8adc332e";
// Legacy export is retired. Opt in only for an explicitly configured migration
// endpoint; never embed a retired Supabase project URL in the active codebase.
const LEGACY_EXPORT_URL=Deno.env.get("LEGACY_R2_VIDEO_EXPORT_URL")??"";
const MIGRATION_FOLDER_NAME="Legacy R2 Video Migration";
const CHUNK_BYTES=64*1024*1024;
const MAX_CHUNKS_PER_TICK=4;

function db(){
  const url=Deno.env.get("SUPABASE_URL")??"";
  const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
  if(!url||!key) throw new Error("Supabase service runtime is not configured.");
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
function json(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});}
async function sha256Hex(v:string){const d=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v)));return [...d].map(b=>b.toString(16).padStart(2,"0")).join("");}
async function authorized(req:Request){const t=req.headers.get("x-video-migration-token")??"";return t.length>20&&await sha256Hex(t)===AUTH_HASH;}
function safeName(v:string){const b=v.split("/").pop()||"video";return b.replace(/[<>:"/\\|?*\x00-\x1f]/g,"_").trim().slice(0,180)||"video";}
function escQ(v:string){return v.replace(/\\/g,"\\\\").replace(/'/g,"\\'");}

async function migrationToken(admin:any){
  const {data,error}=await admin.rpc("get_legacy_r2_migration_token");
  if(error||!data) throw new Error(error?.message??"Migration token unavailable.");
  return String(data);
}
async function legacyCall(admin:any,action:string,payload:Record<string,unknown>={}){
  const token=await migrationToken(admin);
  const r=await fetch(LEGACY_EXPORT_URL,{method:"POST",headers:{"content-type":"application/json","x-video-migration-token":token},body:JSON.stringify({action,...payload})});
  const body=await r.json().catch(()=>({}));
  if(!r.ok||body?.ok===false) throw new Error("Legacy R2 "+action+" failed: "+r.status+" "+String(body?.error??"unknown"));
  return body;
}
async function googleToken(admin:any){
  const {data,error}=await admin.rpc("get_relationship_google_connection_runtime",{p_tenant_id:TENANT_ID,p_connection_type:"drive",p_connection_id:null});
  if(error) throw new Error(error.message);
  if(!data?.refreshToken) throw new Error("Google Drive connection is unavailable.");
  const clientId=Deno.env.get("GOOGLE_RELATIONSHIPS_CLIENT_ID")??"";
  const clientSecret=Deno.env.get("GOOGLE_RELATIONSHIPS_CLIENT_SECRET")??"";
  if(!clientId||!clientSecret) throw new Error("Google OAuth client is not configured.");
  const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,refresh_token:String(data.refreshToken),grant_type:"refresh_token"})});
  const b=await r.json().catch(()=>({}));
  if(!r.ok||!b?.access_token) throw new Error("Google token refresh failed ("+r.status+").");
  return String(b.access_token);
}
async function driveList(token:string,q:string,fields:string){
  const u=new URL("https://www.googleapis.com/drive/v3/files");
  u.searchParams.set("q",q);u.searchParams.set("pageSize","100");u.searchParams.set("fields",fields);u.searchParams.set("supportsAllDrives","true");u.searchParams.set("includeItemsFromAllDrives","true");
  const r=await fetch(u,{headers:{authorization:"Bearer "+token}});
  const b=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error("Drive list failed: "+r.status+" "+JSON.stringify(b).slice(0,300));
  return b.files??[];
}
async function ensureFolder(admin:any,token:string){
  const {data:s,error}=await admin.from("ai_operations_video_settings").select("drive_folder_id").eq("tenant_id",TENANT_ID).maybeSingle();
  if(error||!s?.drive_folder_id) throw new Error(error?.message??"Video Drive root folder is not configured.");
  const root=String(s.drive_folder_id);
  const q=`name = '${escQ(MIGRATION_FOLDER_NAME)}' and mimeType = 'application/vnd.google-apps.folder' and '${escQ(root)}' in parents and trashed = false`;
  const existing=await driveList(token,q,"files(id,name,webViewLink,parents)");
  if(existing.length) return String(existing[0].id);
  const r=await fetch("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,name,webViewLink",{method:"POST",headers:{authorization:"Bearer "+token,"content-type":"application/json"},body:JSON.stringify({name:MIGRATION_FOLDER_NAME,mimeType:"application/vnd.google-apps.folder",parents:[root]})});
  const b=await r.json().catch(()=>({}));
  if(!r.ok||!b?.id) throw new Error("Drive folder create failed: "+r.status+" "+JSON.stringify(b).slice(0,300));
  return String(b.id);
}
async function findExisting(token:string,name:string,size:number){
  const q=`name = '${escQ(name)}' and mimeType != 'application/vnd.google-apps.folder' and trashed = false`;
  const files=await driveList(token,q,"files(id,name,size,md5Checksum,webViewLink,mimeType,parents)");
  return files.find((f:any)=>Number(f.size??-1)===size)??null;
}
async function initUpload(token:string,folderId:string,name:string,size:number){
  const r=await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,size,webViewLink,md5Checksum,mimeType",{method:"POST",headers:{authorization:"Bearer "+token,"content-type":"application/json; charset=UTF-8","x-upload-content-type":"video/mp4","x-upload-content-length":String(size)},body:JSON.stringify({name,parents:[folderId]})});
  if(!r.ok) throw new Error("Drive resumable init failed: "+r.status+" "+(await r.text()).slice(0,300));
  const loc=r.headers.get("location"); if(!loc) throw new Error("Drive resumable init returned no session URL.");
  return loc;
}
async function driveMeta(token:string,fileId:string){
  const r=await fetch("https://www.googleapis.com/drive/v3/files/"+encodeURIComponent(fileId)+"?supportsAllDrives=true&fields=id,name,size,webViewLink,md5Checksum,mimeType,parents",{headers:{authorization:"Bearer "+token}});
  const b=await r.json().catch(()=>({}));if(!r.ok) throw new Error("Drive metadata failed: "+r.status+" "+JSON.stringify(b).slice(0,300));return b;
}
async function replaceCurrentRefs(admin:any,row:any,file:any){
  const key=String(row.source_key);let found=0,updated=0;
  const {data:projects}=await admin.from("ai_operations_video_projects").select("id,source_web_url,source_file_path").or(`source_file_path.eq.${key},source_web_url.ilike.%${key.replace(/[%_,]/g,"\\$&")}%`);
  for(const p of projects??[]){found++;const {error}=await admin.from("ai_operations_video_projects").update({source_provider:"google_drive",source_file_id:String(file.id),source_file_name:String(row.target_file_name),source_web_url:String(file.webViewLink),source_file_path:null,updated_at:new Date().toISOString()}).eq("id",p.id);if(!error) updated++;}
  return {found,updated};
}
async function finalize(admin:any,row:any,token:string,fileId:string){
  const file=await driveMeta(token,fileId);
  if(Number(file.size??-1)!==Number(row.source_size_bytes)) throw new Error(`Drive verification failed: expected ${row.source_size_bytes} bytes, got ${file.size??"unknown"}.`);
  const current=await replaceCurrentRefs(admin,row,file);
  const legacy=await legacyCall(admin,"finalize",{key:String(row.source_key),drive_file_id:String(file.id),drive_url:String(file.webViewLink??("https://drive.google.com/file/d/"+file.id+"/view")),delete_source:true});
  const now=new Date().toISOString();
  const found=current.found+Number(legacy.updated_social??0)+Number(legacy.updated_posted??0);
  const updated=current.updated+Number(legacy.updated_social??0)+Number(legacy.updated_posted??0);
  const {error}=await admin.from("ai_operations_video_storage_migrations").update({target_drive_file_id:String(file.id),target_drive_file_url:String(file.webViewLink??("https://drive.google.com/file/d/"+file.id+"/view")),target_size_bytes:Number(file.size),target_md5:file.md5Checksum??null,migration_status:"complete",bytes_uploaded:Number(file.size),db_references_found:found,db_references_updated:updated,verified_at:now,source_deleted_at:legacy.deleted?now:null,completed_at:now,claimed_by:null,lease_expires_at:null,last_error:null,updated_at:now,metadata:{...(row.metadata??{}),legacy_finalize:{updated_social:legacy.updated_social??0,updated_posted:legacy.updated_posted??0,deleted:Boolean(legacy.deleted)}}}).eq("id",row.id);
  if(error) throw new Error(error.message);
  return {file,legacy};
}
async function inventory(admin:any){
  const m=await legacyCall(admin,"manifest");const videos=Array.isArray(m.videos)?m.videos:[];const now=new Date().toISOString();
  for(let i=0;i<videos.length;i+=100){
    const rows=videos.slice(i,i+100).map((o:any)=>({tenant_id:TENANT_ID,source_provider:"cloudflare_r2",source_bucket:String(m.bucket??"valorwell-videos"),source_key:String(o.key),source_size_bytes:0,source_url:"legacy-r2://"+String(m.bucket??"valorwell-videos")+"/"+String(o.key),target_provider:"google_drive",target_file_name:String(o.original_filename??safeName(String(o.key))),metadata:{original_filename:o.original_filename??null,mime_type:o.mime_type??"video/mp4",youtube_video_id:o.youtube_video_id??null,legacy_ref_count:o.ref_count??0,source_project:"Therapist CRM"},updated_at:now}));
    const {error}=await admin.from("ai_operations_video_storage_migrations").upsert(rows,{onConflict:"tenant_id,source_bucket,source_key",ignoreDuplicates:false});if(error) throw new Error(error.message);
  }
  return {bucket:m.bucket,totalVideos:videos.length,upserted:videos.length};
}
async function claim(admin:any,workerId:string){
  const now=new Date(),expired=now.toISOString();
  const {data:rows,error}=await admin.from("ai_operations_video_storage_migrations").select("*").eq("tenant_id",TENANT_ID).in("migration_status",["pending","uploading","error"]).or(`lease_expires_at.is.null,lease_expires_at.lt.${expired}`).lt("attempts",8).order("created_at",{ascending:true}).limit(1);
  if(error) throw new Error(error.message);const row=rows?.[0];if(!row) return null;
  const lease=new Date(now.getTime()+15*60*1000).toISOString();
  const {data:c,error:ce}=await admin.from("ai_operations_video_storage_migrations").update({claimed_by:workerId,lease_expires_at:lease,attempts:Number(row.attempts??0)+1,updated_at:now.toISOString()}).eq("id",row.id).or(`lease_expires_at.is.null,lease_expires_at.lt.${expired}`).select("*").maybeSingle();
  if(ce) throw new Error(ce.message);return c??null;
}
async function tick(admin:any){
  const workerId="r2-drive-"+crypto.randomUUID();let row=await claim(admin,workerId);if(!row) return {ok:true,action:"idle"};
  try{
    const source=await legacyCall(admin,"source",{key:String(row.source_key)});const size=Number(source.size??0);if(!Number.isFinite(size)||size<=0) throw new Error("Legacy R2 source has no usable size.");
    if(Number(row.source_size_bytes)!==size||row.source_etag!==source.etag){const patch={source_size_bytes:size,source_etag:source.etag??null,updated_at:new Date().toISOString()};await admin.from("ai_operations_video_storage_migrations").update(patch).eq("id",row.id);row={...row,...patch};}
    const token=await googleToken(admin);const folderId=String(row.target_drive_folder_id??"")||await ensureFolder(admin,token);const name=String(row.target_file_name??safeName(row.source_key));
    if(!row.target_drive_file_id&&Number(row.bytes_uploaded??0)===0&&!row.upload_session_url){
      const existing=await findExisting(token,name,size);
      if(existing){await admin.from("ai_operations_video_storage_migrations").update({target_drive_folder_id:folderId,target_drive_file_id:String(existing.id),target_drive_file_url:String(existing.webViewLink??("https://drive.google.com/file/d/"+existing.id+"/view")),target_size_bytes:Number(existing.size),target_md5:existing.md5Checksum??null,migration_status:"deduplicated",updated_at:new Date().toISOString()}).eq("id",row.id);const done=await finalize(admin,{...row,target_drive_folder_id:folderId,target_file_name:name},token,String(existing.id));return {ok:true,action:"deduplicated_and_completed",key:row.source_key,driveFileId:existing.id,legacy:done.legacy};}
    }
    let session=String(row.upload_session_url??""),uploaded=Number(row.bytes_uploaded??0);
    if(!session){session=await initUpload(token,folderId,name,size);await admin.from("ai_operations_video_storage_migrations").update({target_drive_folder_id:folderId,target_file_name:name,upload_session_url:session,migration_status:"uploading",last_error:null,updated_at:new Date().toISOString()}).eq("id",row.id);}
    let finalFileId="";
    for(let i=0;i<MAX_CHUNKS_PER_TICK&&uploaded<size;i++){
      const start=uploaded,end=Math.min(size-1,start+CHUNK_BYTES-1),downloadUrl=String(source.download_url);
      const src=await fetch(downloadUrl,{headers:{Range:`bytes=${start}-${end}`}});
      if(!(src.status===206||(src.status===200&&start===0&&end===size-1))||!src.body) throw new Error("R2 ranged download failed: "+src.status+" "+(await src.text()).slice(0,300));
      const put=await fetch(session,{method:"PUT",headers:{"content-type":"video/mp4","content-length":String(end-start+1),"content-range":`bytes ${start}-${end}/${size}`},body:src.body} as any);
      if(put.status===308){uploaded=end+1;await admin.from("ai_operations_video_storage_migrations").update({bytes_uploaded:uploaded,migration_status:"uploading",claimed_by:workerId,lease_expires_at:new Date(Date.now()+15*60*1000).toISOString(),updated_at:new Date().toISOString()}).eq("id",row.id);continue;}
      if(put.ok){const f=await put.json().catch(()=>({}));finalFileId=String(f.id??"");if(!finalFileId) throw new Error("Drive upload completed without a file id.");uploaded=size;await admin.from("ai_operations_video_storage_migrations").update({target_drive_file_id:finalFileId,target_drive_file_url:String(f.webViewLink??("https://drive.google.com/file/d/"+finalFileId+"/view")),target_size_bytes:f.size?Number(f.size):size,target_md5:f.md5Checksum??null,bytes_uploaded:uploaded,migration_status:"uploaded",updated_at:new Date().toISOString()}).eq("id",row.id);break;}
      const errText=await put.text().catch(()=>"");if(put.status===404||put.status===410){await admin.from("ai_operations_video_storage_migrations").update({upload_session_url:null,bytes_uploaded:0,migration_status:"pending",last_error:"Drive resumable session expired; restarting.",claimed_by:null,lease_expires_at:null,updated_at:new Date().toISOString()}).eq("id",row.id);return {ok:false,action:"restart_session",key:row.source_key};}
      throw new Error("Drive chunk upload failed: "+put.status+" "+errText.slice(0,300));
    }
    if(finalFileId){const done=await finalize(admin,{...row,target_drive_folder_id:folderId,target_file_name:name},token,finalFileId);return {ok:true,action:"completed",key:row.source_key,driveFileId:finalFileId,legacy:done.legacy};}
    await admin.from("ai_operations_video_storage_migrations").update({bytes_uploaded:uploaded,migration_status:"uploading",claimed_by:null,lease_expires_at:null,updated_at:new Date().toISOString()}).eq("id",row.id);
    return {ok:true,action:"progress",key:row.source_key,bytesUploaded:uploaded,totalBytes:size};
  }catch(e){const message=e instanceof Error?e.message:String(e);await admin.from("ai_operations_video_storage_migrations").update({migration_status:"error",last_error:message.slice(0,4000),claimed_by:null,lease_expires_at:null,updated_at:new Date().toISOString()}).eq("id",row.id);return {ok:false,action:"error",key:row.source_key,error:message};}
}
Deno.serve(async(req:Request)=>{
  if(req.method!=="POST") return json({error:"Method not allowed"},405);
  if(!await authorized(req)) return json({error:"Unauthorized"},401);
  const input=await req.json().catch(()=>({})) as any,action=String(input.action??"tick"),admin=db();
  try{
    if(action==="inventory") return json({ok:true,action,...await inventory(admin)});
    if(action==="tick") return json(await tick(admin));
    return json({error:"Unknown action"},400);
  }catch(e){const message=e instanceof Error?e.message:String(e);console.error(JSON.stringify({component:"video-r2-drive-migrator",action,error:message}));return json({ok:false,error:message},500);}
});