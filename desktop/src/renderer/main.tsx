import React,{useEffect,useState} from "react";
import {createRoot} from "react-dom/client";
import type {AppStatus,DesktopApi} from "../shared";
import {nextSyncAt} from "../shared";
import "./styles.css";
declare global{interface Window{instarss:DesktopApi}}

const formatDate=(value:number|null)=>value?new Date(value).toLocaleString():"Not yet";
function App(){
  const [status,setStatus]=useState<AppStatus|null>(null);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const [name,setName]=useState("");
  const [apiUrl,setApiUrl]=useState("https://instarss-api-production.up.railway.app");
  const [interval,setInterval]=useState(1440);
  const [autostart,setAutostart]=useState(false);
  const [password,setPassword]=useState("");
  const [copied,setCopied]=useState("");
  useEffect(()=>{
    void window.instarss.status().then(s=>{setStatus(s);setApiUrl(s.preferences.apiUrl);setInterval(s.preferences.intervalMinutes);setAutostart(s.preferences.startAtLogin);}).catch(e=>setError(e.message));
    return window.instarss.onStatus(setStatus);
  },[]);
  async function run(action:()=>Promise<AppStatus|void>){
    setBusy(true);setError("");
    try{const result=await action();if(result)setStatus(result);}catch(e){setError(e instanceof Error?e.message:"Operation failed");}finally{setBusy(false);}
  }
  const connected=status?.preferences.connected||false;
  const disabled=busy||!!status?.syncing;
  const save=()=>window.instarss.saveSettings({apiUrl,intervalMinutes:interval,startAtLogin:autostart});
  return <div className="page-wrap"><div className="terminal-window">
    <header className="titlebar"><strong>[ InstaRSS ]</strong><span className="window-marks">desktop / v{status?.version||"…"}</span></header>
    <main>
      <div className="path-line"><span>~/pk-dev/feeds</span><span>{connected?"Rust API connected":"Device not connected"}</span></div>
      <section className="hero">
        <div><h1>Follow posts.<br/><em>Keep your feed.</em></h1><p>Fetch on your computer. Keep your RSS online.<br/>Posts and photos stay available for 30 days.</p></div>
        <form onSubmit={event=>{event.preventDefault();void run(async()=>{const value=await window.instarss.addProfile(name);setName("");return value;});}}>
          <label htmlFor="username">Username</label><div className="input-row"><span>@</span><input id="username" value={name} onChange={event=>setName(event.target.value)} placeholder="username" pattern="[A-Za-z0-9._]{1,30}" required disabled={!connected||disabled}/><button disabled={!connected||disabled}>Add profile →</button></div><small>Public photo-sharing accounts</small>
        </form>
      </section>
      {error&&<p className="notice error" role="alert">{error}</p>}
      <details className="settings" open={!connected||undefined}>
        <summary>Connection &amp; synchronization</summary>
        <form onSubmit={event=>{event.preventDefault();void run(async()=>{await save();if(!connected){try{return await window.instarss.connect(password);}finally{setPassword("");}}return window.instarss.status();});}}>
          <div className="settings-grid"><label>Rust API URL<input type="url" value={apiUrl} onChange={event=>setApiUrl(event.target.value)} required disabled={disabled}/></label>
          <label>Sync interval (minutes)<input type="number" value={interval} min={0} max={10080} onChange={event=>setInterval(Number(event.target.value))} required disabled={disabled}/><small>1440 = once a day · 0 = manual only · minimum 15</small></label>
          {!connected&&<label>Administrator password<input type="password" autoComplete="current-password" value={password} onChange={event=>setPassword(event.target.value)} required disabled={disabled}/><small>Used once to pair this device. The password is not stored.</small></label>}</div>
          <div className="settings-actions"><label className="checkbox"><input type="checkbox" checked={autostart} onChange={event=>setAutostart(event.target.checked)} disabled={disabled}/> Start InstaRSS when I sign in to Windows</label><button disabled={disabled}>{connected?"Save settings":"Connect device"}</button>{connected&&<button className="secondary" type="button" disabled={disabled} onClick={()=>void run(()=>window.instarss.disconnect())}>Disconnect</button>}</div>
        </form>
        <p className="muted">Closing the window keeps InstaRSS in the system tray. Synchronization runs while the application and computer are on; overdue work resumes after wake or restart.</p>
      </details>
      <section className="list"><div className="section-head"><h2>Your feeds</h2><button className="secondary" disabled={!connected||disabled} onClick={()=>void run(()=>window.instarss.sync())}>{status?.syncing?"Synchronizing…":"Synchronize now"}</button></div>
      {!status?<div className="empty">Loading…</div>:!status.profiles.length?<div className="empty">{connected?"No profiles yet. Add your first profile above.":"Connect to your Rust API to manage RSS feeds."}</div>:<div className="cards">{status.profiles.map(profile=><article className="card" key={profile.id}><div className="avatar">@</div><div className="card-main"><h3>@{profile.username}</h3><p>{profile.postCount} posts · Last update: {formatDate(profile.lastSuccessAt)}</p>{profile.lastError&&<p className="error">{profile.lastError}</p>}</div><div className="rss-links"><button className="secondary" disabled={disabled} onClick={()=>void run(()=>window.instarss.sync(profile.username))}>Refresh</button><button className="link-button" onClick={()=>void run(()=>window.instarss.openFeed(profile.username))}>Open RSS ↗</button><button className="secondary" onClick={()=>void run(async()=>{await window.instarss.copyUrl(profile.username);setCopied(profile.username);})}>{copied===profile.username?"Copied ✓":"Copy URL"}</button><button className="link-button muted" disabled={disabled} onClick={()=>{if(confirm(`Remove @${profile.username} and its stored posts and photos?`))void run(()=>window.instarss.removeProfile(profile.username));}}>Remove</button></div></article>)}</div>}
      </section>
      <section className="sync-summary"><p aria-live="polite">{status?.progress||"Starting…"}</p><p className="muted">Last attempt: {formatDate(status?.preferences.lastAttempt||null)} · Last success: {formatDate(status?.preferences.lastSuccess||null)}</p><p className="muted">Next scheduled: {!connected?"Connect first":status?.preferences.intervalMinutes===0?"Manual only":status?formatDate(nextSyncAt(status.preferences.intervalMinutes,status.preferences.lastAttempt)):"…"}</p>{status?.preferences.lastError&&<p className="error">{status.preferences.lastError}</p>}</section>
      <section className="updates"><span aria-live="polite">{status?.update.message}</span><div><button className="secondary" disabled={disabled||["checking","downloading"].includes(status?.update.state||"")} onClick={()=>void run(()=>window.instarss.checkUpdate())}>Check for updates</button>{status?.update.state==="ready"&&<button disabled={disabled} onClick={()=>void run(()=>window.instarss.installUpdate())}>Restart &amp; update</button>}</div></section>
    </main><div className="statusbar"><span className="status-mode">RSS</span><span className="status-count">{status?.profiles.length||0} {status?.profiles.length===1?"profile":"profiles"}</span></div>
  </div><footer><span>Public posts in your RSS reader</span><span>30-day retention</span></footer></div>;
}
createRoot(document.getElementById("root")!).render(<App/>);
