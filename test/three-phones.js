// Three simulated phones against an in-memory mock of the Firebase REST + streaming API.
// Run: npm i jsdom && node test/three-phones.js   (every numbered line should read as a pass)
const {JSDOM}=require('jsdom');const fs=require('fs');
const path=require('path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const DB='https://mock.example';
const store={}; const subs=[];           // subs: {room, fn}
function getAt(parts){let n=store;for(const p of parts){if(n==null||typeof n!=='object')return null;n=n[p];}return n===undefined?null:n;}
function setAtS(parts,v){let n=store;for(let i=0;i<parts.length-1;i++){if(!n[parts[i]]||typeof n[parts[i]]!=='object')n[parts[i]]={};n=n[parts[i]];}
  if(v===null)delete n[parts[parts.length-1]];else n[parts[parts.length-1]]=v;}
function mkFetch(){return (url,opts={})=>{const parts=url.slice(DB.length).replace(/\.json$/,'').split('/').filter(Boolean);
  const m=opts.method||'GET';
  if(m==='GET')return Promise.resolve({ok:true,json:()=>Promise.resolve(JSON.parse(JSON.stringify(getAt(parts))))});
  const body=JSON.parse(opts.body);setAtS(parts,body);
  const room=parts[1];const path='/'+parts.slice(2).join('/');
  const sorted=v=>v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])])):v;
  setTimeout(()=>subs.filter(s=>s.room===room).forEach(s=>s.fn('put',{path,data:sorted(JSON.parse(JSON.stringify(body)))})),30);
  return Promise.resolve({ok:true,json:()=>Promise.resolve(body)});};}
function mkES(){return class{constructor(url){this.l={};const room=url.slice(DB.length).replace(/\.json$/,'').split('/').filter(Boolean)[1];
  this.sub={room,fn:(t,d)=>(this.l[t]||[]).forEach(f=>f({data:JSON.stringify(d)}))};subs.push(this.sub);
  setTimeout(()=>{this.onopen&&this.onopen();this.sub.fn('put',{path:'/',data:JSON.parse(JSON.stringify(getAt(['rooms',room])))});},5);}
  addEventListener(t,f){(this.l[t]=this.l[t]||[]).push(f);}close(){const i=subs.indexOf(this.sub);if(i>=0)subs.splice(i,1);}};}
function phone(hash){return new JSDOM(html,{runScripts:'dangerously',url:'https://host.example/things/'+(hash||''),beforeParse(w){
  w.THINGS_DB_URL=DB;w.fetch=mkFetch();w.EventSource=mkES();}});}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const sub=(w,id)=>w.document.getElementById(id).dispatchEvent(new w.Event('submit',{cancelable:true}));
