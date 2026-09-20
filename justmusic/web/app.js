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
function showToast(msg){const tn=$('#toast');tn.textContent=T(msg);tn.classList.add('show');clearTimeout(toastT);toastT=setTimeout(()=>tn.classList.remove('show'),2800);}
/* ---- i18n: statik kabuk (title/placeholder/[data-i18n]) + dil değiştir ---- */
function applyStaticI18n(){
  document.querySelectorAll('[title]').forEach(function(e){
    var o=e.getAttribute('data-i18n-title');if(o==null){o=e.getAttribute('title');e.setAttribute('data-i18n-title',o);}
    e.setAttribute('title',T(o));});
  document.querySelectorAll('[placeholder]').forEach(function(e){
    var o=e.getAttribute('data-i18n-ph');if(o==null){o=e.getAttribute('placeholder');e.setAttribute('data-i18n-ph',o);}
    e.setAttribute('placeholder',T(o));});
  document.querySelectorAll('[data-i18n]').forEach(function(e){e.textContent=T(e.getAttribute('data-i18n'));});
  document.documentElement.setAttribute('lang',getLang());
}
function applyLanguage(code){
  setLang(code);
  $('#langSel').value=getLang();
  applyStaticI18n();
  if(bridge)bridge.setLanguage(code);
  // dile bağlı select seçeneklerini yeniden kur (seçimi koru)
  var th=$('#themeSel').value, sl=$('#sleepSel').value;
  $('#themeSel').innerHTML=Object.keys(THEME_LABELS).map(k=>'<option value="'+k+'">'+T(THEME_LABELS[k])+'</option>').join('');$('#themeSel').value=th;
  $('#sleepSel').innerHTML=SLEEPS.map(([v,l])=>'<option value="'+v+'">'+T(l)+'</option>').join('');$('#sleepSel').value=sl;
  updatePlayer();
  showView(view);            // mevcut görünümü yeni dille yeniden çiz
  renderSidebar();
  renderRightPanel();        // sağ "çalınıyor" paneli de çevrilsin
}
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
  const inputs=fields.map(f=>{const i=el('input');i.placeholder=f.ph?T(f.ph):'';i.value=f.val||'';mo.appendChild(i);return i;});
  const act=el('div','m-actions');
  const cancel=el('button','btn',T('İptal'));cancel.onclick=()=>back.remove();
  const ok=el('button','btn accent',T('Tamam'));ok.onclick=()=>{onOk(inputs.map(i=>i.value));back.remove();};
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
  const no=el('button','btn',T('İptal'));no.onclick=()=>back.remove();
  const yes=el('button','btn accent',T('Evet'));yes.onclick=()=>{back.remove();onYes();};
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
    row.title=T(name);   // ikon rayı daralınca kapağın üstünde isim görünsün
    const info=el('div','pl-info');
    info.appendChild(el('div','pl-name',T(name)));
    info.appendChild(el('div','pl-sub',T('Çalma listesi • '+songs.length+' şarkı')));
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
    box.appendChild(el('div','pl-section-label',T('⚙ Akıllı Listeler')));
    sps.forEach(sp=>{const row=el('div','pl-row');row.title=T(sp.name);
      const cv=el('div','pl-cover smart-cover');cv.textContent=sp.name.split(' ')[0];
      const info=el('div','pl-info');info.appendChild(el('div','pl-name',T(sp.name).replace(/^\S+\s/,'')));info.appendChild(el('div','pl-sub',T(sp.items.length+' şarkı')));
      row.append(cv,info);row.onclick=()=>openSmart(sp);box.appendChild(row);});
  }
}
function playlistMenu(e,name){
  const items=[{text:T('▶ Çal'),fn:()=>playPlaylist(name)},
    {text:T('🔀 Karıştırarak çal'),fn:()=>bridge.playPlaylistShuffled(name,'')},
    {text:T('➕ Tümünü kuyruğa ekle'),fn:()=>bridge.addAllToQueue(name)},
    {sep:true},
    {text:T('🧹 Tekrarları kaldır'),fn:()=>bridge.removeDuplicates(name)},
    {text:T('📄 M3U dışa aktar'),fn:()=>bridge.exportM3U(name)},
    {text:T('📝 Açıklama düzenle'),fn:()=>modalPrompt(T('Liste açıklaması'),[{ph:'Açıklama',val:(S.settings.playlist_desc&&S.settings.playlist_desc[name])||''}],v=>bridge.setPlaylistDescription(name,v[0]))},
    {text:T('🖼 Kapak ayarla (URL)'),fn:()=>modalPrompt(T('Kapak görsel URL'),[{ph:'https://…',val:(S.settings.playlist_covers&&S.settings.playlist_covers[name])||''}],v=>{if(v[0].trim())bridge.setPlaylistCover(name,v[0].trim());})}];
  if(!S.protected.includes(name)){
    items.push({text:T('✏️ Yeniden adlandır'),fn:()=>modalPrompt(T('Listeyi yeniden adlandır'),[{ph:'Yeni ad',val:name}],v=>{if(v[0].trim())bridge.renamePlaylist(name,v[0].trim());})});
    items.push({text:T('🗑 Listeyi sil'),fn:()=>modalConfirm(T('“'+name+'” silinsin mi?'),()=>bridge.deletePlaylist(name))});
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
  else if(v==='now')renderNowHero();   // B: merkez "Şimdi çalıyor" hero
  else renderHome();
  document.getElementById('app').classList.toggle('hero-mode',v==='now');
  if(v!=='clip'&&clip)goMiniClip();   // klipten ayrılınca AKIŞI KESME — köşeye küçült
  recordHistory();
}
/* ---- gezinme geçmişi (üst-sol geri/ileri okları) ---- */
let navLock=false;
function recordHistory(){
  if(navLock||view==='clip')return;                 // klip modu geçmişe girmez
  const loc={view:view,playlist:viewPlaylist};
  const cur=history[histPos];
  if(cur&&cur.view===loc.view&&cur.playlist===loc.playlist)return;
  history=history.slice(0,histPos+1);history.push(loc);histPos=history.length-1;
  updateNavButtons();
}
function goToLoc(loc){
  navLock=true;
  if(loc.view==='playlist'&&loc.playlist){
    viewPlaylist=loc.playlist;view='playlist';setNav('playlist');
    bridge.selectPlaylist(loc.playlist);renderPlaylist(loc.playlist);renderSidebar();
    if(clip)goMiniClip();
  }else showView(loc.view);
  navLock=false;
}
function navBack(){if(histPos>0){histPos--;goToLoc(history[histPos]);updateNavButtons();}}
function navFwd(){if(histPos<history.length-1){histPos++;goToLoc(history[histPos]);updateNavButtons();}}
function updateNavButtons(){
  const b=$('#navBack'),f=$('#navFwd');
  if(b)b.classList.toggle('nav-off',histPos<=0);
  if(f)f.classList.toggle('nav-off',histPos>=history.length-1);
}
function pushHistory(){recordHistory();}   // geriye uyum
function setSidebarRail(on){
  document.getElementById('app').classList.toggle('sidebar-rail',on);
  // daralınca ikonların üstünde etiket görünsün: nav başlığını span metninden al (çeviri-uyumlu)
  document.querySelectorAll('.nav-link').forEach(b=>{const s=b.querySelector('span');if(s)b.title=s.textContent.trim();});
  try{localStorage.setItem('jm_sidebar_rail',on?'1':'0');}catch(e){}
}
function openPlaylist(name){viewPlaylist=name;view='playlist';setNav('playlist');bridge.selectPlaylist(name);renderPlaylist(name);renderSidebar();
  if(clip)goMiniClip();recordHistory();}   // klip yaşıyorsa küçült, öldürme

/* ================= HOME ================= */
function greeting(){const h=new Date().getHours();return h<6?T('İyi geceler'):h<12?T('Günaydın'):h<18?T('İyi günler'):T('İyi akşamlar');}
function renderHome(){
  const m=$('#view');m.innerHTML='';const pad=el('div','view-pad');
  const hero=el('div','home-hero');hero.appendChild(el('div','section-title greet',greeting()));pad.appendChild(hero);
  const grid=el('div','quick-grid');
  Object.keys(S.playlists||{}).slice(0,8).forEach(name=>{
    const songs=songsOf(name);const cover=songs.find(s=>s.hasCover)||songs[0];
    const c=el('div','quick-card');
    const im=cover?coverImg('qc-img',cover):el('img','qc-img');if(!cover)im.src=PLACEHOLDER;
    const pb=Object.assign(el('div','qc-play'),{innerHTML:fa('play')});pb.onclick=ev=>{ev.stopPropagation();playPlaylist(name);};
    c.append(im,el('div','qc-name',T(name)),pb);
    c.onclick=()=>openPlaylist(name);
    grid.appendChild(c);
  });
  pad.appendChild(grid);
  // Son çalınanlar
  const recent=(S.recent||[]);
  if(recent.length){
    pad.appendChild(el('div','section-title',T('Son çalınanlar')));
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
  pad.appendChild(el('div','section-title',T('Çalma Listelerin')));
  const row=el('div','card-row');
  Object.keys(S.playlists||{}).forEach(name=>{
    const songs=songsOf(name);
    const card=el('div','card');
    card.append(coverBlock(songs,'card-cover'),el('div','card-name',T(name)),el('div','card-sub',T(songs.length+' şarkı')));
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
  meta.appendChild(el('div','hdr-kind',T('Çalma listesi')));
  meta.appendChild(el('div','hdr-name',T(name)));
  const desc=S.settings.playlist_desc&&S.settings.playlist_desc[name];
  if(desc)meta.appendChild(el('div','hdr-desc',desc));
  const totalMs=songs.reduce((a,s)=>a+(s.duration_ms||0),0);
  const sub=el('div','hdr-sub');sub.innerHTML='<b>'+esc(S.settings&&S.settings.owner||T('Kütüphanem'))+'</b> • '+T(songs.length+' şarkı')+(totalMs?' • '+fmtMs(totalMs):'');
  meta.appendChild(sub);header.append(hc,meta);m.appendChild(header);

  const acts=el('div','pl-actions');
  const big=Object.assign(el('button','big-play'),{innerHTML:fa('play')});big.onclick=()=>playPlaylist(name);
  const shuf=el('button','act-icon'+(active.shuffle?' on':''),'🔀');shuf.title=T('Karıştır');shuf.onclick=()=>{toggleShuffle();shuf.classList.toggle('on',active.shuffle);};
  const sync=el('button','act-icon','🖼');sync.title=T('İsim & Kapak senkronu');sync.onclick=()=>modalConfirm(T('“'+name+'” adları dosya adından temizlenip kapaklar yeniden çekilsin mi?'),()=>bridge.syncNamesCovers(name));
  const spacer=el('div');spacer.style.flex='1';
  const sortSel=el('select','mini-sel');sortSel.title=T('Sırala');
  [['default','↕ Sıra'],['title','Ada göre'],['artist','Sanatçıya göre'],['duration','Süreye göre'],['plays','En çok çalınan']].forEach(([v,l])=>{const o=el('option',null,T(l));o.value=v;sortSel.appendChild(o);});
  sortSel.value=playlistSort;sortSel.onchange=()=>{playlistSort=sortSel.value;renderPlaylist(name);};
  acts.append(big,shuf,sync,spacer,sortSel);m.appendChild(acts);

  const wrap=el('div','tracks');
  const head=el('div','track-head');
  head.innerHTML='<div style="text-align:center">#</div><div>'+T('Başlık')+'</div><div>'+T('Kaynak')+'</div><div></div><div style="text-align:right">🕐</div>';
  wrap.appendChild(head);
  if(!songs.length){wrap.appendChild(el('div','empty-hint',T('Bu liste boş. Sağ üstten MP3 ekleyebilir veya YouTube’dan indirebilirsin.')));}
  let disp=songs.map(s=>s);
  if(playlistSort==='title')disp.sort((a,b)=>(a.title||'').localeCompare(b.title||'','tr'));
  else if(playlistSort==='artist')disp.sort((a,b)=>(a.artist||'').localeCompare(b.artist||'','tr'));
  else if(playlistSort==='duration')disp.sort((a,b)=>(a.duration_ms||0)-(b.duration_ms||0));
  else if(playlistSort==='plays')disp.sort((a,b)=>(b.play_count||0)-(a.play_count||0));
  disp.forEach((s,i)=>wrap.appendChild(trackRow(s,i,name,true)));   // gerçek tam-liste: sürüklenebilir
  m.appendChild(wrap);
  highlightActive();
}
function trackRow(s,i,pl,reorderable){
  const t=el('div','track');t.dataset.sid=s.id;t.style.setProperty('--i',Math.min(i,18));
  const idx=el('div','t-index');idx.innerHTML='<span class="num">'+(i+1)+'</span><span class="ic">▶</span>';
  const main=el('div','t-main');
  main.appendChild(coverImg('t-cover',s));
  const txt=el('div','t-txt');
  txt.appendChild(el('div','t-title',s.title));
  txt.appendChild(el('div','t-artist',s.artist||(s.source==='youtube'?'YouTube':T('Yerel Parça'))));
  main.appendChild(txt);
  const src=el('div','t-album',s.source==='youtube'?'YouTube':T('Yerel'));
  const fav=el('div','t-fav'+(s.favorite?' on':''),s.favorite?'❤':'♡');
  fav.onclick=e=>{e.stopPropagation();bridge.toggleFavorite(s.id,pl);};
  const dur=el('div','t-dur');dur.appendChild(el('span',null,fmtMs(s.duration_ms)));
  const menu=el('span','t-menu','⋮');menu.onclick=e=>{e.stopPropagation();trackMenu(e,s,pl);};
  dur.appendChild(menu);
  t.append(idx,main,src,fav,dur);
  t.onclick=()=>bridge.play(s.id,pl);
  t.oncontextmenu=e=>{e.preventDefault();trackMenu(e,s,pl);};
  // Sürükle-sırala YALNIZ gerçek tam-liste görünümünde (renderPlaylist). Arama/akıllı
  // listede indeks filtrelenmiş listeye ait; gerçek diziye uygulanırsa yanlış şarkı taşınır.
  if(reorderable){
    t.draggable=true;
    t.ondragstart=e=>{e.dataTransfer.setData('text/plain',JSON.stringify({id:s.id,playlist:pl,idx:i}));e.dataTransfer.effectAllowed='copyMove';};
    t.ondragover=e=>{e.preventDefault();t.classList.add('drag-over');};
    t.ondragleave=()=>t.classList.remove('drag-over');
    t.ondrop=e=>{e.preventDefault();t.classList.remove('drag-over');
      try{const d=JSON.parse(e.dataTransfer.getData('text/plain'));
        if(d&&d.playlist===pl&&d.idx!=null&&playlistSort==='default')bridge.reorderSong(pl,d.idx,i);}catch(_){}};
  }
  return t;
}
function trackMenu(e,s,pl){
  const items=[
    {text:T('▶ Çal'),fn:()=>bridge.play(s.id,pl)},
    {text:T('▶ Sıradaki çal'),fn:()=>bridge.playNext(s.id,pl)},
    {text:T('➕ Sıraya ekle'),fn:()=>bridge.addToQueue(s.id,pl)},
    {text:(s.favorite?T('💔 Beğenmekten vazgeç'):T('❤ Beğen')),fn:()=>bridge.toggleFavorite(s.id,pl)},
    {text:T('✏️ Künyeyi düzenle'),fn:()=>modalPrompt(T('Künyeyi düzenle'),[{ph:'Şarkı adı',val:s.title},{ph:'Sanatçı',val:s.artist}],v=>bridge.editMetadata(s.id,pl,v[0],v[1]))},
    {text:T('❌ Listeden kaldır'),fn:()=>bridge.removeSong(s.id,pl)},
    {text:T('📁 Dosya konumunu aç'),fn:()=>bridge.openFileLocation(s.id,pl)},
    {sep:true},{label:T('Şu listeye ekle')},
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
      pad.appendChild(el('div','section-title',T('Çalma Listeleri')));
      const row=el('div','card-row');
      plMatches.forEach(name=>{const songs=songsOf(name);const card=el('div','card');
        card.append(coverBlock(songs,'card-cover'),el('div','card-name',T(name)),el('div','card-sub',T(songs.length+' şarkı')));
        const pb=Object.assign(el('div','card-play'),{innerHTML:fa('play')});pb.onclick=ev=>{ev.stopPropagation();playPlaylist(name);};card.appendChild(pb);
        card.onclick=()=>openPlaylist(name);row.appendChild(card);});
      pad.appendChild(row);
    }
    const songMatches=[];
    for(const pl in S.playlists)for(const s of S.playlists[pl])
      if(s.title.toLowerCase().includes(q)||(s.artist||'').toLowerCase().includes(q))songMatches.push([s,pl]);
    if(songMatches.length){
      pad.appendChild(el('div','section-title',T('Kütüphanendeki Şarkılar')));
      const list=el('div','tracks');
      songMatches.slice(0,40).forEach(([s,pl],i)=>list.appendChild(trackRow(s,i,pl)));
      pad.appendChild(list);
    }
    if(!plMatches.length&&!songMatches.length)pad.appendChild(el('div','empty-hint',T('Kütüphanende “'+esc(localQuery)+'” için sonuç yok.')));
  }
  pad.appendChild(el('div','section-title',T('🔎 YouTube’dan İndir')));
  const info=el('div','empty-hint',q?T('“'+esc(localQuery)+'” için Enter’a bas → YouTube’da 20 sonuç.'):T('Üstteki kutuya yaz; anında kütüphanende arar, Enter → YouTube’dan indir.'));
  info.id='searchInfo';pad.appendChild(info);
  const res=el('div','search-results');res.id='searchResults';pad.appendChild(res);
  m.appendChild(pad);
  if(searchRows.length)renderSearchRows();
}
function isPlaylistUrl(q){return /[?&]list=/.test(q)||/\/playlist\?/.test(q);}
function doSearch(q){
  q=q.trim();if(!q)return;
  if(view!=='search'){showView('search');}
  const info=$('#searchInfo');if(info)info.style.display='';
  searchRows=[];const res=$('#searchResults');if(res)res.innerHTML='';
  if(isPlaylistUrl(q)){                     // playlist URL → tüm parçaları önizle-ve-seç
    if(info)info.textContent=T('📃 Playlist çözülüyor…');
    bridge.importPlaylist(q);
  }else{
    if(info)info.textContent=T('“'+q+'” aranıyor…');
    bridge.searchYouTube(q);
  }
}
function onSearchResults(json){
  let data;try{data=JSON.parse(json);}catch(e){return;}
  if(data.error){const info=$('#searchInfo');if(info)info.textContent=T('Arama hatası: ')+data.error;return;}
  searchRows=data;renderSearchRows();
}
function renderSearchRows(){
  const res=$('#searchResults');if(!res)return;const info=$('#searchInfo');
  res.innerHTML='';
  if(!searchRows.length){if(info)info.textContent=T('Sonuç yok.');return;}
  if(info)info.style.display='none';
  const tb=el('div','sr-toolbar');
  const cnt=el('span','count',T(searchRows.length+' sonuç — satıra tıkla anında indir, ya da seçip toplu indir'));
  const selAll=el('button','btn',T('☑ Tümünü Seç'));
  const dl=el('button','btn accent',T('⬇ Seçilenleri İndir'));
  tb.append(selAll,cnt);tb.append(dl);tb.style.justifyContent='space-between';res.appendChild(tb);
  const markDone=(row)=>{row.classList.add('done');const b=row.querySelector('.sr-dlbtn');if(b){b.innerHTML=fa('check');b.title=T('İndirmeye eklendi');}};
  const startOne=(r,row)=>{                         // tek tıkla ANINDA indir
    if(row.classList.contains('done'))return;
    markDone(row);
    bridge.downloadUrls(JSON.stringify([r.url]));
    showToast('“'+(r.title||'Parça').slice(0,42)+'” indirmeye eklendi.');
  };
  searchRows.forEach((r,i)=>{
    const row=el('div','sr-row');
    const chk=el('input','sr-check');chk.type='checkbox';chk.dataset.i=i;chk.title=T('Toplu indirme için seç');
    const im=el('img');im.src=r.thumbnail;im.onerror=()=>{im.onerror=null;im.src=PLACEHOLDER;};
    const txt=el('div');txt.appendChild(el('div','sr-title',r.title));
    txt.appendChild(el('div','sr-sub',(r.uploader||'YouTube')+(r.duration_ms?'  ·  '+fmtMs(r.duration_ms):'')));
    const dur=el('div','sr-dur',r.duration_ms?fmtMs(r.duration_ms):'');
    const dlb=el('button','sr-dlbtn');dlb.innerHTML=fa('download');dlb.title=T('Hemen indir');
    row.append(chk,im,txt,dur,dlb);
    chk.onclick=e=>e.stopPropagation();             // checkbox yalnızca seçim
    dlb.onclick=e=>{e.stopPropagation();startOne(r,row);};
    row.onclick=e=>{if(e.target===chk)return;startOne(r,row);};   // satıra tıkla → anında indir
    res.appendChild(row);
  });
  selAll.onclick=()=>{const cs=res.querySelectorAll('.sr-check');const all=[...cs].every(c=>c.checked);cs.forEach(c=>c.checked=!all);};
  dl.onclick=()=>{
    const rows=[...res.querySelectorAll('.sr-check')].filter(c=>c.checked).map(c=>c.closest('.sr-row'));
    const urls=[...res.querySelectorAll('.sr-check')].filter(c=>c.checked).map(c=>searchRows[+c.dataset.i].url);
    if(!urls.length){showToast('Hiçbir şey seçmedin — istersen satıra tıklayıp tek tek de indirebilirsin.');return;}
    rows.forEach(markDone);
    bridge.downloadUrls(JSON.stringify(urls));showToast(urls.length+' parça indirme kuyruğuna eklendi.');
  };
}

/* ================= EFFECTS ================= */
const FX_ROWS=[['preamp','🎚 Preamp'],['bass','🔊 Bass Boost'],['karaoke','🎙 Karaoke (Vokal Azalt)'],['echo','📣 Echo (Yankı)'],['echo_time','⏱ Echo Süresi'],['echo_feedback','🔁 Echo Tekrarı'],['reverb','🏛 Reverb (Oda)'],['spatial','🌀 8D Spatial']];
const SOUNDSCAPES=[['off','🚫 Kapalı'],['rain','🌧 Yağmur'],['white','📻 Beyaz Gürültü'],['brown','🟤 Kahverengi Gürültü']];
function renderEffects(){
  const m=$('#view');m.innerHTML='';const pad=el('div','view-pad');
  pad.appendChild(el('div','section-title',T('🎛 Ekolayzır & Efektler')));
  const wrap=el('div','fx-wrap');
  // EQ card
  const eq=el('div','fx-card');eq.appendChild(Object.assign(el('h3'),{textContent:T('Ekolayzır')}));
  const top=el('div','eq-top');
  const tog=el('label','toggle');const ci=el('input');ci.type='checkbox';ci.checked=eqEnabled;
  ci.onchange=()=>{eqEnabled=ci.checked;bridge.setEqEnabled(eqEnabled);};
  tog.append(ci,document.createTextNode(' '+T('Açık')));
  const sel=el('select','mini-sel');sel.innerHTML='<option value="">'+T('✏️ Özel')+'</option>'+(S.presetNames||[]).map(n=>'<option>'+esc(n)+'</option>').join('');
  sel.value=(S.settings&&S.settings.eq_preset)||'';
  sel.onchange=()=>{const g=S.presets[sel.value];if(g){eqGains=g.slice();applyEqUI();bridge.setEq(JSON.stringify(eqGains));bridge.setEqPreset(sel.value);}};
  const auto=el('button','btn',T('🤖 Oto'));auto.onclick=()=>bridge.autoEq(g=>{const arr=JSON.parse(g);if(arr.length){eqGains=arr;applyEqUI();sel.value='';}});
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
  const reset=el('button','btn',T('↺ Sıfırla (Flat)'));reset.style.marginTop='16px';
  reset.onclick=()=>{const g=S.presets['🎚 Flat'];eqGains=g.slice();applyEqUI();sel.value='🎚 Flat';bridge.setEq(JSON.stringify(eqGains));bridge.setEqPreset('🎚 Flat');};
  eq.appendChild(reset);
  wrap.appendChild(eq);
  // FX card
  const fx=el('div','fx-card');fx.appendChild(Object.assign(el('h3'),{textContent:T('Efektler')}));
  const normRow=el('label','toggle');const ncb=el('input');ncb.type='checkbox';ncb.checked=!!(S.settings&&S.settings.normalize);ncb.onchange=()=>bridge.setNormalize(ncb.checked);normRow.append(ncb,document.createTextNode(' '+T('🔊 Ses Eşitleme (Normalize)')));normRow.style.marginBottom='12px';fx.appendChild(normRow);
  const rvRow=el('div','fx-row');const rvHead=el('div','fx-head');rvHead.appendChild(el('span','fxName',T('🏛 Ortam (Reverb Preset)')));rvRow.appendChild(rvHead);
  const rvSel=el('select','mini-sel');rvSel.style.width='100%';Object.keys(REVERB_PRESETS).forEach(k=>{const o=el('option',null,T(k));o.value=k;rvSel.appendChild(o);});rvSel.onchange=()=>applyReverbPreset(rvSel.value);rvRow.appendChild(rvSel);fx.appendChild(rvRow);
  const rows=el('div','fx-rows');
  FX_ROWS.forEach(([key,label])=>{
    const row=el('div','fx-row');const head=el('div','fx-head');
    head.appendChild(el('span',null,T(label)));const val=el('span','fx-val',String(Math.round(effects[key]||0)));head.appendChild(val);
    row.appendChild(head);
    const sl=hSlider(0,100,effects[key]||0,(v)=>{effects[key]=v;val.textContent=v;bridge.setEffect(key,v);});
    row.appendChild(sl);rows.appendChild(row);
  });
  fx.appendChild(rows);
  const fxr=el('button','btn',T('↺ Efektleri Sıfırla'));fxr.style.marginTop='16px';
  fxr.onclick=()=>{Object.keys(S.effectDefaults).forEach(k=>{effects[k]=S.effectDefaults[k];bridge.setEffect(k,effects[k]);});renderEffects();};
  fx.appendChild(fxr);
  wrap.appendChild(fx);
  // 🌊 Odak Sesleri (soundscape)
  const sc=el('div','fx-card');sc.appendChild(Object.assign(el('h3'),{textContent:T('🌊 Odak Sesleri')}));
  let scKind=(S.settings.soundscape&&S.settings.soundscape[0])||'off';
  let scLevel=(S.settings.soundscape&&S.settings.soundscape[1])||40;
  const scRow=el('div','sc-btns');
  SOUNDSCAPES.forEach(([k,l])=>{const bt=el('button','btn'+(k===scKind?' accent':''),T(l));
    bt.onclick=()=>{scKind=k;[...scRow.children].forEach(x=>x.classList.remove('accent'));bt.classList.add('accent');bridge.setSoundscape(scKind,scLevel);};
    scRow.appendChild(bt);});
  sc.appendChild(scRow);
  const rowL=el('div','fx-row');const hL=el('div','fx-head');hL.appendChild(el('span',null,T('Seviye')));const vL=el('span','fx-val',String(scLevel));hL.appendChild(vL);rowL.appendChild(hL);
  rowL.appendChild(hSlider(0,100,scLevel,(v)=>{scLevel=v;vL.textContent=v;bridge.setSoundscape(scKind,scLevel);}));
  sc.appendChild(rowL);
  sc.appendChild(el('div','panelHint2',T('Müzik olmadan da çalar — odaklanmak/uyumak için.')));
  wrap.appendChild(sc);
  // 🎚 Geçiş (crossfade / gapless) + Discord
  const tr=el('div','fx-card');tr.appendChild(Object.assign(el('h3'),{textContent:T('🎚 Geçiş & Discord')}));
  let xf=(S.settings&&+S.settings.crossfade)||0;
  const xfRow=el('div','fx-row');const xfHead=el('div','fx-head');
  xfHead.appendChild(el('span',null,T('🎚 Crossfade (sn)')));
  const xfVal=el('span','fx-val',xf?String(xf):T('Kapalı'));xfHead.appendChild(xfVal);
  xfRow.appendChild(xfHead);
  xfRow.appendChild(hSlider(0,12,xf,(v)=>{xf=v;xfVal.textContent=v?String(v):T('Kapalı');bridge.setCrossfade(v);}));
  tr.appendChild(xfRow);
  const gpRow=el('label','toggle');const gcb=el('input');gcb.type='checkbox';gcb.checked=!!(S.settings&&S.settings.gapless);
  gcb.onchange=()=>bridge.setGapless(gcb.checked);
  gpRow.append(gcb,document.createTextNode(' '+T('▶ Boşluksuz Çalma (Gapless)')));gpRow.style.margin='12px 0';tr.appendChild(gpRow);
  tr.appendChild(el('div','panelHint2',T('Crossfade parçaları üst üste eritir; boşluksuz mod sınırda kesintisiz geçer (albüm/DJ setleri için).')));
  const dcTog=el('label','toggle');const dcb=el('input');dcb.type='checkbox';dcb.checked=!!(S.settings&&S.settings.discord_rpc);
  dcb.disabled=!S.discordAvail;
  dcb.onchange=()=>bridge.setDiscordRpc(dcb.checked);
  dcTog.append(dcb,document.createTextNode(' '+T('🎮 Discord Durumu (Rich Presence)')));dcTog.style.margin='14px 0 8px';tr.appendChild(dcTog);
  const dcId=el('input','mini-input');dcId.type='text';dcId.placeholder=T('Discord Application Client ID');
  dcId.value=(S.settings&&S.settings.discord_client_id)||'';
  dcId.onchange=()=>bridge.setDiscordClientId(dcId.value.trim());
  tr.appendChild(dcId);
  tr.appendChild(el('div','panelHint2',S.discordAvail
    ?T('discord.com/developers → uygulama oluştur → Application ID’yi buraya yapıştır. Discord açık olmalı.')
    :T('pypresence bu derlemede yok — Discord durumu devre dışı.')));
  wrap.appendChild(tr);
  pad.appendChild(wrap);m.appendChild(pad);
}
function applyEqUI(){if(window._eqSetters)eqGains.forEach((v,i)=>window._eqSetters[i]&&window._eqSetters[i](v));}

/* ================= LYRICS VIEW ================= */
function renderLyricsView(){
  const m=$('#view');m.innerHTML='';const pad=el('div','lyrics-view');
  if(!track||track.none){pad.appendChild(el('div','empty-hint',T('Önce bir şarkı çal.')));m.appendChild(pad);return;}
  const lines=(track.lyrics||'').split('\n');
  if(!track.lyrics){pad.appendChild(el('div','empty-hint',T('Bu şarkının sözü yok. Sağ paneldeki ✏️ ile ekleyebilirsin.')));}
  lines.forEach(l=>pad.appendChild(el('div','lv-line',l||' ')));
  m.appendChild(pad);
}

/* ================= RIGHT PANEL (now playing) ================= */
function renderRightPanel(){
  const p=$('#rightPanel');if(!p.classList.contains('show')){return;}
  // now-playing hero: blurlu kapak arka planı (Apple Music tarzı)
  var hasCov=!!(track&&!track.none&&track.cover);
  p.style.setProperty('--np-cover',hasCov?('url("'+track.cover+'")'):'none');
  p.classList.toggle('has-np',hasCov);
  p.innerHTML='';const pad=el('div','np-pad');
  if(!track||track.none){pad.appendChild(el('div','empty-hint',T('Çalan parça yok.')));
    const cv=el('canvas','np-viz');cv.id='vizCanvas';pad.appendChild(cv);p.appendChild(pad);return;}
  pad.appendChild(coverImg('np-cover',track));
  pad.appendChild(el('div','np-title',track.title));
  pad.appendChild(el('div','np-artist',track.artist||T('Yerel Parça')));
  const cv=el('canvas','np-viz');cv.id='vizCanvas';pad.appendChild(cv);
  pad.appendChild(el('div','np-wlabel',T('🌊 Şarkı DNA’sı')));
  pad.appendChild(buildWave());
  pad.appendChild(buildAbControls());
  drawWaveforms();
  const badges=el('div','np-badges');
  if(bpmData)badges.appendChild(el('span','np-badge','🥁 '+bpmData+' BPM'));
  if(moodData&&moodData.label){const mb=el('span','np-badge',moodData.label);mb.style.color=moodData.color;badges.appendChild(mb);}
  const radio=el('button','btn',T('📻 Radyo'));radio.onclick=()=>bridge.startRadio(track.id,track.playlist);
  const trim=el('button','btn',T('✂️ Kırp (A-B)'));trim.onclick=()=>{if(loopAB&&loopAB.b!=null)bridge.exportTrim(track.id,track.playlist,loopAB.a,loopAB.b);else showToast('Önce A-B döngü noktalarını ayarla.');};
  badges.append(radio,trim);pad.appendChild(badges);
  if(specData.length){pad.appendChild(el('div','np-wlabel',T('🎛 Spektrogram')));
    const spec=el('canvas','np-spec');spec.id='specCanvas';pad.appendChild(spec);setTimeout(drawSpectrogram,0);}
  const lyr=el('div','np-lyrics-card');
  const lh=el('div','lh');lh.appendChild(el('b',null,T('📝 Sözler')));
  const lhBtns=el('div','lh-btns');
  const getBtn=el('button','btn');getBtn.innerHTML=fa('cloud-arrow-down')+' '+T('Getir');
  getBtn.title=T('Lyrica’dan zaman kodlu (senkron) söz getir');
  getBtn.onclick=()=>bridge.fetchLyrics(track.id,track.playlist);
  const editBtn=el('button','btn');editBtn.innerHTML=fa('pen')+' '+T('Düzenle');
  lhBtns.append(getBtn,editBtn);lh.appendChild(lhBtns);lyr.appendChild(lh);
  const lrc=parseLRC(track.lyrics);
  let body;
  if(lrc){body=el('div','np-lyrics lrc-lines');body._lrc=lrc;lrc.forEach(l=>{const ln=el('div','lrc-line',l.txt||' ');ln.onclick=()=>bridge.seek(l.t);body.appendChild(ln);});}
  else{body=el('div','np-lyrics',track.lyrics||T('Söz yok. ([mm:ss] ile zaman kodlu sözler desteklenir)'));}
  lyr.appendChild(body);
  editBtn.onclick=()=>{
    if(editBtn.textContent.includes(T('Düzenle'))){
      const ta=el('textarea','np-lyrics-edit');ta.value=track.lyrics||'';lyr.replaceChild(ta,body);
      editBtn.innerHTML=fa('floppy-disk')+' '+T('Kaydet');ta.focus();lyr._ta=ta;
    }else{const ta=lyr._ta;if(ta)bridge.saveLyrics(track.id,track.playlist,ta.value);editBtn.innerHTML=fa('pen')+' '+T('Düzenle');}
  };
  pad.appendChild(lyr);
  if(queueData&&queueData.length){
    pad.appendChild(el('div','np-wlabel',T('⏭ Sıradaki')));
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
  $('#pTitle').textContent=has?track.title:T('Müzik Çalar Hazır');
  $('#pArtist').textContent=has?(track.artist||''):'';
  const fav=$('#pFav');fav.innerHTML=has&&track.favorite?fa('heart'):fa('heart','regular');fav.classList.toggle('on',!!(has&&track.favorite));
  updatePlayBtn();
  $('#pShuffle').classList.toggle('on',active.shuffle);
  updateRepeatBtn();
}
function updatePlayBtn(){$('#pPlay').innerHTML=active.playing?fa('pause'):fa('play');const h=$('#heroPlay');if(h)h.innerHTML=active.playing?fa('pause'):fa('play');}
/* Alt bar HER ZAMAN motoru sürer (ses kaynağı). Klip varsa muted video motoru
   aynalar (playingChanged/positionChanged üzerinden). Tek kontrol noktası. */
function togglePlayback(){bridge.toggle();}
function seekTo(sec){bridge.seek(sec);}
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
  if(track&&!track.none){active.shuffle=track.shuffle;active.repeat=track.repeat;
    if(track.repeat_mode!=null)active.repeat_mode=track.repeat_mode;}
  waveData=[];moodData=null;loopAB=null;updateMoodChip();  // yeni parça: analiz bekleniyor
  updatePlayer();highlightActive();renderRightPanel();
  if(view==='now')renderNowHero();   // B: merkez hero açıksa yeni parçaya göre tazele
  if(track&&!track.none&&track.cover)applyCoverAccent(track.cover);   // kapak renginden adaptif accent
  if(view==='lyrics')renderLyricsView();
}
function toggleShuffle(){active.shuffle=!active.shuffle;bridge.setShuffle(active.shuffle);$('#pShuffle').classList.toggle('on',active.shuffle);showToast(active.shuffle?'Karışık çalma açık':'Sıralı çalma');}
function toggleRepeat(){active.repeat=!active.repeat;bridge.setRepeat(active.repeat);$('#pRepeat').classList.toggle('on',active.repeat);showToast(active.repeat?'Tekrar açık':'Tekrar kapalı');}
function setVolumeUI(v){volume=v;$('#volFill').style.width=(v/150*100)+'%';
  $('#pMute').innerHTML=v===0?fa('volume-xmark'):v<55?fa('volume-low'):fa('volume-high');
  const vb=$('#volBar');if(vb)vb.title=T('Ses:')+' '+v+'%'+(v>100?' '+T('(boost)'):'');}  // ses motordan (bridge.setVolume); video hep sessiz
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
  const st=S.settings||{};
  setLang(st.lang||'tr');                 // dil: render'lardan ÖNCE ayarla
  $('#langSel').innerHTML=langList().map(([v,l])=>'<option value="'+v+'">'+l+'</option>').join('');
  $('#langSel').value=getLang();
  $('#themeSel').innerHTML=Object.keys(THEME_LABELS).map(k=>'<option value="'+k+'">'+T(THEME_LABELS[k])+'</option>').join('');
  $('#speedSel').innerHTML=SPEEDS.map(s=>'<option value="'+s+'">'+s+'x</option>').join('');
  $('#sleepSel').innerHTML=SLEEPS.map(([v,l])=>'<option value="'+v+'">'+T(l)+'</option>').join('');
  applyStaticI18n();                      // statik kabuğu çevir
  try{ if(localStorage.getItem('jm_sidebar_rail')==='1') setSidebarRail(true); }catch(e){}
  applyTheme(st.theme||'green');
  if(st.accent)applyAccentHex(st.accent);
  autoCoverColor=!st.accent;   // kullanıcı özel renk seçmediyse kapak-renginden adaptif accent açık
  volume=st.volume!=null?st.volume:80;setVolumeUI(volume);
  speed=st.speed||1.0;$('#speedSel').value=speed;
  eqEnabled=st.eq_enabled!==false;
  eqGains=(st.eq_gains&&st.eq_gains.length===10)?st.eq_gains.slice():new Array(10).fill(0);
  effects=Object.assign({},S.effectDefaults,st.effects||{});
  active=S.active||active;
  onKaraokeMode(S.karaokeMode||'off');
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
  bridge.trackChanged.connect(j=>{try{track=JSON.parse(j);}catch(e){return;}onTrackChanged();});
  bridge.playingChanged.connect(p=>{active.playing=p;updatePlayBtn();if(clip)clipMirrorPlay(p);});
  bridge.positionChanged.connect((pos,dur)=>{updateSeek(pos,dur);if(clip){syncClipVideo(pos);clipSyncLyrics(pos);}});  // motor = tek saat
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
  bridge.updateAvailableSignal.connect((v,notes)=>{updateInfo={version:v,notes:notes};});
  bridge.updateProgressSignal.connect(p=>onUpdateProgress(p));
  bridge.updateReadySignal.connect(v=>onUpdateReady(v));
  bridge.separationProgressSignal.connect((pct,status)=>updateSepPill(pct,status));
  bridge.karaokeModeSignal.connect(m=>onKaraokeMode(m));
}

/* ================= OTOMATİK GÜNCELLEME ================= */
let updateInfo=null;
function onUpdateProgress(p){
  const b=$('#updateBar');if(!b)return;
  const t=b.querySelector('.upd-text');if(t)t.textContent=T('Güncelleme indiriliyor…')+' %'+Math.round(p);
}
function onUpdateReady(version){
  let b=$('#updateBar');
  if(!b){b=el('div','update-bar');b.id='updateBar';document.body.appendChild(b);}
  b.innerHTML='';
  const ic=el('span','upd-ic');ic.innerHTML=fa('circle-up');
  const txt=el('span','upd-text');txt.innerHTML='<b>'+T('Güncelleme hazır:')+' v'+version+'</b> — '+T('kapatınca otomatik kurulacak.');
  const now=el('button','upd-btn');now.innerHTML=fa('rotate-right')+' '+T('Şimdi yeniden başlat');
  now.onclick=()=>{showToast('Güncelleme kuruluyor, birazdan yeniden açılacak…');setTimeout(()=>bridge.installUpdateNow(),400);};
  const x=el('button','upd-x');x.innerHTML=fa('xmark');x.title=T('Gizle (çıkışta yine de kurulur)');x.onclick=()=>b.remove();
  b.append(ic,txt,now,x);
  b.classList.add('show');
}

/* ================= EVENTS ================= */
function wireEvents(){
  document.querySelectorAll('.nav-link').forEach(b=>b.onclick=()=>showView(b.dataset.view));
  $('#navBack').onclick=navBack;$('#navFwd').onclick=navFwd;updateNavButtons();
  $('#sidebarToggle').onclick=()=>setSidebarRail(!document.getElementById('app').classList.contains('sidebar-rail'));
  $('#homeBtn').onclick=()=>showView('home');
  $('#topSearch').addEventListener('keydown',e=>{if(e.key==='Enter')doSearch(e.target.value);});
  $('#topSearch').addEventListener('input',e=>{localQuery=e.target.value.trim();searchRows=[];/* sorgu değişti: eski YouTube sonuçları bayat */if(localQuery){if(view!=='search')showView('search');else renderSearch();}else if(view==='search')renderSearch();});
  $('#libSearch').addEventListener('input',renderSidebar);
  $('#importBtn').onclick=()=>bridge.importFiles();
  $('#createPlaylist').onclick=()=>modalPrompt(T('Yeni çalma listesi'),[{ph:'Liste adı'}],v=>{if(v[0].trim())bridge.addPlaylist(v[0].trim());});
  $('#scanBtn').onclick=()=>bridge.scanMusic();
  $('#statsBtn').onclick=()=>showView('stats');
  $('#helpBtn').onclick=showShortcuts;
  $('#backupBtn').onclick=()=>bridge.backup();
  $('#langSel').onchange=e=>applyLanguage(e.target.value);
  $('#themeSel').onchange=e=>{applyTheme(e.target.value);bridge.setTheme(e.target.value);};
  $('#accentPick').oninput=e=>{autoCoverColor=false;applyAccentHex(e.target.value);bridge.setAccent(e.target.value);};  // elle renk seçince kapak-accent kapanır
  $('#pQueueBtn').onclick=()=>showView('queue');
  $('#pFsBtn').onclick=openFullscreen;
  $('#pHeroBtn').onclick=enterHero;                 // B: merkez hero aç/kapa
  $('#pCover').style.cursor='pointer';$('#pCover').onclick=enterHero;   // mini kapak → merkez hero
  {const _pm=document.querySelector('.p-meta');if(_pm){_pm.style.cursor='pointer';_pm.onclick=enterHero;}}
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
  $('#pKaraoke').onclick=e=>{e.stopPropagation();openKaraokeMenu();};  // global tıkla-kapat menüyü hemen kapatmasın
  $('#pVideo').onclick=()=>{
    if(clip){if(view==='clip')showView(clipPrevView||'home');else showView('clip');}  // büyüt/küçült
    else if(track&&!track.none)bridge.playVideo(track.id,track.playlist);
    else showToast('Önce bir şarkı çal.');};
  $('#compactBtn').onclick=toggleCompact;
  $('#moodChip').onclick=()=>{autoMoodColor=!autoMoodColor;showToast(autoMoodColor?'Ruh haline göre renk: açık':'Ruh haline göre renk: kapalı');if(autoMoodColor&&moodData)applyAccentHex(moodData.color);};
  $('#speedSel').onchange=e=>{speed=parseFloat(e.target.value);bridge.setSpeed(speed);if(clip&&clip.v)clip.v.playbackRate=speed;};
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
    else if(e.code==='KeyI')toggleLyricsIsland();   // söz adası
    else if(e.code==='KeyB')setSidebarRail(!document.getElementById('app').classList.contains('sidebar-rail'));   // kenar çubuğu rayı
    else if(e.key==='/'){e.preventDefault();$('#topSearch').focus();}
    else if(e.key==='?')showShortcuts();
  });
}
let lastPos=0,lastDur=0;
const _origUpdateSeek=updateSeek;
updateSeek=function(pos,dur){lastPos=pos;lastDur=dur;_origUpdateSeek(pos,dur);syncLyrics(pos);islandSync(pos);
  if(view==='now'){                                   // B: merkez hero'yu da aynı motor saatiyle sür
    if(!seeking){const p=(dur>0?pos/dur*100:0);const hf=$('#heroFill');if(hf)hf.style.width=p+'%';const hk=$('#heroKnob');if(hk)hk.style.left=p+'%';}
    const hc=$('#heroCur');if(hc)hc.textContent=fmt(pos);
    const hd=$('#heroDur');if(hd)hd.textContent=fmt(dur);
    heroLyricSync(pos);
  }
};

