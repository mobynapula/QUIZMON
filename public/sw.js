const C='quizmon-v17-audio-v18',CSS="https://fonts.googleapis.com/css2?family=DotGothic16&family=Pixelify+Sans:wght@400..700&display=swap";
async function pre(c){try{const r=await fetch(CSS),t=await r.clone().text();await c.put(CSS,r);await Promise.all([...t.matchAll(/url\(([^)]+)\)/g)].map(m=>fetch(m[1]).then(x=>c.put(m[1],x)).catch(()=>{})))}catch(e){}}
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(async c=>{await c.addAll(['./','./index.html']).catch(()=>{});await pre(c)}));self.skipWaiting()});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))).then(()=>clients.claim())));
self.addEventListener('fetch',e=>{const r=e.request,u=new URL(r.url);if(r.method!=='GET'||u.pathname.startsWith('/.netlify/'))return;
 if(/fonts\.(googleapis|gstatic)\.com$/.test(u.host)){e.respondWith(caches.open(C).then(async c=>{const h=await c.match(r);if(h)return h;const x=await fetch(r);c.put(r,x.clone());return x}));return}
 e.respondWith(fetch(r).then(x=>{const k=x.clone();caches.open(C).then(c=>c.put(r,k));return x}).catch(()=>caches.match(r).then(h=>h||caches.match('./index.html'))))});
