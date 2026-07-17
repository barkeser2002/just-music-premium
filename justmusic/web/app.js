/* ===== Just Music — web UI mantığı ===== */
"use strict";

const THEMES = {
  green:['#1db954','#1ed760','29,185,84'], purple:['#a855f7','#c084fc','168,85,247'],
  orange:['#f97316','#fb923c','249,115,22'], pink:['#ec4899','#f472b6','236,72,153'],
  silver:['#9ca3af','#d1d5db','156,163,175'], blue:['#3b82f6','#60a5fa','59,130,246'],
  red:['#ef4444','#f87171','239,68,68'], teal:['#14b8a6','#2dd4bf','20,184,166'],
  gold:['#eab308','#facc15','234,179,8'], indigo:['#6366f1','#818cf8','99,102,241'],
  rose:['#f43f5e','#fb7185','244,63,94'], cyan:['#06b6d4','#22d3ee','6,182,212'],
};
const THEME_LABELS = {green:'🟢 Yeşil',purple:'🟣 Mor',orange:'🟠 Turuncu',pink:'🌸 Pembe',silver:'⚪ Gümüş',blue:'🔵 Mavi',red:'🔴 Kırmızı',teal:'🩵 Turkuaz',gold:'🟡 Altın',indigo:'🟣 Çivit',rose:'🌹 Gül',cyan:'💠 Camgöbeği'};
let bpmData=0, specData=[];
const SPEEDS = [0.5,0.75,1.0,1.25,1.5,2.0];
const SLEEPS = [[0,'⏰ Kapalı'],[5,'5 dk'],[15,'15 dk'],[30,'30 dk'],[60,'60 dk']];
const PLACEHOLDER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='10' fill='%23282828'/%3E%3Ctext x='50' y='66' font-size='46' text-anchor='middle' fill='%235a5a5a'%3E%E2%99%AA%3C/text%3E%3C/svg%3E";

let bridge=null, S={}, view='home', viewPlaylist=null;
let active={playlist:null,song_id:null,playing:false,shuffle:false,repeat:false};
let track=null, volume=80, muted=false, lastVol=80, speed=1.0;
let eqGains=new Array(10).fill(0), eqEnabled=true, effects={};
let searchRows=[], seeking=false, draggingVol=false, localQuery='', playlistSort='default';
let spectrum=new Array(56).fill(0), vizLevels=new Array(56).fill(0);
let sleepTimer=null, history=[], histPos=-1;

const $=s=>document.querySelector(s);
const el=(t,c,txt)=>{const e=document.createElement(t);if(c)e.className=c;if(txt!=null)e.textContent=txt;return e;};
const fa=(n,s)=>'<i class="fa-'+(s||'solid')+' fa-'+n+'"></i>';
const faBtn=(cls,n,s)=>{const b=el('button',cls);b.innerHTML=fa(n,s);return b;};
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
function fmt(sec){sec=Math.max(0,Math.floor(sec||0));return Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0');}
function fmtMs(ms){return fmt((ms||0)/1000);}
function hueFromName(n){let h=0;for(const c of (n||'')) h=(h*31+c.charCodeAt(0))>>>0;return h%360;}

/* ---------- toast / menu / modal ---------- */
let toastT=null;
function showToast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove('show'),2800);}
function closeMenus(){document.querySelectorAll('.ctx-menu,.modal-back').forEach(m=>m.remove());}
document.addEventListener('click',e=>{if(!e.target.closest('.ctx-menu'))document.querySelectorAll('.ctx-menu').forEach(m=>m.remove());});
function ctxMenu(x,y,items){
  closeMenus();
  const m=el('div','ctx-menu');
  items.forEach(it=>{
    if(it.sep){m.appendChild(el('div','sep'));return;}
    if(it.label){m.appendChild(el('div','lab',it.label));return;}
    const a=el('a',null,it.text);a.onclick=()=>{m.remove();it.fn();};m.appendChild(a);
  });
  document.body.appendChild(m);
  const r=m.getBoundingClientRect();
  m.style.left=Math.min(x,window.innerWidth-r.width-8)+'px';
  m.style.top=Math.min(y,window.innerHeight-r.height-8)+'px';
}
function modalPrompt(title,fields,onOk){
  closeMenus();
  const back=el('div','modal-back');const mo=el('div','modal');
  mo.appendChild(el('h3',null,title));
  const inputs=fields.map(f=>{const i=el('input');i.placeholder=f.ph;i.value=f.val||'';mo.appendChild(i);return i;});
  const act=el('div','m-actions');
  const cancel=el('button','btn','İptal');cancel.onclick=()=>back.remove();
  const ok=el('button','btn accent','Tamam');ok.onclick=()=>{onOk(inputs.map(i=>i.value));back.remove();};
  act.append(cancel,ok);mo.appendChild(act);back.appendChild(mo);
  back.onclick=e=>{if(e.target===back)back.remove();};
  document.body.appendChild(back);inputs[0]&&inputs[0].focus();
  mo.addEventListener('keydown',e=>{if(e.key==='Enter')ok.click();if(e.key==='Escape')cancel.click();});
}
function confirmBox(msg,onYes){modalConfirm(msg,onYes);}
function modalConfirm(msg,onYes){
  const back=el('div','modal-back');const mo=el('div','modal');
  mo.appendChild(el('h3',null,msg));
  const act=el('div','m-actions');
  const no=el('button','btn','İptal');no.onclick=()=>back.remove();
  const yes=el('button','btn accent','Evet');yes.onclick=()=>{back.remove();onYes();};
  act.append(no,yes);mo.appendChild(act);back.appendChild(mo);
  back.onclick=e=>{if(e.target===back)back.remove();};document.body.appendChild(back);
}

/* ---------- covers ---------- */
function coverImg(cls,song){
  const im=el('img',cls);
  im.src=song.cover||PLACEHOLDER;
  im.dataset.cid=song.id;
  im.onerror=()=>{im.onerror=null;im.src=PLACEHOLDER;};
  return im;
}
function updateCovers(id,url){
  document.querySelectorAll('img[data-cid="'+CSS.escape(id)+'"]').forEach(im=>{
    im.onerror=()=>{im.onerror=null;im.src=PLACEHOLDER;};
    im.src=url+'?t='+Date.now();
  });
  // başlık rengini yalnızca başlık kapağı bu şarkıysa güncelle
  if(view==='playlist'){const hc=document.querySelector('.hdr-cover');if(hc&&hc.dataset.cid===id)setHeaderColor(url+'?t='+Date.now());}
}
const _colorCache={};
function dominantColor(url,cb){
  const im=new Image();im.crossOrigin='anonymous';
  im.onload=function(){
    try{
      const c=document.createElement('canvas');c.width=c.height=28;const cx=c.getContext('2d');
      cx.drawImage(im,0,0,28,28);const d=cx.getImageData(0,0,28,28).data;
      let r=0,g=0,b=0,n=0;
      for(let i=0;i<d.length;i+=4){if(d[i+3]<128)continue;
        const mx=Math.max(d[i],d[i+1],d[i+2]),mn=Math.min(d[i],d[i+1],d[i+2]);
        if(mx-mn<14&&mx>235)continue; // beyaz/gri arka planı at
        r+=d[i];g+=d[i+1];b+=d[i+2];n++;}
      if(n){cb('rgb('+((r/n)|0)+','+((g/n)|0)+','+((b/n)|0)+')');}else cb(null);
    }catch(e){cb(null);}
  };
  im.onerror=function(){cb(null);};im.src=url;
}
function setHeaderColor(url){
  const h=document.querySelector('.pl-header');if(!h)return;
  dominantColor(url,c=>{if(c)h.style.setProperty('--hdr',c);});
}

/* ---------- theme ---------- */
function applyTheme(name){
  const t=THEMES[name]||THEMES.green;
  document.documentElement.style.setProperty('--accent',t[0]);
  document.documentElement.style.setProperty('--accent2',t[1]);
  document.documentElement.style.setProperty('--accent-rgb',t[2]);
  $('#themeSel').value=name;
}

/* ---------- generic sliders ---------- */
function attachDrag(elm,onFrac,vertical){
  const calc=e=>{
    const r=elm.getBoundingClientRect();
    let f=vertical?1-(e.clientY-r.top)/r.height:(e.clientX-r.left)/r.width;
    return Math.max(0,Math.min(1,f));
  };
  const down=e=>{e.preventDefault();onFrac(calc(e),true);
    const mv=ev=>onFrac(calc(ev),true);
    const up=ev=>{onFrac(calc(ev),false);window.removeEventListener('pointermove',mv);window.removeEventListener('pointerup',up);};
    window.addEventListener('pointermove',mv);window.addEventListener('pointerup',up);};
  elm.addEventListener('pointerdown',down);
}
function vSlider(min,max,val,onInput){
  const wrap=el('div','vslider');const fill=el('div','vfill');const knob=el('div','vknob');
  wrap.append(fill,knob);
  const set=v=>{v=Math.max(min,Math.min(max,v));const f=(v-min)/(max-min);
    fill.style.height=(f*100)+'%';knob.style.bottom='calc('+(f*100)+'% )';};
  set(val);
  attachDrag(wrap,(f,live)=>{const v=Math.round(min+f*(max-min));set(v);onInput(v,live);},true);
  wrap._set=set;return wrap;
}
function hSlider(min,max,val,onInput){
  const wrap=el('div','hslider');const fill=el('div','hfill');const knob=el('div','hknob');
  wrap.append(fill,knob);
  const set=v=>{v=Math.max(min,Math.min(max,v));const f=(v-min)/(max-min);
    fill.style.width=(f*100)+'%';knob.style.left=(f*100)+'%';};
  set(val);
  attachDrag(wrap,(f,live)=>{const v=Math.round(min+f*(max-min));set(v);onInput(v,live);},false);
  wrap._set=set;return wrap;
}

/* ================= data helpers ================= */
function songsOf(pl){return (S.playlists&&S.playlists[pl])||[];}
function findSong(pl,id){return songsOf(pl).find(s=>s.id===id);}

