
import "jsr:@supabase/functions-js@2.4.5/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.93.1";

const TENANT_ID="00000000-0000-0000-0000-000000000001";
const BASE="https://api.cloudflare.com/client/v4";
const SUPABASE_PROJECT="ahqauomkgflopxgnlndd";

function db(){
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    {auth:{persistSession:false,autoRefreshToken:false}}
  );
}
function json(body:unknown,status=200){
  return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
}
async function sha256Hex(v:string){
  const b=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v)));
  return [...b].map(x=>x.toString(16).padStart(2,"0")).join("");
}
function randomToken(){
  const b=crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");
}
async function cf(path:string, init:RequestInit={}){
  const account=Deno.env.get("CLOUDFLARE_ACCOUNT_ID") ?? "";
  const token=Deno.env.get("CLOUDFLARE_STREAM_API_TOKEN") ?? "";
  if(!account || !token) throw new Error("Cloudflare Stream secrets are not configured.");
  const r=await fetch(BASE+"/accounts/"+encodeURIComponent(account)+path,{
    ...init,
    headers:{
      "authorization":"Bearer "+token,
      "content-type":"application/json",
      ...(init.headers||{})
    }
  });
  const body=await r.json().catch(()=>({}));
  if(!r.ok || body?.success===false){
    const msg=body?.errors?.map((x:any)=>x.message).filter(Boolean).join("; ") || ("Cloudflare HTTP "+r.status);
    throw new Error(msg);
  }
  return body?.result ?? body;
}
async function googleToken(admin:any){
  const {data,error}=await admin.rpc("get_relationship_google_connection_runtime",{
    p_tenant_id:TENANT_ID,p_connection_type:"drive",p_connection_id:null
  });
  if(error) throw new Error(error.message);
  const refresh=String(data?.refreshToken ?? "");
  if(!refresh) throw new Error("Google Drive connection unavailable.");
  const clientId=Deno.env.get("GOOGLE_RELATIONSHIPS_CLIENT_ID") ?? "";
  const clientSecret=Deno.env.get("GOOGLE_RELATIONSHIPS_CLIENT_SECRET") ?? "";
  const r=await fetch("https://oauth2.googleapis.com/token",{
    method:"POST",
    headers:{"content-type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({
      client_id:clientId,client_secret:clientSecret,refresh_token:refresh,grant_type:"refresh_token"
    })
  });
  const b=await r.json().catch(()=>({}));
  if(!r.ok || !b?.access_token) throw new Error("Google Drive token refresh failed.");
  return String(b.access_token);
}
function safeName(v:string){
  return v.replace(/[<>:"/\\|?*]+/g,"_").replace(/\s+/g," ").trim().replace(/[. ]+$/g,"").slice(0,150) || "video";
}
function shortTransformUrl(sourceUrl:string){
  return "https://valorwell.org/cdn-cgi/media/mode=video,width=1080,height=1920,fit=cover,audio=true/"+sourceUrl;
}
async function searchDrive(folderId:string,name:string,access:string){
  const q="'"+folderId.replaceAll("'","\\'")+"' in parents and name = '"+name.replaceAll("'","\\'")+"' and trashed = false";
  const u=new URL("https://www.googleapis.com/drive/v3/files");
  u.searchParams.set("q",q);
  u.searchParams.set("pageSize","10");
  u.searchParams.set("fields","files(id,name,size,webViewLink,mimeType)");
  const r=await fetch(u,{headers:{authorization:"Bearer "+access}});
  if(!r.ok) throw new Error("Drive search failed: "+r.status+" "+(await r.text()).slice(0,300));
  const b=await r.json();
  return b?.files?.[0] ?? null;
}
async function transferToDrive(admin:any, job:any, clip:any, project:any, downloadUrl:string, cfClipUid:string, folderId:string){
  const now=new Date().toISOString();
  try{
    const startMs=Math.round(Number(clip.start_seconds)*1000);
    const endMs=Math.round(Number(clip.end_seconds)*1000);
    const base=safeName(String(project.source_file_name ?? "video").replace(/\.[^.]+$/,""));
    const isShort=String(clip.clip_type ?? "")==="short";
    const profileSuffix=isShort ? "__short_9x16__" : "__clip__";
    const name=base+profileSuffix+startMs+"-"+endMs+"__"+String(clip.id).slice(0,8)+".mp4";
    const access=await googleToken(admin);

    let existing=await searchDrive(folderId,name,access);
    let fileId="",fileUrl="",fileSize:number|null=null;

    if(existing){
      fileId=String(existing.id);
      fileUrl=String(existing.webViewLink ?? ("https://drive.google.com/file/d/"+fileId+"/view"));
      fileSize=existing.size ? Number(existing.size) : null;
    } else {
      const outputUrl=isShort ? shortTransformUrl(downloadUrl) : downloadUrl;
      const source=await fetch(outputUrl,{headers:{accept:"video/mp4"}});
      if(!source.ok || !source.body){
        const detail=await source.text().catch(()=>"");
        if(isShort && source.status===404) throw new Error("SHORT_TRANSFORM_UNAVAILABLE: Cloudflare Media Transformations returned 404 for valorwell.org. Enable Media Transformations for the zone before automatic 9:16 rendering.");
        throw new Error((isShort ? "Cloudflare 9:16 transform failed: " : "Cloudflare MP4 download failed: ")+source.status+" "+detail.slice(0,300));
      }
      const contentType=String(source.headers.get("content-type") ?? "").toLowerCase();
      if(isShort && !contentType.includes("video/")) throw new Error("Cloudflare 9:16 transform returned non-video content: "+contentType);
      const lenHeader=source.headers.get("content-length");
      const size=lenHeader ? Number(lenHeader) : NaN;
      if(!Number.isFinite(size) || size<=0) throw new Error("Cloudflare MP4 response did not include a usable content-length.");

      const init=await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,webViewLink,mimeType",{
        method:"POST",
        headers:{
          authorization:"Bearer "+access,
          "content-type":"application/json; charset=UTF-8",
          "x-upload-content-type":"video/mp4",
          "x-upload-content-length":String(size)
        },
        body:JSON.stringify({name,parents:[folderId]})
      });
      if(!init.ok) throw new Error("Drive resumable session failed: "+init.status+" "+(await init.text()).slice(0,300));
      const location=init.headers.get("location");
      if(!location) throw new Error("Drive resumable session returned no upload URL.");

      const putInit:any={
        method:"PUT",
        headers:{
          "content-type":"video/mp4",
          "content-length":String(size),
          "content-range":"bytes 0-"+String(size-1)+"/"+String(size)
        },
        body:source.body
      };
      const uploaded=await fetch(location,putInit);
      if(!uploaded.ok) throw new Error("Drive video upload failed: "+uploaded.status+" "+(await uploaded.text()).slice(0,300));
      const f=await uploaded.json();
      fileId=String(f.id);
      fileUrl=String(f.webViewLink ?? ("https://drive.google.com/file/d/"+fileId+"/view"));
      fileSize=f.size ? Number(f.size) : size;
    }

    const {error:ce}=await admin.from("ai_operations_video_clips").update({
      drive_file_id:fileId,
      drive_file_url:fileUrl,
      output_mime_type:"video/mp4",
      output_size_bytes:fileSize,
      status:"rendered",
      rendered_at:now,
      error_message:null,
      updated_at:now
    }).eq("id",clip.id);
    if(ce) throw new Error(ce.message);

    const {error:je}=await admin.from("ai_operations_video_jobs").update({
      status:"complete",
      completed_at:now,
      error_message:null,
      updated_at:now,
      payload:{...(job.payload||{}),cloudflare_stage:"drive_complete",drive_file_id:fileId,render_profile:isShort ? "youtube_short_9x16" : "source_aspect_clip",render_width:isShort ? 1080 : null,render_height:isShort ? 1920 : null}
    }).eq("id",job.id);
    if(je) throw new Error(je.message);

    try{ await cf("/stream/"+encodeURIComponent(cfClipUid),{method:"DELETE"}); }catch(_){}
  }catch(e){
    const message=e instanceof Error?e.message:String(e);
    const terminal=message.startsWith("SHORT_TRANSFORM_UNAVAILABLE:");
    await admin.from("ai_operations_video_jobs").update({
      status:terminal ? "error" : "queued",
      attempts:Number(job.attempts||0)+1,
      error_message:message.slice(0,4000),
      updated_at:new Date().toISOString(),
      payload:{...(job.payload||{}),cloudflare_stage:terminal ? "short_transform_unavailable" : "drive_transfer_retry"}
    }).eq("id",job.id);
    await admin.from("ai_operations_video_clips").update({
      status:terminal ? "error" : "render_queued",
      error_message:message.slice(0,4000),
      updated_at:new Date().toISOString()
    }).eq("id",clip.id);
  }
}
async function failProject(admin:any,projectId:string,message:string){
  const {data:jobs}=await admin.from("ai_operations_video_jobs")
    .select("id,clip_id").eq("project_id",projectId).eq("job_type","render_clip").in("status",["queued","running","claimed"]);
  const ids=(jobs||[]).map((x:any)=>x.id);
  const clips=(jobs||[]).map((x:any)=>x.clip_id).filter(Boolean);
  if(ids.length) await admin.from("ai_operations_video_jobs").update({status:"error",error_message:message,updated_at:new Date().toISOString()}).in("id",ids);
  if(clips.length) await admin.from("ai_operations_video_clips").update({status:"error",error_message:message,updated_at:new Date().toISOString()}).in("id",clips);
}

