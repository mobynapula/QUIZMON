import {getStore} from "@netlify/blobs";
const ok=id=>/^[a-z0-9]{6,60}$/.test(id||"");
const R=(t,c=200)=>new Response(t,{status:c,headers:{"content-type":"application/json"}});
export default async (req)=>{
  const st=getStore("quizmon-saves");
  if(req.method==="GET"){const u=new URL(req.url),rid=u.searchParams.get("rec"),id=u.searchParams.get("id");
    if(rid){if(!ok(rid))return R("{}",400);const r=await st.get("r-"+rid,{type:"json"});return r?R(JSON.stringify({q:r.q})):R("{}",404)}
    if(!ok(id))return R("{}",400);const d=await st.get(id);return d?R(d):R("{}",404)}
  if(req.method==="POST"){const t=await req.text();if(t.length>500000)return R("{}",413);
    let j;try{j=JSON.parse(t)}catch(e){return R("{}",400)}
    if(!ok(j.id))return R("{}",400);
    if(j.kind==="rec"){if(!ok(j.key)||!j.q||!j.ah)return R("{}",400);
      const old=await st.get("r-"+j.id,{type:"json"});
      if(old&&old.ah!==j.ah&&old.ah!==j.prev)return R("{}",403);
      await st.setJSON("r-"+j.id,{q:String(j.q).slice(0,80),ah:String(j.ah),key:j.key,f:old?old.f||0:0,t:old?old.t||0:0});return R("{}")}
    if(j.kind==="recover"){const r=await st.get("r-"+j.id,{type:"json"});if(!r)return R("{}",404);
      if((r.f||0)>=8&&Date.now()-(r.t||0)<900000)return R("{}",429);
      if(r.ah!==j.ah){r.f=(r.f||0)+1;r.t=Date.now();await st.setJSON("r-"+j.id,r);return R("{}",403)}
      r.f=0;await st.setJSON("r-"+j.id,r);const d=await st.get(r.key);return d?R(JSON.stringify({data:JSON.parse(d)})):R("{}",404)}
    if(!j.data)return R("{}",400);await st.set(j.id,JSON.stringify(j.data));return R("{}")}
  return R("{}",405)};
