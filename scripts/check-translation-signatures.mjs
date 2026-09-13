import { readFileSync } from 'node:fs';
import { createHash,createHmac } from 'node:crypto';
import assert from 'node:assert/strict';
const hash=(type,text)=>createHash(type).update(text).digest('hex');
const hmac=(key,text)=>createHmac('sha256',key).update(text).digest();
for(const v of JSON.parse(readFileSync('build/native-check/translation-vectors.json','utf8'))){
 if(v.provider==='tencent'){
   const timestamp=v.headers['X-TC-Timestamp'],date=new Date(Number(timestamp)*1000).toISOString().slice(0,10),scope=date+'/tmt/tc3_request';
   const canonical=['POST','/','','content-type:'+v.type+'\nhost:tmt.tencentcloudapi.com\n','content-type;host',hash('sha256',v.body)].join('\n');
   const signature=hmac(hmac(hmac(hmac('TC3fixture-secret',date),'tmt'),'tc3_request'),['TC3-HMAC-SHA256',timestamp,scope,hash('sha256',canonical)].join('\n')).toString('hex');
   assert.equal(v.headers.Authorization,`TC3-HMAC-SHA256 Credential=fixture-id/${scope}, SignedHeaders=content-type;host, Signature=${signature}`);
   assert.equal(JSON.parse(v.body).SourceText,v.text);assert.equal(v.headers['X-TC-Action'],'TextTranslate');
 }else{
   const p=new URLSearchParams(v.body);assert.equal(p.get('q'),v.text);const chars=Array.from(v.text),input=chars.length>20?chars.slice(0,10).join('')+chars.length+chars.slice(-10).join(''):v.text;
   assert.equal(p.get('sign'),v.provider==='baidu'?hash('md5','fixture-id'+v.text+'fixture-saltfixture-secret'):hash('sha256','fixture-id'+input+'fixture-salt1700000000fixture-secret'));
 }
}
console.log('All three native signatures match independent Node crypto calculations.');