Deno.serve(async(req:Request)=>{
  if(req.method!=="POST") return json({error:"Method not allowed"},405);
  const admin=db();
  try{
    const {data:jobs,error:jerr}=await admin.from("ai_operations_video_jobs")
      .select("id,project_id,clip_id,status,attempts,payload,created_at")
      .eq("job_type","render_clip")
      .in("status",["queued","running"])
      .order("status",{ascending:false})
      .order("created_at",{ascending:true})
      .order("id",{ascending:true})
      .limit(25);
    if(jerr) throw new Error(jerr.message);
    if(!jobs?.length) return json({ok:true,action:"idle"});

    const job=jobs[0] as any;
    const projectId=String(job.project_id);
    const {data:projects,error:perr}=await admin.from("ai_operations_video_projects")
      .select("id,source_file_id,source_file_name,source_size_bytes,source_mime_type,metadata")
      .eq("id",projectId).limit(1);
    if(perr || !projects?.length) throw new Error(perr?.message ?? "Project not found.");
    const project=projects[0] as any;
    let meta={...(project.metadata||{})};
    let sourceUid=String(meta.cloudflare_stream_uid ?? "");

    if(!sourceUid){
      const token=randomToken();
      const hash=await sha256Hex(token);
      const payload={...(job.payload||{}),source_proxy_token_hash:hash,cloudflare_stage:"source_upload_submitted"};
      const {error:ue}=await admin.from("ai_operations_video_jobs").update({payload,updated_at:new Date().toISOString()}).eq("id",job.id);
      if(ue) throw new Error(ue.message);

      const input="https://"+SUPABASE_PROJECT+".supabase.co/functions/v1/video-drive-media-proxy?job_id="+job.id+"&token="+encodeURIComponent(token);
      const copied=await cf("/stream/copy",{
        method:"POST",
        body:JSON.stringify({
          input,
          name:String(project.source_file_name),
          meta:{name:String(project.source_file_name),valorwell_project_id:projectId}
        })
      });
      sourceUid=String(copied.uid ?? "");
      if(!sourceUid) throw new Error("Cloudflare source upload returned no UID.");
      meta={...meta,cloudflare_stream_uid:sourceUid,cloudflare_stream_status:copied?.status?.state ?? "submitted",cloudflare_stream_submitted_at:new Date().toISOString()};
      await admin.from("ai_operations_video_projects").update({metadata:meta,updated_at:new Date().toISOString()}).eq("id",projectId);
      return json({ok:true,action:"source_submitted",project_id:projectId,cloudflare_status:meta.cloudflare_stream_status});
    }

    const source=await cf("/stream/"+encodeURIComponent(sourceUid),{method:"GET"});
    const sourceState=String(source?.status?.state ?? "");
    meta={...meta,cloudflare_stream_status:sourceState,cloudflare_stream_pct_complete:source?.status?.pctComplete ?? null};
    await admin.from("ai_operations_video_projects").update({metadata:meta,updated_at:new Date().toISOString()}).eq("id",projectId);
    if(sourceState==="error"){
      const msg="Cloudflare source processing failed: "+String(source?.status?.errorReasonText ?? source?.status?.errorReasonCode ?? "unknown error");
      await failProject(admin,projectId,msg);
      return json({ok:false,action:"source_error",error:msg},502);
    }
    if(!source?.readyToStream) return json({ok:true,action:"source_processing",project_id:projectId,state:sourceState,pct:source?.status?.pctComplete ?? null});

    const {data:clips,error:cerr}=await admin.from("ai_operations_video_clips")
      .select("id,project_id,parent_file_id,start_seconds,end_seconds,transcript_text,clip_type,status,drive_file_id")
      .eq("id",job.clip_id).limit(1);
    if(cerr || !clips?.length) throw new Error(cerr?.message ?? "Clip not found.");
    const clip=clips[0] as any;
    if(clip.drive_file_id){
      await admin.from("ai_operations_video_jobs").update({status:"complete",completed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",job.id);
      return json({ok:true,action:"already_rendered",clip_id:clip.id});
    }

    let payload={...(job.payload||{})};
    let clipUid=String(payload.cloudflare_clip_uid ?? "");

    if(!clipUid){
      const created=await cf("/stream/clip",{
        method:"POST",
        body:JSON.stringify({
          clippedFromVideoUID:sourceUid,
          startTimeSeconds:Number(clip.start_seconds),
          endTimeSeconds:Number(clip.end_seconds)
        })
      });
      clipUid=String(created.uid ?? "");
      if(!clipUid) throw new Error("Cloudflare clip creation returned no UID.");
      payload={...payload,cloudflare_clip_uid:clipUid,cloudflare_stage:"clip_submitted",cloudflare_clip_submitted_at:new Date().toISOString()};
      await admin.from("ai_operations_video_jobs").update({
        status:"running",started_at:job.started_at ?? new Date().toISOString(),payload,error_message:null,updated_at:new Date().toISOString()
      }).eq("id",job.id);
      await admin.from("ai_operations_video_clips").update({status:"rendering",error_message:null,updated_at:new Date().toISOString()}).eq("id",clip.id);
      return json({ok:true,action:"clip_submitted",clip_id:clip.id});
    }

    const detail=await cf("/stream/"+encodeURIComponent(clipUid),{method:"GET"});
    const clipState=String(detail?.status?.state ?? "");
    if(clipState==="error"){
      const msg="Cloudflare clip processing failed: "+String(detail?.status?.errorReasonText ?? detail?.status?.errorReasonCode ?? "unknown error");
      await admin.from("ai_operations_video_jobs").update({status:"error",error_message:msg,updated_at:new Date().toISOString()}).eq("id",job.id);
      await admin.from("ai_operations_video_clips").update({status:"error",error_message:msg,updated_at:new Date().toISOString()}).eq("id",clip.id);
      return json({ok:false,action:"clip_error",error:msg},502);
    }
    if(!detail?.readyToStream) return json({ok:true,action:"clip_processing",clip_id:clip.id,state:clipState,pct:detail?.status?.pctComplete ?? null});

    let downloads:any;
    if(!payload.cloudflare_download_requested_at){
      downloads=await cf("/stream/"+encodeURIComponent(clipUid)+"/downloads",{method:"POST"});
      payload={...payload,cloudflare_download_requested_at:new Date().toISOString(),cloudflare_stage:"download_requested"};
      await admin.from("ai_operations_video_jobs").update({payload,updated_at:new Date().toISOString()}).eq("id",job.id);
    }else{
      downloads=await cf("/stream/"+encodeURIComponent(clipUid)+"/downloads",{method:"GET"});
    }
    const d=downloads?.default;
    if(d?.status==="error"){
      const msg="Cloudflare MP4 generation failed.";
      await admin.from("ai_operations_video_jobs").update({status:"error",error_message:msg,updated_at:new Date().toISOString()}).eq("id",job.id);
      await admin.from("ai_operations_video_clips").update({status:"error",error_message:msg,updated_at:new Date().toISOString()}).eq("id",clip.id);
      return json({ok:false,action:"download_error"},502);
    }
    if(d?.status!=="ready" || !d?.url){
      return json({ok:true,action:"download_processing",clip_id:clip.id,percent:d?.percentComplete ?? null});
    }

    const {data:settings,error:serr}=await admin.from("ai_operations_video_settings")
      .select("short_clip_folder_id").eq("tenant_id",TENANT_ID).limit(1);
    if(serr || !settings?.[0]?.short_clip_folder_id) throw new Error(serr?.message ?? "BTY Shorts folder is not configured.");

    payload={...payload,cloudflare_stage:"drive_transfer_started",cloudflare_download_url:String(d.url)};
    await admin.from("ai_operations_video_jobs").update({payload,updated_at:new Date().toISOString()}).eq("id",job.id);

    EdgeRuntime.waitUntil(transferToDrive(admin,{...job,payload},clip,project,String(d.url),clipUid,String(settings[0].short_clip_folder_id)));
    return json({ok:true,action:"drive_transfer_started",clip_id:clip.id});
  }catch(e){
    const message=e instanceof Error?e.message:String(e);
    console.error(JSON.stringify({component:"video-cloudflare-render-dispatcher",error:message}));
    return json({ok:false,error:message},500);
  }
});