/* ================= SIDEBAR ================= */
function renderSidebar(){
  const box=$('#playlistList');const q=($('#libSearch').value||'').toLowerCase();
  box.innerHTML='';
  Object.keys(S.playlists||{}).forEach(name=>{
    if(q && !name.toLowerCase().includes(q))return;
    const songs=songsOf(name);
    const row=el('div','pl-row'+(name===viewPlaylist?' active':''));
    const info=el('div','pl-info');
    info.appendChild(el('div','pl-name',name));
    info.appendChild(el('div','pl-sub','Çalma listesi • '+songs.length+' şarkı'));
    row.append(coverBlock(songs,'pl-cover'),info);
    row.onclick=()=>openPlaylist(name);
    row.oncontextmenu=e=>{e.preventDefault();playlistMenu(e,name);};
    row.ondragover=e=>{e.preventDefault();row.classList.add('drop-hover');};
    row.ondragleave=()=>row.classList.remove('drop-hover');
    row.ondrop=e=>{e.preventDefault();row.classList.remove('drop-hover');
      try{const d=JSON.parse(e.dataTransfer.getData('text/plain'));if(d&&d.id)bridge.copyToPlaylist(d.id,d.playlist,name);}catch(_){}};
    box.appendChild(row);
  });
  const sps=smartPlaylists().filter(sp=>sp.items.length);
  if(sps.length){
    box.appendChild(el('div','pl-section-label','⚙ Akıllı Listeler'));
    sps.forEach(sp=>{const row=el('div','pl-row');
      const cv=el('div','pl-cover smart-cover');cv.textContent=sp.name.split(' ')[0];
      const info=el('div','pl-info');info.appendChild(el('div','pl-name',sp.name.replace(/^\S+\s/,'')));info.appendChild(el('div','pl-sub',sp.items.length+' şarkı'));
      row.append(cv,info);row.onclick=()=>openSmart(sp);box.appendChild(row);});
  }
}
function playlistMenu(e,name){
  const items=[{text:'▶ Çal',fn:()=>playPlaylist(name)},
    {text:'🔀 Karıştırarak çal',fn:()=>bridge.playPlaylistShuffled(name,'')},
    {text:'➕ Tümünü kuyruğa ekle',fn:()=>bridge.addAllToQueue(name)},
    {sep:true},
    {text:'🧹 Tekrarları kaldır',fn:()=>bridge.removeDuplicates(name)},
    {text:'📄 M3U dışa aktar',fn:()=>bridge.exportM3U(name)},
    {text:'📝 Açıklama düzenle',fn:()=>modalPrompt('Liste açıklaması',[{ph:'Açıklama',val:(S.settings.playlist_desc&&S.settings.playlist_desc[name])||''}],v=>bridge.setPlaylistDescription(name,v[0]))},
    {text:'🖼 Kapak ayarla (URL)',fn:()=>modalPrompt('Kapak görsel URL',[{ph:'https://…',val:(S.settings.playlist_covers&&S.settings.playlist_covers[name])||''}],v=>{if(v[0].trim())bridge.setPlaylistCover(name,v[0].trim());})}];
  if(!S.protected.includes(name)){
    items.push({text:'✏️ Yeniden adlandır',fn:()=>modalPrompt('Listeyi yeniden adlandır',[{ph:'Yeni ad',val:name}],v=>{if(v[0].trim())bridge.renamePlaylist(name,v[0].trim());})});
    items.push({text:'🗑 Listeyi sil',fn:()=>modalConfirm('“'+name+'” silinsin mi?',()=>bridge.deletePlaylist(name))});
  }
  ctxMenu(e.clientX,e.clientY,items);
}

/* ================= ROUTER ================= */
function setNav(v){document.querySelectorAll('.nav-link').forEach(b=>b.classList.toggle('active',b.dataset.view===v && v!=='playlist'));}
function showView(v){
  view=v;setNav(v);
  if(v==='home')renderHome();
  else if(v==='search')renderSearch();
  else if(v==='effects')renderEffects();
  else if(v==='lyrics')renderLyricsView();
  else if(v==='queue')renderQueue();
  else if(v==='stats')renderStats();
  else if(v==='clip')renderClipView();
  else if(v==='playlist'&&viewPlaylist)renderPlaylist(viewPlaylist);  // klipten listeye dönüş
  else renderHome();
  if(v!=='clip'&&clip)goMiniClip();   // klipten ayrılınca AKIŞI KESME — köşeye küçült
}
function pushHistory(){/* basit; ileri/geri opsiyonel */}
function openPlaylist(name){viewPlaylist=name;view='playlist';setNav('playlist');bridge.selectPlaylist(name);renderPlaylist(name);renderSidebar();
  if(clip)goMiniClip();}   // klip yaşıyorsa küçült, öldürme

/* ================= HOME ================= */
function greeting(){const h=new Date().getHours();return h<6?'İyi geceler':h<12?'Günaydın':h<18?'İyi günler':'İyi akşamlar';}
function renderHome(){
  const m=$('#view');m.innerHTML='';const pad=el('div','view-pad');
  const hero=el('div','home-hero');hero.appendChild(el('div','section-title greet',greeting()));pad.appendChild(hero);
  const grid=el('div','quick-grid');
  Object.keys(S.playlists||{}).slice(0,8).forEach(name=>{
    const songs=songsOf(name);const cover=songs.find(s=>s.hasCover)||songs[0];
    const c=el('div','quick-card');
    const im=cover?coverImg('qc-img',cover):el('img','qc-img');if(!cover)im.src=PLACEHOLDER;
    const pb=Object.assign(el('div','qc-play'),{innerHTML:fa('play')});pb.onclick=ev=>{ev.stopPropagation();playPlaylist(name);};
    c.append(im,el('div','qc-name',name),pb);
    c.onclick=()=>openPlaylist(name);
    grid.appendChild(c);
  });
  pad.appendChild(grid);
  // Son çalınanlar
  const recent=(S.recent||[]);
  if(recent.length){
    pad.appendChild(el('div','section-title','Son çalınanlar'));
    const rr=el('div','card-row');
    recent.slice(0,8).forEach(s=>{
      const card=el('div','card song-card');
      card.append(coverImg('card-cover',s),el('div','card-name',s.title),el('div','card-sub',s.artist||'—'));
      const pb=Object.assign(el('div','card-play'),{innerHTML:fa('play')});pb.onclick=ev=>{ev.stopPropagation();bridge.play(s.id,s.playlist);};
      card.appendChild(pb);card.onclick=()=>bridge.play(s.id,s.playlist);
      rr.appendChild(card);
    });
    pad.appendChild(rr);
  }
  pad.appendChild(el('div','section-title','Çalma Listelerin'));
  const row=el('div','card-row');
  Object.keys(S.playlists||{}).forEach(name=>{
    const songs=songsOf(name);
    const card=el('div','card');
    card.append(coverBlock(songs,'card-cover'),el('div','card-name',name),el('div','card-sub',songs.length+' şarkı'));
    const pb=Object.assign(el('div','card-play'),{innerHTML:fa('play')});pb.onclick=ev=>{ev.stopPropagation();playPlaylist(name);};
    card.appendChild(pb);
    card.onclick=()=>openPlaylist(name);
    row.appendChild(card);
  });
  pad.appendChild(row);
  m.appendChild(pad);
}

/* ================= PLAYLIST VIEW ================= */
function playPlaylist(name){const songs=songsOf(name);if(!songs.length){showToast('Liste boş.');return;}bridge.play(songs[0].id,name);}
function renderPlaylist(name){
  if(bridge)bridge.requestCovers(name);   // kapağı olmayanları çekmeye başla
  const songs=songsOf(name);const m=$('#view');m.innerHTML='';
  const hue=hueFromName(name);
  const header=el('div','pl-header');header.style.setProperty('--hdr','hsl('+hue+',42%,30%)');
  const custom=S.settings.playlist_covers&&S.settings.playlist_covers[name];
  let hc;
  if(custom){hc=el('img','hdr-cover');hc.src=custom;hc.onerror=()=>{hc.onerror=null;hc.src=PLACEHOLDER;};dominantColor(custom,c=>{if(c)header.style.setProperty('--hdr',c);});}
  else{const cover=songs.find(s=>s.hasCover)||songs[0];hc=cover?coverImg('hdr-cover',cover):el('img','hdr-cover');if(!cover)hc.src=PLACEHOLDER;if(cover&&cover.hasCover)dominantColor(cover.cover,c=>{if(c)header.style.setProperty('--hdr',c);});}
  const meta=el('div','hdr-meta');
  meta.appendChild(el('div','hdr-kind','Çalma listesi'));
  meta.appendChild(el('div','hdr-name',name));
  const desc=S.settings.playlist_desc&&S.settings.playlist_desc[name];
  if(desc)meta.appendChild(el('div','hdr-desc',desc));
  const totalMs=songs.reduce((a,s)=>a+(s.duration_ms||0),0);
  const sub=el('div','hdr-sub');sub.innerHTML='<b>'+esc(S.settings&&S.settings.owner||'Kütüphanem')+'</b> • '+songs.length+' şarkı'+(totalMs?' • '+fmtMs(totalMs):'');
  meta.appendChild(sub);header.append(hc,meta);m.appendChild(header);

  const acts=el('div','pl-actions');
  const big=Object.assign(el('button','big-play'),{innerHTML:fa('play')});big.onclick=()=>playPlaylist(name);
  const shuf=el('button','act-icon'+(active.shuffle?' on':''),'🔀');shuf.title='Karıştır';shuf.onclick=()=>{toggleShuffle();shuf.classList.toggle('on',active.shuffle);};
  const sync=el('button','act-icon','🖼');sync.title='İsim & Kapak senkronu';sync.onclick=()=>modalConfirm('“'+name+'” adları dosya adından temizlenip kapaklar yeniden çekilsin mi?',()=>bridge.syncNamesCovers(name));
  const spacer=el('div');spacer.style.flex='1';
  const sortSel=el('select','mini-sel');sortSel.title='Sırala';
  [['default','↕ Sıra'],['title','Ada göre'],['artist','Sanatçıya göre'],['duration','Süreye göre'],['plays','En çok çalınan']].forEach(([v,l])=>{const o=el('option',null,l);o.value=v;sortSel.appendChild(o);});
  sortSel.value=playlistSort;sortSel.onchange=()=>{playlistSort=sortSel.value;renderPlaylist(name);};
  acts.append(big,shuf,sync,spacer,sortSel);m.appendChild(acts);

  const wrap=el('div','tracks');
  const head=el('div','track-head');
  head.innerHTML='<div style="text-align:center">#</div><div>Başlık</div><div>Kaynak</div><div></div><div style="text-align:right">🕐</div>';
  wrap.appendChild(head);
  if(!songs.length){wrap.appendChild(el('div','empty-hint','Bu liste boş. Sağ üstten MP3 ekleyebilir veya YouTube’dan indirebilirsin.'));}
  let disp=songs.map(s=>s);
  if(playlistSort==='title')disp.sort((a,b)=>(a.title||'').localeCompare(b.title||'','tr'));
  else if(playlistSort==='artist')disp.sort((a,b)=>(a.artist||'').localeCompare(b.artist||'','tr'));
  else if(playlistSort==='duration')disp.sort((a,b)=>(a.duration_ms||0)-(b.duration_ms||0));
  else if(playlistSort==='plays')disp.sort((a,b)=>(b.play_count||0)-(a.play_count||0));
  disp.forEach((s,i)=>wrap.appendChild(trackRow(s,i,name)));
  m.appendChild(wrap);
  highlightActive();
}
function trackRow(s,i,pl){
  const t=el('div','track');t.dataset.sid=s.id;
  const idx=el('div','t-index');idx.innerHTML='<span class="num">'+(i+1)+'</span><span class="ic">▶</span>';
  const main=el('div','t-main');
  main.appendChild(coverImg('t-cover',s));
  const txt=el('div','t-txt');
  txt.appendChild(el('div','t-title',s.title));
  txt.appendChild(el('div','t-artist',s.artist||(s.source==='youtube'?'YouTube':'Yerel Parça')));
  main.appendChild(txt);
  const src=el('div','t-album',s.source==='youtube'?'YouTube':'Yerel');
  const fav=el('div','t-fav'+(s.favorite?' on':''),s.favorite?'❤':'♡');
  fav.onclick=e=>{e.stopPropagation();bridge.toggleFavorite(s.id,pl);};
  const dur=el('div','t-dur');dur.appendChild(el('span',null,fmtMs(s.duration_ms)));
  const menu=el('span','t-menu','⋮');menu.onclick=e=>{e.stopPropagation();trackMenu(e,s,pl);};
  dur.appendChild(menu);
  t.append(idx,main,src,fav,dur);
  t.onclick=()=>bridge.play(s.id,pl);
  t.oncontextmenu=e=>{e.preventDefault();trackMenu(e,s,pl);};
  t.draggable=true;
  t.ondragstart=e=>{e.dataTransfer.setData('text/plain',JSON.stringify({id:s.id,playlist:pl,idx:i}));e.dataTransfer.effectAllowed='copyMove';};
  t.ondragover=e=>{e.preventDefault();t.classList.add('drag-over');};
  t.ondragleave=()=>t.classList.remove('drag-over');
  t.ondrop=e=>{e.preventDefault();t.classList.remove('drag-over');
    try{const d=JSON.parse(e.dataTransfer.getData('text/plain'));
      if(d&&d.playlist===pl&&d.idx!=null&&playlistSort==='default')bridge.reorderSong(pl,d.idx,i);}catch(_){}};
  return t;
}
function trackMenu(e,s,pl){
  const items=[
    {text:'▶ Çal',fn:()=>bridge.play(s.id,pl)},
    {text:'▶ Sıradaki çal',fn:()=>bridge.playNext(s.id,pl)},
    {text:'➕ Sıraya ekle',fn:()=>bridge.addToQueue(s.id,pl)},
    {text:(s.favorite?'💔 Beğenmekten vazgeç':'❤ Beğen'),fn:()=>bridge.toggleFavorite(s.id,pl)},
    {text:'✏️ Künyeyi düzenle',fn:()=>modalPrompt('Künyeyi düzenle',[{ph:'Şarkı adı',val:s.title},{ph:'Sanatçı',val:s.artist}],v=>bridge.editMetadata(s.id,pl,v[0],v[1]))},
    {text:'❌ Listeden kaldır',fn:()=>bridge.removeSong(s.id,pl)},
    {text:'📁 Dosya konumunu aç',fn:()=>bridge.openFileLocation(s.id,pl)},
    {sep:true},{label:'Şu listeye ekle'},
  ];
  Object.keys(S.playlists||{}).filter(n=>n!==pl).forEach(n=>items.push({text:'➕ '+n,fn:()=>bridge.copyToPlaylist(s.id,pl,n)}));
  ctxMenu(e.clientX,e.clientY,items);
}
function highlightActive(){
  document.querySelectorAll('.track').forEach(t=>t.classList.toggle('active',t.dataset.sid===active.song_id && viewPlaylist===active.playlist));
}