/* ===== B: Merkez "Şimdi çalıyor" hero (opt-in showView('now')) ===== */
let heroPrevView='home';
let _heroLrc=null,_heroLrcId=null;
function heroLrc(){                                    // parseLRC'i parça id'sine göre memoize et
  if(!track||track.none)return null;
  if(_heroLrcId!==track.id){_heroLrcId=track.id;_heroLrc=parseLRC(track.lyrics);}
  return _heroLrc;
}
function renderNowHero(){
  const m=$('#view');m.innerHTML='';
  const root=el('div','hero-now');root.id='heroNow';
  const hasCov=!!(track&&!track.none&&track.cover);
  root.style.setProperty('--np-cover',hasCov?('url("'+track.cover+'")'):'none');   // renderRightPanel ile aynı
  root.classList.toggle('has-np',hasCov);
  root.appendChild(el('div','hero-bg'));
  if(!track||track.none){root.appendChild(el('div','hero-empty',T('Bir şey çal ve burada büyük görünsün.')));m.appendChild(root);return;}
  const inner=el('div','hero-inner');
  const cov=coverImg('hero-cover',track);cov.title=T('Tam ekran');cov.onclick=openFullscreen;   // büyük kapak → theater
  inner.appendChild(cov);
  const body=el('div','hero-body');
  body.appendChild(el('div','hero-eyebrow',T('Şimdi çalıyor')));
  body.appendChild(el('div','hero-title',track.title));
  body.appendChild(el('div','hero-artist',track.artist||T('Yerel Parça')));
  const lyr=el('div','hero-lyric');lyr.id='heroLyric';body.appendChild(lyr);
  const seek=el('div','hero-seek');
  const cur=el('span','time',fmt(lastPos));cur.id='heroCur';
  const bar=el('div','bar');bar.id='heroBar';
  const fill=el('div','bar-fill');fill.id='heroFill';
  const knob=el('div','bar-knob');knob.id='heroKnob';
  bar.append(fill,knob);
  const dur=el('span','time',fmt(lastDur));dur.id='heroDur';
  seek.append(cur,bar,dur);body.appendChild(seek);
  if(lastDur>0){fill.style.width=(lastPos/lastDur*100)+'%';knob.style.left=(lastPos/lastDur*100)+'%';}
  attachDrag(bar,(f,live)=>{seeking=live;fill.style.width=(f*100)+'%';knob.style.left=(f*100)+'%';   // #seekBar ile birebir
    if(!live)seekTo(f*lastDur);else cur.textContent=fmt(f*lastDur);},false);
  const ctr=el('div','hero-controls');
  const sh=faBtn('hero-ic'+(active.shuffle?' on':''),'shuffle');sh.onclick=toggleShuffle;
  const pv=faBtn('hero-ic','backward-step');pv.onclick=()=>bridge.prev();
  const pl=el('button','hero-play');pl.id='heroPlay';pl.innerHTML=active.playing?fa('pause'):fa('play');pl.onclick=togglePlayback;
  const nx=faBtn('hero-ic','forward-step');nx.onclick=()=>bridge.next();
  const rp=faBtn('hero-ic'+(((active.repeat_mode||0)!==0)?' on':''),'repeat');rp.onclick=cycleRepeat;
  ctr.append(sh,pv,pl,nx,rp);body.appendChild(ctr);
  const acts=el('div','hero-actions');
  const fav=faBtn('hero-ic2'+(track.favorite?' on':''),'heart');fav.title=T('Beğen');fav.onclick=()=>bridge.toggleFavorite(track.id,track.playlist);
  const exp=faBtn('hero-ic2','expand');exp.title=T('Tam ekran');exp.onclick=openFullscreen;
  const lyrc=faBtn('hero-ic2','align-left');lyrc.title=T('Şarkı Sözleri');lyrc.onclick=()=>showView('lyrics');
  const q=faBtn('hero-ic2','list-ol');q.title=T('Kuyruk (Sıradaki)');q.onclick=()=>showView('queue');
  acts.append(fav,exp,lyrc,q);body.appendChild(acts);
  inner.appendChild(body);root.appendChild(inner);m.appendChild(root);
  updateSeek(lastPos,lastDur);                        // scrubber + süreleri hemen doğru bas
  heroLyricSync(lastPos||0);
}
function heroLyricSync(pos){
  const box=$('#heroLyric');if(!box)return;
  const lrc=heroLrc();
  if(!lrc){if(box.textContent)box.textContent='';box.classList.remove('on');return;}
  let cur=-1;for(let i=0;i<lrc.length;i++){if(pos>=lrc[i].t)cur=i;else break;}
  const txt=cur>=0?(lrc[cur].txt||''):'';
  if(box.textContent!==txt)box.textContent=txt;
  box.classList.toggle('on',!!txt);
}
function enterHero(){
  if(view!=='now')heroPrevView=view;
  const go=()=>showView(view==='now'?(heroPrevView||'home'):'now');
  if(document.startViewTransition && !matchMedia('(prefers-reduced-motion:reduce)').matches){try{document.startViewTransition(go);}catch(e){go();}}else go();
}

