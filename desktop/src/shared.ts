export type Profile = { id:number; username:string; postCount:number; lastCheckedAt:number|null; lastSuccessAt:number|null; lastSource:string|null; lastError:string|null };
export type Preferences = { apiUrl:string; connected:boolean; intervalMinutes:number; startAtLogin:boolean; lastAttempt:number|null; lastSuccess:number|null; lastError:string|null; deviceId:string|null };
export type AppStatus = { preferences:Preferences; profiles:Profile[]; syncing:boolean; progress:string; version:string; update:{state:string;message:string} };
export type SettingsInput = { apiUrl:string; intervalMinutes:number; startAtLogin:boolean };
export type DesktopApi = {
  status():Promise<AppStatus>; saveSettings(settings:SettingsInput):Promise<AppStatus>;
  connect(password:string):Promise<AppStatus>; disconnect():Promise<AppStatus>;
  addProfile(username:string):Promise<AppStatus>; removeProfile(username:string):Promise<AppStatus>;
  sync(username?:string):Promise<AppStatus>; copyUrl(username:string):Promise<void>; openFeed(username:string):Promise<void>;
  checkUpdate():Promise<AppStatus>; installUpdate():Promise<void>; onStatus(callback:(status:AppStatus)=>void):()=>void;
};
export function normalizeUsername(value:string):string {
  const name=value.trim().replace(/^@/,"").toLowerCase();
  if(!/^[a-z0-9._]{1,30}$/.test(name))throw new Error("Enter a valid profile username");
  return name;
}
export function validateApiUrl(value:string):string {
  const url=new URL(value);
  const local=["localhost","127.0.0.1","[::1]"].includes(url.hostname);
  if((url.protocol!=="https:"&&!(local&&url.protocol==="http:"))||url.username||url.password||url.search||url.hash||url.pathname!=="/")throw new Error("Use an HTTPS server URL (HTTP is allowed only for localhost)");
  return url.origin;
}
export function nextSyncAt(intervalMinutes:number,lastAttempt:number|null,now=Date.now()):number|null {
  if(intervalMinutes===0)return null;
  if(lastAttempt===null)return now;
  return Math.max(now,(lastAttempt||0)+intervalMinutes*60_000);
}