/* ================= SEARCH ================= */
function renderSearch(){
  const m=$('#view');m.innerHTML='';const pad=el('div','view-pad');
  const q=(localQuery||'').toLowerCase();
  if(q){
    const plMatches=Object.keys(S.playlists||{}).filter(n=>n.toLowerCase().includes(q));
    if(plMatches.length){
      pad.appendChild(el('div','section-title','Çalma Listeleri'));
      const row=el('div','card-row');
      plMatches.forEach(name=>{const songs=songsOf(name);const card=el('div','card');
        card.append(coverBlock(songs,'card-cover'),el('div','card-name',name),el('div','card-sub',songs.length+' şarkı'));
        const pb=Object.assign(el('div','card-play'),{innerHTML:fa('play')});pb.onclick=ev=>{ev.stopPropagation();playPlaylist(name);};card.appendChild(pb);
        card.onclick=()=>openPlaylist(name);row.appendChild(card);});
      pad.appendChild(row);
    }
    const songMatches=[];
    for(const pl in S.playlists)for(const s of S.playlists[pl])
      if(s.title.toLowerCase().includes(q)||(s.artist||'').toLowerCase().includes(q))songMatches.push([s,pl]);
    if(songMatches.length){
      pad.appendChild(el('div','section-title','Kütüphanendeki Şarkılar'));
      const list=el('div','tracks');
      songMatches.slice(0,40).forEach(([s,pl],i)=>list.appendChild(trackRow(s,i,pl)));
      pad.appendChild(list);
    }
    if(!plMatches.length&&!songMatches.length)pad.appendChild(el('div','empty-hint','Kütüphanende “'+esc(localQuery)+'” için sonuç yok.'));
  }
  pad.appendChild(el('div','section-title','🔎 YouTube’dan İndir'));
  const info=el('div','empty-hint',q?('“'+esc(localQuery)+'” için Enter’a bas → YouTube’da 20 sonuç.'):'Üstteki kutuya yaz; anında kütüphanende arar, Enter → YouTube’dan indir.');
  info.id='searchInfo';pad.appendChild(info);
  const res=el('div','search-results');res.id='searchResults';pad.appendChild(res);
  m.appendChild(pad);
  if(searchRows.length)renderSearchRows();
}
function doSearch(q){
  if(!q.trim())return;
  if(view!=='search'){showView('search');}
  const info=$('#searchInfo');if(info)info.textContent='“'+q+'” aranıyor…';
  bridge.searchYouTube(q);
}
function onSearchResults(json){
  let data;try{data=JSON.parse(json);}catch(e){return;}
  if(data.error){const info=$('#searchInfo');if(info)info.textContent='Arama hatası: '+data.error;return;}
  searchRows=data;renderSearchRows();
}
function renderSearchRows(){
  const res=$('#searchResults');if(!res)return;const info=$('#searchInfo');
  res.innerHTML='';
  if(!searchRows.length){if(info)info.textContent='Sonuç yok.';return;}
  if(info)info.style.display='none';
  const tb=el('div','sr-toolbar');
  const cnt=el('span','count',searchRows.length+' sonuç — indirmek istediklerini seç');
  const selAll=el('button','btn','☑ Tümünü Seç');
  const dl=el('button','btn accent','⬇ Seçilenleri İndir');
  tb.append(selAll,cnt);tb.append(dl);tb.style.justifyContent='space-between';res.appendChild(tb);
  searchRows.forEach((r,i)=>{
    const row=el('div','sr-row');
    const chk=el('input','sr-check');chk.type='checkbox';chk.dataset.i=i;
    const im=el('img');im.src=r.thumbnail;im.onerror=()=>{im.onerror=null;im.src=PLACEHOLDER;};
    const txt=el('div');txt.appendChild(el('div','sr-title',r.title));
    txt.appendChild(el('div','sr-sub',(r.uploader||'YouTube')+(r.duration_ms?'  ·  '+fmtMs(r.duration_ms):'')));
    const dur=el('div','sr-dur',r.duration_ms?fmtMs(r.duration_ms):'');
    row.append(chk,im,txt,dur);
    row.onclick=e=>{if(e.target!==chk)chk.checked=!chk.checked;};
    res.appendChild(row);
  });
  selAll.onclick=()=>{const cs=res.querySelectorAll('.sr-check');const all=[...cs].every(c=>c.checked);cs.forEach(c=>c.checked=!all);};
  dl.onclick=()=>{
    const urls=[...res.querySelectorAll('.sr-check')].filter(c=>c.checked).map(c=>searchRows[+c.dataset.i].url);
    if(!urls.length){showToast('Hiçbir şey seçmedin.');return;}
    bridge.downloadUrls(JSON.stringify(urls));showToast(urls.length+' parça indirme kuyruğuna eklendi.');
  };
}

/* ================= EFFECTS ================= */
const FX_ROWS=[['preamp','🎚 Preamp'],['bass','🔊 Bass Boost'],['karaoke','🎙 Karaoke (Vokal Azalt)'],['echo','📣 Echo (Yankı)'],['echo_time','⏱ Echo Süresi'],['echo_feedback','🔁 Echo Tekrarı'],['reverb','🏛 Reverb (Oda)'],['spatial','🌀 8D Spatial']];
const SOUNDSCAPES=[['off','🚫 Kapalı'],['rain','🌧 Yağmur'],['white','📻 Beyaz Gürültü'],['brown','🟤 Kahverengi Gürültü']];
function renderEffects(){
  const m=$('#view');m.innerHTML='';const pad=el('div','view-pad');
  pad.appendChild(el('div','section-title','🎛 Ekolayzır & Efektler'));
  const wrap=el('div','fx-wrap');
  // EQ card
  const eq=el('div','fx-card');eq.appendChild(Object.assign(el('h3'),{textContent:'Ekolayzır'}));
  const top=el('div','eq-top');
  const tog=el('label','toggle');const ci=el('input');ci.type='checkbox';ci.checked=eqEnabled;
  ci.onchange=()=>{eqEnabled=ci.checked;bridge.setEqEnabled(eqEnabled);};
  tog.append(ci,document.createTextNode(' Açık'));
  const sel=el('select','mini-sel');sel.innerHTML='<option value="">✏️ Özel</option>'+(S.presetNames||[]).map(n=>'<option>'+esc(n)+'</option>').join('');
  sel.value=(S.settings&&S.settings.eq_preset)||'';
  sel.onchange=()=>{const g=S.presets[sel.value];if(g){eqGains=g.slice();applyEqUI();bridge.setEq(JSON.stringify(eqGains));bridge.setEqPreset(sel.value);}};
  const auto=el('button','btn','🤖 Oto');auto.onclick=()=>bridge.autoEq(g=>{const arr=JSON.parse(g);if(arr.length){eqGains=arr;applyEqUI();sel.value='';}});
  top.append(tog,sel,auto);eq.appendChild(top);
  const bands=el('div','eq-bands');
  window._eqSetters=[];
  (S.bandLabels||[]).forEach((lbl,i)=>{
    const col=el('div','eq-band');const db=el('div','db',String(eqGains[i]||0));
    const sl=vSlider(-12,12,eqGains[i]||0,(v)=>{eqGains[i]=v;db.textContent=v;sel.value='';bridge.setEq(JSON.stringify(eqGains));});
    window._eqSetters.push((v)=>{sl._set(v);db.textContent=v;});
    col.append(db,sl,el('div','lbl',lbl));bands.appendChild(col);
  });
  eq.appendChild(bands);
  const reset=el('button','btn','↺ Sıfırla (Flat)');reset.style.marginTop='16px';
  reset.onclick=()=>{const g=S.presets['🎚 Flat'];eqGains=g.slice();applyEqUI();sel.value='🎚 Flat';bridge.setEq(JSON.stringify(eqGains));bridge.setEqPreset('🎚 Flat');};
  eq.appendChild(reset);
  wrap.appendChild(eq);
  // FX card
  const fx=el('div','fx-card');fx.appendChild(Object.assign(el('h3'),{textContent:'Efektler'}));
  const normRow=el('label','toggle');const ncb=el('input');ncb.type='checkbox';ncb.checked=!!(S.settings&&S.settings.normalize);ncb.onchange=()=>bridge.setNormalize(ncb.checked);normRow.append(ncb,document.createTextNode(' 🔊 Ses Eşitleme (Normalize)'));normRow.style.marginBottom='12px';fx.appendChild(normRow);
  const rvRow=el('div','fx-row');const rvHead=el('div','fx-head');rvHead.appendChild(el('span','fxName','🏛 Ortam (Reverb Preset)'));rvRow.appendChild(rvHead);
  const rvSel=el('select','mini-sel');rvSel.style.width='100%';Object.keys(REVERB_PRESETS).forEach(k=>{const o=el('option',null,k);o.value=k;rvSel.appendChild(o);});rvSel.onchange=()=>applyReverbPreset(rvSel.value);rvRow.appendChild(rvSel);fx.appendChild(rvRow);
  const rows=el('div','fx-rows');
  FX_ROWS.forEach(([key,label])=>{
    const row=el('div','fx-row');const head=el('div','fx-head');
    head.appendChild(el('span',null,label));const val=el('span','fx-val',String(Math.round(effects[key]||0)));head.appendChild(val);
    row.appendChild(head);
    const sl=hSlider(0,100,effects[key]||0,(v)=>{effects[key]=v;val.textContent=v;bridge.setEffect(key,v);});
    row.appendChild(sl);rows.appendChild(row);
  });
  fx.appendChild(rows);
  const fxr=el('button','btn','↺ Efektleri Sıfırla');fxr.style.marginTop='16px';
  fxr.onclick=()=>{Object.keys(S.effectDefaults).forEach(k=>{effects[k]=S.effectDefaults[k];bridge.setEffect(k,effects[k]);});renderEffects();};
  fx.appendChild(fxr);
  wrap.appendChild(fx);
  // 🌊 Odak Sesleri (soundscape)
  const sc=el('div','fx-card');sc.appendChild(Object.assign(el('h3'),{textContent:'🌊 Odak Sesleri'}));
  let scKind=(S.settings.soundscape&&S.settings.soundscape[0])||'off';
  let scLevel=(S.settings.soundscape&&S.settings.soundscape[1])||40;
  const scRow=el('div','sc-btns');
  SOUNDSCAPES.forEach(([k,l])=>{const bt=el('button','btn'+(k===scKind?' accent':''),l);
    bt.onclick=()=>{scKind=k;[...scRow.children].forEach(x=>x.classList.remove('accent'));bt.classList.add('accent');bridge.setSoundscape(scKind,scLevel);};
    scRow.appendChild(bt);});
  sc.appendChild(scRow);
  const rowL=el('div','fx-row');const hL=el('div','fx-head');hL.appendChild(el('span',null,'Seviye'));const vL=el('span','fx-val',String(scLevel));hL.appendChild(vL);rowL.appendChild(hL);
  rowL.appendChild(hSlider(0,100,scLevel,(v)=>{scLevel=v;vL.textContent=v;bridge.setSoundscape(scKind,scLevel);}));
  sc.appendChild(rowL);
  sc.appendChild(el('div','panelHint2','Müzik olmadan da çalar — odaklanmak/uyumak için.'));
  wrap.appendChild(sc);
  pad.appendChild(wrap);m.appendChild(pad);
}
function applyEqUI(){if(window._eqSetters)eqGains.forEach((v,i)=>window._eqSetters[i]&&window._eqSetters[i](v));}

