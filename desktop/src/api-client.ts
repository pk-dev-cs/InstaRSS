import { validateApiUrl } from "./shared";

export class ApiClient {
  constructor(readonly baseUrl:string,readonly token:string){validateApiUrl(baseUrl);}
  async request<T>(path:string,method="GET",body?:unknown):Promise<T>{
    const response=await fetch(`${this.baseUrl}${path}`,{
      method,headers:{Authorization:`Bearer ${this.token}`,"content-type":"application/json"},
      body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(60000),redirect:"error",
    });
    if(!response.ok){const json=await response.json().catch(()=>null);throw new Error(json?.error||`Server returned HTTP ${response.status}`);}
    if(response.status===204)return undefined as T;
    if(response.headers.get("content-type")?.includes("application/json"))return response.json();
    return undefined as T;
  }
  static async pair(baseUrl:string,password:string):Promise<{id:string;token:string}>{
    validateApiUrl(baseUrl);
    const response=await fetch(`${baseUrl}/api/devices`,{method:"POST",headers:{Authorization:`Basic ${Buffer.from(`admin:${password}`).toString("base64")}`,"content-type":"application/json"},body:JSON.stringify({label:"InstaRSS Windows desktop"}),signal:AbortSignal.timeout(20000),redirect:"error"});
    if(!response.ok){const json=await response.json().catch(()=>null);throw new Error(json?.error||`Connection failed: HTTP ${response.status}`);}
    const value=await response.json();
    if(typeof value.id!=="string"||typeof value.token!=="string"||value.token.length<32)throw new Error("Invalid pairing response");
    return value;
  }
}
