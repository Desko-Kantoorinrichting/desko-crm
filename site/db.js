/* Opslag in een privé GitHub-repository (standaard Desko-Kantoorinrichting/desko-crm-data).
   Elke collectie is een JSON-bestand in de map data/ ({ "<id>": {...}, ... }).
   Activiteiten staan per bedrijf in data/activiteiten/<bedrijfId>.json.
   Elke opslag is een commit, dus de Git-geschiedenis is meteen het wijzigingslog.
   De app gebruikt een document-API: collection(..).doc(..).set/update/delete,
   where/orderBy/limit en onSnapshot (verversen elke minuut en bij terugkeren in de app). */
function makeDb({repo, token, branch = 'main', gebruiker = 'onbekend'}){
  const API = 'https://api.github.com';
  const SHARD = {activiteiten:'bedrijfId'};
  const bestanden = new Map();   // pad -> {docs, sha, etag, laden}
  const luisteraars = new Set(); // {pad, ververs}
  const wachtrij = new Map();    // pad -> [{op, id, data, ok, fout}]
  const bezig = new Set();

  const b64enc = s => { const b = new TextEncoder().encode(s); let bin = ''; for(let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(bin); };
  const b64dec = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, '')), c => c.charCodeAt(0)));
  const nieuwId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const kopie = o => JSON.parse(JSON.stringify(o));

  async function gh(pad, opts = {}){
    const r = await fetch(API + pad, {...opts, cache:'no-store', headers:{
      Authorization:`Bearer ${token}`, Accept:'application/vnd.github+json', 'X-GitHub-Api-Version':'2022-11-28', ...(opts.headers || {})}});
    if(r.status === 401) { const e = new Error('Niet ingelogd'); e.code = 'auth'; throw e; }
    return r;
  }

  function bestandPad(collectie, sleutel){
    if(SHARD[collectie]){
      if(!sleutel) throw new Error(`${collectie} kan alleen per ${SHARD[collectie]} worden opgehaald`);
      return `data/${collectie}/${sleutel}.json`;
    }
    return `data/${collectie}.json`;
  }
  const staat = pad => { if(!bestanden.has(pad)) bestanden.set(pad, {docs:{}, sha:null, etag:null, geladen:false}); return bestanden.get(pad); };

  async function laad(pad, forceer = false){
    const s = staat(pad);
    const r = await gh(`/repos/${repo}/contents/${pad}?ref=${branch}`, {headers: s.etag && !forceer ? {'If-None-Match':s.etag} : {}});
    if(r.status === 304) return false;
    if(r.status === 404){ const veranderd = !s.geladen || Object.keys(s.docs).length > 0; Object.assign(s, {docs:{}, sha:null, etag:null, geladen:true}); return veranderd; }
    if(!r.ok) throw new Error(`GitHub gaf ${r.status} bij ${pad}`);
    const j = await r.json();
    if(j.sha === s.sha){ s.etag = r.headers.get('ETag'); return false; }
    let tekst;
    if(j.content) tekst = b64dec(j.content);
    else { const b = await gh(`/repos/${repo}/git/blobs/${j.sha}`); tekst = b64dec((await b.json()).content); }
    Object.assign(s, {docs:JSON.parse(tekst || '{}'), sha:j.sha, etag:r.headers.get('ETag'), geladen:true});
    return true;
  }
  const melden = pad => luisteraars.forEach(l => { if(l.pad === pad) l.ververs(); });

  async function verversAlles(){
    const paden = new Set([...luisteraars].map(l => l.pad));
    for(const pad of paden){ try{ if(await laad(pad)) melden(pad); }catch(e){ console.warn(e); } }
  }
  setInterval(verversAlles, 60000);
  document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible') verversAlles(); });

  /* Schrijven: wijzigingen per bestand bundelen tot één commit. */
  function schrijf(pad, actie){
    return new Promise((ok, fout) => {
      if(!wachtrij.has(pad)) wachtrij.set(pad, []);
      wachtrij.get(pad).push({...actie, ok, fout});
      setTimeout(() => spoel(pad), 250);
    });
  }
  async function spoel(pad){
    if(bezig.has(pad) || !wachtrij.get(pad)?.length) return;
    bezig.add(pad);
    const acties = wachtrij.get(pad).splice(0);
    try{
      const s = staat(pad);
      if(!s.geladen) await laad(pad, true);
      for(let poging = 0; ; poging++){
        const docs = kopie(s.docs);
        for(const a of acties){
          if(a.op === 'set') docs[a.id] = kopie(a.data);
          else if(a.op === 'update') docs[a.id] = {...(docs[a.id] || {}), ...kopie(a.data)};
          else delete docs[a.id];
        }
        const gesorteerd = Object.fromEntries(Object.keys(docs).sort().map(k => [k, docs[k]]));
        const leeg = !Object.keys(gesorteerd).length;
        const naam = acties.map(a => a.data?.naam || a.data?.omschrijving).find(Boolean);
        const bericht = `${gebruiker}: ${acties.length} wijziging${acties.length > 1 ? 'en' : ''} in ${pad.replace(/^data\//, '')}${naam ? ` (${naam})` : ''}`;
        let r;
        if(leeg && s.sha){
          r = await gh(`/repos/${repo}/contents/${pad}`, {method:'DELETE', body:JSON.stringify({message:bericht, sha:s.sha, branch})});
        } else if(leeg){
          r = {ok:true, status:200, json:async () => ({content:null})};
        } else {
          r = await gh(`/repos/${repo}/contents/${pad}`, {method:'PUT', body:JSON.stringify({message:bericht, content:b64enc(JSON.stringify(gesorteerd, null, 1) + '\n'), branch, ...(s.sha ? {sha:s.sha} : {})})});
        }
        if(r.ok){
          const j = await r.json();
          Object.assign(s, {docs:gesorteerd, sha:j.content ? j.content.sha : null, etag:null, geladen:true});
          acties.forEach(a => a.ok());
          melden(pad);
          break;
        }
        if((r.status === 409 || r.status === 422) && poging < 4){ await laad(pad, true); continue; } // iemand anders schreef tegelijk
        throw new Error(`Opslaan mislukt (${r.status})`);
      }
    }catch(e){ acties.forEach(a => a.fout(e)); }
    finally{
      bezig.delete(pad);
      if(wachtrij.get(pad)?.length) spoel(pad);
    }
  }

  const snap = (id, data) => ({id, exists:data !== undefined, data:() => data});
  const vindPad = (collectie, id) => {
    if(!SHARD[collectie]) return bestandPad(collectie);
    for(const [pad, s] of bestanden) if(pad.startsWith(`data/${collectie}/`) && s.docs[id]) return pad;
    return null;
  };

  function docRef(collectie, id){
    return {
      id, path:`${collectie}/${id}`,
      async get(){ const pad = vindPad(collectie, id); if(!pad) return snap(id); await laad(pad); return snap(id, staat(pad).docs[id]); },
      set(d){ return schrijf(bestandPad(collectie, d[SHARD[collectie]]), {op:'set', id, data:d}); },
      update(d){ const pad = vindPad(collectie, id); if(!pad) return Promise.reject(new Error('Document niet gevonden')); return schrijf(pad, {op:'update', id, data:d}); },
      delete(){ const pad = vindPad(collectie, id); return pad ? schrijf(pad, {op:'delete', id}) : Promise.resolve(); },
      onSnapshot(next, fout){
        const pad = bestandPad(collectie);
        const l = {pad, ververs:() => next(snap(id, staat(pad).docs[id]))};
        luisteraars.add(l);
        laad(pad).then(() => l.ververs(), e => fout && fout(e));
        return () => luisteraars.delete(l);
      }
    };
  }

  function query(collectie, o = {}){
    const pad = () => bestandPad(collectie, SHARD[collectie] && (o.where || []).find(([v]) => v === SHARD[collectie])?.[1]);
    const resultaat = () => {
      let docs = Object.entries(staat(pad()).docs).map(([id, d]) => snap(id, d));
      for(const [veld, waarde] of o.where || []) docs = docs.filter(d => d.data()[veld] === waarde);
      if(o.order){ const [veld, r] = o.order; docs.sort((a, b) => String(a.data()[veld] ?? '').localeCompare(String(b.data()[veld] ?? '')) * (r === 'desc' ? -1 : 1)); }
      if(o.limit) docs = docs.slice(0, o.limit);
      return {docs, size:docs.length, empty:!docs.length};
    };
    return {
      path:collectie,
      where(veld, op, waarde){ if(op !== '==') throw new Error('Alleen == wordt ondersteund'); return query(collectie, {...o, where:[...(o.where || []), [veld, waarde]]}); },
      orderBy(veld, richting = 'asc'){ return query(collectie, {...o, order:[veld, richting]}); },
      limit(n){ return query(collectie, {...o, limit:n}); },
      async get(){ await laad(pad()); return resultaat(); },
      onSnapshot(next, fout){
        const l = {pad:pad(), ververs:() => next(resultaat())};
        luisteraars.add(l);
        laad(l.pad).then(() => l.ververs(), e => fout && fout(e));
        return () => luisteraars.delete(l);
      },
      doc(id){ return docRef(collectie, id || nieuwId()); },
      async add(d){ const r = docRef(collectie, nieuwId()); await r.set(d); return r; }
    };
  }

  return {
    collection:naam => query(naam),
    doc:pad => { const [c, id] = pad.split('/'); return docRef(c, id); }
  };
}

/* Controleert een token: geeft {login, naam} terug of gooit een fout met een duidelijke melding. */
async function controleerToegang(repo, token){
  const h = {Authorization:`Bearer ${token}`, Accept:'application/vnd.github+json'};
  const u = await fetch('https://api.github.com/user', {headers:h, cache:'no-store'});
  if(u.status === 401) throw new Error('Deze code werkt niet (verlopen of verkeerd gekopieerd).');
  const r = await fetch(`https://api.github.com/repos/${repo}`, {headers:h, cache:'no-store'});
  if(r.status === 404 || r.status === 403) throw new Error(`Deze code heeft geen toegang tot ${repo}.`);
  if(!r.ok) throw new Error(`GitHub is niet bereikbaar (${r.status}). Probeer het zo opnieuw.`);
  const repoInfo = await r.json();
  if(repoInfo.permissions && !repoInfo.permissions.push) throw new Error('Deze code mag alleen lezen. Kies bij Contents: Read and write.');
  const user = u.ok ? await u.json() : {};
  return {login:user.login || 'gebruiker', naam:user.name || user.login || 'gebruiker'};
}
