import { BrowserWindow } from "electron";
import { normalizeUsername } from "./shared";

export type FetchedPost={id:string;caption:string;permalink:string;publishedAt:number;images:{mimeType:string;dataBase64:string}[]};
const origin="https://www.instagram.com";
function allowedSource(value:string):boolean {try{const u=new URL(value);return u.protocol==="https:"&&(u.hostname==="www.instagram.com"||u.hostname==="instagram.com");}catch{return false;}}
function allowedImage(value:string):boolean {try{const u=new URL(value);return u.protocol==="https:"&&(u.hostname.endsWith(".cdninstagram.com")||u.hostname.endsWith(".fbcdn.net"));}catch{return false;}}
async function waitFor<T>(window:BrowserWindow,script:string,accept:(value:T)=>boolean,timeout=15000):Promise<T>{
  const until=Date.now()+timeout;
  while(Date.now()<until){
    if(window.isDestroyed())throw new Error("Fetching was cancelled");
    if(new URL(window.webContents.getURL()).pathname.startsWith("/accounts/login"))throw new Error("The source requires sign-in on this connection. No posts were imported.");
    const value=await window.webContents.executeJavaScript(script,true) as T;
    if(accept(value))return value;
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  throw new Error("The source did not provide public posts. Try again later.");
}
async function download(url:string):Promise<{mimeType:string;dataBase64:string}>{
  if(!allowedImage(url))throw new Error("Unsupported image host");
  const response=await fetch(url,{signal:AbortSignal.timeout(20000),redirect:"error"});
  if(!response.ok||!response.body)throw new Error(`Image download failed: HTTP ${response.status}`);
  const mimeType=response.headers.get("content-type")?.split(";")[0]||"";
  if(!["image/jpeg","image/png","image/webp"].includes(mimeType))throw new Error("Unsupported image format");
  const chunks:Uint8Array[]=[];let size=0;
  for await(const chunk of response.body as unknown as AsyncIterable<Uint8Array>){size+=chunk.length;if(size>10*1024*1024)throw new Error("Image exceeds 10 MB");chunks.push(chunk);}
  return{mimeType,dataBase64:Buffer.concat(chunks).toString("base64")};
}
export async function fetchProfile(username:string,onPost:(post:FetchedPost)=>Promise<void>,progress:(message:string)=>void):Promise<number>{
  const name=normalizeUsername(username);
  const browser=new BrowserWindow({show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,partition:"provider-public",backgroundThrottling:false}});
  browser.webContents.setWindowOpenHandler(()=>({action:"deny"}));
  browser.webContents.session.setPermissionRequestHandler((_webContents,_permission,callback)=>callback(false));
  browser.webContents.on("will-navigate",(event,url)=>{if(!allowedSource(url))event.preventDefault();});
  browser.webContents.on("will-redirect",(event,url)=>{if(!allowedSource(url))event.preventDefault();});
  try{
    progress(`Reading @${name}`);
    await browser.loadURL(`${origin}/${name}/`);
    const links=await waitFor<string[]>(browser,`Array.from(document.querySelectorAll('a[href*="/p/"],a[href*="/reel/"]')).map(a=>a.href)`,v=>v.length>0);
    const paths=[...new Set(links)].filter(link=>{if(!allowedSource(link))return false;const parts=new URL(link).pathname.split('/').filter(Boolean);const index=parts[0]?.toLowerCase()===name?1:0;return ['p','reel'].includes(parts[index])&&!!parts[index+1];}).slice(0,30);
    if(!paths.length)throw new Error("No public post links were available for this profile");
    let saved=0;
    const failures:string[]=[];
    for(const [index,link]of paths.entries()){
      progress(`@${name}: post ${index+1} of ${paths.length}`);
      try{
        await browser.loadURL(link);
        const meta=await waitFor<{date:string;image:string;caption:string}>(browser,`({date:document.querySelector('time[datetime]')?.getAttribute('datetime')||'',image:document.querySelector('meta[property="og:image"]')?.content||'',caption:document.querySelector('meta[property="og:description"]')?.content||''})`,v=>!!v.date&&!!v.image);
        const publishedAt=Date.parse(meta.date);if(!Number.isFinite(publishedAt)||publishedAt<Date.now()-30*86400000)continue;
        const match=new URL(link).pathname.match(/\/(p|reel)\/([A-Za-z0-9_-]+)/);if(!match)continue;
        const image=await download(meta.image);
        await onPost({id:match[2],caption:meta.caption,permalink:`${origin}/${match[1]}/${match[2]}/`,publishedAt,images:[image]});
        saved++;
      }catch(error){failures.push(error instanceof Error?error.message:"Post could not be imported");}
    }
    if(failures.length)throw new Error(`${saved} posts processed; ${failures.length} failed. ${failures[0]}`);
    return saved;
  }finally{if(!browser.isDestroyed())browser.destroy();}
}
