import { VelopackApp, UpdateManager, GithubSource, type UpdateInfo } from "velopack";
VelopackApp.build().run();

import { app, BrowserWindow, clipboard, ipcMain, Menu, nativeImage, powerMonitor, shell, Tray } from "electron";
import path from "node:path";
import { Store } from "./store";
import { ApiClient } from "./api-client";
import { fetchProfile } from "./fetcher";
import { nextSyncAt, normalizeUsername, type AppStatus, type Profile, type SettingsInput } from "./shared";

let window:BrowserWindow|null=null;
let tray:Tray|null=null;
let store:Store;
let profiles:Profile[]=[];
let syncing=false;
let progress="Ready";
let quitting=false;
let timer:NodeJS.Timeout|undefined;
let updateState={state:"idle",message:"Updates are checked automatically"};
let updateManager:UpdateManager|undefined;
let pendingUpdate:UpdateInfo|undefined;

if(!app.isPackaged&&process.env.INSTARSS_TEST_DATA_DIR)app.setPath("userData",path.resolve(process.env.INSTARSS_TEST_DATA_DIR));

function status():AppStatus{return{preferences:store.preferences(),profiles,syncing,progress,version:app.getVersion(),update:updateState};}
function broadcast(){if(window&&!window.isDestroyed())window.webContents.send("status-changed",status());}
function client(){const token=store.token();if(!token)throw new Error("Connect this device to your Rust API first");return new ApiClient(store.preferences().apiUrl,token);}
async function refresh(){if(store.preferences().connected)profiles=await client().request<Profile[]>("/api/profiles");else profiles=[];broadcast();}
function schedule(){
  if(timer)clearTimeout(timer);
  if(!store.preferences().connected||syncing)return;
  const next=nextSyncAt(store.preferences().intervalMinutes,store.preferences().lastAttempt);
  if(next!==null)timer=setTimeout(()=>{void synchronize().catch(()=>{});},Math.min(Math.max(next-Date.now(),1000),2_147_483_647));
}
async function synchronize(username?:string):Promise<AppStatus>{
  if(syncing)throw new Error("A synchronization is already running");
  const api=client();syncing=true;if(!username)store.attempt();progress="Loading profiles";broadcast();
  const failures:string[]=[];
  try{
    await refresh();
    const selected=username?profiles.filter(p=>p.username===normalizeUsername(username)):profiles;
    if(username&&!selected.length)throw new Error("Profile not found");
    for(const profile of selected){
      try{
        await fetchProfile(profile.username,async post=>{await api.request(`/api/profiles/${profile.username}/posts`,"POST",post);},message=>{progress=message;broadcast();});
        await api.request(`/api/profiles/${profile.username}/status`,"POST",{error:null});
      }catch(error){const message=error instanceof Error?error.message:"Synchronization failed";failures.push(`@${profile.username}: ${message}`);await api.request(`/api/profiles/${profile.username}/status`,"POST",{error:message}).catch(()=>{});}
    }
    const error=failures.length?failures.join("; "):null;store.finish(error);progress=error?"Completed with errors":"Synchronization complete";
  }catch(error){store.finish(error instanceof Error?error.message:"Synchronization failed");progress="Synchronization failed";}
  finally{syncing=false;await refresh().catch(()=>{});broadcast();schedule();}
  return status();
}
async function checkUpdate():Promise<AppStatus>{
  if(!app.isPackaged){updateState={state:"development",message:"Automatic updates are available in the installed application"};broadcast();return status();}
  if(updateState.state==="checking"||updateState.state==="downloading")return status();
  try{
    updateState={state:"checking",message:"Checking for updates…"};broadcast();
    updateManager ??= new UpdateManager(new GithubSource("https://github.com/pk-dev-cs/InstaRSS",undefined,false));
    const update=await updateManager.checkForUpdatesAsync();
    if(!update){updateState={state:"current",message:"You have the latest version"};}
    else{
      updateState={state:"downloading",message:"Downloading update…"};broadcast();
      await updateManager.downloadUpdateAsync(update,percent=>{updateState={state:"downloading",message:`Downloading update: ${percent}%`};broadcast();});
      pendingUpdate=update;updateState={state:"ready",message:"Update ready — restart to install"};
    }
  }catch{updateState={state:"error",message:"Could not check for updates. Try again later."};}
  broadcast();return status();
}
function createWindow(){
  if(window&&!window.isDestroyed()){window.show();window.focus();return;}
  window=new BrowserWindow({width:1280,height:960,minWidth:620,minHeight:600,titleBarStyle:"hidden",titleBarOverlay:{color:"#1d2528",symbolColor:"#e6ebe7",height:44},backgroundColor:"#0c1012",title:"InstaRSS",icon:path.join(app.getAppPath(),"assets/icon.png"),webPreferences:{preload:path.join(__dirname,"preload.cjs"),nodeIntegration:false,contextIsolation:true,sandbox:true}});
  window.removeMenu();window.webContents.setWindowOpenHandler(()=>({action:"deny"}));
  window.webContents.on("will-navigate",event=>event.preventDefault());
  window.on("close",event=>{if(!quitting){event.preventDefault();window?.hide();}});
  void window.loadFile(path.join(__dirname,"renderer/index.html"));
}
function registerHandlers(){
  function handle(name:string,action:(...args:any[])=>unknown){
    ipcMain.handle(name,async(event,...args)=>{
      if(!window||event.sender.id!==window.webContents.id||event.senderFrame!==window.webContents.mainFrame)return{ok:false,error:"Unauthorized request"};
      try{return{ok:true,value:await action(...args)};}catch(error){return{ok:false,error:error instanceof Error?error.message:"Operation failed"};}
    });
  }
  handle("status",async()=>{await refresh().catch(error=>{progress=error.message;});return status();});
  handle("settings",async(input:SettingsInput)=>{if(syncing)throw new Error("Wait for synchronization to finish");if(!input||typeof input.apiUrl!=="string")throw new Error("Invalid settings");store.update(input);if(app.isPackaged)app.setLoginItemSettings({openAtLogin:input.startAtLogin});await refresh();schedule();return status();});
  handle("connect",async(password:string)=>{if(typeof password!=="string"||password.length>1024)throw new Error("Invalid password");if(syncing)throw new Error("Wait for synchronization to finish");const result=await ApiClient.pair(store.preferences().apiUrl,password);store.connect(result.id,result.token);await refresh();schedule();return status();});
  handle("disconnect",async()=>{if(syncing)throw new Error("Wait for synchronization to finish");const id=store.preferences().deviceId;if(id)await client().request(`/api/devices/${encodeURIComponent(id)}`,"DELETE");store.disconnect();profiles=[];schedule();return status();});
  handle("add-profile",async(name:string)=>{if(typeof name!=="string")throw new Error("Invalid username");await client().request("/api/profiles","POST",{username:normalizeUsername(name)});await refresh();return status();});
  handle("remove-profile",async(name:string)=>{if(syncing)throw new Error("Wait for synchronization to finish");if(typeof name!=="string")throw new Error("Invalid username");await client().request(`/api/profiles/${normalizeUsername(name)}`,"DELETE");await refresh();return status();});
  handle("sync",(name?:string)=>{if(name!==undefined&&typeof name!=="string")throw new Error("Invalid username");return synchronize(name);});
  const feedUrl=(name:string)=>`${store.preferences().apiUrl}/rss/${normalizeUsername(name)}.xml`;
  handle("copy-url",(name:string)=>{if(typeof name!=="string")throw new Error("Invalid username");clipboard.writeText(feedUrl(name));});
  handle("open-feed",async(name:string)=>{if(typeof name!=="string")throw new Error("Invalid username");await shell.openExternal(feedUrl(name));});
  handle("check-update",checkUpdate);
  handle("install-update",()=>{if(syncing)throw new Error("Wait for synchronization to finish");if(!pendingUpdate||!updateManager)throw new Error("No update is ready");updateManager.waitExitThenApplyUpdate(pendingUpdate,false,true);app.quit();});
}

if(!app.requestSingleInstanceLock())app.quit();
else{
  app.on("second-instance",()=>createWindow());
  app.on("before-quit",()=>{quitting=true;if(timer)clearTimeout(timer);});
  app.on("window-all-closed",()=>{});
  void app.whenReady().then(async()=>{
    store=new Store();registerHandlers();createWindow();
    tray=new Tray(nativeImage.createFromPath(path.join(app.getAppPath(),"assets/icon.png")));
    tray.setToolTip("InstaRSS — synchronization runs in the background");
    tray.setContextMenu(Menu.buildFromTemplate([{label:"Open InstaRSS",click:createWindow},{label:"Synchronize now",click:()=>{void synchronize().catch(()=>{});}},{type:"separator"},{label:"Quit",click:()=>app.quit()}]));
    tray.on("double-click",createWindow);
    powerMonitor.on("resume",schedule);
    await refresh().catch(error=>{progress=error.message;broadcast();});schedule();
    setTimeout(()=>void checkUpdate(),5000);
    setInterval(()=>void checkUpdate(),6*3600_000).unref();
  });
}
