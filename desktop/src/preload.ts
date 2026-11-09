import { contextBridge, ipcRenderer } from "electron";
import type { AppStatus, DesktopApi } from "./shared";

async function invoke<T>(channel:string,...args:unknown[]):Promise<T>{
  const result=await ipcRenderer.invoke(channel,...args);
  if(!result.ok)throw new Error(result.error);
  return result.value;
}
const api:DesktopApi={
  status:()=>invoke("status"),saveSettings:(v)=>invoke("settings",v),connect:(v)=>invoke("connect",v),disconnect:()=>invoke("disconnect"),
  addProfile:(v)=>invoke("add-profile",v),removeProfile:(v)=>invoke("remove-profile",v),sync:(v)=>invoke("sync",v),
  copyUrl:(v)=>invoke("copy-url",v),openFeed:(v)=>invoke("open-feed",v),checkUpdate:()=>invoke("check-update"),installUpdate:()=>invoke("install-update"),
  onStatus:(callback)=>{const listener=(_event:unknown,status:AppStatus)=>callback(status);ipcRenderer.on("status-changed",listener);return()=>ipcRenderer.removeListener("status-changed",listener);},
};
contextBridge.exposeInMainWorld("instarss",api);
