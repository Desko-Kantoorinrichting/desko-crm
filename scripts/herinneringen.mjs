/* Herinneringen als melding op de telefoon (web push) voor het Desko CRM.
   Draait elk kwartier op werkdagen via GitHub Actions (.github/workflows/herinneringen.yml).
   - Opvolgingen van vandaag: een melding per bedrijf ("Neem vandaag contact op met ..."),
     om de gekozen tijd of anders aan het begin van de werkdag. Tikken opent het profiel.
   - Te late opvolgingen: één samenvatting per dag.
   - Een route (Plannen) voor vandaag: één melding aan het begin van de werkdag.
   - Elke herinnering gaat één keer; wat al verstuurd is staat in data/herinneringen.json.
   Meldingen zijn versleuteld van deze robot tot de telefoon; de pushdienst (Google, Apple,
   Mozilla) kan de inhoud niet lezen. Dit logboek is openbaar: schrijf hier nooit namen weg. */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { nlNu } from './mailrobot.mjs';
const R = createRequire(import.meta.url)('../site/reeks.js');

const MAX_LOS = 6;              // meer dan dit per keer: één samenvatting
const BEWAAR_DAGEN = 14;

/* Welke meldingen zijn er nu aan de beurt? Puur, zodat het te testen is. */
export function teVersturen({bedrijven, mails, inst, robotActief, log, datum, tijd, routes = {}}){
  const begin = (inst.kantoortijden && inst.kantoortijden.van) || '08:30';
  const los = [], laat = [];
  for(const [id, b] of Object.entries(bedrijven)){
    const o = b.opvolging;
    if(!o || !o.actief || o.gepauzeerd || !o.datum || o.datum > datum) continue;
    const m = Object.values(mails).find(x => x.bedrijfId === id && x.status === 'gepland');
    if(o.stap === 'mail' && robotActief) continue;        // die mail gaat automatisch
    if(o.datum < datum){ laat.push(id); continue; }
    const wanneer = o.tijd || (o.stap === 'mail' && m && m.tijd) || begin;
    if(wanneer > tijd) continue;
    const sleutel = `${id}|${o.datum}|${wanneer}|${o.stap}`;
    if(log[sleutel]) continue;
    const c = (b.contacten || [])[o.contact || 0], wie = (c && c.naam) || 'de contactpersoon';
    const om = o.tijd ? ` · om ${o.tijd}` : '';
    let titel = `Neem vandaag contact op met ${wie}`, tekst = b.naam;
    if(o.stap === 'actie') tekst = `${b.naam} · ${o.actie || 'Opvolgen'}${om}`;
    else if(o.stap === 'mail'){ titel = `Mail vandaag ${wie}`; tekst = `${b.naam}${m ? ` · "${m.onderwerp}"` : ''}${om}`; }
    else if(o.stap === 'wacht') tekst = `${b.naam} · geen reactie op je mail${om}`;
    else if(o.stap === 'terug') tekst = `${b.naam} · nog niet bereikt${om}`;
    else if(o.stap === 'eerste') tekst = `${b.naam} · eerste opvolging na je bezoek${om}`;
    los.push({sleutel, titel, tekst, url:`#/b/${id}`, tag:`opvolging-${id}`});
  }
  // Route van vandaag: één melding aan het begin van de werkdag
  const routeMeldingen = [];
  for(const [id, r] of Object.entries(routes)){
    const stops = (r.stops || []).filter(x => bedrijven[x.id]);
    if(r.datum !== datum || !stops.length || begin > tijd || log[`route|${id}`]) continue;
    const namen = stops.map(x => bedrijven[x.id].naam);
    routeMeldingen.push({sleutel:`route|${id}`, titel:`Route vandaag${r.voor ? ` voor ${r.voor}` : ''}: ${stops.length} bezoek${stops.length > 1 ? 'en' : ''}`,
      tekst:`${namen.slice(0, 3).join(', ')}${namen.length > 3 ? ' en meer' : ''}`, url:'#/vandaag', tag:`route-${id}`});
  }
  const uit = [...routeMeldingen, ...los.slice(0, MAX_LOS)], rest = los.slice(MAX_LOS);
  if(rest.length) uit.push({sleutel:null, sleutels:rest.map(x => x.sleutel), titel:`Nog ${rest.length} opvolging${rest.length > 1 ? 'en' : ''} vandaag`, tekst:'Bekijk ze in de app.', url:'#/vandaag', tag:'vandaag'});
  const laatSleutel = `te-laat|${datum}`;
  if(laat.length && begin <= tijd && !log[laatSleutel])
    uit.push({sleutel:laatSleutel, titel:`${laat.length} opvolging${laat.length > 1 ? 'en zijn' : ' is'} te laat`, tekst:'Pak ze vandaag op of stel ze uit.', url:'#/vandaag', tag:'te-laat'});
  return uit;
}

