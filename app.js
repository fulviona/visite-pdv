
// === Persistenza ===
let visite = JSON.parse(localStorage.getItem('visite')||'[]');
function save(){ localStorage.setItem('visite', JSON.stringify(visite)); }

// === Utility ===
const sleep = ms => new Promise(r=>setTimeout(r, ms));
const km = m => (m/1000).toFixed(1);
const mm = s => Math.round(s/60);

// === Geocoding (Nominatim – gratuito) ===
async function geocodeNominatim(address){
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(address)}&limit=1&addressdetails=0&accept-language=it`;
  const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if(!r.ok) throw new Error('Geocoding HTTP '+r.status);
  const j = await r.json();
  if(!j.length) return null;
  return { lat: parseFloat(j[0].lat), lng: parseFloat(j[0].lon) };
}

// === Routing (OSRM pubblico – gratuito) ===
async function routeOSRM(points){
  // points: [{lat,lng}, ...]
  const coords = points.map(p=>`${p.lng},${p.lat}`).join(';'); // OSRM usa lon,lat
  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true&annotations=distance,duration`;
  const r = await fetch(url);
  if(!r.ok) throw new Error('OSRM HTTP '+r.status);
  const j = await r.json();
  if(j.code!=='Ok') throw new Error('OSRM code '+j.code);
  return j.routes[0]; // {geometry, legs, distance, duration}
}

// === TSP (Nearest Neighbor) per ordinarli prima del routing ===
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

// === UI Elements ===
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
  btnSalva: document.getElementById('btn-salva'),
  btnImport: document.getElementById('btn-importa'),
  btnMappa: document.getElementById('btn-mappa'),
  btnOSM: document.getElementById('btn-osm'),
  btnPDF: document.getElementById('btn-pdf'),
  btnTSP: document.getElementById('btn-tsp'),
};

// === Render lista ===
function render(){
  el.lista.innerHTML='';
  visite.forEach((v,i)=>{
    const li=document.createElement('li');
    const left=document.createElement('div');
    left.innerHTML = `<div><strong>${v.nome||'Senza nome'}</strong></div><div style="color:#9fb3c8;font-size:12px">${v.address||''}</div>`;
    const tag=document.createElement('span');
    tag.className='tag'+(v.visited?' visited':'');
    tag.textContent = v.visited? 'Visitato' : 'Da visitare';
    tag.onclick=()=>{ v.visited=!v.visited; save(); render(); };
    li.appendChild(left); li.appendChild(tag);
    el.lista.appendChild(li);
  });
}

// === Salvataggio singola visita ===
el.btnSalva.onclick = async () => {
  try{
    const address = el.addr.value.trim();
    const nome = el.name.value.trim();
    if(!address || !nome) return alert('Inserisci almeno Nome e Indirizzo.');
    const pos = await geocodeNominatim(address);
    if(!pos) return alert('Indirizzo non trovato.');
    const file = el.foto.files[0];
    const reader = new FileReader();
    reader.onload = (e)=>{
      visite.push({ nome, address, note: el.note.value, lat: pos.lat, lng: pos.lng, foto: e.target.result, visited:false });
      save(); render();
      el.name.value=''; el.addr.value=''; el.note.value=''; el.foto.value='';
    };
    if(file) reader.readAsDataURL(file); else { reader.onload({target:{result:''}}); }
  }catch(err){ alert('Errore salvataggio: '+err.message); }
};

// === Import Excel ===
el.btnImport.onclick = async () => {
  const file = el.excel.files[0]; if(!file) return alert('Seleziona un file .xlsx');
  el.status.textContent='Import in corso… (geocoding sequenziale)';
  const fr = new FileReader();
  fr.onload = async (e)=>{
    const wb = XLSX.read(e.target.result, {type:'binary'});
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(ws);
    let ok=0, ko=0;
    for(const row of data){
      const nome = row.NOME; const address = row.INDIRIZZO;
      if(!nome || !address) { ko++; continue; }
      try{
        const pos = await geocodeNominatim(address);
        if(pos){
          visite.push({ nome, address, note:'', lat:pos.lat, lng:pos.lng, foto:'', visited:false }); ok++; save(); render();
        } else ko++;
      }catch{ ko++; }
      await sleep(1200); // rispetto politiche Nominatim
      el.status.textContent=`Import: ${ok} ok, ${ko} errori`;
    }
    el.status.textContent=`Completato: ${ok} importati, ${ko} non importati`;
  };
  fr.readAsBinaryString(file);
};

