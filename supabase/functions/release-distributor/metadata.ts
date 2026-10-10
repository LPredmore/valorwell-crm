/** Duration may rule out a Short, but never proves that a video is a Short. */
export function durationSeconds(iso:unknown):number|null {
  if(typeof iso!=="string")return null;
  const m=/^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(iso);
  if(!m)return null;
  const seconds=Number(m[1]??0)*86400+Number(m[2]??0)*3600+Number(m[3]??0)*60+Number(m[4]??0);
  return Number.isFinite(seconds)?seconds:null;
}