/* ================= YENİ ÖZELLİKLER ================= */
// -- özel vurgu rengi --
function hexToRgb(h){h=(h||'').replace('#','');if(h.length===3)h=h.split('').map(c=>c+c).join('');const n=parseInt(h||'1db954',16);return [(n>>16)&255,(n>>8)&255,n&255];}
function lighten(rgb,a){return rgb.map(c=>Math.min(255,Math.round(c+(255-c)*a)));}
function applyAccentHex(hex){const rgb=hexToRgb(hex);const l=lighten(rgb,.2);
  const R=document.documentElement.style;
  R.setProperty('--accent',hex);R.setProperty('--accent2','rgb('+l.join(',')+')');R.setProperty('--accent-rgb',rgb.join(','));
  const ap=$('#accentPick');if(ap)ap.value=hex;}
/* Kapak renginden okunur bir accent üret: doygunluk+parlaklık okunabilir aralığa clamp'lenir. */
function _clampAccentHex(rgbStr){
  var m=(rgbStr||'').match(/\d+/g);if(!m)return null;
  var r=+m[0]/255,g=+m[1]/255,b=+m[2]/255;
  var mx=Math.max(r,g,b),mn=Math.min(r,g,b),h=0,s=0,l=(mx+mn)/2,dd=mx-mn;
  if(dd){s=l>.5?dd/(2-mx-mn):dd/(mx+mn);
    if(mx===r)h=(g-b)/dd+(g<b?6:0);else if(mx===g)h=(b-r)/dd+2;else h=(r-g)/dd+4;h/=6;}
  s=Math.max(.45,Math.min(.85,s));l=Math.max(.46,Math.min(.60,l));   // canlı + okunur orta ton
  function hue(p,q,t){if(t<0)t+=1;if(t>1)t-=1;if(t<1/6)return p+(q-p)*6*t;if(t<1/2)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p;}
  var q=l<.5?l*(1+s):l+s-l*s,p=2*l-q;
  var R=Math.round(hue(p,q,h+1/3)*255),G=Math.round(hue(p,q,h)*255),B=Math.round(hue(p,q,h-1/3)*255);
  return '#'+[R,G,B].map(function(x){return('0'+x.toString(16)).slice(-2);}).join('');
}
function applyCoverAccent(cover){
  if(!cover||!autoCoverColor)return;
  dominantColor(cover,function(c){if(!c||!autoCoverColor)return;var hex=_clampAccentHex(c);if(hex)applyAccentHex(hex);});
}

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
  const head=el('div','qhead');head.appendChild(el('div','section-title',T('📋 Kuyruk')));
  if(queueData.length){const cl=el('button','btn',T('Kuyruğu temizle'));cl.onclick=()=>bridge.clearQueue();head.appendChild(cl);}
  pad.appendChild(head);
  if(track&&!track.none){pad.appendChild(el('div','q-label',T('Şimdi çalıyor')));
    const nowRow=trackRowLite(track,-1,track.playlist,true);pad.appendChild(nowRow);}
  pad.appendChild(el('div','q-label',T('Sıradakiler')));
  if(!queueData.length){pad.appendChild(el('div','empty-hint',T('Kuyruk boş. Şarkı menüsünden “Sıraya ekle” diyebilirsin.')));}
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
  pad.appendChild(el('div','section-title',T('📊 İstatistikler')));
  const all=[];for(const pl in S.playlists)for(const s of S.playlists[pl])all.push(s);
  const total=all.length, pls=Object.keys(S.playlists).length;
  const secs=(S.stats&&S.stats.total_seconds)||0;const h=Math.floor(secs/3600),mn=Math.floor(secs%3600/60);
  const cards=el('div','stat-cards');
  [['🎵',total,'Toplam parça'],['📂',pls,'Çalma listesi'],['⏱',(h?T(h+' sa '+mn+' dk'):T(mn+' dk')),'Dinleme süresi']].forEach(([ic,v,l])=>{
    const c=el('div','stat-card');c.innerHTML='<div class="sc-ic">'+ic+'</div><div class="sc-v">'+v+'</div><div class="sc-l">'+esc(T(l))+'</div>';cards.appendChild(c);});
  pad.appendChild(cards);
  pad.appendChild(el('div','section-title',T('⭐ En Çok Dinlenenler')));
  const top=all.filter(s=>s.play_count>0).sort((a,b)=>b.play_count-a.play_count).slice(0,10);
  if(!top.length){pad.appendChild(el('div','empty-hint',T('Henüz yeterli veri yok. Biraz müzik çal!')));}
  const maxc=top.length?top[0].play_count:1;
  top.forEach((s,i)=>{const r=el('div','top-row');
    r.innerHTML='<div class="top-rank">'+(i+1)+'</div>';
    const im=coverImg('top-cover',s);r.appendChild(im);
    const info=el('div','top-info');info.appendChild(el('div','top-name',s.title));
    const bar=el('div','top-bar');const fill=el('div','top-fill');fill.style.width=(s.play_count/maxc*100)+'%';bar.appendChild(fill);info.appendChild(bar);
    r.appendChild(info);r.appendChild(el('div','top-count',T(s.play_count+' kez')));
    pad.appendChild(r);});
  m.appendChild(pad);
}

