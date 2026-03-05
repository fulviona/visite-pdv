
// ===== Persistenza =====
let visite = JSON.parse(localStorage.getItem('visite')||'[]');
function save(){ localStorage.setItem('visite', JSON.stringify(visite)); }

// ===== Utility =====
const sleep = ms => new Promise(r=>setTimeout(r, ms));
const km = m => (m/1000).toFixed(1);
const mm = s => Math.round(s/60);
function isValidCoord(v){ return typeof v?.lat==='number' && typeof v?.lng==='number' && !Number.isNaN(v.lat) && !Number.isNaN(v.lng); }

// ===== Geocoding (Nominatim) =====
async function geocodeAddress(address){
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(address)}&limit=1&addressdetails=0&accept-language=it`;
  const r = await fetch(url, { headers: { 'Accept':'application/json' }});
  const j = await r.json();
  if(j && j.length) return {lat:parseFloat(j[0].lat), lng:parseFloat(j[0].lon)};
  return null;
}
async function reverseGeocode(lat,lng){
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=it`;
  const r = await fetch(url);
  const j = await r.json();
  return j && (j.display_name || (j.address?.road+", "+(j.address?.city||j.address?.town||j.address?.village||'')+", "+(j.address?.postcode||'')+", Italia"));
}

// ===== Routing (OSRM) =====
async function routeOSRM(points){
  const coords = points.map(p=>`${p.lng},${p.lat}`).join(';');
  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true&annotations=distance,duration`;
  const r = await fetch(url);
  if(!r.ok) throw new Error('OSRM HTTP '+r.status);
  const j = await r.json();
  if(j.code!=='Ok') throw new Error('OSRM code '+j.code);
  return j.routes[0];
}

// ===== TSP (Nearest Neighbor) =====
function distanza(a,b){
  const R=6371, dLat=(b.lat-a.lat)*Math.PI/180, dLng=(b.lng-a.lng)*Math.PI/180;
  const lat1=a.lat*Math.PI/180, lat2=b.lat*Math.PI/180;
  const x=Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(x));
}
function tspOrder(punti){
  if(punti.length<=2) return punti;
  const rem = punti.map(p=>({...p}));
  const tour=[rem.shift()];
  while(rem.length){
    const last=tour[tour.length-1];
    let bestI=0, bestD=distanza(last, rem[0]);
    for(let i=1;i<rem.length;i++){
      const d=distanza(last, rem[i]); if(d<bestD){ bestD=d; bestI=i; }
    }
    tour.push(rem.splice(bestI,1)[0]);
  }
  return tour;
}

// ===== Elementi UI =====
const el = {
  name: document.getElementById('pdv-name'),
  addr: document.getElementById('pdv-address'),
  note: document.getElementById('note'),
  foto: document.getElementById('foto'),
  excel: document.getElementById('excel'),
  status: document.getElementById('import-status'),
  lista: document.getElementById('lista'),
  mappa: document.getElementById('mappa'),
  istr: document.getElementById('istruzioni'),
  btnGPS: document.getElementById('btn-gps'),
  btnSalva: document.getElementById('btn-salva'),
  btnImport: document.getElementById('btn-importa'),
  btnClear: document.getElementById('btn-clear'),
  btnMappa: document.getElementById('btn-mappa'),
  btnTSP: document.getElementById('btn-tsp'),
  btnNav: document.getElementById('btn-nav'),
  fabPDF: document.getElementById('fab-pdf'),
  navModal: document.getElementById('nav-modal'),
  goOverlay: document.getElementById('go-overlay'),
  goBtn: document.getElementById('go-btn'),
  goCancel: document.getElementById('go-cancel')
};

// ===== Render Lista =====
let editingIndex = -1;
function render(){
  el.lista.innerHTML='';
  visite.forEach((v,i)=>{
    const li = document.createElement('li'); li.className='item';

    const row = document.createElement('div'); row.className='row';
    const info = document.createElement('div');
    info.innerHTML = `<div class="title">${v.nome||'Senza nome'}</div><div class="addr">${v.address||''}</div>`;

    const right = document.createElement('div'); right.className='tags';
    const tag = document.createElement('span'); tag.className='tag'+(v.visited?' visited':''); tag.textContent=v.visited?'Visitato':'Da visitare';
    tag.onclick=()=>{ v.visited=!v.visited; save(); render(); };
    right.appendChild(tag);

    row.appendChild(info); row.appendChild(right);
    li.appendChild(row);

    const actions = document.createElement('div'); actions.className='actions';
    const bEdit = document.createElement('button'); bEdit.textContent='✏ Modifica'; bEdit.onclick=()=>{ editingIndex=(editingIndex===i?-1:i); render(); };
    const bDel = document.createElement('button'); bDel.className='danger'; bDel.textContent='❌ Elimina'; bDel.onclick=()=>onDelete(i);
    const bRemPhoto = document.createElement('button'); bRemPhoto.textContent='🖼 Rimuovi foto'; bRemPhoto.onclick=()=>onRemovePhoto(i);
    actions.append(bEdit, bRemPhoto, bDel);
    li.appendChild(actions);

    if(v.foto){
      const img = document.createElement('img'); img.src=v.foto; img.className='thumb'; img.alt='foto';
      img.onclick=()=>window.open(v.foto,'_blank');
      li.appendChild(img);
    }

    if(editingIndex===i){
      const ed = document.createElement('div'); ed.className='editor';
      ed.innerHTML = `
        <div class="grid-2">
          <input id="e-nome" value="${v.nome||''}"/>
          <input id="e-address" value="${v.address||''}"/>
        </div>
        <textarea id="e-note">${v.note||''}</textarea>
        <div class="btn-row">
          <button id="e-geocode">🔄 Geocoding indirizzo</button>
          <button id="e-gps">📍 Usa posizione attuale</button>
          <input type="file" id="e-foto" accept="image/*" />
        </div>
        <div class="btn-row">
          <button id="e-save">💾 Salva modifiche</button>
          <button id="e-cancel">↩ Annulla</button>
        </div>`;
      li.appendChild(ed);

      ed.querySelector('#e-cancel').onclick=()=>{ editingIndex=-1; render(); };
      ed.querySelector('#e-save').onclick=()=>{
        v.nome = ed.querySelector('#e-nome').value.trim();
        v.address = ed.querySelector('#e-address').value.trim();
        v.note = ed.querySelector('#e-note').value;
        const f = ed.querySelector('#e-foto').files[0];
        if(f){ const r=new FileReader(); r.onload=e=>{ v.foto=e.target.result; save(); editingIndex=-1; render(); }; r.readAsDataURL(f); }
        else { save(); editingIndex=-1; render(); }
      };
      ed.querySelector('#e-geocode').onclick=async()=>{
        const a = ed.querySelector('#e-address').value.trim(); if(!a) return alert('Inserisci un indirizzo.');
        const pos = await geocodeAddress(a); if(!pos) return alert('Indirizzo non trovato.');
        v.lat=pos.lat; v.lng=pos.lng; v.src='geocode'; save(); alert('Coordinate aggiornate.');
      };
      ed.querySelector('#e-gps').onclick=()=>{
        navigator.geolocation.getCurrentPosition(async gp=>{
          v.lat=gp.coords.latitude; v.lng=gp.coords.longitude; v.address = await reverseGeocode(v.lat, v.lng) || v.address; v.src='gps'; save(); render();
        }, err=> alert('GPS non disponibile: '+err.message), {enableHighAccuracy:true, timeout:10000});
      };
    }

    el.lista.appendChild(li);
  });
}

function onDelete(i){ if(!confirm('Eliminare questa visita?')) return; visite.splice(i,1); save(); render(); }
function onRemovePhoto(i){ if(!visite[i].foto) return alert('Nessuna foto da rimuovere.'); if(!confirm('Rimuovere la foto?')) return; visite[i].foto=''; save(); render(); }

// ===== Nuova visita =====
el.btnSalva.onclick = async () => {
  try{
    const nome = el.name.value.trim();
    const address = el.addr.value.trim();
    if(!nome) return alert('Inserisci il nome.');

    let lat=null, lng=null, src=null;
    if(address){ const pos = await geocodeAddress(address); if(pos){ lat=pos.lat; lng=pos.lng; src='geocode'; } }

    const file = el.foto.files[0];
    const reader = new FileReader();
    reader.onload = (e)=>{
      visite.push({ nome, address, note: el.note.value, lat, lng, src, foto: e.target.result||'', visited:false });
      save(); render();
      el.name.value=''; el.addr.value=''; el.note.value=''; el.foto.value='';
    };
    if(file) reader.readAsDataURL(file); else reader.onload({target:{result:''}});
  }catch(err){ alert('Errore salvataggio: '+err.message); }
};

// GPS per nuova visita (compila indirizzo ma non salva finché non premi Salva)
el.btnGPS.onclick = ()=>{
  navigator.geolocation.getCurrentPosition(async gp=>{
    const lat=gp.coords.latitude, lng=gp.coords.longitude;
    const addr = await reverseGeocode(lat,lng);
    if(addr) el.addr.value = addr;
  }, err=> alert('GPS non disponibile: '+err.message), {enableHighAccuracy:true, timeout:10000});
};

// ===== Import Excel (robusto) =====
function pick(obj, keys){ for(const k of keys){ const found = Object.keys(obj).find(x=>x.trim().toLowerCase()===k.trim().toLowerCase()); if(found) return obj[found]; } return undefined; }

el.btnImport.onclick = ()=>{
  const file = el.excel.files[0]; if(!file) return alert('Seleziona un file .xlsx');
  el.status.textContent='Import in corso…';
  const fr = new FileReader();
  fr.onload = async (e)=>{
    const wb = XLSX.read(e.target.result, {type:'binary'});
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(ws, {defval:'', raw:true});
    let ok=0, ko=0;
    for(const row of data){
      const cod = pick(row, ['Cod_Punto']);
      const reg = pick(row, ['regione_PV','regione','reg']);
      const sede = pick(row, ['Sede','Citta','Città']);
      const via = pick(row, ['Indirizzo Sede','Indirizzo']);
      const cap = pick(row, ['Cap Sede','CAP','Cap']);
      if(!cod || !sede || !via){ ko++; continue; }
      const address = [via, sede, cap, reg, 'Italia'].filter(Boolean).join(', ');
      try{
        const pos = await geocodeAddress(address);
        if(pos){ visite.push({ nome:`${String(cod).trim()} - ${String(sede).trim()}`, address, lat:pos.lat, lng:pos.lng, src:'geocode', note:'', foto:'', visited:false }); ok++; save(); render(); }
        else { ko++; }
      }catch{ ko++; }
      await sleep(1200);
      el.status.textContent=`Import: ${ok} ok, ${ko} errori`;
    }
    el.status.textContent=`Completato: ${ok} importati, ${ko} non importati`;
  };
  fr.readAsBinaryString(file);
};

// ===== Cancella tutte =====
el.btnClear.onclick = ()=>{ if(!visite.length) return alert('Nessuna visita salvata.'); if(!confirm('Attenzione: vuoi eliminare TUTTE le visite?')) return; if(!confirm('Conferma definitiva: questa azione è irreversibile.')) return; visite = []; save(); render(); el.status.textContent='Lista svuotata.'; };

// ===== Mappa & Routing =====
let map, layerRoute; let lastOrderedPts = null;
function ensureMap(){ if(map) return map; el.mappa.style.display='block'; map = L.map('mappa'); L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 19, crossOrigin:true}).addTo(map); return map; }
function addNumberedMarkers(pts, visitedFlags){ map.eachLayer(l=>{ if(l instanceof L.Marker) map.removeLayer(l); }); pts.forEach((p,idx)=>{ const visited = visitedFlags[idx]; const colorClass = visited? 'marker-green' : 'marker-red'; const html = `<div class="marker-num ${colorClass}">${idx+1}</div>`; const icon = L.divIcon({className:'', html, iconSize:[28,28], iconAnchor:[14,14]}); L.marker([p.lat,p.lng], {icon}).addTo(map).bindPopup(`#${idx+1}`); }); }
async function mostraMappa(percorsoPunti){ if(!visite.length) return alert('Nessun punto.'); const source = (percorsoPunti && percorsoPunti.length? percorsoPunti : visite).filter(v=>v.lat && v.lng); if(!source.length) return alert('Nessun punto con coordinate valide.'); const pts = source.map(v=>({lat:v.lat, lng:v.lng})); const visitedFlags = source.map(v=>!!v.visited); ensureMap(); const bounds = L.latLngBounds(pts.map(p=>[p.lat,p.lng])); map.fitBounds(bounds.pad(0.2)); addNumberedMarkers(pts, visitedFlags); try{ const route = await routeOSRM(pts); if(layerRoute) map.removeLayer(layerRoute); layerRoute = L.geoJSON(route.geometry, { style:{ color:'#4cc9f0', weight:5 } }).addTo(map); renderIstruzioni(route); }catch(err){ alert('Routing non disponibile: '+err.message); } }
function renderIstruzioni(route){ el.istr.innerHTML=''; let stepCount=1; route.legs.forEach((leg)=>{ leg.steps.forEach(step=>{ const liEl=document.createElement('li'); const name = step.name && step.name!=='-'? step.name : 'strada senza nome'; const mod = step.maneuver && step.maneuver.modifier? step.maneuver.modifier : ''; liEl.textContent = `${stepCount}. ${mod?mod+': ':''}prosegui su ${name} per ${km(step.distance)} km`; el.istr.appendChild(liEl); stepCount++; }); }); const liSum=document.createElement('li'); liSum.innerHTML = `<strong>Totale:</strong> ${km(route.distance)} km, ${mm(route.duration)} min`; el.istr.appendChild(liSum); }

el.btnMappa.onclick = ()=> mostraMappa();
el.btnTSP.onclick = async ()=>{ if(visite.length<2) return alert('Servono almeno 2 punti'); const src = visite.filter(v=>v.lat && v.lng); const pts = src.map(v=>({lat:v.lat,lng:v.lng})); lastOrderedPts = tspOrder(pts); await mostraMappa(lastOrderedPts); };

// ===== Flusso Navigazione iPhone-safe con overlay "AVVIA NAVIGAZIONE" =====
function buildURL(app, orderedPts){ const coords = orderedPts.map(p=>`${p.lat},${p.lng}`); switch(app){ case 'google': return `https://www.google.com/maps/dir/?api=1&travelmode=driving&waypoints=${encodeURIComponent(coords.join('|'))}`; case 'waze': return `https://waze.com/ul?ll=${coords[0]}&navigate=yes`; case 'apple': return `https://maps.apple.com/?daddr=${coords[0]}&dirflg=d`; case 'osm': return `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${encodeURIComponent(coords.join(';'))}`; default: return `https://www.google.com/maps/dir/?api=1&travelmode=driving&waypoints=${encodeURIComponent(coords.join('|'))}`; } }
function askNavigationApp(orderedPts){ const modal = el.navModal; modal.classList.remove('hidden'); const choose = (app)=>{ modal.classList.add('hidden'); // invece di aprire subito, mostra overlay centrale (azione diretta utente)
  const url = buildURL(app||'google', orderedPts); showGoOverlay(url); }; modal.querySelectorAll('[data-app]').forEach(b=> b.onclick=()=> choose(b.getAttribute('data-app'))); document.getElementById('nav-cancel').onclick=()=> choose('google'); setTimeout(()=>{ if(!modal.classList.contains('hidden')){ modal.classList.add('hidden'); showGoOverlay(buildURL('google', orderedPts)); } }, 3000); }
function showGoOverlay(url){ el.goOverlay.classList.remove('hidden'); // l'azione successiva e' un tap diretto dell'utente -> iOS la consente
  const go = ()=>{ el.goOverlay.classList.add('hidden'); setTimeout(()=>{ window.location.href = url; }, 50); };
  el.goBtn.onclick = go; el.goCancel.onclick = ()=> el.goOverlay.classList.add('hidden'); }

el.btnNav.onclick = ()=>{ const src = (lastOrderedPts && lastOrderedPts.length)? lastOrderedPts : visite.filter(v=>v.lat && v.lng).map(v=>({lat:v.lat,lng:v.lng})); if(!src.length) return alert('Nessun punto con coordinate valide. Mostra la mappa o importa i PDV.'); askNavigationApp(src); };

// ===== FAB PDF: screenshot solo mappa + report =====
el.fabPDF.onclick = async ()=>{ const { jsPDF } = window.jspdf; const pdf = new jsPDF('p','mm','a4'); let restoreRoute=false; if(layerRoute){ map.removeLayer(layerRoute); restoreRoute=true; } if(el.mappa.style.display==='none'){ await mostraMappa(); if(layerRoute){ map.removeLayer(layerRoute); restoreRoute=true; } } else { const src = visite.filter(v=>v.lat && v.lng); const pts = src.map(v=>({lat:v.lat,lng:v.lng})); const visitedFlags = src.map(v=>!!v.visited); addNumberedMarkers(pts, visitedFlags); } await sleep(500); try{ const canvas = await html2canvas(el.mappa, {useCORS:true, backgroundColor:null, scale:2}); const img = canvas.toDataURL('image/png'); const pageWidth = 210, margin=10, imgW=pageWidth-2*margin, imgH=imgW*0.6; pdf.addImage(img,'PNG', margin, 12, imgW, imgH); }catch(e){ pdf.setFontSize(12); pdf.text('Impossibile catturare la mappa. Verifica connessione o riprova.', 10, 20); } let y = 12 + (pageWidth-20)*0.6 + 10; pdf.setFontSize(14); pdf.text('Report Visite Punti Vendita', 10, y); y+=8; pdf.setFontSize(11); for(const v of visite){ if(y>270){ pdf.addPage(); y=12; } pdf.text(`PDV: ${v.nome||''}`, 10, y); y+=6; if(v.address) { pdf.text(`Indirizzo: ${v.address}`, 10, y); y+=6; } let lat=v.lat, lng=v.lng; if(v.src!=='gps' && (!isValidCoord(v))){ if(v.address){ const pos = await geocodeAddress(v.address); if(pos){ lat=pos.lat; lng=pos.lng; } } } if(isFinite(lat) && isFinite(lng)) pdf.text(`Lat: ${Number(lat).toFixed(6)}  Lng: ${Number(lng).toFixed(6)}  (${v.src==='gps'?'GPS':'Auto'})`, 10, y); else pdf.text('Coordinate non disponibili', 10, y); y+=6; if(v.note){ pdf.text(`Note: ${v.note}`, 10, y); y+=6; } if(v.foto){ try{ pdf.addImage(v.foto, 'JPEG', 10, y, 60, 45); y+=50; }catch(e){ y+=6; } } pdf.line(10, y, 200, y); y+=6; } pdf.save('visite-pdv.pdf'); if(restoreRoute){ const src = visite.filter(v=>v.lat && v.lng).map(v=>({lat:v.lat,lng:v.lng})); const route = await routeOSRM(src); layerRoute = L.geoJSON(route.geometry, { style:{ color:'#4cc9f0', weight:5 } }).addTo(map); } };

// ===== Start =====
render();