/* ================= LYRICS VIEW ================= */
function renderLyricsView(){
  const m=$('#view');m.innerHTML='';const pad=el('div','lyrics-view');
  if(!track||track.none){pad.appendChild(el('div','empty-hint','Önce bir şarkı çal.'));m.appendChild(pad);return;}
  const lines=(track.lyrics||'').split('\n');
  if(!track.lyrics){pad.appendChild(el('div','empty-hint','Bu şarkının sözü yok. Sağ paneldeki ✏️ ile ekleyebilirsin.'));}
  lines.forEach(l=>pad.appendChild(el('div','lv-line',l||' ')));
  m.appendChild(pad);
}

/* ================= RIGHT PANEL (now playing) ================= */
function renderRightPanel(){
  const p=$('#rightPanel');if(!p.classList.contains('show')){return;}
  p.innerHTML='';const pad=el('div','np-pad');
  if(!track||track.none){pad.appendChild(el('div','empty-hint','Çalan parça yok.'));
    const cv=el('canvas','np-viz');cv.id='vizCanvas';pad.appendChild(cv);p.appendChild(pad);return;}
  pad.appendChild(coverImg('np-cover',track));
  pad.appendChild(el('div','np-title',track.title));
  pad.appendChild(el('div','np-artist',track.artist||'Yerel Parça'));
  const cv=el('canvas','np-viz');cv.id='vizCanvas';pad.appendChild(cv);
  pad.appendChild(el('div','np-wlabel','🌊 Şarkı DNA’sı'));
  pad.appendChild(buildWave());
  pad.appendChild(buildAbControls());
  drawWaveforms();
  const badges=el('div','np-badges');
  if(bpmData)badges.appendChild(el('span','np-badge','🥁 '+bpmData+' BPM'));
  if(moodData&&moodData.label){const mb=el('span','np-badge',moodData.label);mb.style.color=moodData.color;badges.appendChild(mb);}
  const radio=el('button','btn','📻 Radyo');radio.onclick=()=>bridge.startRadio(track.id,track.playlist);
  const trim=el('button','btn','✂️ Kırp (A-B)');trim.onclick=()=>{if(loopAB&&loopAB.b!=null)bridge.exportTrim(track.id,track.playlist,loopAB.a,loopAB.b);else showToast('Önce A-B döngü noktalarını ayarla.');};
  badges.append(radio,trim);pad.appendChild(badges);
  if(specData.length){pad.appendChild(el('div','np-wlabel','🎛 Spektrogram'));
    const spec=el('canvas','np-spec');spec.id='specCanvas';pad.appendChild(spec);setTimeout(drawSpectrogram,0);}
  const lyr=el('div','np-lyrics-card');
  const lh=el('div','lh');lh.appendChild(el('b',null,'📝 Sözler'));
  const lhBtns=el('div','lh-btns');
  const getBtn=el('button','btn');getBtn.innerHTML=fa('cloud-arrow-down')+' Getir';
  getBtn.title='Lyrica’dan zaman kodlu (senkron) söz getir';
  getBtn.onclick=()=>bridge.fetchLyrics(track.id,track.playlist);
  const editBtn=el('button','btn');editBtn.innerHTML=fa('pen')+' Düzenle';
  lhBtns.append(getBtn,editBtn);lh.appendChild(lhBtns);lyr.appendChild(lh);
  const lrc=parseLRC(track.lyrics);
  let body;
  if(lrc){body=el('div','np-lyrics lrc-lines');body._lrc=lrc;lrc.forEach(l=>{const ln=el('div','lrc-line',l.txt||' ');ln.onclick=()=>bridge.seek(l.t);body.appendChild(ln);});}
  else{body=el('div','np-lyrics',track.lyrics||'Söz yok. ([mm:ss] ile zaman kodlu sözler desteklenir)');}
  lyr.appendChild(body);
  editBtn.onclick=()=>{
    if(editBtn.textContent.includes('Düzenle')){
      const ta=el('textarea','np-lyrics-edit');ta.value=track.lyrics||'';lyr.replaceChild(ta,body);
      editBtn.innerHTML=fa('floppy-disk')+' Kaydet';ta.focus();lyr._ta=ta;
    }else{const ta=lyr._ta;if(ta)bridge.saveLyrics(track.id,track.playlist,ta.value);editBtn.innerHTML=fa('pen')+' Düzenle';}
  };
  pad.appendChild(lyr);
  if(queueData&&queueData.length){
    pad.appendChild(el('div','np-wlabel','⏭ Sıradaki'));
    const q0=queueData[0];const nx=el('div','nextup');
    const info=el('div');info.appendChild(el('div','nextup-title',q0.title));info.appendChild(el('div','t-artist',q0.artist||'—'));
    nx.append(coverImg('nextup-cover',q0),info);nx.onclick=()=>showView('queue');
    pad.appendChild(nx);
  }
  p.appendChild(pad);
}

/* ================= PLAYER ================= */
function updatePlayer(){
  const has=track&&!track.none;
  const cov=$('#pCover');
  if(has){cov.dataset.cid=track.id;cov.src=track.cover;cov.onerror=()=>{cov.onerror=null;cov.src=PLACEHOLDER;};}
  else{cov.src=PLACEHOLDER;}
  $('#pTitle').textContent=has?track.title:'Müzik Çalar Hazır';
  $('#pArtist').textContent=has?(track.artist||''):'';
  const fav=$('#pFav');fav.innerHTML=has&&track.favorite?fa('heart'):fa('heart','regular');fav.classList.toggle('on',!!(has&&track.favorite));
  updatePlayBtn();
  $('#pShuffle').classList.toggle('on',active.shuffle);
  updateRepeatBtn();
}
function updatePlayBtn(){$('#pPlay').innerHTML=active.playing?fa('pause'):fa('play');}
/* Alt bar hem müziği hem klibi sürer — hangisi aktifse ona gider. */
function togglePlayback(){
  if(clip&&clip.v){if(clip.v.paused)clip.v.play().catch(()=>{});else clip.v.pause();return;}
  bridge.toggle();
}
function seekTo(sec){
  if(clip&&clip.v){clip.v.currentTime=Math.max(0,Math.min(sec,clip.v.duration||sec));return;}
  bridge.seek(sec);
}
function updateSeek(pos,dur){
  if(!seeking){$('#seekFill').style.width=(dur>0?pos/dur*100:0)+'%';$('#seekKnob').style.left=(dur>0?pos/dur*100:0)+'%';}
  $('#pCur').textContent=fmt(pos);$('#pDur').textContent=fmt(dur);
}
function onTrackChanged(){
  /* trackChanged aynı parçanın metadata'sı (ör. sonradan gelen sözler) için de gelir.
     Sadece parça GERÇEKTEN değiştiyse klip geçersizdir; yoksa sözleri tazele. */
  if(clip){
    const same=track&&!track.none&&track.id===active.song_id;
    if(same)clipUpdateLyrics();
    else{stopClip(false);showView(clipPrevView||'home');}
  }
  active.playlist=track&&!track.none?track.playlist:active.playlist;
  active.song_id=track&&!track.none?track.id:null;
  if(track&&!track.none){active.shuffle=track.shuffle;active.repeat=track.repeat;}
  waveData=[];moodData=null;loopAB=null;updateMoodChip();  // yeni parça: analiz bekleniyor
  updatePlayer();highlightActive();renderRightPanel();
  if(view==='lyrics')renderLyricsView();
}
function toggleShuffle(){active.shuffle=!active.shuffle;bridge.setShuffle(active.shuffle);$('#pShuffle').classList.toggle('on',active.shuffle);showToast(active.shuffle?'Karışık çalma açık':'Sıralı çalma');}
function toggleRepeat(){active.repeat=!active.repeat;bridge.setRepeat(active.repeat);$('#pRepeat').classList.toggle('on',active.repeat);showToast(active.repeat?'Tekrar açık':'Tekrar kapalı');}
function setVolumeUI(v){volume=v;$('#volFill').style.width=(v/150*100)+'%';
  $('#pMute').innerHTML=v===0?fa('volume-xmark'):v<55?fa('volume-low'):fa('volume-high');
  const vb=$('#volBar');if(vb)vb.title='Ses: '+v+'%'+(v>100?' (boost)':'');
  if(clip){const m=clip.a||clip.v;if(m)m.volume=Math.min(1,v/100);}}  // klip sesi de bara uysun
