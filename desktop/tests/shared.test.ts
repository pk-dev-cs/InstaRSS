import test from "node:test";
import assert from "node:assert/strict";
import {nextSyncAt,normalizeUsername,validateApiUrl} from "../src/shared";

test("RSS server URL rejects credentials and insecure remote endpoints",()=>{
  assert.equal(validateApiUrl("https://feeds.example/"),"https://feeds.example");
  assert.equal(validateApiUrl("http://localhost:3100"),"http://localhost:3100");
  for(const url of ["http://feeds.example","https://user:password@feeds.example","https://feeds.example/path","file:///data"]){assert.throws(()=>validateApiUrl(url));}
});
test("scheduler catches up after sleep and supports manual mode",()=>{
  assert.equal(nextSyncAt(0,1000,2000),null);
  assert.equal(nextSyncAt(15,1000,2000),901000);
  assert.equal(nextSyncAt(15,1000,1_000_000),1_000_000);
  assert.equal(nextSyncAt(1440,null,2000),2000);
});
test("profile names cannot become paths or executable input",()=>{
  assert.equal(normalizeUsername(" @Example.Profile "),"example.profile");
  for(const value of ["../profile","name/path","name?query",""]){assert.throws(()=>normalizeUsername(value));}
});