// -- tam ekran şimdi çalıyor --
function openFullscreen(){
  closeFullscreen();
  const o=el('div','fs-now');o.id='fsNow';
  const bg=el('div','fs-bg');
  if(track&&!track.none&&track.cover)bg.style.backgroundImage='url("'+track.cover+'")';  // blurlu kapak arka planı
  o.appendChild(bg);
  const close=el('button','fs-close','✕');close.onclick=closeFullscreen;o.appendChild(close);
  const inner=el('div','fs-inner');
  const cov=track&&!track.none?coverImg('fs-cover',track):el('img','fs-cover');if(!track||track.none)cov.src=PLACEHOLDER;
  inner.appendChild(cov);
  const info=el('div','fs-info');
  info.appendChild(el('div','fs-title',track&&!track.none?track.title:'—'));
  info.appendChild(el('div','fs-artist',track&&!track.none?(track.artist||T('Yerel Parça')):''));
  const cv=el('canvas','fs-viz');cv.id='fsViz';info.appendChild(cv);
  if(track&&!track.none&&track.lyrics){
    const lrc=parseLRC(track.lyrics);
    if(lrc){                                   // theater modu: senkron sözler kapağın yanında
      o.classList.add('theater');
      const ly=el('div','fs-lyrics lrc-lines');ly._lrc=lrc;ly._cur=-2;
      lrc.forEach(l=>{const ln=el('div','lrc-line',l.txt||' ');ln.onclick=()=>bridge.seek(l.t);ly.appendChild(ln);});
      info.appendChild(ly);setTimeout(()=>syncLyrics(lastPos||0),0);
    }else info.appendChild(el('div','fs-lyrics',track.lyrics));
  }
  inner.appendChild(info);o.appendChild(inner);
  // kapak varsa blurlu kapak arka planı (yukarıda set edildi); yoksa kapak renginden radyal
  if(track&&!track.none&&!track.cover)dominantColor(track.cover,c=>{if(c)bg.style.background='radial-gradient(1200px 700px at 30% 20%, '+c+', #0a0a0b 70%)';});
  document.body.appendChild(o);
  document.addEventListener('keydown',fsEsc);
}
function fsEsc(e){if(e.key==='Escape')closeFullscreen();}
function closeFullscreen(){const o=$('#fsNow');if(o)o.remove();document.removeEventListener('keydown',fsEsc);}