const txt=(d,sel)=>[...d.querySelectorAll(sel)].map(b=>b.textContent+(b.getAttribute('aria-pressed')==='true'?'*':''));
(async()=>{
  const A=phone();const a=A.window.document;await wait(20);
  console.log('1 lobby shown:',!a.getElementById('lobby').hidden,'game hidden:',a.getElementById('game').hidden);
  a.getElementById('codeInput').value='zzzzzz';sub(A.window,'joinForm');await wait(20);
  console.log('2 bad code msg:',a.getElementById('lobbyMsg').textContent);
  a.getElementById('startBtn').click();await wait(40);
  const code=a.getElementById('codeLabel').textContent;
  console.log('3 started code:',code,/^[A-Z2-9]{6}$/.test(code),'| hash:',A.window.location.hash,'| status:',a.getElementById('status').textContent);
  const B=phone('#'+code);const b=B.window.document;await wait(40);
  console.log('4 B joined via link:',!b.getElementById('game').hidden,b.getElementById('codeLabel').textContent===code);
  for(const n of ['Chris','Kristy','Olivia']){a.getElementById('nameInput').value=n;sub(A.window,'addForm');await wait(3);}
  a.getElementById('nextBtn').click();a.getElementById('nextBtn').click();
  a.getElementById('answerInput').value='Gravy <i>boat</i>';sub(A.window,'answerForm');await wait(3);
  a.getElementById('answerInput').value='The dog';sub(A.window,'answerForm');
  await wait(120);
  console.log('5 B sees round:',b.getElementById('roundNum').textContent,'| topic:',b.getElementById('topic').textContent);
  console.log('  B answers:',txt(b,'#answerList button').join(' | '),b.getElementById('answerCount').textContent);
  console.log('  B roster:',txt(b,'#rosterList button').join(', '),b.getElementById('rosterCount').textContent);
  console.log(JSON.stringify(store.rooms[code].answers), '| A:', txt(a,'#answerList button').join(' / '));
  b.querySelectorAll('#answerList button')[1].click();
  b.querySelectorAll('#rosterList button')[2].click();
  b.querySelectorAll('#playerList li')[0].querySelectorAll('button.plus')[1].click();
  b.querySelectorAll('#playerList li')[1].querySelectorAll('button.plus')[0].click();
  await wait(120);
  console.log('6 A answers:',txt(a,'#answerList button').join(' | '),a.getElementById('answerCount').textContent);
  console.log('  A roster:',txt(a,'#rosterList button').join(', '),a.getElementById('rosterCount').textContent);
  console.log('  A scores:',[...a.querySelectorAll('#playerList li')].map(li=>li.querySelector('.pname').textContent+'='+li.querySelector('.pscore').textContent+(li.className==='lead'?'(lead)':'')).join(', '));
  // rapid taps: five +1 on Olivia from A while echoes lag, and B taps +1 on Olivia too
  for(let i=0;i<5;i++){a.querySelectorAll('#playerList li')[2].querySelectorAll('button.plus')[0].click();await wait(4);}
  await wait(150);
  console.log('6b rapid +1 x5 -> A:',a.querySelectorAll('#playerList .pscore')[2].textContent,'B:',b.querySelectorAll('#playerList .pscore')[2].textContent);
  // rapid Next x3 then immediate answer lands in the right round
  const r0=+a.getElementById('roundNum').textContent;
  for(let i=0;i<3;i++){a.getElementById('nextBtn').click();await wait(4);}
  a.getElementById('answerInput').value='late answer';sub(A.window,'answerForm');
  await wait(20);const mid=a.getElementById('roundNum').textContent;await wait(150);
  console.log('6c rapid next from',r0,'-> A mid:',mid,'A end:',a.getElementById('roundNum').textContent,'B:',b.getElementById('roundNum').textContent,'| answer rounds:',Object.keys(store.rooms[code].answers).join(','),'| B sees it:',txt(b,'#answerList button').join('/'));
  // next round resets "out"; remove a player; zero scores
  a.getElementById('nextBtn').click();await wait(120);
  console.log('7 round',b.getElementById('roundNum').textContent,'roster:',txt(b,'#rosterList button').join(', '),'| answers:',b.querySelectorAll('#answerList button').length);
  a.getElementById('editBtn').click();a.querySelectorAll('#playerList li')[1].querySelector('button.remove').click();await wait(120);
  const z=b.getElementById('zeroBtn');z.click();z.click();await wait(150);
  console.log('8 after remove+zero, A scores:',[...a.querySelectorAll('#playerList li')].map(li=>li.querySelector('.pname').textContent+'='+li.querySelector('.pscore').textContent).join(', '));
  // late joiner C by typing code lowercase; leave
  const C=phone();const c=C.window.document;await wait(20);
  c.getElementById('codeInput').value=code.toLowerCase();sub(C.window,'joinForm');await wait(80);
  console.log('9 C joined:',!c.getElementById('game').hidden,'round',c.getElementById('roundNum').textContent,'players',c.querySelectorAll('#playerList li').length);
  c.getElementById('leaveBtn').click();
  console.log('10 C left -> lobby:',!c.getElementById('lobby').hidden,'| subs left:',subs.length);
  console.log('store keys:',Object.keys(store.rooms[code]).join(','),'| any <i> elements injected:',a.querySelectorAll('#answerList i').length+b.querySelectorAll('#answerList i').length);
  // unconfigured page
  const U=new JSDOM(html,{runScripts:'dangerously',url:'https://host.example/'});await wait(10);
  console.log('11 unconfigured shows setup:',!U.window.document.getElementById('setup').hidden);
  process.exit(0);
})();
