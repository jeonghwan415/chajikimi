// Code.gs를 구글 없이 돌리기 위한 가짜 환경 (테스트 전용)
const fs=require('fs'),crypto=require('crypto');
module.exports=function(){
  const sheets={},props={};let mail=null;
  function mk(){const rows=[];return {rows,appendRow:r=>rows.push(r.slice()),setFrozenRows(){},getLastRow:()=>rows.length,
    getRange(r,c,n,w){n=n||1;w=w||1;return {getValues:()=>rows.slice(r-1,r-1+n).map(x=>{const y=x.slice(c-1,c-1+w);while(y.length<w)y.push('');return y}),getValue:()=>(rows[r-1]||[])[c-1]||'',setValues:v=>{v.forEach((x,i)=>{rows[r-1+i]=x.slice()})}}},
    deleteRow:r=>rows.splice(r-1,1)}}
  const ss={getSheetByName:n=>sheets[n]||null,insertSheet:n=>sheets[n]=mk(),getId:()=>'SS1',getUrl:()=>'https://example.invalid/ss'};
  const g={SpreadsheetApp:{create:()=>ss,openById:()=>ss},
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>k in props?props[k]:null,setProperty:(k,v)=>{props[k]=String(v)},deleteProperty:k=>{delete props[k]}})},
    Utilities:{getUuid:()=>'salt-1',computeDigest:(a,s)=>[...crypto.createHash('sha256').update(s).digest()],base64Encode:b=>Buffer.from(b).toString('base64'),DigestAlgorithm:{SHA_256:1},Charset:{UTF_8:1}},
    LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},MailApp:{sendEmail:(to,s,b)=>{mail={to,s,b}}},Session:{getEffectiveUser:()=>({getEmail:()=>'owner@example.com'})},
    HtmlService:{createHtmlOutput:h=>({setTitle(){return this},addMetaTag(){return this},html:h})},ScriptApp:{},Logger:{log(){}}};
  const code=fs.readFileSync(__dirname+'/build/Code.gs','utf8');
  const api=new Function(...Object.keys(g),code+';return {api,sendReminder,readAll_,reminderText_,doGet};')(...Object.values(g));
  return {api,sheets,props,getMail:()=>mail};
};