function toggleMute(){if(volume>0){lastVol=volume;setVolumeUI(0);bridge.setVolume(0);muted=true;}else{setVolumeUI(lastVol||80);bridge.setVolume(lastVol||80);muted=false;}}

/* ================= VISUALIZER ================= */
function vizLoop(){
  const cv=$('#vizCanvas');
  if(cv){
    const ctx=cv.getContext('2d');const w=cv.width=cv.clientWidth*devicePixelRatio;const h=cv.height=cv.clientHeight*devicePixelRatio;
    ctx.clearRect(0,0,w,h);
    const n=spectrum.length,gap=2*devicePixelRatio,bw=Math.max(1,(w-(n-1)*gap)/n);
    const acc=getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').trim()||'29,185,84';
    for(let i=0;i<n;i++){
      vizLevels[i]+=((active.playing?spectrum[i]:0)-vizLevels[i])*0.3;
      const bh=Math.max(2,vizLevels[i]*h);const x=i*(bw+gap);
      const g=ctx.createLinearGradient(0,h-bh,0,h);
      g.addColorStop(0,'rgba('+acc+','+(0.45+0.5*vizLevels[i])+')');g.addColorStop(1,'rgba('+acc+',0.1)');
      ctx.fillStyle=g;ctx.fillRect(x,h-bh,bw,bh);
    }
  }
  const fsv=$('#fsViz');
  if(fsv){const ctx=fsv.getContext('2d');const w=fsv.width=fsv.clientWidth*devicePixelRatio;const h=fsv.height=fsv.clientHeight*devicePixelRatio;
    ctx.clearRect(0,0,w,h);const acc=getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').trim()||'29,185,84';
    const n=spectrum.length,gap=3*devicePixelRatio,bw=Math.max(1,(w-(n-1)*gap)/n);
    for(let i=0;i<n;i++){const lv=active.playing?(spectrum[i]||0):0;const bh=Math.max(2,lv*h);
      ctx.fillStyle='rgba('+acc+','+(.5+.5*lv)+')';ctx.fillRect(i*(bw+gap),h-bh,bw,bh);}}
  drawPlayerViz();
  drawWaveforms();
  updateAmbient();
  requestAnimationFrame(vizLoop);
}

/* ================= INIT ================= */
function initFromState(){
  // selects
  $('#themeSel').innerHTML=Object.keys(THEME_LABELS).map(k=>'<option value="'+k+'">'+THEME_LABELS[k]+'</option>').join('');
  $('#speedSel').innerHTML=SPEEDS.map(s=>'<option value="'+s+'">'+s+'x</option>').join('');
  $('#sleepSel').innerHTML=SLEEPS.map(([v,l])=>'<option value="'+v+'">'+l+'</option>').join('');
  const st=S.settings||{};
  applyTheme(st.theme||'green');
  if(st.accent)applyAccentHex(st.accent);
  volume=st.volume!=null?st.volume:80;setVolumeUI(volume);
  speed=st.speed||1.0;$('#speedSel').value=speed;
  eqEnabled=st.eq_enabled!==false;
  eqGains=(st.eq_gains&&st.eq_gains.length===10)?st.eq_gains.slice():new Array(10).fill(0);
  effects=Object.assign({},S.effectDefaults,st.effects||{});
  active=S.active||active;
  renderSidebar();showView('home');updatePlayer();
  $('#rightPanel').classList.add('show');$('#pPanelBtn').classList.add('active');renderRightPanel();
  bridge.requestSidebarCovers();
}
function refreshState(){bridge.getState(json=>{S=JSON.parse(json);active=S.active||active;
  renderSidebar();
  if(view==='home')renderHome();else if(view==='playlist'&&viewPlaylist)renderPlaylist(viewPlaylist);
  updatePlayer();bridge.requestSidebarCovers();
});}

function wireSignals(){
  bridge.stateChanged.connect(refreshState);
  bridge.trackChanged.connect(j=>{track=JSON.parse(j);onTrackChanged();});
  bridge.playingChanged.connect(p=>{if(clip)return;active.playing=p;updatePlayBtn();});
  bridge.positionChanged.connect((pos,dur)=>{if(clip)return;updateSeek(pos,dur);});  // klipteyken bar videoyu sürer
  bridge.spectrumSignal.connect(j=>{try{spectrum=JSON.parse(j);}catch(e){}});
  bridge.coverReadySignal.connect((id,url)=>updateCovers(id,url));
  bridge.toastSignal.connect(showToast);
  bridge.downloadProgressSignal.connect((pct,status,q)=>updateDlPill(pct,status,q));
  bridge.downloadDoneSignal.connect(()=>{});
  bridge.searchResultsSignal.connect(onSearchResults);
  bridge.durationSignal.connect(onDuration);
  bridge.queueChanged.connect(onQueue);
  bridge.analysisSignal.connect(onAnalysis);
  bridge.loopSignal.connect(onLoop);
  bridge.videoReadySignal.connect(onVideoReady);
}

/* ================= EVENTS ================= */
function wireEvents(){
  document.querySelectorAll('.nav-link').forEach(b=>b.onclick=()=>showView(b.dataset.view));
  $('#homeBtn').onclick=()=>showView('home');
  $('#topSearch').addEventListener('keydown',e=>{if(e.key==='Enter')doSearch(e.target.value);});
  $('#topSearch').addEventListener('input',e=>{localQuery=e.target.value.trim();if(localQuery){if(view!=='search')showView('search');else renderSearch();}});
  $('#libSearch').addEventListener('input',renderSidebar);
  $('#importBtn').onclick=()=>bridge.importFiles();
  $('#createPlaylist').onclick=()=>modalPrompt('Yeni çalma listesi',[{ph:'Liste adı'}],v=>{if(v[0].trim())bridge.addPlaylist(v[0].trim());});
  $('#scanBtn').onclick=()=>bridge.scanMusic();
  $('#statsBtn').onclick=()=>showView('stats');
  $('#helpBtn').onclick=showShortcuts;
  $('#backupBtn').onclick=()=>bridge.backup();
  $('#themeSel').onchange=e=>{applyTheme(e.target.value);bridge.setTheme(e.target.value);};
  $('#accentPick').oninput=e=>{applyAccentHex(e.target.value);bridge.setAccent(e.target.value);};
  $('#pQueueBtn').onclick=()=>showView('queue');
  $('#pFsBtn').onclick=openFullscreen;
  document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&(e.key==='k'||e.key==='K')){e.preventDefault();openPalette();}});
  // player
  $('#pPlay').onclick=togglePlayback;
  $('#pNext').onclick=()=>bridge.next();
  $('#pPrev').onclick=()=>bridge.prev();
  $('#pShuffle').onclick=toggleShuffle;
  $('#pRepeat').onclick=cycleRepeat;
  $('#pFav').onclick=()=>{if(track&&!track.none)bridge.toggleFavorite(track.id,track.playlist);};
  $('#pMute').onclick=toggleMute;
  $('#pAmbient').onclick=toggleAmbient;
  $('#pKaraoke').onclick=toggleKaraoke;
  $('#pVideo').onclick=()=>{
    if(clip){if(view==='clip')showView(clipPrevView||'home');else showView('clip');}  // büyüt/küçült
    else if(track&&!track.none)bridge.playVideo(track.id,track.playlist);
    else showToast('Önce bir şarkı çal.');};
  $('#compactBtn').onclick=toggleCompact;
  $('#moodChip').onclick=()=>{autoMoodColor=!autoMoodColor;showToast(autoMoodColor?'Ruh haline göre renk: açık':'Ruh haline göre renk: kapalı');if(autoMoodColor&&moodData)applyAccentHex(moodData.color);};
  $('#speedSel').onchange=e=>{speed=parseFloat(e.target.value);bridge.setSpeed(speed);};
  $('#sleepSel').onchange=e=>{const min=parseInt(e.target.value);if(sleepTimer){clearTimeout(sleepTimer);sleepTimer=null;}
    if(min>0){sleepTimer=setTimeout(()=>{if(active.playing)bridge.toggle();showToast('Uyku zamanı — durduruldu.');$('#sleepSel').value='0';},min*60000);showToast(min+' dk sonra duracak.');}else showToast('Uyku zamanlayıcı kapalı.');};
  $('#pLyricsBtn').onclick=()=>showView('lyrics');
  $('#pPanelBtn').onclick=()=>{const p=$('#rightPanel');p.classList.toggle('show');$('#pPanelBtn').classList.toggle('active',p.classList.contains('show'));renderRightPanel();};
  // seek
  attachDrag($('#seekBar'),(f,live)=>{seeking=live;const dur=parseFloat($('#pDur').textContent.split(':').reduce((a,b)=>a*60+ +b,0))||0;
    $('#seekFill').style.width=(f*100)+'%';$('#seekKnob').style.left=(f*100)+'%';
    // compute dur from last known
    if(!live){seekTo(f*lastDur);}else{$('#pCur').textContent=fmt(f*lastDur);}},false);
  attachDrag($('#volBar'),(f)=>{const v=Math.round(f*150);setVolumeUI(v);bridge.setVolume(v);muted=v===0;if(v>0)lastVol=v;},false);
  // keyboard
  document.addEventListener('keydown',e=>{
    if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName))return;
    if(e.key==='Escape'&&clip){exitClip();return;}
    if(e.code==='Space'){e.preventDefault();togglePlayback();}
    else if(e.code==='ArrowRight')seekTo(lastPos+10);
    else if(e.code==='ArrowLeft')seekTo(Math.max(0,lastPos-10));
    else if(e.code==='ArrowUp'){const v=Math.min(150,volume+5);setVolumeUI(v);bridge.setVolume(v);lastVol=v;}
    else if(e.code==='ArrowDown'){const v=Math.max(0,volume-5);setVolumeUI(v);bridge.setVolume(v);}
    else if(e.code==='KeyS')toggleShuffle();else if(e.code==='KeyL')cycleRepeat();
    else if(e.code==='KeyN')bridge.next();else if(e.code==='KeyP')bridge.prev();
    else if(e.code==='KeyF')openFullscreen();
    else if(e.key==='/'){e.preventDefault();$('#topSearch').focus();}
    else if(e.key==='?')showShortcuts();
  });
}
let lastPos=0,lastDur=0;
const _origUpdateSeek=updateSeek;
updateSeek=function(pos,dur){lastPos=pos;lastDur=dur;_origUpdateSeek(pos,dur);syncLyrics(pos);};

