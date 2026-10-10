import type { SupabaseClient } from "npm:@supabase/supabase-js@2.93.1";
const TENANT="00000000-0000-0000-0000-000000000001";
export const digest=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)))).map(v=>v.toString(16).padStart(2,"0")).join("");
async function driveToken(db:SupabaseClient) {
  const {data,error}=await db.rpc("get_relationship_google_connection_runtime",{p_tenant_id:TENANT,p_connection_type:"drive",p_connection_id:null});
  if(error||!data?.refreshToken)throw new Error("media_auth_unavailable");
  const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:Deno.env.get("GOOGLE_RELATIONSHIPS_CLIENT_ID")??"",client_secret:Deno.env.get("GOOGLE_RELATIONSHIPS_CLIENT_SECRET")??"",refresh_token:data.refreshToken,grant_type:"refresh_token"}),signal:AbortSignal.timeout(20000)});
  const b=await r.json();if(!r.ok||!b.access_token)throw new Error("media_auth_unavailable");return b.access_token as string;
}
export async function prepareMedia(db:SupabaseClient,deliveryId:string,lease:string) {
  const {data:d,error}=await db.from("ai_operations_social_distribution_deliveries").select("*").eq("tenant_id",TENANT).eq("id",deliveryId).eq("lease_token",lease).eq("status","PROCESSING").eq("platform","instagram").single();
  if(error||!d||Date.parse(d.lease_expires_at)<Date.now()||!d.drive_file_id)return {ok:false,error:"media_unavailable"};
  const mediaInfo=await inspectMedia(db,d.drive_file_id);
  if(!mediaInfo.ok)return {ok:false,error:"media_unavailable"};
  const key=Array.from(crypto.getRandomValues(new Uint8Array(32))).map(v=>v.toString(16).padStart(2,"0")).join("");
  const {data:media,error:insertError}=await db.from("ai_operations_distribution_media_leases").insert({tenant_id:TENANT,delivery_id:d.id,token_hash:await digest(key),drive_file_id:d.drive_file_id,size_bytes:mediaInfo.size_bytes,expires_at:new Date(Date.now()+24*3600000).toISOString()}).select("id").single();
  if(insertError)throw new Error("media_lease_failed");
  return {ok:true,media_url:`${Deno.env.get("SUPABASE_URL")}/functions/v1/release-distributor?media=${media.id}&key=${key}`};
}
export async function inspectMedia(db:SupabaseClient,fileId:string) {
  const token=await driveToken(db);
  const r=await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,mimeType,size,videoMediaMetadata`,{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)});
  const b=await r.json(),seconds=Number(b.videoMediaMetadata?.durationMillis??0)/1000;
  const width=Number(b.videoMediaMetadata?.width??0),height=Number(b.videoMediaMetadata?.height??0),size=Number(b.size??0);
  const ok=r.ok&&b.mimeType==='video/mp4'&&size>0&&size<=1024*1024*1024&&seconds>=3&&seconds<=180&&width>0&&height>0&&width<=height;
  return {ok,mime_type:String(b.mimeType??''),size_bytes:size,duration_seconds:seconds,width,height};
}
// Capability URL is random, short lived, file-specific and read-only. The Drive file stays private.
export async function serveMedia(db:SupabaseClient,request:Request) {
  const url=new URL(request.url),key=url.searchParams.get("key")??"",id=url.searchParams.get("media")??"";
  if(!/^[a-f0-9]{64}$/.test(key)||!/^[a-f0-9-]{36}$/.test(id))return new Response(null,{status:404});
  const {data:m,error}=await db.from("ai_operations_distribution_media_leases").select("*").eq("tenant_id",TENANT).eq("id",id).gt("expires_at",new Date().toISOString()).single();
  if(error||!m||await digest(key)!==m.token_hash)return new Response(null,{status:404});
  const headers=new Headers({"content-type":"video/mp4","accept-ranges":"bytes","cache-control":"private, no-store","content-length":String(m.size_bytes)});
  if(request.method==="HEAD")return new Response(null,{headers});
  const range=request.headers.get("range");
  if(range&&!/^bytes=\d*-\d*$/.test(range))return new Response(null,{status:416});
  const upstream=await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(m.drive_file_id)}?alt=media`,{headers:{authorization:`Bearer ${await driveToken(db)}`,...(range?{range}:{})},signal:AbortSignal.timeout(240000)});
  if(!upstream.ok)return new Response(null,{status:502});
  for(const name of ["content-length","content-range"])if(upstream.headers.has(name))headers.set(name,upstream.headers.get(name)!);
  return new Response(upstream.body,{status:upstream.status,headers});
}
