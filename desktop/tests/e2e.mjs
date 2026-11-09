import { _electron } from "playwright";
import electronPath from "electron";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

const repository=path.resolve("..");
const root=path.join(repository,"data");
await fs.mkdir(root,{recursive:true});
const directory=await fs.mkdtemp(path.join(root,"desktop-integration-"));
await fs.mkdir(path.join(directory,"desktop"));
const port=await new Promise(resolve=>{const server=createServer();server.listen(0,"127.0.0.1",()=>{const port=server.address().port;server.close(()=>resolve(port));});});
const baseUrl=`http://127.0.0.1:${port}`;
const binary=path.join(repository,"api/target/debug",process.platform==="win32"?"instarss-api.exe":"instarss-api");
const server=spawn(binary,[],{env:{...process.env,PORT:String(port),APP_BASE_URL:baseUrl,DATA_DIR:path.join(directory,"api"),ADMIN_PASSWORD:"fixture-password",API_TOKEN:"fixture-maintenance"},stdio:["ignore","ignore","pipe"]});
let serverError="";server.stderr.on("data",chunk=>{serverError+=chunk;});
const launch=()=>_electron.launch({executablePath:electronPath,args:[process.cwd()],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,INSTARSS_TEST_DATA_DIR:path.join(directory,"desktop")},timeout:30000});
let application;
try{
  for(let attempt=0;;attempt++){
    try{const response=await fetch(`${baseUrl}/api/health`);if(response.ok)break;}catch{}
    if(attempt>=50)throw new Error(`Rust API did not start: ${serverError}`);
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  application=await launch();
  const page=await application.firstWindow();
  await page.getByRole("heading",{name:"Follow posts. Keep your feed."}).waitFor();
  await page.getByRole("button",{name:"Settings",exact:true}).click();
  assert.equal(await page.getByLabel("Username",{exact:true}).isVisible(),false);
  assert.equal(await page.getByRole("button",{name:"Check for updates",exact:true}).isVisible(),true);
  await page.getByLabel("API URL",{exact:true}).fill(baseUrl);
  await page.getByLabel("Sync interval (minutes)").fill("0");
  await page.getByLabel("Administrator password").fill("fixture-password");
  await page.getByRole("button",{name:"Connect device",exact:true}).click();
  await page.getByText("API connected",{exact:true}).waitFor();
  await page.getByRole("button",{name:"Feeds",exact:true}).click();
  assert.equal(await page.getByLabel("API URL",{exact:true}).isVisible(),false);
  assert.equal(await page.getByRole("button",{name:"Check for updates",exact:true}).isVisible(),false);
  await page.getByLabel("Username",{exact:true}).fill("example");
  await page.getByRole("button",{name:"Add profile",exact:false}).click();
  await page.getByRole("heading",{name:"@example",exact:true}).waitFor();
  await application.evaluate(async({session})=>{
    await session.fromPartition("provider-public").protocol.handle("https",request=>{
      const html=new URL(request.url).pathname==="/example/"?'<a href="https://www.instagram.com/example/p/fixture1/">Post</a>':`<time datetime="${new Date().toISOString()}"></time><meta property="og:image" content="https://fixture.cdninstagram.com/image.png"><meta property="og:description" content="Desktop fixture &amp; RSS">`;
      return new Response(html,{headers:{"content-type":"text/html"}});
    });
    const original=globalThis.fetch;
    globalThis.fetch=async(input,init)=>String(input)==="https://fixture.cdninstagram.com/image.png"?new Response(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aioAAAAASUVORK5CYII=","base64"),{headers:{"content-type":"image/png"}}):original(input,init);
  });
  await page.getByRole("button",{name:"Synchronize now",exact:true}).click();
  await page.getByText("Synchronization complete",{exact:true}).waitFor({timeout:45000});
  const status=await page.evaluate(()=>window.instarss.status());
  assert.equal(status.profiles[0].postCount,1);
  await page.getByRole("button",{name:"Copy URL",exact:true}).click();
  const copied=await application.evaluate(({clipboard})=>clipboard.readText());
  assert.equal(copied,`${baseUrl}/rss/example.xml`);
  assert.ok((await (await fetch(copied)).text()).includes("Desktop fixture &amp; RSS"));
  assert.equal((await fetch(`${baseUrl}/media/1`)).status,200);
  await page.screenshot({path:path.join(root,"desktop-feeds.png"),fullPage:true});
  await page.getByRole("button",{name:"Settings",exact:true}).click();
  await page.getByLabel("Sync interval (minutes)").fill("1440");
  await page.getByRole("button",{name:"Save settings",exact:true}).click();
  await page.waitForTimeout(250);
  assert.equal((await page.evaluate(()=>window.instarss.status())).preferences.intervalMinutes,1440);
  const stored=JSON.parse(await fs.readFile(path.join(directory,"desktop/settings.json"),"utf8"));
  assert.ok(stored.encryptedToken);
  assert.ok(!JSON.stringify(stored).includes("fixture-password"));
  await page.screenshot({path:path.join(root,"desktop-e2e.png"),fullPage:true});
  await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==="InstaRSS")?.setSize(680,720));
  await page.screenshot({path:path.join(root,"desktop-settings-narrow.png"),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==="InstaRSS")?.close());
  assert.equal(await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==="InstaRSS")?.isVisible()),false);
  await application.close();application=undefined;
  application=await launch();
  const reopened=await application.firstWindow();
  const persisted=await reopened.evaluate(()=>window.instarss.status());
  assert.equal(persisted.preferences.connected,true);
  assert.equal(persisted.preferences.intervalMinutes,1440);
  assert.equal(persisted.profiles[0].postCount,1);
  console.log("Electron → Rust → SQLite → public RSS/image, Copy URL, daily schedule, tray and restart persistence: OK");
}finally{
  if(application)await application.close();
  if(server.exitCode===null){server.kill();await once(server,"exit");}
  await fs.rm(directory,{recursive:true,force:true});
}