/* ================= YENİ ÖZELLİKLER ================= */
// -- özel vurgu rengi --
function hexToRgb(h){h=(h||'').replace('#','');if(h.length===3)h=h.split('').map(c=>c+c).join('');const n=parseInt(h||'1db954',16);return [(n>>16)&255,(n>>8)&255,n&255];}
function lighten(rgb,a){return rgb.map(c=>Math.min(255,Math.round(c+(255-c)*a)));}
function applyAccentHex(hex){const rgb=hexToRgb(hex);const l=lighten(rgb,.2);
  const R=document.documentElement.style;
  R.setProperty('--accent',hex);R.setProperty('--accent2','rgb('+l.join(',')+')');R.setProperty('--accent-rgb',rgb.join(','));
  const ap=$('#accentPick');if(ap)ap.value=hex;}

// -- çalma listesi kapak mozaiği (Spotify tarzı 2x2) --
function coverBlock(songs,cls){
  if(!songs||!songs.length){const im=el('img',cls);im.src=PLACEHOLDER;return im;}
  if(songs.length>=4){const d=el('div','mosaic '+cls);for(let i=0;i<4;i++)d.appendChild(coverImg('',songs[i]));return d;}
  const s=songs.find(x=>x.hasCover)||songs[0];return coverImg(cls,s);
}

// -- süre sinyali --
function onDuration(id,ms){
  for(const pl in S.playlists){const s=S.playlists[pl].find(x=>x.id===id);if(s)s.duration_ms=ms;}
  document.querySelectorAll('.track[data-sid="'+CSS.escape(id)+'"] .t-dur span:first-child').forEach(e=>e.textContent=fmtMs(ms));
}

// -- kuyruk görünümü --
let queueData=[];
function onQueue(json){try{queueData=JSON.parse(json);}catch(e){queueData=[];}if(view==='queue')renderQueue();renderRightPanel();}
function renderQueue(){
  const m=$('#view');m.innerHTML='';const pad=el('div','view-pad');
  const head=el('div','qhead');head.appendChild(el('div','section-title','📋 Kuyruk'));
  if(queueData.length){const cl=el('button','btn','Kuyruğu temizle');cl.onclick=()=>bridge.clearQueue();head.appendChild(cl);}
  pad.appendChild(head);
  if(track&&!track.none){pad.appendChild(el('div','q-label','Şimdi çalıyor'));
    const nowRow=trackRowLite(track,-1,track.playlist,true);pad.appendChild(nowRow);}
  pad.appendChild(el('div','q-label','Sıradakiler'));
  if(!queueData.length){pad.appendChild(el('div','empty-hint','Kuyruk boş. Şarkı menüsünden “Sıraya ekle” diyebilirsin.'));}
  queueData.forEach((s,i)=>{const r=trackRowLite(s,i,s.playlist,false);
    r.onclick=()=>bridge.playQueueIndex(i);
    const rm=el('span','t-menu','✕');rm.onclick=e=>{e.stopPropagation();bridge.removeFromQueue(i);};
    r.querySelector('.t-dur').appendChild(rm);pad.appendChild(r);});
  m.appendChild(pad);
}
function trackRowLite(s,i,pl,active){
  const t=el('div','track'+(active?' active':''));t.dataset.sid=s.id;
  const idx=el('div','t-index',active?'♪':String(i+1));
  const main=el('div','t-main');main.appendChild(coverImg('t-cover',s));
  const txt=el('div','t-txt');txt.appendChild(el('div','t-title',s.title));txt.appendChild(el('div','t-artist',s.artist||'—'));main.appendChild(txt);
  const src=el('div','t-album',pl||'');const fav=el('div','t-fav','');
  const dur=el('div','t-dur');dur.appendChild(el('span',null,fmtMs(s.duration_ms)));
  t.append(idx,main,src,fav,dur);return t;
}

// -- istatistik sayfası --
function renderStats(){
  const m=$('#view');m.innerHTML='';const pad=el('div','view-pad');
  pad.appendChild(el('div','section-title','📊 İstatistikler'));
  const all=[];for(const pl in S.playlists)for(const s of S.playlists[pl])all.push(s);
  const total=all.length, pls=Object.keys(S.playlists).length;
  const secs=(S.stats&&S.stats.total_seconds)||0;const h=Math.floor(secs/3600),mn=Math.floor(secs%3600/60);
  const cards=el('div','stat-cards');
  [['🎵',total,'Toplam parça'],['📂',pls,'Çalma listesi'],['⏱',(h?h+' sa '+mn+' dk':mn+' dk'),'Dinleme süresi']].forEach(([ic,v,l])=>{
    const c=el('div','stat-card');c.innerHTML='<div class="sc-ic">'+ic+'</div><div class="sc-v">'+v+'</div><div class="sc-l">'+esc(l)+'</div>';cards.appendChild(c);});
  pad.appendChild(cards);
  pad.appendChild(el('div','section-title','⭐ En Çok Dinlenenler'));
  const top=all.filter(s=>s.play_count>0).sort((a,b)=>b.play_count-a.play_count).slice(0,10);
  if(!top.length){pad.appendChild(el('div','empty-hint','Henüz yeterli veri yok. Biraz müzik çal!'));}
  const maxc=top.length?top[0].play_count:1;
  top.forEach((s,i)=>{const r=el('div','top-row');
    r.innerHTML='<div class="top-rank">'+(i+1)+'</div>';
    const im=coverImg('top-cover',s);r.appendChild(im);
    const info=el('div','top-info');info.appendChild(el('div','top-name',s.title));
    const bar=el('div','top-bar');const fill=el('div','top-fill');fill.style.width=(s.play_count/maxc*100)+'%';bar.appendChild(fill);info.appendChild(bar);
    r.appendChild(info);r.appendChild(el('div','top-count',s.play_count+' kez'));
    pad.appendChild(r);});
  m.appendChild(pad);
}

// -- tam ekran şimdi çalıyor --
function openFullscreen(){
  closeFullscreen();
  const o=el('div','fs-now');o.id='fsNow';
  const bg=el('div','fs-bg');o.appendChild(bg);
  const close=el('button','fs-close','✕');close.onclick=closeFullscreen;o.appendChild(close);
  const inner=el('div','fs-inner');
  const cov=track&&!track.none?coverImg('fs-cover',track):el('img','fs-cover');if(!track||track.none)cov.src=PLACEHOLDER;
  inner.appendChild(cov);
  const info=el('div','fs-info');
  info.appendChild(el('div','fs-title',track&&!track.none?track.title:'—'));
  info.appendChild(el('div','fs-artist',track&&!track.none?(track.artist||'Yerel Parça'):''));
  const cv=el('canvas','fs-viz');cv.id='fsViz';info.appendChild(cv);
  if(track&&!track.none&&track.lyrics){const ly=el('div','fs-lyrics',track.lyrics);info.appendChild(ly);}
  inner.appendChild(info);o.appendChild(inner);
  if(track&&!track.none)dominantColor(track.cover,c=>{if(c)bg.style.background='radial-gradient(1200px 700px at 30% 20%, '+c+', #0a0a0b 70%)';});
  document.body.appendChild(o);
  document.addEventListener('keydown',fsEsc);
}
function fsEsc(e){if(e.key==='Escape')closeFullscreen();}
function closeFullscreen(){const o=$('#fsNow');if(o)o.remove();document.removeEventListener('keydown',fsEsc);}

// -- klavye kısayolları --
function showShortcuts(){
  const rows=[['Boşluk','Oynat / Duraklat'],['← / →','10 sn geri / ileri'],['↑ / ↓','Ses',],['S','Karıştır'],['L','Tekrar'],['N / P','Sonraki / Önceki'],['F','Tam ekran'],['/','Arama'],['?','Bu pencere']];
  const back=el('div','modal-back');const mo=el('div','modal');mo.style.width='440px';
  mo.appendChild(el('h3',null,'⌨ Klavye Kısayolları'));
  const list=el('div','sc-list');
  rows.forEach(([k,d])=>{const r=el('div','sc-row');r.innerHTML='<kbd>'+esc(k)+'</kbd><span>'+esc(d)+'</span>';list.appendChild(r);});
  mo.appendChild(list);
  const act=el('div','m-actions');const ok=el('button','btn accent','Kapat');ok.onclick=()=>back.remove();act.appendChild(ok);mo.appendChild(act);
  back.appendChild(mo);back.onclick=e=>{if(e.target===back)back.remove();};document.body.appendChild(back);
}

// -- indirme göstergesi (pill) --
function ensureDlPill(){let p=$('#dlPill');if(!p){p=el('div','dl-pill');p.id='dlPill';p.innerHTML='<span class="dl-txt"></span><div class="dl-bar"><div class="dl-fill"></div></div>';document.body.appendChild(p);}return p;}
function updateDlPill(pct,status,q){const p=ensureDlPill();
  if(!status){p.classList.remove('show');return;}
  p.classList.add('show');p.querySelector('.dl-txt').textContent='⬇ '+status+(q?' ('+q+' sırada)':'');
  p.querySelector('.dl-fill').style.width=(pct>0?pct:0)+'%';
  if(pct>=100&&status.indexOf('Dönüş')<0){/* keep */}
}

// -- alt bar mini görselleştirici --
function drawPlayerViz(){
  const cv=$('#playerViz');if(!cv)return;
  const ctx=cv.getContext('2d');const w=cv.width=cv.clientWidth*devicePixelRatio;const h=cv.height=cv.clientHeight*devicePixelRatio;
  ctx.clearRect(0,0,w,h);const acc=getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').trim()||'29,185,84';
  const n=24,gap=1.5*devicePixelRatio,bw=Math.max(1,(w-(n-1)*gap)/n);
  for(let i=0;i<n;i++){const si=Math.floor(i/n*spectrum.length);const lv=active.playing?(spectrum[si]||0):0;
    const bh=Math.max(2,lv*h);ctx.fillStyle='rgba('+acc+','+(.35+.5*lv)+')';ctx.fillRect(i*(bw+gap),h-bh,bw,bh);}
}