// -- klavye kısayolları --
function showShortcuts(){
  const rows=[['Boşluk','Oynat / Duraklat'],['← / →','10 sn geri / ileri'],['↑ / ↓','Ses',],['S','Karıştır'],['L','Tekrar'],['N / P','Sonraki / Önceki'],['F','Tam ekran'],['I','Söz adası'],['B','Kenar çubuğu (daralt/genişlet)'],['/','Arama'],['?','Bu pencere']];
  const back=el('div','modal-back');const mo=el('div','modal');mo.style.width='440px';
  mo.appendChild(el('h3',null,T('⌨ Klavye Kısayolları')));
  const list=el('div','sc-list');
  rows.forEach(([k,d])=>{const r=el('div','sc-row');r.innerHTML='<kbd>'+esc(T(k))+'</kbd><span>'+esc(T(d))+'</span>';list.appendChild(r);});
  mo.appendChild(list);
  const act=el('div','m-actions');const ok=el('button','btn accent',T('Kapat'));ok.onclick=()=>back.remove();act.appendChild(ok);mo.appendChild(act);
  back.appendChild(mo);back.onclick=e=>{if(e.target===back)back.remove();};document.body.appendChild(back);
}

// -- indirme göstergesi (pill) --
function ensureDlPill(){let p=$('#dlPill');if(!p){p=el('div','dl-pill');p.id='dlPill';p.innerHTML='<span class="dl-txt"></span><div class="dl-bar"><div class="dl-fill"></div></div>';document.body.appendChild(p);}return p;}
function updateDlPill(pct,status,q){const p=ensureDlPill();
  if(!status){p.classList.remove('show');return;}
  p.classList.add('show');p.querySelector('.dl-txt').textContent='⬇ '+status;  // status "X/Y" içerir
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
let waveData=[], moodData=null, loopAB=null, ambientOn=false, autoMoodColor=false, autoCoverColor=false;
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
  const lines=[];let has=false;
  (text||'').split('\n').forEach(l=>{const m=l.match(/^\[(\d{1,2}):(\d{2})(?:[.:](\d{1,2}))?\]\s*(.*)$/);
    if(!m)return;
    const t=(+m[1])*60+(+m[2])+(m[3]?(+m[3])/100:0);
    const rest=m[4];
    // Enhanced LRC (A2) kelime zamanları: <mm:ss.xx>kelime — varsa word-by-word
    const words=[];const wre=/<(\d{1,2}):(\d{2})(?:[.:](\d{1,2}))?>([^<]*)/g;let wm,any=false;
    while((wm=wre.exec(rest))){any=true;const wt=(+wm[1])*60+(+wm[2])+(wm[3]?(+wm[3])/100:0);
      if(wm[4]!=='')words.push({t:wt,txt:wm[4]});}
    const plain=rest.replace(/<\d{1,2}:\d{2}(?:[.:]\d{1,2})?>/g,'').trim();
    lines.push({t:t,txt:plain,words:any?words:null});has=true;});
  return has?lines.sort((a,b)=>a.t-b.t):null;
}
function syncLyrics(pos){
  document.querySelectorAll('.lrc-lines').forEach(box=>{     // sağ panel + tam ekran theater
    const lines=box._lrc;if(!lines)return;
    let cur=-1;for(let i=0;i<lines.length;i++){if(pos>=lines[i].t)cur=i;else break;}
    if(box._cur===cur)return;box._cur=cur;                  // sadece satır değişince kaydır
    [...box.children].forEach((el2,i)=>el2.classList.toggle('active',i===cur));
    if(cur>=0&&box.children[cur]){box.children[cur].scrollIntoView({block:'center',behavior:'smooth'});}
  });
}
/* ---- Dinamik söz adası (word-by-word, yüzen cam) ---- */
let lyricsIsland=null;
function makeDraggable(elm){
  let sx,sy,ox,oy,drag=false;
  elm.addEventListener('mousedown',e=>{if(e.target.closest('button'))return;drag=true;sx=e.clientX;sy=e.clientY;
    const r=elm.getBoundingClientRect();ox=r.left;oy=r.top;elm.style.transition='none';e.preventDefault();});
  window.addEventListener('mousemove',e=>{if(!drag)return;
    elm.style.left=Math.max(6,Math.min(window.innerWidth-elm.offsetWidth-6,ox+e.clientX-sx))+'px';
    elm.style.top=Math.max(6,Math.min(window.innerHeight-elm.offsetHeight-6,oy+e.clientY-sy))+'px';
    elm.style.bottom='auto';elm.style.transform='none';});
  window.addEventListener('mouseup',()=>{drag=false;elm.style.transition='';});
}
function toggleLyricsIsland(){
  if(lyricsIsland){lyricsIsland.remove();lyricsIsland=null;showToast(T('🎤 Söz adası kapalı'));return;}
  const isl=el('div','lyric-island');isl.id='lyricIsland';
  isl.innerHTML='<div class="li-cur"></div><div class="li-next"></div>';
  makeDraggable(isl);document.body.appendChild(isl);lyricsIsland=isl;lyricsIsland._idx=-2;
  islandSync(lastPos||0);showToast(T('🎤 Söz adası açık'));
}
function islandSync(pos){
  if(!lyricsIsland)return;
  const cd=lyricsIsland.querySelector('.li-cur'),nd=lyricsIsland.querySelector('.li-next');
  const lrc=parseLRC(track&&track.lyrics);
  if(!lrc){cd.textContent=T('Zaman kodlu söz yok');nd.textContent='';lyricsIsland._idx=-2;return;}
  let cur=-1;for(let i=0;i<lrc.length;i++){if(pos>=lrc[i].t)cur=i;else break;}
  if(cur!==lyricsIsland._idx){
    lyricsIsland._idx=cur;
    if(cur<0){cd.textContent=lrc[0]?lrc[0].txt:'';nd.textContent='';return;}
    const line=lrc[cur];
    if(line.words&&line.words.length){cd.innerHTML='';line.words.forEach(w=>{const s=el('span','kw',w.txt);s._t=w.t;cd.appendChild(s);});}
    else cd.textContent=line.txt;
    nd.textContent=lrc[cur+1]?lrc[cur+1].txt:'';
  }
  if(cur>=0&&lrc[cur].words){cd.querySelectorAll('.kw').forEach(s=>s.classList.toggle('done',pos>=s._t));}
}
function onLoop(a,b){loopAB=(a<0)?null:{a:a,b:(b<0?null:b)};
  document.querySelectorAll('.abloop-status').forEach(e=>e.textContent=loopStatusText());drawWaveforms();}
