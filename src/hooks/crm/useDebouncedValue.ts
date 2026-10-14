import {useEffect,useState} from 'react';

/** Prevent one expensive server-search request per typed character.
 * The input itself remains responsive and URL-persisted immediately. */
export function useDebouncedValue<T>(value:T,delayMs=350):T{
  const [settled,setSettled]=useState(value);
  useEffect(()=>{
    const handle=window.setTimeout(()=>setSettled(value),delayMs);
    return ()=>window.clearTimeout(handle);
  },[value,delayMs]);
  return settled;
}
