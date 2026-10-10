import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.93.1";
import { youtubeAccessToken } from "../_shared/ai-ops-youtube.ts";
import { prepareMedia, serveMedia, inspectMedia } from "./media.ts";
import { durationSeconds } from "./metadata.ts";

const TENANT = "00000000-0000-0000-0000-000000000001";
const CHANNEL = "UCVcoBzMSzuABGxJ5Ne5EBtw";
type DistributionRequest = {action:string;worker_id?:string;delivery_id?:string;lease_token?:string;container_id?:string;external_post_id?:string;external_post_url?:string;outcome?:string;http_status?:number;error_category?:string};
type MonitorConfig = {baseline_completed_at:string|null;monitor_cursor:string|null;last_full_scan_at:string|null};
type InventoryChannel = {id:string;contentDetails:{relatedPlaylists:{uploads:string}}};
const respond = (body: unknown, status=200) => new Response(JSON.stringify(body), {status,headers:{"content-type":"application/json","cache-control":"no-store"}});
const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)))).map(v=>v.toString(16).padStart(2,"0")).join("");

// Custom, tenant-bound worker authentication. Token hash stays in a service-only table.
// This gateway exposes specific operations, never generic SQL or arbitrary RPC forwarding.
Deno.serve(async request => {
  if(request.method==="GET"||request.method==="HEAD") {
    const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
    try{return await serveMedia(db,request);}catch{return new Response(null,{status:502});}
  }
  if(request.method!=="POST") return respond({error:"method_not_allowed"},405);
  const token=request.headers.get("x-distribution-token")??"";
  if(token.length<32 || token.length>256) return respond({error:"unauthorized"},401);
  const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:cfg,error:cfgError}=await db.from("ai_operations_distribution_config").select("*").eq("tenant_id",TENANT).single();
  if(cfgError || !cfg?.worker_token_hash || await hash(token)!==cfg.worker_token_hash) return respond({error:"unauthorized"},401);
  let body: DistributionRequest;
  try { body=await request.json(); } catch { return respond({error:"invalid_json"},400); }
  if(!body||typeof body.action!=="string")return respond({error:"invalid_action"},400);
  const rpc=async(name:string,args:Record<string,unknown>)=>{const {data,error}=await db.rpc(name,args);if(error)throw new Error("database_operation_failed");return data;};
  try {
    switch(body.action) {
      case "status": {
        const {data,error}=await db.from("ai_operations_social_distribution_deliveries").select("id,youtube_video_id,platform,status,attempt_count,external_post_id,external_post_url,last_error").eq("tenant_id",TENANT).order("created_at",{ascending:false}).limit(100);
        if(error) throw new Error("database_operation_failed");
        return respond({publishing_enabled:cfg.publishing_enabled,test_delivery_id:cfg.test_delivery_id,baseline_completed_at:cfg.baseline_completed_at,deliveries:data});
      }
      case "monitor": return respond(await monitor(db,cfg,rpc));
      case "media_preflight": {
        const {data:r}=await db.from("ai_operations_youtube_release_registry").select("clip_id").eq("tenant_id",TENANT).eq("classification","short").not("clip_id","is",null).limit(1).maybeSingle();
        if(!r?.clip_id)return respond({ok:false,error:"no_matched_short"});
        const {data:c}=await db.from("ai_operations_video_clips").select("drive_file_id").eq("id",r.clip_id).single();
        if(!c?.drive_file_id)return respond({ok:false,error:"media_unavailable"});
        try{return respond(await inspectMedia(db,c.drive_file_id));}catch{return respond({ok:false,error:"media_auth_or_access_unavailable"});}
      }
      case "claim": return respond({job:await rpc("distribution_claim",{p_tenant:TENANT,p_worker:String(body.worker_id??"n8n").slice(0,200)})});
      case "begin": {
        const {data:d,error}=await db.from("ai_operations_social_distribution_deliveries").select("youtube_video_id").eq("tenant_id",TENANT).eq("id",body.delivery_id).eq("lease_token",body.lease_token).eq("status","PROCESSING").single();
        if(error||!d)return respond({allowed:false});
        const yt=await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,status&id=${encodeURIComponent(d.youtube_video_id)}`,{headers:{authorization:`Bearer ${await youtubeAccessToken()}`},signal:AbortSignal.timeout(20000)});
        if(!yt.ok)throw new Error("youtube_read_failed");
        const video=(await yt.json()).items?.[0];
        if(!video||video.snippet?.channelId!==CHANNEL||video.status?.privacyStatus!=="public")return respond({allowed:false});
        return respond({allowed:await rpc("distribution_begin_request",{p_tenant:TENANT,p_delivery:body.delivery_id,p_lease:body.lease_token})});
      }
      case "media": {
        try{return respond(await prepareMedia(db,String(body.delivery_id),String(body.lease_token)));}
        catch{return respond({ok:false,error:"media_unavailable"});}
      }
      case "container": {
        if(!/^\d+$/.test(String(body.container_id)))return respond({recorded:false},400);
        const {data,error}=await db.from("ai_operations_social_distribution_deliveries").update({external_container_id:body.container_id}).eq("tenant_id",TENANT).eq("id",body.delivery_id).eq("lease_token",body.lease_token).eq("status","PROCESSING").is("external_container_id",null).select("id");
        return respond({recorded:!error&&data?.length===1});
      }
      case "finish": {
        const allowedErrors=new Set(["platform_auth","platform_rate_limit","platform_rejected","platform_ambiguous","media_unavailable","invalid_response"]);
        const url=typeof body.external_post_url==="string" && /^https:\/\/(www\.)?(facebook\.com|linkedin\.com|instagram\.com)\//.test(body.external_post_url)?body.external_post_url:null;
        return respond({recorded:await rpc("distribution_finish",{p_tenant:TENANT,p_delivery:body.delivery_id,p_lease:body.lease_token,p_outcome:body.outcome,p_http:Number.isInteger(body.http_status)?body.http_status:null,p_external_id:typeof body.external_post_id==="string"?body.external_post_id.slice(0,200):null,p_url:url,p_error:allowedErrors.has(String(body.error_category))?body.error_category:null})});
      }
      case "recover": {
        const recovered=await rpc("distribution_recover",{p_tenant:TENANT});
        const {data,error}=await db.from("ai_operations_youtube_release_registry").select("id").eq("tenant_id",TENANT).eq("visibility","public").eq("baseline_excluded",false).limit(200);
        if(error) throw new Error("database_operation_failed");
        for(const r of data??[]) await rpc("distribution_prepare",{p_tenant:TENANT,p_release:r.id});
        const {data:review,error:reviewError}=await db.from("ai_operations_social_distribution_deliveries").select("id,platform,external_post_id,external_container_id").eq("tenant_id",TENANT).eq("status","NEEDS_REVIEW").not("external_post_id","is",null).limit(50);
        if(reviewError)throw new Error("database_operation_failed");
        return respond({recovered,review:review??[]});
      }
      case "confirm_existing": {
        const url=typeof body.external_post_url==="string"&&/^https:\/\/(www\.)?(facebook\.com|linkedin\.com|instagram\.com)\//.test(body.external_post_url)?body.external_post_url:null;
        if(!url)return respond({recorded:false},400);
        return respond({recorded:await rpc("distribution_confirm_existing",{p_tenant:TENANT,p_delivery:body.delivery_id,p_external_id:body.external_post_id,p_url:url})});
      }
      default: return respond({error:"unsupported_action"},400);
    }
  } catch { return respond({error:"distribution_operation_failed",action:body.action},502); }
});

async function monitor(db:SupabaseClient,cfg:MonitorConfig,rpc:(name:string,args:Record<string,unknown>)=>Promise<unknown>) {
  const token=await youtubeAccessToken();
  const yt=async(path:string)=>{const r=await fetch(`https://www.googleapis.com/youtube/v3/${path}`,{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error("youtube_read_failed");return await r.json();};
  const identity=await yt("channels?part=id,contentDetails&mine=true");
  const channel=(identity.items??[]).find((v:InventoryChannel)=>v.id===CHANNEL);
  if(!channel)throw new Error("youtube_channel_mismatch");
  const ids=new Set<string>();
  // Persisted internal IDs include Private/scheduled uploads regardless of inventory ordering.
  for(let offset=0;;offset+=500) {
    const {data,error}=await db.from("ai_operations_social_publications").select("external_video_id").eq("tenant_id",TENANT).eq("platform","youtube").not("external_video_id","is",null).range(offset,offset+499);
    if(error)throw new Error("database_read_failed");
    for(const p of data??[]) if(/^[\w-]{11}$/.test(p.external_video_id))ids.add(p.external_video_id);
    if((data??[]).length<500)break;
  }
  const {data:known,error:knownError}=await db.from("ai_operations_youtube_release_registry").select("youtube_video_id").eq("tenant_id",TENANT).order("last_checked_at",{ascending:true,nullsFirst:true}).limit(200);
  if(knownError)throw new Error("database_read_failed");
  for(const r of known??[])ids.add(r.youtube_video_id);
  const deep=!cfg.baseline_completed_at || !!cfg.monitor_cursor || !cfg.last_full_scan_at || Date.now()-Date.parse(cfg.last_full_scan_at)>3600000;
  let cursor=deep?(cfg.monitor_cursor??""):"";
  let finished=false;
  // Five pages per invocation, with cursor saved only after successful visibility checks.
  for(let page=0;page<(deep?5:1);page++) {
    const list=await yt(`playlistItems?part=contentDetails&maxResults=50&playlistId=${encodeURIComponent(channel.contentDetails.relatedPlaylists.uploads)}${cursor?`&pageToken=${encodeURIComponent(cursor)}`:""}`);
    for(const v of list.items??[])if(v.contentDetails?.videoId)ids.add(v.contentDetails.videoId);
    cursor=list.nextPageToken??"";
    if(!cursor){finished=true;break;}
  }
  const all=[...ids];let observed=0;
  for(let offset=0;offset<all.length;offset+=50) {
    const batch=all.slice(offset,offset+50);
    const list=await yt(`videos?part=snippet,status,contentDetails&id=${batch.join(",")}`);
    const found=new Set<string>();
    for(const v of list.items??[]) {
      if(v.snippet?.channelId!==CHANNEL)continue;
      found.add(v.id);
      await rpc("distribution_observe",{p_tenant:TENANT,p_video:{id:v.id,channel_id:CHANNEL,title:v.snippet.title,visibility:v.status.privacyStatus,duration_seconds:durationSeconds(v.contentDetails?.duration)},p_method:deep?"authenticated_inventory":"scheduled_check"});
      observed++;
    }
    // Missing API entries are not inferred Public. Preserve them for later reconciliation.
    for(const id of batch.filter(id=>!found.has(id))) {
      const {error}=await db.from("ai_operations_youtube_release_registry").update({visibility:"unavailable",last_checked_at:new Date().toISOString()}).eq("tenant_id",TENANT).eq("youtube_video_id",id);
      if(error)throw new Error("database_write_failed");
    }
  }
  if(deep) {
    const patch:Record<string,unknown>={monitor_cursor:cursor||null};
    if(finished){patch.last_full_scan_at=new Date().toISOString();if(!cfg.baseline_completed_at)patch.baseline_completed_at=patch.last_full_scan_at;}
    const {error}=await db.from("ai_operations_distribution_config").update(patch).eq("tenant_id",TENANT);
    if(error)throw new Error("database_write_failed");
  }
  return {observed,deep_scan:deep,inventory_complete:finished,baseline_complete:!!cfg.baseline_completed_at||(deep&&finished)};
}
