/* =========================================================
   VISITE PDV – v3.3 (finale)
   Logica completa applicazione
========================================================= */

/* -----------------------------
   Persistenza e stato globale
----------------------------- */
let visite = JSON.parse(localStorage.getItem('visite') || '[]');
function save() { localStorage.setItem('visite', JSON.stringify(visite)); }

/* Flag per flusso navigazione iPhone-safe */
let navigationFlowActive = false;

/* Ultimo ordine TSP per Naviga */
let lastOrderedPts = null;

/* -----------------------------
   Utility varie
----------------------------- */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const km = (m) => (m / 1000).toFixed(1);
const mm = (s) => Math.round(s / 60);

function isValidCoord(v) {
  return typeof v?.lat === 'number' &&
         typeof v?.lng === 'number' &&
         !Number.isNaN(v.lat) &&
         !Number.isNaN(v.lng);
}

function pick(obj, keys) {
  for (const k of keys) {
    const found = Object.keys(obj).find(
      x => x.trim().toLowerCase() === k.trim().toLowerCase()
    );
    if (found) return obj[found];
  }
  return undefined;
}

/* -----------------------------
   Suono + Vibrazione
----------------------------- */
const clickSound = new Audio('sounds/pop.mp3');
clickSound.volume = 0.30;

let lastHapticAt = 0;

function hapticClick() {
  const now = Date.now();
  if (now - lastHapticAt < 200) return;
  lastHapticAt = now;

  try { clickSound.currentTime = 0; clickSound.play(); } catch {}
  try { navigator.vibrate?.(10); } catch {}
}

document.addEventListener('click', (e) => {
  if (e.target.closest('button')) hapticClick();
}, true);

/* -----------------------------
   Geocoding (Nominatim)
----------------------------- */
async function geocodeAddress(address) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(address)}&limit=1&addressdetails=0&accept-language=it`;
  const r = await fetch(url);
  if (!r.ok) return null;
  const j = await r.json();
  if (j && j.length) return { lat: parseFloat(j[0].lat), lng: parseFloat(j[0].lon) };
  return null;
}

async function reverseGeocode(lat, lng) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=it`;
  const r = await fetch(url);
  if (!r.ok) return '';
  const j = await r.json();
  if (j?.display_name) return j.display_name;
  return '';
}

/* -----------------------------
   Routing (OSRM)
----------------------------- */
async function routeOSRM(points) {
  const coords = points.map(p => `${p.lng},${p.lat}`).join(';');
  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true&annotations=distance,duration`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('OSRM ' + r.status);
  const j = await r.json();
  if (j.code !== 'Ok') throw new Error('OSRM code ' + j.code);
  return j.routes[0];
}

/* -----------------------------
   TSP (Nearest Neighbor)
----------------------------- */
function distanza(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;

  const x = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1) * Math.cos(lat2) *
            Math.sin(dLng / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(x));
}

function tspOrder(punti) {
  if (punti.length <= 2) return [...punti];

  const rem = punti.map(p => ({ ...p }));
  const tour = [rem.shift()];

  while (rem.length) {
    const last = tour[tour.length - 1];
    let bestI = 0;
    let bestD = distanza(last, rem[0]);

    for (let i = 1; i < rem.length; i++) {
      const d = distanza(last, rem[i]);
      if (d < bestD) {
        bestD = d;
        bestI = i;
      }
    }
    tour.push(rem.splice(bestI, 1)[0]);
  }

  return tour;
}

/* -----------------------------
   Mappa
----------------------------- */
let el = {};
let map, layerRoute;

function ensureMap() {
  if (map) return map;
  el.mappa.style.display = 'block';

  map = L.map('mappa');
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19
  }).addTo(map);

  return map;
}

function addNumberedMarkers(pts, visitedFlags) {
  map.eachLayer(layer => {
    if (layer instanceof L.Marker) map.removeLayer(layer);
  });

  pts.forEach((p, i) => {
    const icon = visitedFlags[i]
      ? L.divIcon({
          className: 'marker-visited',
          html: '✔️',
          iconSize: [32, 32],
          iconAnchor: [16, 16]
        })
      : L.divIcon({
          className: 'marker-notvisited',
          html: `${i + 1}`,
          iconSize: [32, 32],
          iconAnchor: [16, 16]
        });

    L.marker([p.lat, p.lng], { icon })
      .addTo(map)
      .bindPopup(`#${i + 1}`);
  });
}