function loopStatusText(){if(!loopAB)return T('A-B döngü kapalı');if(loopAB.b==null)return'A: '+fmt(loopAB.a)+' — '+T('B seç');return T('Döngü:')+' '+fmt(loopAB.a)+' – '+fmt(loopAB.b);}
function updateMoodChip(){const c=$('#moodChip');if(!c)return;
  if(moodData&&moodData.label){c.textContent=T(moodData.label);c.style.display='inline-flex';
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
function buildWave(){const cv=el('canvas','wave-canvas');cv.title=T('Şarkı DNA’sı — tıkla seç');cv.onclick=e=>waveSeek(cv,e);return cv;}
function buildAbControls(){
  const box=el('div','abloop');
  box.appendChild(el('span','ab-label',T('🔁 A-B Döngü')));
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
/* ---- Karaoke / vokal ayırma (htdemucs, CPU) + hızlı mid-side ---- */
let karaokeMode='off';   // off / quick / instrumental / vocals
function openKaraokeMenu(){
  const b=$('#pKaraoke');const r=b.getBoundingClientRect();
  const has=S&&S.demucs;
  const dot=m=>karaokeMode===m?'● ':'';
  const eng=has?'':' · '+T('motor yok, hızlıya düşer');
  ctxMenu(r.left,r.top,[
    {label:T('🎤 Vokal / Karaoke')},
    {text:dot('instrumental')+T('Enstrümantal — vokalleri ayır (htdemucs)')+eng,fn:()=>bridge.setKaraoke('instrumental')},
    {text:dot('vocals')+T('Akapella — sadece vokal (htdemucs)')+eng,fn:()=>bridge.setKaraoke('vocals')},
    {text:dot('quick')+T('⚡ Hızlı karaoke (anında · mid-side)'),fn:()=>bridge.setKaraoke('quick')},
    {sep:true},
    {text:dot('off')+T('✕ Kapat'),fn:()=>bridge.setKaraoke('off')},
  ]);
}
function onKaraokeMode(mode){
  karaokeMode=mode;
  const b=$('#pKaraoke');if(!b)return;
  b.classList.toggle('on',mode!=='off');
  b.title=({off:T('Karaoke / vokal ayır (htdemucs)'),quick:T('Hızlı karaoke (mid-side) açık'),
    instrumental:T('Karaoke: enstrümantal (htdemucs) açık'),vocals:T('Akapella: sadece vokal (htdemucs) açık')})[mode]||T('Karaoke');
}
function updateSepPill(pct,status){
  let p=$('#sepPill');
  if(pct>=100||!status){if(p)p.remove();return;}
  if(!p){p=el('div','dl-pill');p.id='sepPill';
    p.innerHTML='<span class="dl-txt"></span><div class="dl-bar"><div class="dl-fill"></div></div>';
    document.body.appendChild(p);}
  p.classList.add('show');
  p.querySelector('.dl-txt').textContent='🎤 '+status+'  %'+Math.round(pct);
  p.querySelector('.dl-fill').style.width=pct+'%';
}
function toggleKaraoke(){openKaraokeMenu();}   // geriye uyum (komut paleti vb.)
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
  /* YENİ MİMARİ: video HER ZAMAN SESSİZ; ses DSP motorundan (mp3) gelir. Muted
     video, motorun konumuna (positionChanged) senkronlanır ve motorun çalma
     durumunu aynalar. Böylece TEK ses kaynağı olur (çift playback yok) ve tüm
     DSP efektleri klibin sesine de uygulanır. Ayrı <audio> akışı YOK. */
  if(clip)stopClip(false);
  const host=el('div','clip-host');
  const v=el('video','clip-video');v.src=d.video;v.playsInline=true;v.controls=false;
  v.muted=true;v.volume=0;                 // video=sessiz (1/0 bayrağı: clip var mı)
  host.appendChild(v);
  const lyrBox=el('div','clip-lyrics');host.appendChild(lyrBox);
  clip={d:d,host:host,v:v,lrc:parseLRC(track&&track.lyrics),lyrBox:lyrBox,lyrIdx:-2,
        mode:'full',ready:false,startAt:Math.max(0,+d.start||0)};
  v.onloadedmetadata=()=>{if(v.videoWidth&&v.videoHeight)host.style.setProperty('--ar',v.videoWidth+'/'+v.videoHeight);};
  v.onclick=()=>{if(clip&&clip.mode==='mini')showView('clip');else togglePlayback();};
  v.playbackRate=speed||1;                 // DSP hızıyla görsel eşleşsin
  v.addEventListener('canplay',()=>{
    if(!clip)return;
    clip.ready=true;
    try{v.currentTime=clip.startAt;}catch(e){}
    if(active.playing)v.play().catch(()=>{});else v.pause();
  },{once:true});
  v.onerror=()=>showToast('Klip görüntüsü oynatılamadı (kodek/ağ).');
}
/* Muted videoyu motorun konumuna hizala (kayma > 0.35s ise düzelt). */
function syncClipVideo(pos){
  if(!clip||!clip.ready)return;
  const v=clip.v;
  if(Math.abs((v.currentTime||0)-pos)>0.35){try{v.currentTime=pos;}catch(e){}}
}
/* Muted video, motorun çal/duraklat durumunu aynalar. */
function clipMirrorPlay(p){
  if(!clip||!clip.ready)return;
  if(p)clip.v.play().catch(()=>{});else clip.v.pause();
}
function stopClip(resume){
  const c=clip;clip=null;
  if(!c)return;
  if(c.sync)clearInterval(c.sync);
  /* Video akışını gerçekten kes ve DOM'dan kaldır: sadece pause ağ trafiğini
     sürdürür, DOM'da kalan canlı <video> kapanışta WebEngine'i çökertiyor.
     (Ses motoru zaten çalıyor — dokunmuyoruz.) */
  if(c.v){c.v.pause();c.v.removeAttribute('src');c.v.load();}
  if(c.host)c.host.remove();
  removeMiniClip();
  if(bridge&&resume)bridge.resumeMusic(-1);   // motorun çaldığından emin ol
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
  const exp=el('button','clip-mini-btn');exp.innerHTML=fa('expand');exp.title=T('Büyüt');
  exp.onclick=e=>{e.stopPropagation();showView('clip');};
  const cls=el('button','clip-mini-btn');cls.innerHTML=fa('xmark');cls.title=T('Klibi kapat');
  cls.onclick=e=>{e.stopPropagation();exitClip();};
  bar.append(exp,cls);
  clip.host.className='clip-host mini';
  mini.append(clip.host,bar);       // host'u mini kutuya TAŞI (yeniden yükleme yok)
  document.body.appendChild(mini);
}
function renderClipView(){
  const m=$('#view');m.innerHTML='';
  if(!clip){m.appendChild(el('div','empty-hint',T('Klip yok.')));return;}
  const d=clip.d;
  const wrap=el('div','clip-view');

  const head=el('div','clip-head');
  head.appendChild(el('div','clip-title',d.title||(track&&track.title)||T('Klip')));
  head.appendChild(el('span','clip-hint',T('internetten akış · indirme yok')));
  const btns=el('div','clip-btns');
  const lyrBtn=el('button','clip-btn');lyrBtn.innerHTML=fa('align-left');
  lyrBtn.title=T('Sözleri klibin üstünde göster');lyrBtn.classList.toggle('on',clipLyricsOn);
  const fsBtn=el('button','clip-btn');fsBtn.innerHTML=fa('expand');fsBtn.title=T('Tam ekran');
  const audBtn=el('button','clip-btn primary');audBtn.innerHTML=fa('music')+' '+T('Sese geç');
  audBtn.title=T('Klipten çık, müziğe dön');audBtn.onclick=exitClip;
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
  pad.appendChild(el('div','section-title',T(sp.name)));
  const acts=el('div','pl-actions2');const big=Object.assign(el('button','big-play'),{innerHTML:fa('play')});big.onclick=()=>{if(sp.items[0])bridge.play(sp.items[0][0].id,sp.items[0][1]);};acts.appendChild(big);pad.appendChild(acts);
  const wrap=el('div','tracks');const head=el('div','track-head');
  head.innerHTML='<div style="text-align:center">#</div><div>'+T('Başlık')+'</div><div>'+T('Kaynak')+'</div><div></div><div style="text-align:right">🕐</div>';wrap.appendChild(head);
  if(!sp.items.length)wrap.appendChild(el('div','empty-hint',T('Bu akıllı listede henüz şarkı yok.')));
  sp.items.forEach(([s,pl],i)=>wrap.appendChild(trackRow(s,i,pl)));
  pad.appendChild(wrap);m.appendChild(pad);
}

/* -- Komut Paleti (Ctrl+K) -- */
function openPalette(){
  closeMenus();const back=el('div','palette-back');const box=el('div','palette');
  const inp=el('input','palette-input');inp.placeholder=T('Komut ara veya şarkı/liste bul…');
  const list=el('div','palette-list');box.append(inp,list);back.appendChild(box);
  back.onclick=e=>{if(e.target===back)back.remove();};document.body.appendChild(back);inp.focus();
  const commands=[
    ['🏠 Ana Sayfa',()=>showView('home')],['🔎 Ara',()=>{showView('search');$('#topSearch').focus();}],
    ['🎛 Efektler',()=>showView('effects')],['📊 İstatistikler',()=>showView('stats')],
    ['📋 Kuyruk',()=>showView('queue')],['🔄 Müzik Tara',()=>bridge.scanMusic()],
    ['➕ MP3 Ekle',()=>bridge.importFiles()],['💾 Yedek Al',()=>bridge.backup()],
    ['⛶ Tam Ekran',()=>openFullscreen()],['💡 Ambiyans Işığı',()=>toggleAmbient()],
    ['🎙 Karaoke',()=>toggleKaraoke()],['🎤 Söz Adası',()=>toggleLyricsIsland()],['⌨ Kısayollar',()=>showShortcuts()],
    ['📐 Kenar Çubuğu (daralt/genişlet)',()=>setSidebarRail(!document.getElementById('app').classList.contains('sidebar-rail'))],
    ['🎧 Şimdi çalıyor (merkez)',()=>showView('now')],
    ['⏭ Sonraki',()=>bridge.next()],['⏮ Önceki',()=>bridge.prev()],['⏯ Oynat/Duraklat',()=>bridge.toggle()],
  ];
  function render(q){
    q=(q||'').toLowerCase();list.innerHTML='';
    commands.filter(c=>c[0].toLowerCase().includes(q)).slice(0,8).forEach(c=>{const it=el('div','palette-item',T(c[0]));it.onclick=e=>{e.stopPropagation();back.remove();c[1]();};list.appendChild(it);});  // stopPropagation: komut bir menü açarsa global tıkla-kapat onu silmesin
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
