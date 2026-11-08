import {getStore} from "@netlify/blobs";
const ok=id=>/^[a-z0-9]{6,60}$/.test(id||"");
const R=(body,c=200)=>new Response(typeof body==="string"?body:JSON.stringify(body),{status:c,headers:{"content-type":"application/json","cache-control":"no-store"}});
const authorized=req=>{
  const expected=process.env.QUIZMON_ADMIN_KEY||"";
  const got=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  return !!expected && got.length===expected.length && got===expected;
};
async function admin(req,st){
  if(!authorized(req))return R({error:"Unauthorized"},401);
  if(req.method==="GET"){
    const users=[];let cursor;
    do{
      const page=await st.list({prefix:"",...(cursor?{cursor}:{}),limit:1000});
      for(const b of page.blobs||[]){
        if(!b.key||b.key.startsWith("r-")||!ok(b.key))continue;
        const raw=await st.get(b.key);
        if(!raw)continue;
        try{const data=JSON.parse(raw);if(data&&data.n)users.push({id:b.key,data})}catch{}
      }
      cursor=page.cursor||undefined;
    }while(cursor);
    return R({users});
  }
  if(req.method==="POST"){
    let j;try{j=await req.json()}catch{return R({error:"Invalid JSON"},400)}
    if(!ok(j.id))return R({error:"Invalid record id"},400);
    if(j.action==="update"){
      if(!j.data||typeof j.data!=="object")return R({error:"Missing account data"},400);
      const raw=JSON.stringify(j.data);if(raw.length>500000)return R({error:"Record too large"},413);
      await st.set(j.id,raw);return R({ok:true});
    }
    if(j.action==="delete"){
      await st.delete(j.id);
      if(j.recoveryId&&ok(j.recoveryId))await st.delete("r-"+j.recoveryId);
      return R({ok:true});
    }
    return R({error:"Unknown admin action"},400);
  }
  return R({error:"Method not allowed"},405);
}
export default async req=>{
  const st=getStore("quizmon-saves");
  const u=new URL(req.url);
  if(u.searchParams.get("admin")==="1")return admin(req,st);
  if(req.method==="GET"){
    const rid=u.searchParams.get("rec"),id=u.searchParams.get("id");
    if(rid){if(!ok(rid))return R("{}",400);const r=await st.get("r-"+rid,{type:"json"});return r?R({q:r.q}):R("{}",404)}
    if(!ok(id))return R("{}",400);const d=await st.get(id);return d?new Response(d,{headers:{"content-type":"application/json","cache-control":"no-store"}}):R("{}",404);
  }
  if(req.method==="POST"){
    const t=await req.text();if(t.length>500000)return R("{}",413);
    let j;try{j=JSON.parse(t)}catch{return R("{}",400)}
    if(!ok(j.id))return R("{}",400);
    if(j.kind==="rec"){
      if(!ok(j.key)||!j.q||!j.ah)return R("{}",400);
      const old=await st.get("r-"+j.id,{type:"json"});
      if(old&&old.ah!==j.ah&&old.ah!==j.prev)return R("{}",403);
      await st.setJSON("r-"+j.id,{q:String(j.q).slice(0,80),ah:String(j.ah),key:j.key,f:old?old.f||0:0,t:old?old.t||0:0});return R("{}");
    }
    if(j.kind==="recover"){
      const r=await st.get("r-"+j.id,{type:"json"});if(!r)return R("{}",404);
      if((r.f||0)>=8&&Date.now()-(r.t||0)<900000)return R("{}",429);
      if(r.ah!==j.ah){r.f=(r.f||0)+1;r.t=Date.now();await st.setJSON("r-"+j.id,r);return R("{}",403)}
      r.f=0;await st.setJSON("r-"+j.id,r);const d=await st.get(r.key);return d?R({data:JSON.parse(d)}):R("{}",404);
    }
    if(!j.data)return R("{}",400);await st.set(j.id,JSON.stringify(j.data));return R("{}");
  }
  return R("{}",405);
};