/* -----------------------------
   Render()
----------------------------- */
let editingIndex = -1;

function render() {
  el.lista.innerHTML = '';

  visite.forEach((v, i) => {
    const li = document.createElement('li');
    li.className = 'item';

    const row = document.createElement('div');
    row.className = 'row';

    const info = document.createElement('div');
    info.innerHTML = `
      <div class="title">${v.nome || 'Senza nome'}</div>
      <div class="addr">${v.address || ''}</div>
    `;

    const right = document.createElement('div');
    right.className = 'tags';

    const tag = document.createElement('span');
    tag.className = 'tag' + (v.visited ? ' visited' : '');
    tag.textContent = v.visited ? 'Visitato' : 'Da visitare';

    tag.onclick = () => {
      v.visited = !v.visited;
      save();
      render();

      if (map && el.mappa.style.display !== 'none') {
        const src = visite.filter(v => v.lat && v.lng);
        const pts = src.map(v => ({ lat: v.lat, lng: v.lng }));
        const visitedFlags = src.map(v => !!v.visited);
        addNumberedMarkers(pts, visitedFlags);
      }
    };

    right.appendChild(tag);
    row.appendChild(info);
    row.appendChild(right);
    li.appendChild(row);

    /* --- Azioni --- */
    const actions = document.createElement('div');
    actions.className = 'actions';

    const bEdit = document.createElement('button');
    bEdit.textContent = '✏ Modifica';
    bEdit.onclick = () => { editingIndex = (editingIndex === i ? -1 : i); render(); };

    const bPhoto = document.createElement('button');
    bPhoto.textContent = '🖼 Rimuovi foto';
    bPhoto.onclick = () => onRemovePhoto(i);

    const bDel = document.createElement('button');
    bDel.className = 'danger';
    bDel.textContent = '❌ Elimina';
    bDel.onclick = () => onDelete(i);

    actions.append(bEdit, bPhoto, bDel);
    li.appendChild(actions);

    /* FOTO */
    if (v.foto) {
      const img = document.createElement('img');
      img.src = v.foto;
      img.className = 'thumb';
      img.onclick = () => window.open(v.foto, '_blank');
      li.appendChild(img);
    }

    /* EDITOR */
    if (editingIndex === i) {
      const ed = document.createElement('div');
      ed.className = 'editor';
      ed.innerHTML = `
        <div class="grid-2">
          <input id="e-nome" value="${v.nome || ''}"/>
          <input id="e-address" value="${v.address || ''}"/>
        </div>
        <textarea id="e-note">${v.note || ''}</textarea>
        <div class="btn-row">
          <button id="e-geocode">🔄 Geocoding indirizzo</button>
          <button id="e-gps">📍 Usa posizione attuale</button>
          <input type="file" id="e-foto" accept="image/*" />
        </div>
        <div class="btn-row">
          <button id="e-save">💾 Salva modifiche</button>
          <button id="e-cancel">↩ Annulla</button>
        </div>
      `;
      li.appendChild(ed);

      ed.querySelector('#e-cancel').onclick = () => {
        editingIndex = -1;
        render();
      };

      ed.querySelector('#e-save').onclick = () => {
        v.nome = ed.querySelector('#e-nome').value;
        v.address = ed.querySelector('#e-address').value;
        v.note = ed.querySelector('#e-note').value;

        const f = ed.querySelector('#e-foto').files[0];
        if (f) {
          const reader = new FileReader();
          reader.onload = e => {
            v.foto = e.target.result;
            save();
            editingIndex = -1;
            render();
          };
          reader.readAsDataURL(f);
        } else {
          save();
          editingIndex = -1;
          render();
        }
      };

      ed.querySelector('#e-geocode').onclick = async () => {
        const a = ed.querySelector('#e-address').value.trim();
        if (!a) return alert('Inserisci un indirizzo.');
        const pos = await geocodeAddress(a);
        if (!pos) return alert('Indirizzo non trovato.');
        v.lat = pos.lat;
        v.lng = pos.lng;
        v.src = 'geocode';
        save();
        alert('Coordinate aggiornate.');
      };

      ed.querySelector('#e-gps').onclick = () => {
        navigator.geolocation.getCurrentPosition(async gp => {
          v.lat = gp.coords.latitude;
          v.lng = gp.coords.longitude;
          v.address = await reverseGeocode(v.lat, v.lng) || v.address;
          v.src = 'gps';
          save();
          render();
        });
      };
    }

    el.lista.appendChild(li);
  });

  /* RESET MAPPA SE LISTA VUOTA */
  if (visite.length === 0 && map) {
    if (layerRoute) {
      map.removeLayer(layerRoute);
      layerRoute = null;
    }
    map.eachLayer(layer => {
      if (layer instanceof L.Marker) map.removeLayer(layer);
    });
    el.routeSummary.style.display = 'none';
    map.setView([41.8719, 12.5674], 6);
  }
}

