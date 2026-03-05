
let visite = JSON.parse(localStorage.getItem('visite')||'[]');
function save(){ localStorage.setItem('visite', JSON.stringify(visite)); }
async function geocode(a){let u=`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(a)}&limit=1`;let r=await fetch(u);let j=await r.json();return j.length?{lat:parseFloat(j[0].lat),lng:parseFloat(j[0].lon)}:null;}

document.getElementById('btn-importa').onclick=()=>{
 let f=document.getElementById('excel').files[0]; if(!f) return alert('Seleziona file');
 let fr=new FileReader();
 fr.onload=async e=>{
  let wb=XLSX.read(e.target.result,{type:'binary'});
  let ws=wb.Sheets[wb.SheetNames[0]];
  let rows=XLSX.utils.sheet_to_json(ws);
  let ok=0,ko=0;
  for(const r of rows){
    let cod=r['Cod_Punto'], reg=r['regione_PV'], sede=r['Sede'], via=r['Indirizzo Sede'], cap=r['Cap Sede'];
    if(!cod||!sede||!via){ko++;continue;}
    let address=`${via}, ${cap||''}, ${reg||''}`;
    let pos=await geocode(address);
    if(!pos){ko++;continue;}
    visite.push({nome:`${cod} - ${sede}`,address,lat:pos.lat,lng:pos.lng,note:'',foto:'',visited:false});
    save(); ok++;
    await new Promise(r=>setTimeout(r,1200));
  }
  document.getElementById('import-status').innerText=`Importati ${ok}, errori ${ko}`;
  render();
 };
 fr.readAsBinaryString(f);
};

function render(){
 let ul=document.getElementById('lista'); ul.innerHTML='';
 visite.forEach(v=>{
  let li=document.createElement('li');
  let t=document.createElement('div'); t.innerHTML=`<b>${v.nome}</b><br>${v.address}`;
  let tag=document.createElement('span'); tag.className='tag'+(v.visited?' visited':''); tag.textContent=v.visited?'Visitato':'Da fare';
  tag.onclick=()=>{v.visited=!v.visited;save();render();};
  li.appendChild(t); li.appendChild(tag); ul.appendChild(li);
 });
}

async function mostraMappa(p){
 let pts=(p||visite).map(v=>({lat:v.lat,lng:v.lng}));
 document.getElementById('mappa').style.display='block';
 if(!window.map){window.map=L.map('mappa');L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);} 
 let b=L.latLngBounds(pts.map(p=>[p.lat,p.lng])); map.fitBounds(b);
 pts.forEach((p,i)=>L.marker([p.lat,p.lng]).addTo(map).bindPopup(`#${i+1}`));
}
document.getElementById('btn-mappa').onclick=()=>mostraMappa();

document.getElementById('btn-tsp').onclick=()=>{
 if(visite.length<2) return alert('Minimo 2');
 function d(a,b){return Math.hypot(a.lat-b.lat,a.lng-b.lng);} 
 let rem=[...visite], out=[rem.shift()];
 while(rem.length){let last=out[out.length-1],bi=0,bd=d(last,rem[0]); for(let i=1;i<rem.length;i++){let dd=d(last,rem[i]);if(dd<bd){bd=dd;bi=i;}} out.push(rem.splice(bi,1)[0]);}
 mostraMappa(out);
};

document.getElementById('btn-osm').onclick=()=>{
 let r=visite.map(v=>`${v.lat},${v.lng}`).join('%3B'); window.open(`https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${r}`,'_blank');};

document.getElementById('btn-pdf').onclick=()=>{
 let {jsPDF}=window.jspdf; let pdf=new jsPDF(),y=10;
 visite.forEach(v=>{if(y>270){pdf.addPage();y=10;} pdf.text(`PDV: ${v.nome}`,10,y);y+=6; pdf.text(v.address,10,y);y+=6;});
 pdf.save('visite.pdf');};

render();
