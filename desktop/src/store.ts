import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";
import { validateApiUrl, type Preferences, type SettingsInput } from "./shared";

type Stored=Omit<Preferences,"connected">&{encryptedToken:string|null};
export class Store {
  private value:Stored;
  private filename=path.join(app.getPath("userData"),"settings.json");
  constructor(){
    const defaults:Stored={apiUrl:"http://127.0.0.1:3102",intervalMinutes:1440,startAtLogin:false,lastAttempt:null,lastSuccess:null,lastError:null,deviceId:null,encryptedToken:null};
    let loaded:Partial<Stored>={};
    try{loaded=JSON.parse(fs.readFileSync(this.filename,"utf8"));}catch{}
    this.value={...defaults,...loaded};
    try{validateApiUrl(this.value.apiUrl);}catch{this.value=defaults;}
    if(!Number.isInteger(this.value.intervalMinutes)||!(this.value.intervalMinutes===0||(this.value.intervalMinutes>=15&&this.value.intervalMinutes<=10080)))this.value.intervalMinutes=1440;
  }
  token():string|null{
    if(!this.value.encryptedToken)return null;
    if(!safeStorage.isEncryptionAvailable())throw new Error("Secure token storage is unavailable on this computer");
    try{return safeStorage.decryptString(Buffer.from(this.value.encryptedToken,"base64"));}catch{throw new Error("Reconnect this device to restore its server credentials");}
  }
  preferences():Preferences{const {encryptedToken,...preferences}=this.value;return{...preferences,connected:!!encryptedToken};}
  update(input:SettingsInput){
    const apiUrl=validateApiUrl(input.apiUrl);
    if(!Number.isInteger(input.intervalMinutes)||!(input.intervalMinutes===0||(input.intervalMinutes>=15&&input.intervalMinutes<=10080)))throw new Error("Choose manual synchronization or an interval between 15 minutes and 7 days");
    if(typeof input.startAtLogin!=="boolean")throw new Error("Invalid startup setting");
    if(apiUrl!==this.value.apiUrl){this.value.encryptedToken=null;this.value.deviceId=null;}
    this.value={...this.value,apiUrl,intervalMinutes:input.intervalMinutes,startAtLogin:input.startAtLogin};this.persist();
  }
  connect(id:string,token:string){if(!safeStorage.isEncryptionAvailable())throw new Error("Secure token storage is unavailable");this.value.deviceId=id;this.value.encryptedToken=safeStorage.encryptString(token).toString("base64");this.value.lastError=null;this.persist();}
  disconnect(){this.value.deviceId=null;this.value.encryptedToken=null;this.value.lastError=null;this.persist();}
  attempt(){this.value.lastAttempt=Date.now();this.persist();}
  finish(error:string|null){this.value.lastError=error;if(!error)this.value.lastSuccess=Date.now();this.persist();}
  private persist(){fs.mkdirSync(path.dirname(this.filename),{recursive:true});const temporary=this.filename+".tmp";fs.writeFileSync(temporary,JSON.stringify(this.value,null,2),{mode:0o600});fs.renameSync(temporary,this.filename);}
}