/* -----------------------------
   Azioni singole
----------------------------- */
function onDelete(i) {
  if (!confirm('Eliminare questa visita?')) return;
  visite.splice(i,1);
  save();
  render();
}

function onRemovePhoto(i) {
  if (!visite[i].foto) return alert('Nessuna foto.');
  if (!confirm('Rimuovere la foto?')) return;
  visite[i].foto = '';
  save();
  render();
}

/* -----------------------------
   Salva nuova visita
----------------------------- */
async function salvaVisita() {
  const nome = el.name.value.trim();
  const address = el.addr.value.trim();
  if (!nome) return alert('Inserisci il nome.');

  let lat = null, lng = null, src = null;
  if (address) {
    const pos = await geocodeAddress(address);
    if (pos) { lat = pos.lat; lng = pos.lng; src = 'geocode'; }
  }

  const f = el.foto.files[0];
  const reader = new FileReader();
  reader.onload = e => {
    visite.push({
      nome,
      address,
      note: el.note.value,
      lat,
      lng,
      src,
      foto: e.target.result || '',
      visited: false
    });
    save();
    render();
    el.name.value = '';
    el.addr.value = '';
    el.note.value = '';
    el.foto.value = '';
  };
  if (f) reader.readAsDataURL(f);
  else reader.onload({ target: { result:'' } });
}