/* -- ÇAĞ AÇICI: Şarkı DNA'sı (dalga formu), Ruh Hali, A-B döngü, Ambiyans -- */
let waveData=[], moodData=null, loopAB=null, ambientOn=false, autoMoodColor=false;
function onAnalysis(json){
  let d;try{d=JSON.parse(json);}catch(e){return;}
  if(!track||track.none||d.id!==track.id)return;
  waveData=d.waveform||[]; moodData={label:d.mood,color:d.color}; bpmData=d.bpm||0; specData=d.spectrogram||[];
  if(track){track.bpm=bpmData;track.mood=d.mood;}
  updateMoodChip();
  if(autoMoodColor&&d.color)applyAccentHex(d.color);
  renderRightPanel();
  if(view==='lyrics')renderLyricsView();
  if(view==='queue')renderQueue();
}
function drawSpectrogram(){
  const cv=$('#specCanvas');if(!cv||!specData.length)return;
  const cols=specData.length,rows=specData[0].length;
  const w=cv.width=cv.clientWidth*devicePixelRatio,h=cv.height=cv.clientHeight*devicePixelRatio;
  const ctx=cv.getContext('2d');ctx.clearRect(0,0,w,h);
  const cw=w/cols,ch=h/rows;const acc=hexToRgb('#'+rgbCssToHex(getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()));
  for(let x=0;x<cols;x++)for(let y=0;y<rows;y++){const v=specData[x][y];
    ctx.fillStyle='rgba('+acc[0]+','+acc[1]+','+acc[2]+','+(v*v).toFixed(2)+')';
    ctx.fillRect(x*cw,h-(y+1)*ch,Math.ceil(cw),Math.ceil(ch));}
}
// -- LRC zaman kodlu şarkı sözleri --
function parseLRC(text){
  const lines=[];let plain=false;
  (text||'').split('\n').forEach(l=>{const m=l.match(/^\[(\d{1,2}):(\d{2})(?:[.:](\d{1,2}))?\]\s*(.*)$/);
    if(m){lines.push({t:(+m[1])*60+(+m[2])+(m[3]?(+m[3])/100:0),txt:m[4]});}else if(l.trim()){plain=true;}});
  return lines.length?lines.sort((a,b)=>a.t-b.t):null;
}
function syncLyrics(pos){
  const box=document.querySelector('.lrc-lines');if(!box)return;
  const lines=box._lrc;if(!lines)return;
  let cur=-1;for(let i=0;i<lines.length;i++){if(pos>=lines[i].t)cur=i;else break;}
  [...box.children].forEach((el2,i)=>el2.classList.toggle('active',i===cur));
  if(cur>=0&&box.children[cur]){box.children[cur].scrollIntoView({block:'center',behavior:'smooth'});}
}
function onLoop(a,b){loopAB=(a<0)?null:{a:a,b:(b<0?null:b)};
  document.querySelectorAll('.abloop-status').forEach(e=>e.textContent=loopStatusText());drawWaveforms();}
function loopStatusText(){if(!loopAB)return'A-B döngü kapalı';if(loopAB.b==null)return'A: '+fmt(loopAB.a)+' — B seç';return'Döngü: '+fmt(loopAB.a)+' – '+fmt(loopAB.b);}
function updateMoodChip(){const c=$('#moodChip');if(!c)return;
  if(moodData&&moodData.label){c.textContent=moodData.label;c.style.display='inline-flex';
    c.style.background='rgba('+hexToRgb(moodData.color).join(',')+',.18)';c.style.color=moodData.color;}
  else c.style.display='none';}
function drawWaveforms(){document.querySelectorAll('canvas.wave-canvas').forEach(drawOneWave);}
function drawOneWave(cv){
  const ctx=cv.getContext('2d');const w=cv.width=cv.clientWidth*devicePixelRatio;const h=cv.height=cv.clientHeight*devicePixelRatio;
  ctx.clearRect(0,0,w,h);if(!waveData.length)return;
  const acc=getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').trim()||'29,185,84';
  const n=waveData.length,bw=w/n;const prog=lastDur>0?lastPos/lastDur:0;
  for(let i=0;i<n;i++){const bh=Math.max(2,waveData[i]*h*0.92);const played=(i/n)<=prog;
    ctx.fillStyle=played?('rgb('+acc+')'):'rgba(255,255,255,.20)';
    ctx.fillRect(i*bw,(h-bh)/2,Math.max(1,bw-0.6),bh);}
  if(loopAB&&lastDur>0){const ax=(loopAB.a/lastDur)*w;
    if(loopAB.b!=null){const bx=(loopAB.b/lastDur)*w;ctx.fillStyle='rgba(255,210,74,.14)';ctx.fillRect(ax,0,bx-ax,h);ctx.fillStyle='#ffd24a';ctx.fillRect(bx-1,0,2,h);}
    ctx.fillStyle='#ffd24a';ctx.fillRect(ax,0,2,h);}
}
function waveSeek(cv,e){if(!lastDur)return;const r=cv.getBoundingClientRect();bridge.seek((e.clientX-r.left)/r.width*lastDur);}
function buildWave(){const cv=el('canvas','wave-canvas');cv.title='Şarkı DNA’sı — tıkla seç';cv.onclick=e=>waveSeek(cv,e);return cv;}
function buildAbControls(){
  const box=el('div','abloop');
  box.appendChild(el('span','ab-label','🔁 A-B Döngü'));
  const a=el('button','ab-btn','A');a.onclick=()=>bridge.setLoopA();
  const b=el('button','ab-btn','B');b.onclick=()=>bridge.setLoopB();
  const c=el('button','ab-btn','✕');c.onclick=()=>bridge.clearLoop();
  box.append(a,b,c,el('span','abloop-status',loopStatusText()));return box;
}
function toggleAmbient(){ambientOn=!ambientOn;$('#pAmbient').classList.toggle('active',ambientOn);
  const a=$('#ambient');a.classList.toggle('on',ambientOn);if(!ambientOn)a.style.boxShadow='none';
  showToast(ambientOn?'Ambiyans ışığı açık':'Ambiyans ışığı kapalı');}
function hexOrRgbA(c,al){if(!c)return'rgba(29,185,84,'+al+')';if(c[0]==='#'){const r=hexToRgb(c);return'rgba('+r.join(',')+','+al+')';}if(c.startsWith('rgb(')){return c.replace('rgb(','rgba(').replace(')',','+al+')');}return c;}
function updateAmbient(){if(!ambientOn)return;const a=$('#ambient');
  const bass=((spectrum[0]||0)+(spectrum[1]||0)+(spectrum[2]||0)+(spectrum[3]||0))/4;
  const col=(moodData&&moodData.color)||('#'+rgbCssToHex(getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()));
  const inten=active.playing?(0.30+bass*0.85):0.12;
  a.style.boxShadow='inset 0 0 '+(70+bass*140)+'px '+(16+bass*44)+'px '+hexOrRgbA(col,inten);}
function rgbCssToHex(c){return c&&c[0]==='#'?c.slice(1):'1db954';}

/* -- 3 durumlu tekrar + karaoke hızlı düğme + kompakt -- */
function cycleRepeat(){const m=((active.repeat_mode==null?1:active.repeat_mode)+1)%3;active.repeat_mode=m;bridge.setRepeatMode(m);updateRepeatBtn();
  showToast(['Tekrar kapalı','Listeyi tekrarla','Parçayı tekrarla'][m]);}
function updateRepeatBtn(){const b=$('#pRepeat');const m=active.repeat_mode==null?1:active.repeat_mode;
  b.innerHTML=fa('repeat')+(m===2?'<span class="rep1">1</span>':'');b.classList.toggle('on',m!==0);}
let karaokeOn=false;
function toggleKaraoke(){karaokeOn=!karaokeOn;effects.karaoke=karaokeOn?85:0;bridge.setEffect('karaoke',effects.karaoke);
  $('#pKaraoke').classList.toggle('on',karaokeOn);showToast(karaokeOn?'Karaoke açık (vokal azaltıldı)':'Karaoke kapalı');}
function toggleCompact(){document.body.classList.toggle('compact');}

/* ================= KLİP MODU =================
   Spotify gibi: klip ekranı KAPLAMAZ — ana alana gömülür, kenar çubuğu ve
   alt player yerinde kalır. Alt bar klip çalarken videoyu sürer (oynat/duraklat,
   seek, ses); "Sese geç" ile müziğe dönülür.
   QtWebEngine H.264/AAC oynatamaz ve YouTube muxed webm vermiyor: video VP9 +
   ses Opus AYRI gelir, burada senkron tutulur (video saat, ses ona hizalanır). */
let clip=null;              // {d, host, v, a, sync, lrc, lyrBox, lyrIdx, mode}
let clipPrevView='home';
let clipLyricsOn=true;      // sözler klip üstünde görünsün mü

/* KRİTİK: video/ses elementleri BİR KEZ kurulur ve kalıcı `clip.host` içinde
   yaşar. Sekme/menü değiştikçe host YOK EDİLMEZ; sadece taşınır (büyük sahne
   <-> köşedeki mini oynatıcı). Böylece akış kesilmez ve yt-dlp'yi her seferinde
   yeniden bekletmez. Klip yalnızca "Sese geç", mini kapat veya parça değişince biter. */