export async function main(env = process.env, nu = new Date(), {stuur} = {}){
  const {DATA_REPO, DATA_TOKEN} = env;
  if(!DATA_REPO || !DATA_TOKEN){ console.log('Herinneringen zijn nog niet ingesteld (DATA_TOKEN ontbreekt); niets te doen.'); return {verstuurd:0}; }
  const {datum, tijd} = nlNu(nu);
  if(!R.isWerkdag(datum) || tijd < '07:00' || tijd > '19:00'){ console.log('Buiten werktijd; niets te doen.'); return {verstuurd:0}; }

  const gh = (pad, opts = {}) => fetch(`https://api.github.com/repos/${DATA_REPO}/contents/${pad}`, {...opts, headers:{
    Authorization:`Bearer ${DATA_TOKEN}`, Accept:'application/vnd.github+json', 'X-GitHub-Api-Version':'2022-11-28', 'User-Agent':'desko-herinneringen'}});
  async function lees(pad){
    const r = await gh(`${pad}?ref=main`);
    if(r.status === 404) return {docs:{}, sha:null};
    if(!r.ok) throw new Error(`Lezen mislukt (${r.status})`);
    const j = await r.json();
    let tekst = j.content ? Buffer.from(j.content, 'base64').toString('utf8') : '';
    if(!j.content && j.sha){
      const b = await fetch(`https://api.github.com/repos/${DATA_REPO}/git/blobs/${j.sha}`, {headers:{Authorization:`Bearer ${DATA_TOKEN}`, Accept:'application/vnd.github+json', 'User-Agent':'desko-herinneringen'}});
      tekst = Buffer.from((await b.json()).content, 'base64').toString('utf8');
    }
    return {docs:JSON.parse(tekst || '{}'), sha:j.sha};
  }
  async function wijzig(pad, fn, bericht){
    for(let poging = 0; poging < 5; poging++){
      const {docs, sha} = await lees(pad);
      fn(docs);
      const gesorteerd = Object.fromEntries(Object.keys(docs).sort().map(k => [k, docs[k]]));
      const r = await gh(pad, {method:'PUT', body:JSON.stringify({message:`Herinneringen: ${bericht}`, branch:'main',
        content:Buffer.from(JSON.stringify(gesorteerd, null, 1) + '\n').toString('base64'), ...(sha ? {sha} : {})})});
      if(r.ok) return;
      if(r.status !== 409 && r.status !== 422) throw new Error(`Schrijven mislukt (${r.status})`);
    }
    throw new Error('Schrijven mislukt: te veel gelijktijdige wijzigingen');
  }

  const abonnementen = (await lees('data/meldingen.json')).docs;
  if(!Object.keys(abonnementen).length){ console.log('Nog niemand heeft meldingen aangezet.'); return {verstuurd:0}; }
  const sleutel = (await lees('data/push-sleutel.json')).docs.vapid || {};
  const vapid = {publicKey:env.VAPID_PUBLIC || sleutel.publicKey, privateKey:env.VAPID_PRIVATE || sleutel.privateKey, subject:sleutel.subject || 'https://desko-kantoorinrichting.github.io/desko-crm/'};
  if(!vapid.publicKey || !vapid.privateKey) throw new Error('Pushsleutel ontbreekt (data/push-sleutel.json)');
  if(!stuur){
    const wp = (await import('web-push')).default;
    wp.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
    stuur = (sub, payload) => wp.sendNotification(sub, payload, {TTL:4 * 3600, urgency:'high'});
  }

  const [bedrijven, mails, inst0, robot, log, routes] = await Promise.all(['data/bedrijven.json', 'data/mails.json', 'data/instellingen.json', 'data/robot.json', 'data/herinneringen.json', 'data/routes.json'].map(p => lees(p).then(x => x.docs)));
  const inst = R.instellingen(inst0.algemeen);
  const rs = robot.status || {};
  const robotActief = !!(rs.gekoppeld && rs.laatsteRun && nu - new Date(rs.laatsteRun) < 2 * 3600 * 1000);
  const meldingen = teVersturen({bedrijven, mails, inst, robotActief, log, datum, tijd, routes});
  if(!meldingen.length){ console.log('Geen nieuwe herinneringen.'); return {verstuurd:0}; }

  let verstuurd = 0, fouten = 0; const verlopen = [];
  for(const m of meldingen){
    const payload = JSON.stringify({titel:m.titel, tekst:m.tekst, url:m.url, tag:m.tag});
    for(const [id, a] of Object.entries(abonnementen)){
      if(verlopen.includes(id)) continue;
      try{ await stuur({endpoint:a.endpoint, keys:a.keys}, payload); verstuurd++; }
      catch(e){ if(e.statusCode === 404 || e.statusCode === 410) verlopen.push(id); else fouten++; }
    }
  }
  const nuIso = nu.toISOString(), grens = new Date(nu - BEWAAR_DAGEN * 86400000).toISOString();
  await wijzig('data/herinneringen.json', docs => {
    for(const m of meldingen) for(const k of m.sleutels || [m.sleutel]) if(k) docs[k] = nuIso;
    for(const [k, v] of Object.entries(docs)) if(v < grens) delete docs[k];
  }, `${meldingen.length} verstuurd`);
  if(verlopen.length) await wijzig('data/meldingen.json', docs => { verlopen.forEach(id => delete docs[id]); }, 'verlopen telefoons opgeruimd');
  console.log(`Klaar. Meldingen: ${meldingen.length}, afgeleverd: ${verstuurd}, verlopen telefoons: ${verlopen.length}, fouten: ${fouten}.`);
  return {verstuurd, meldingen:meldingen.length, verlopen:verlopen.length, fouten};
}

if(process.argv[1] === fileURLToPath(import.meta.url)){
  main().catch(e => { console.log(`Herinneringen gestopt: ${e.message}`); process.exit(1); });
}