// === Mappa e routing ===
let map, layerRoute;
function ensureMap(){
  if(map) return map;
  el.mappa.style.display='block';
  map = L.map('mappa');
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 19}).addTo(map);
  return map;
}

async function mostraMappa(percorsoPunti){
  if(!visite.length) return alert('Nessun punto.');
  const pts = (percorsoPunti && percorsoPunti.length? percorsoPunti : visite).map(v=>({lat:v.lat, lng:v.lng}));
  ensureMap();
  const bounds = L.latLngBounds(pts.map(p=>[p.lat,p.lng]));
  map.fitBounds(bounds.pad(0.2));
  // Marker
  pts.forEach((p,idx)=> L.marker([p.lat,p.lng]).addTo(map).bindPopup(`#${idx+1}`));
  try{
    const route = await routeOSRM(pts);
    if(layerRoute) map.removeLayer(layerRoute);
    layerRoute = L.geoJSON(route.geometry, { style:{ color:'#4cc9f0', weight:5 } }).addTo(map);
    // Istruzioni
    renderIstruzioni(route);
  }catch(err){ alert('Routing non disponibile: '+err.message); }
}

function renderIstruzioni(route){
  el.istr.innerHTML='';
  let stepCount=1;
  route.legs.forEach((leg,li)=>{
    leg.steps.forEach(step=>{
      const liEl=document.createElement('li');
      const name = step.name && step.name!=='-'? step.name : 'strada senza nome';
      const dir = step.maneuver && step.maneuver.modifier? step.maneuver.modifier : '';
      liEl.textContent = `${stepCount}. ${dir?dir+': ':''}prosegui su ${name} per ${km(step.distance)} km`;
      el.istr.appendChild(liEl); stepCount++;
    });
  });
  const liSum=document.createElement('li');
  liSum.innerHTML = `<strong>Totale:</strong> ${km(route.distance)} km, ${mm(route.duration)} min`;
  el.istr.appendChild(liSum);
}

// === Pulsanti ===
el.btnMappa.onclick = ()=> mostraMappa();

el.btnTSP.onclick = async ()=>{
  if(visite.length<2) return alert('Servono almeno 2 punti');
  const ordered = tspOrder(visite.map(v=>({lat:v.lat,lng:v.lng})));
  await mostraMappa(ordered);
};

el.btnOSM.onclick = ()=>{
  if(visite.length<2) return alert('Servono almeno 2 punti');
  // OpenStreetMap directions con OSRM (FOSSGIS)
  const routeParam = visite.map(v=>`${v.lat},${v.lng}`).join('%3B');
  const url = `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${routeParam}`;
  window.open(url, '_blank');
};

// === PDF ===
function esportaPDF(){
  const { jsPDF } = window.jspdf; const pdf = new jsPDF(); let y=12; let p=1;
  pdf.setFontSize(14); pdf.text('Report Visite Punti Vendita', 10, y); y+=8; pdf.setFontSize(11);
  visite.forEach(v=>{
    if(y>270){ pdf.addPage(); y=12; }
    pdf.text(`PDV: ${v.nome}`,10,y); y+=6;
    if(v.address){ pdf.text(`Indirizzo: ${v.address}`,10,y); y+=6; }
    pdf.text(`Lat: ${v.lat?.toFixed(6)}  Lng: ${v.lng?.toFixed(6)}`,10,y); y+=6;
    if(v.note){ pdf.text(`Note: ${v.note}`,10,y); y+=6; }
    if(v.foto){ try{ pdf.addImage(v.foto, 'JPEG', 10, y, 60, 45); y+=50; }catch(e){ y+=6; } }
    pdf.line(10, y, 200, y); y+=6;
  });
  pdf.save('visite-pdv.pdf');
}
el.btnPDF.onclick = esportaPDF;

// === Start ===
render();