function onVideoReady(json){
  let d;try{d=JSON.parse(json);}catch(e){return;}
  if(view!=='clip')clipPrevView=view;
  buildClipMedia(d);
  showView('clip');
}
function buildClipMedia(d){
  if(clip)stopClip(false);
  const host=el('div','clip-host');
  const v=el('video','clip-video');v.src=d.video;v.playsInline=true;v.controls=false;
  host.appendChild(v);
  const lyrBox=el('div','clip-lyrics');host.appendChild(lyrBox);
  clip={d:d,host:host,v:v,a:null,sync:null,lrc:parseLRC(track&&track.lyrics),lyrBox:lyrBox,lyrIdx:-2,mode:'full'};
  v.onloadedmetadata=()=>{if(v.videoWidth&&v.videoHeight)host.style.setProperty('--ar',v.videoWidth+'/'+v.videoHeight);};
  v.onclick=()=>{if(clip&&clip.mode==='mini')showView('clip');else togglePlayback();};

  const at0=Math.max(0,+d.start||0);      // müzikten devralınan saniye
  if(d.audio){
    /* YouTube muxed webm vermiyor: video VP9, ses Opus — iki ayrı akış.
       Video saat (clock) kabul edilir, ses ona hizalanır. */
    const a=el('audio');a.src=d.audio;a.preload='auto';v.muted=true;
    a.volume=Math.min(1,volume/100);host.appendChild(a);clip.a=a;
    let started=0;
    const start=()=>{if(++started<2)return;v.currentTime=at0;a.currentTime=at0;
      v.play().catch(()=>{});a.play().catch(()=>showToast('Ses akışı başlatılamadı.'));};
    v.addEventListener('canplay',start,{once:true});
    a.addEventListener('canplay',start,{once:true});
    v.onseeked=()=>{a.currentTime=v.currentTime;};
    v.onwaiting=()=>a.pause();                        // video buffer'da -> ses beklesin
    v.onplaying=()=>{a.currentTime=v.currentTime;a.play().catch(()=>{});};
    a.onerror=()=>showToast('Ses akışı yüklenemedi.');
    clip.sync=setInterval(()=>{                       // kayma düzeltme
      if(clip&&!v.paused&&Math.abs(a.currentTime-v.currentTime)>0.25)a.currentTime=v.currentTime;
    },1000);
  }else{
    v.volume=Math.min(1,volume/100);
    v.addEventListener('canplay',()=>{if(at0>0)v.currentTime=at0;v.play().catch(()=>{});},{once:true});
  }
  // Alt player bar klibi sürsün (büyük sahnede de mini modda da)
  v.onplay=()=>{if(clip&&clip.a){clip.a.currentTime=v.currentTime;clip.a.play().catch(()=>{});}
    active.playing=true;updatePlayBtn();};
  v.onpause=()=>{if(clip&&clip.a)clip.a.pause();active.playing=false;updatePlayBtn();};
  v.ontimeupdate=()=>{if(!clip)return;updateSeek(v.currentTime||0,v.duration||0);clipSyncLyrics(v.currentTime||0);};
  v.onerror=()=>showToast('Klip akışı oynatılamadı (kodek/ağ).');
}
function stopClip(resume){
  const c=clip;clip=null;
  if(!c)return;
  if(c.sync)clearInterval(c.sync);
  let at=-1;
  /* Akışı gerçekten kes ve elementleri DOM'dan kaldır: sadece pause etmek ağ
     trafiğini sürdürür, DOM'da kalan canlı <video> kapanışta WebEngine'i çökertiyor. */
  if(c.v){at=c.v.currentTime||0;c.v.pause();c.v.removeAttribute('src');c.v.load();}
  if(c.a){c.a.pause();c.a.removeAttribute('src');c.a.load();}
  if(c.host)c.host.remove();
  removeMiniClip();
  if(bridge&&resume)bridge.resumeMusic(at);   // müzik klibin bıraktığı saniyeden
}
function exitClip(){
  const wasClipView=(view==='clip');
  stopClip(true);
  if(wasClipView)showView(clipPrevView||'home');
}
function removeMiniClip(){const mm=$('#clipMini');if(mm)mm.remove();}
function goMiniClip(){               // klibi köşedeki mini oynatıcıya indir (akış SÜRER)
  if(!clip||clip.mode==='mini')return;
  clip.mode='mini';clip.lyrBox.style.display='none';
  const mini=el('div','clip-mini');mini.id='clipMini';
  const bar=el('div','clip-mini-bar');
  const exp=el('button','clip-mini-btn');exp.innerHTML=fa('expand');exp.title='Büyüt';
  exp.onclick=e=>{e.stopPropagation();showView('clip');};
  const cls=el('button','clip-mini-btn');cls.innerHTML=fa('xmark');cls.title='Klibi kapat';
  cls.onclick=e=>{e.stopPropagation();exitClip();};
  bar.append(exp,cls);
  clip.host.className='clip-host mini';
  mini.append(clip.host,bar);       // host'u mini kutuya TAŞI (yeniden yükleme yok)
  document.body.appendChild(mini);
}
function renderClipView(){
  const m=$('#view');m.innerHTML='';
  if(!clip){m.appendChild(el('div','empty-hint','Klip yok.'));return;}
  const d=clip.d;
  const wrap=el('div','clip-view');

  const head=el('div','clip-head');
  head.appendChild(el('div','clip-title',d.title||(track&&track.title)||'Klip'));
  head.appendChild(el('span','clip-hint','internetten akış · indirme yok'));
  const btns=el('div','clip-btns');
  const lyrBtn=el('button','clip-btn');lyrBtn.innerHTML=fa('align-left');
  lyrBtn.title='Sözleri klibin üstünde göster';lyrBtn.classList.toggle('on',clipLyricsOn);
  const fsBtn=el('button','clip-btn');fsBtn.innerHTML=fa('expand');fsBtn.title='Tam ekran';
  const audBtn=el('button','clip-btn primary');audBtn.innerHTML=fa('music')+' Sese geç';
  audBtn.title='Klipten çık, müziğe dön';audBtn.onclick=exitClip;
  btns.append(lyrBtn,fsBtn,audBtn);head.appendChild(btns);wrap.appendChild(head);

  const stage=el('div','clip-stage');
  clip.mode='full';clip.host.className='clip-host';
  stage.appendChild(clip.host);          // kalıcı host'u büyük sahneye TAŞI (akış kesilmez)
  removeMiniClip();                      // varsa köşedeki mini kutuyu kaldır
  clip.lyrBox.style.display=(clipLyricsOn&&clip.lrc)?'flex':'none';
  clip.lyrIdx=-2;                        // yeniden çiz
  fsBtn.onclick=()=>{if(document.fullscreenElement)document.exitFullscreen();else stage.requestFullscreen().catch(()=>{});};
  lyrBtn.onclick=()=>{clipLyricsOn=!clipLyricsOn;lyrBtn.classList.toggle('on',clipLyricsOn);
    clip.lyrBox.style.display=(clipLyricsOn&&clip.lrc)?'flex':'none';
    showToast(!clip.lrc?'Bu şarkının zaman kodlu sözü yok.':clipLyricsOn?'Sözler klipte açık':'Sözler klipte kapalı');};
  wrap.appendChild(stage);
  m.appendChild(wrap);
  clipSyncLyrics(clip.v.currentTime||0);
}
function clipUpdateLyrics(){          // sözler klip açıkken gelirse (Lyrica async) anında görünsün
  if(!clip)return;
  clip.lrc=parseLRC(track&&track.lyrics);clip.lyrIdx=-2;
  if(clip.lyrBox){
    clip.lyrBox.style.display=(clipLyricsOn&&clip.lrc)?'flex':'none';
    if(clip.v)clipSyncLyrics(clip.v.currentTime||0);
  }
}
function clipSyncLyrics(pos){
  if(!clip||!clip.lrc||!clip.lyrBox)return;
  const L=clip.lrc;let cur=-1;
  for(let i=0;i<L.length;i++){if(pos>=L[i].t)cur=i;else break;}
  if(cur===clip.lyrIdx)return;clip.lyrIdx=cur;      // sadece satır değişince çiz
  clip.lyrBox.innerHTML='';
  if(cur<0){if(L[0])clip.lyrBox.appendChild(el('div','clip-line next',L[0].txt||' '));return;}
  clip.lyrBox.appendChild(el('div','clip-line cur',L[cur].txt||' '));
  if(L[cur+1])clip.lyrBox.appendChild(el('div','clip-line next',L[cur+1].txt||' '));
}

/* -- Akıllı Listeler (dinamik) -- */
function allSongsWithPl(){const out=[],seen=new Set();for(const pl in S.playlists)for(const s of S.playlists[pl]){if(seen.has(s.id))continue;seen.add(s.id);out.push([s,pl]);}return out;}
function smartPlaylists(){const a=allSongsWithPl();return [
  {name:'🔥 En Çok Dinlenenler',items:a.filter(([s])=>s.play_count>0).sort((x,y)=>y[0].play_count-x[0].play_count).slice(0,50)},
  {name:'⚡ Enerjik',items:a.filter(([s])=>(s.mood||'').includes('Enerjik'))},
  {name:'🌙 Sakin',items:a.filter(([s])=>(s.mood||'').includes('Sakin'))},
  {name:'✨ Aydınlık',items:a.filter(([s])=>(s.mood||'').includes('Aydınlık'))},
  {name:'▶ Hiç Çalınmayanlar',items:a.filter(([s])=>!s.play_count)},
];}
function openSmart(sp){
  view='smart';viewPlaylist=null;setNav('');
  const m=$('#view');m.innerHTML='';const pad=el('div','view-pad');
  pad.appendChild(el('div','section-title',sp.name));
  const acts=el('div','pl-actions2');const big=Object.assign(el('button','big-play'),{innerHTML:fa('play')});big.onclick=()=>{if(sp.items[0])bridge.play(sp.items[0][0].id,sp.items[0][1]);};acts.appendChild(big);pad.appendChild(acts);
  const wrap=el('div','tracks');const head=el('div','track-head');
  head.innerHTML='<div style="text-align:center">#</div><div>Başlık</div><div>Kaynak</div><div></div><div style="text-align:right">🕐</div>';wrap.appendChild(head);
  if(!sp.items.length)wrap.appendChild(el('div','empty-hint','Bu akıllı listede henüz şarkı yok.'));
  sp.items.forEach(([s,pl],i)=>wrap.appendChild(trackRow(s,i,pl)));
  pad.appendChild(wrap);m.appendChild(pad);
}

/* -- Komut Paleti (Ctrl+K) -- */
function openPalette(){
  closeMenus();const back=el('div','palette-back');const box=el('div','palette');
  const inp=el('input','palette-input');inp.placeholder='Komut ara veya şarkı/liste bul…';
  const list=el('div','palette-list');box.append(inp,list);back.appendChild(box);
  back.onclick=e=>{if(e.target===back)back.remove();};document.body.appendChild(back);inp.focus();
  const commands=[
    ['🏠 Ana Sayfa',()=>showView('home')],['🔎 Ara',()=>{showView('search');$('#topSearch').focus();}],
    ['🎛 Efektler',()=>showView('effects')],['📊 İstatistikler',()=>showView('stats')],
    ['📋 Kuyruk',()=>showView('queue')],['🔄 Müzik Tara',()=>bridge.scanMusic()],
    ['➕ MP3 Ekle',()=>bridge.importFiles()],['💾 Yedek Al',()=>bridge.backup()],
    ['⛶ Tam Ekran',()=>openFullscreen()],['💡 Ambiyans Işığı',()=>toggleAmbient()],
    ['🎙 Karaoke',()=>toggleKaraoke()],['⌨ Kısayollar',()=>showShortcuts()],
    ['⏭ Sonraki',()=>bridge.next()],['⏮ Önceki',()=>bridge.prev()],['⏯ Oynat/Duraklat',()=>bridge.toggle()],
  ];
  function render(q){
    q=(q||'').toLowerCase();list.innerHTML='';
    commands.filter(c=>c[0].toLowerCase().includes(q)).slice(0,8).forEach(c=>{const it=el('div','palette-item',c[0]);it.onclick=()=>{back.remove();c[1]();};list.appendChild(it);});
    if(q){allSongsWithPl().filter(([s])=>s.title.toLowerCase().includes(q)||(s.artist||'').toLowerCase().includes(q)).slice(0,8).forEach(([s,pl])=>{
      const it=el('div','palette-item','🎵 '+s.title+(s.artist?' — '+s.artist:''));it.onclick=()=>{back.remove();bridge.play(s.id,pl);};list.appendChild(it);});
      Object.keys(S.playlists).filter(n=>n.toLowerCase().includes(q)).slice(0,5).forEach(n=>{const it=el('div','palette-item','📂 '+n);it.onclick=()=>{back.remove();openPlaylist(n);};list.appendChild(it);});}
  }
  render('');inp.oninput=()=>render(inp.value);
  inp.onkeydown=e=>{if(e.key==='Escape')back.remove();else if(e.key==='Enter'){const f=list.querySelector('.palette-item');if(f)f.click();}};
}

/* -- Reverb ortam presetleri -- */
const REVERB_PRESETS={'Kapalı':{reverb:0,echo:0},'Oda':{reverb:30,echo:10,echo_time:20,echo_feedback:20},'Salon':{reverb:55,echo:20,echo_time:40,echo_feedback:30},'Katedral':{reverb:85,echo:35,echo_time:70,echo_feedback:45},'Stüdyo':{reverb:20,echo:0},'Stadyum':{reverb:70,echo:50,echo_time:85,echo_feedback:55}};
function applyReverbPreset(name){const p=REVERB_PRESETS[name];if(!p)return;
  ['reverb','echo','echo_time','echo_feedback'].forEach(k=>{if(p[k]!=null){effects[k]=p[k];bridge.setEffect(k,p[k]);}});
  if(view==='effects')renderEffects();showToast('Ortam: '+name);}

/* ================= BOOT ================= */
new QWebChannel(qt.webChannelTransport,function(channel){
  bridge=channel.objects.bridge;
  wireSignals();wireEvents();
  bridge.getState(function(json){S=JSON.parse(json);initFromState();});
  requestAnimationFrame(vizLoop);
});