/* -----------------------------
   Import Excel
----------------------------- */
function importExcel() {
  const file = el.excel.files[0];
  if (!file) return alert('Seleziona file .xlsx');

  el.status.textContent = 'Import in corso…';

  const fr = new FileReader();
  fr.onload = async e => {
    const wb = XLSX.read(e.target.result, { type:'binary' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(ws,{ defval:'', raw:true });

    let ok=0, ko=0;

    for (const row of data) {
      const cod = pick(row,['Cod_Punto']);
      const reg = pick(row,['regione_PV','regione','reg']);
      const sede = pick(row,['Sede','Citta','Città']);
      const via  = pick(row,['Indirizzo Sede','Indirizzo']);
      const cap  = pick(row,['Cap Sede','CAP','Cap']);

      if (!cod || !sede || !via) {
        ko++; el.status.textContent=`Import: ${ok} ok, ${ko} err`;
        continue;
      }

      const address = [via,sede,cap,reg,'Italia'].filter(Boolean).join(', ');

      try{
        const pos = await geocodeAddress(address);
        if(pos){
          visite.push({
            nome: `${String(cod).trim()} - ${String(sede).trim()}`,
            address,
            lat: pos.lat,
            lng: pos.lng,
            src:'geocode',
            note:'',
            foto:'',
            visited:false
          });
          ok++; save(); render();
        } else ko++;
      }catch { ko++; }

      await sleep(1200);
      el.status.textContent=`Import: ${ok} ok, ${ko} err`;
    }

    el.status.textContent = `Completato: ${ok} ok, ${ko} errori`;
  };

  fr.readAsBinaryString(file);
}

/* -----------------------------
   clearAll()
----------------------------- */
function clearAll() {
  if (!visite.length) return alert('Nessuna visita.');
  if (!confirm('Eliminare TUTTE le visite?')) return;
  if (!confirm('Conferma definitiva?')) return;

  visite=[];
  save();
  render();
  el.status.textContent='Lista svuotata.';

  if(map){
    if(layerRoute){
      map.removeLayer(layerRoute);
      layerRoute=null;
    }
    map.eachLayer(l=>{ if(l instanceof L.Marker) map.removeLayer(l); });
    el.routeSummary.style.display='none';
    map.setView([41.8719,12.5674],6);
  }
}

/* -----------------------------
   clearImportedPoints()
----------------------------- */
function clearImportedPoints() {
  const msg = [
    '⚠ Operazione irreversibile',
    'Saranno rimossi SOLO i PDV importati da Excel.',
    'I PDV manuali resteranno.',
    '',
    'Procedere?'
  ].join('\n');

  if(!confirm(msg)) return;

  const before = visite.length;
  visite = visite.filter(v => v.src !== 'geocode');
  const removed = before - visite.length;

  save();
  render();

  if(map && el.mappa.style.display !== 'none'){
    const src = visite.filter(v=>v.lat && v.lng);
    addNumberedMarkers(
      src.map(v=>({lat:v.lat,lng:v.lng})),
      src.map(v=>!!v.visited)
    );
  }

  if(map && visite.length===0){
    if(layerRoute){ map.removeLayer(layerRoute); layerRoute=null; }
    map.eachLayer(l=>{ if(l instanceof L.Marker) map.removeLayer(l); });
    el.routeSummary.style.display='none';
    map.setView([41.8719,12.5674],6);
  }

  alert(removed>0
        ? `Rimossi ${removed} punti importati.`
        : 'Nessun punto importato da Excel.');
}

/* -----------------------------
   Mini Scheda percorso
----------------------------- */
function aggiornaRiepilogoPercorso(route){
  if(!route){
    el.routeSummary.style.display='none';
    return;
  }

  const distanzaKm = km(route.distance);

  const totalSec = Math.round(route.duration);
  const ore = Math.floor(totalSec/3600);
  const min = Math.round((totalSec%3600)/60);

  el.routeSummary.innerHTML = `
    <div><strong>Distanza totale:</strong> ${distanzaKm} km</div>
    <div><strong>Tempo stimato:</strong> ${ore} h ${min} min</div>
  `;

  el.routeSummary.style.display='block';
}

/* -----------------------------
   Mostra Mappa
----------------------------- */
async function mostraMappa(percorsoPunti){
  if(!visite.length) return alert('Nessun punto.');

  const source = (percorsoPunti && percorsoPunti.length ? percorsoPunti : visite)
    .filter(v=>v.lat && v.lng);

  if(!source.length) return alert('Nessun punto con coordinate valide.');

  const pts = source.map(v=>({lat:v.lat,lng:v.lng}));
  const visitedFlags = source.map(v=>!!v.visited);

  ensureMap();

  const bounds = L.latLngBounds(pts.map(p=>[p.lat,p.lng]));
  map.fitBounds(bounds.pad(0.2));

  addNumberedMarkers(pts, visitedFlags);

  try{
    const route = await routeOSRM(pts);
    if(layerRoute) map.removeLayer(layerRoute);

    layerRoute = L.geoJSON(route.geometry,{
      style:{ color:'#4cc9f0', weight:5 }
    }).addTo(map);

    aggiornaRiepilogoPercorso(route);

  }catch(err){
    alert('Routing non disponibile: '+err.message);
  }
}

/* -----------------------------
   Navigazione
----------------------------- */
function buildDeepLink(app,coord){
  const latlng = `${coord.lat},${coord.lng}`;
  switch(app){
    case 'google': return `comgooglemaps://?daddr=${latlng}&directionsmode=driving`;
    case 'waze'  : return `waze://?ll=${latlng}&navigate=yes`;
    case 'apple' : return `maps://?daddr=${latlng}&dirflg=d`;
    case 'osm'   : return `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${encodeURIComponent(latlng)}`;
    default      : return `comgooglemaps://?daddr=${latlng}&directionsmode=driving`;
  }
}

function askNavigationApp(orderedPts){
  if(!navigationFlowActive) return;

  const modal = el.navModal;
  modal.classList.remove('hidden');
  requestAnimationFrame(()=>modal.classList.add('show'));

  const choose = (app)=>{
    modal.classList.remove('show');
    setTimeout(()=>modal.classList.add('hidden'),250);
    const first = orderedPts[0];
    const url = buildDeepLink(app || 'google', first);
    showGoOverlay(url);
  };

  modal.querySelectorAll('[data-app]').forEach(b=>{
    b.onclick = ()=> choose(b.dataset.app);
  });

  el.navCancel.onclick = ()=> choose('google');
}

/* -----------------------------
   Overlay NAVIGA
----------------------------- */
function showGoOverlay(url){
  el.goOverlay.classList.add('show');

  el.goBtn.onclick = ()=>{
    el.goOverlay.classList.remove('show');
    setTimeout(()=>{
      window.location.href=url;
      navigationFlowActive=false;
    },50);
  };

  el.goCancel.onclick = ()=>{
    el.goOverlay.classList.remove('show');
    navigationFlowActive=false;
  };
}

/* -----------------------------
   PDF
----------------------------- */
async function exportPDF(){
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF('p','mm','a4');

  let restoreRoute=false;
  if(layerRoute){
    map.removeLayer(layerRoute);
    restoreRoute=true;
  }

  if(el.mappa.style.display==='none'){
    await mostraMappa();
    if(layerRoute){ map.removeLayer(layerRoute); restoreRoute=true; }
  }else{
    const src = visite.filter(v=>v.lat&&v.lng);
    addNumberedMarkers(src.map(v=>({lat:v.lat,lng:v.lng})),
                       src.map(v=>!!v.visited));
  }

  await sleep(500);

  try{
    const canvas = await html2canvas(el.mappa,{ useCORS:true, backgroundColor:null, scale:2 });
    const img = canvas.toDataURL('image/png');
    const W = 210, margin=10;
    const imgW=W-2*margin, imgH=imgW*0.6;
    pdf.addImage(img,'PNG',margin,12,imgW,imgH);
  }catch(e){
    pdf.setFontSize(12);
    pdf.text('Errore cattura mappa',10,20);
  }

  let y = 12+(210-20)*0.6+10;
  pdf.setFontSize(14);
  pdf.text('Report Visite Punti Vendita',10,y);
  y+=8;
  pdf.setFontSize(11);

  for(const v of visite){
    if(y>270){ pdf.addPage(); y=12; }

    pdf.text(`PDV: ${v.nome}`,10,y); y+=6;
    if(v.address){ pdf.text(`Indirizzo: ${v.address}`,10,y); y+=6; }

    let lat=v.lat, lng=v.lng;
    if(v.src!=='gps' && !isValidCoord(v)){
      if(v.address){
        const pos = await geocodeAddress(v.address);
        if(pos){ lat=pos.lat; lng=pos.lng; }
      }
    }

    if(isFinite(lat)&&isFinite(lng))
      pdf.text(`Lat: ${lat.toFixed(6)} Lng: ${lng.toFixed(6)} (${v.src==='gps'?'GPS':'Auto'})`,10,y);
    else pdf.text('Coordinate non disponibili',10,y);

    y+=6;

    if(v.note){ pdf.text(`Note: ${v.note}`,10,y); y+=6; }

    if(v.foto){
      try{
        pdf.addImage(v.foto,'JPEG',10,y,60,45);
        y+=50;
      }catch{}
    }

    pdf.line(10,y,200,y);
    y+=6;
  }

  pdf.save('visite-pdv.pdf');

  if(restoreRoute){
    const src = visite.filter(v=>v.lat&&v.lng)
                      .map(v=>({lat:v.lat,lng:v.lng}));
    const route = await routeOSRM(src);
    layerRoute = L.geoJSON(route.geometry,{
      style:{ color:'#4cc9f0', weight:5 }
    }).addTo(map);
  }
}

/* -----------------------------
   Init
----------------------------- */
document.addEventListener('DOMContentLoaded',()=>{

  setTimeout(()=>{
    const btn = document.getElementById('btn-clear-import');
    if(btn) btn.onclick = clearImportedPoints;
  },100);

  el = {
    name: document.getElementById('pdv-name'),
    addr: document.getElementById('pdv-address'),
    note: document.getElementById('note'),
    foto: document.getElementById('foto'),
    excel: document.getElementById('excel'),
    status: document.getElementById('import-status'),
    lista: document.getElementById('lista'),
    mappa: document.getElementById('mappa'),
    istr: document.getElementById('istruzioni'),
    routeSummary: document.getElementById('route-summary'),
    btnGPS: document.getElementById('btn-gps'),
    btnSalva: document.getElementById('btn-salva'),
    btnImport: document.getElementById('btn-importa'),
    btnClear: document.getElementById('btn-clear'),
    btnMappa: document.getElementById('btn-mappa'),
    btnTSP: document.getElementById('btn-tsp'),
    btnNav: document.getElementById('btn-nav'),
    fabPDF: document.getElementById('fab-pdf'),
    navModal: document.getElementById('nav-modal'),
    navCancel: document.getElementById('nav-cancel'),
    goOverlay: document.getElementById('go-overlay'),
    goBtn: document.getElementById('go-btn'),
    goCancel: document.getElementById('go-cancel'),
    loading: document.getElementById('loading-screen')
  };

  el.btnSalva.onclick = salvaVisita;
  el.btnGPS.onclick = fillFromGPS;
  el.btnImport.onclick = importExcel;
  el.btnClear.onclick = clearAll;

  el.btnClearImport = document.getElementById('btn-clear-import');
  el.btnClearImport.onclick = clearImportedPoints;

  el.btnMappa.onclick = ()=>mostraMappa();

  el.btnTSP.onclick = async()=>{
    if(visite.length<2) return alert('Servono almeno 2 punti');

    const validi = visite.filter(v=>v.lat&&v.lng);
    const pts = validi.map(v=>({lat:v.lat, lng:v.lng}));
    const ordered = tspOrder(pts);

    visite = ordered.map(o=>visite.find(v=>
      v.lat===o.lat &&
      v.lng===o.lng &&
      v.nome===o.nome
    ));

    save();
    render();
    await mostraMappa(visite);
  };

  el.btnNav.onclick = ()=>{
    const src = (lastOrderedPts && lastOrderedPts.length)
      ? lastOrderedPts
      : visite.filter(v=>v.lat&&v.lng).map(v=>({lat:v.lat,lng:v.lng}));

    if(!src.length) return alert('Nessun punto valido.');

    navigationFlowActive=true;
    askNavigationApp(src);
  };

  el.fabPDF.onclick = exportPDF;

  render();
});

/* -----------------------------
   Loading screen
----------------------------- */
window.addEventListener('load',()=>{
  const scr=document.getElementById('loading-screen');
  if(scr) setTimeout(()=>scr.classList.add('hidden'),400);
});
