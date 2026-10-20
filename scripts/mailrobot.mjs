/* Mailrobot voor het Desko CRM.
   Draait elk kwartier op werkdagen via GitHub Actions (.github/workflows/mailrobot.yml).
   - Verstuurt ingeplande mails (data/mails.json, status "gepland") vanuit de Microsoft 365-
     mailbox van de afzender, alleen op werkdagen binnen kantoortijd.
   - Controleert vlak voor verzending of er al contact of een reactie is geweest; zo ja, dan
     gaat de mail niet en stopt de reeks.
   - Herkent reacties op verstuurde mails en zet die in de tijdlijn.
   Dit logboek is openbaar zichtbaar: schrijf hier nooit namen, adressen of onderwerpen weg. */
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const R = createRequire(import.meta.url)('../site/reeks.js');

const AUTO_ANTWOORD = /^(automatisch antwoord|automatic reply|autoreply|out of office|afwezig|niet aanwezig)/i;

/* Datum en tijd in Nederland, los van de tijdzone van de server. */
export function nlNu(nu){
  const p = Object.fromEntries(new Intl.DateTimeFormat('nl-NL', {timeZone:'Europe/Amsterdam', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23'})
    .formatToParts(nu).map(x => [x.type, x.value]));
  return {datum:`${p.year}-${p.month}-${p.day}`, tijd:`${p.hour}:${p.minute}`};
}

export async function main(env = process.env, nu = new Date()){
  const {DATA_REPO, DATA_TOKEN, MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_AFZENDER} = env;
  if(!DATA_REPO || !DATA_TOKEN) throw new Error('DATA_REPO of DATA_TOKEN ontbreekt');
  const telling = {verstuurd:0, geannuleerd:0, reacties:0, fouten:0, overgeslagen:0};

  /* ---------- GitHub: gegevens lezen en schrijven ---------- */
  const gh = (pad, opts = {}) => fetch(`https://api.github.com/repos/${DATA_REPO}/contents/${pad}`, {...opts, headers:{
    Authorization:`Bearer ${DATA_TOKEN}`, Accept:'application/vnd.github+json', 'X-GitHub-Api-Version':'2022-11-28', 'User-Agent':'desko-mailrobot'}});
  async function lees(pad){
    const r = await gh(`${pad}?ref=main`);
    if(r.status === 404) return {docs:{}, sha:null};
    if(!r.ok) throw new Error(`Lezen mislukt (${r.status})`);
    const j = await r.json();
    let tekst = j.content ? Buffer.from(j.content, 'base64').toString('utf8') : '';
    if(!j.content && j.sha){
      const b = await fetch(`https://api.github.com/repos/${DATA_REPO}/git/blobs/${j.sha}`, {headers:{Authorization:`Bearer ${DATA_TOKEN}`, Accept:'application/vnd.github+json', 'User-Agent':'desko-mailrobot'}});
      tekst = Buffer.from((await b.json()).content, 'base64').toString('utf8');
    }
    return {docs:JSON.parse(tekst || '{}'), sha:j.sha};
  }
  /* Lees-wijzig-schrijf met opnieuw proberen als de app tegelijk schreef. */
  async function wijzig(pad, fn, bericht){
    for(let poging = 0; poging < 5; poging++){
      const {docs, sha} = await lees(pad);
      fn(docs);
      const gesorteerd = Object.fromEntries(Object.keys(docs).sort().map(k => [k, docs[k]]));
      const r = await gh(pad, {method:'PUT', body:JSON.stringify({message:`Mailrobot: ${bericht}`, branch:'main',
        content:Buffer.from(JSON.stringify(gesorteerd, null, 1) + '\n').toString('base64'), ...(sha ? {sha} : {})})});
      if(r.ok) return;
      if(r.status !== 409 && r.status !== 422) throw new Error(`Schrijven mislukt (${r.status})`);
    }
    throw new Error('Schrijven mislukt: te veel gelijktijdige wijzigingen');
  }
  const activiteit = (b, a) => wijzig(`data/activiteiten/${b.id}.json`, docs => { docs[randomUUID()] = {bedrijfId:b.id, datum:new Date().toISOString(), door:'Mailrobot', ...a}; }, 'tijdlijn bijgewerkt');
  const bedrijfBij = (id, patch) => wijzig('data/bedrijven.json', docs => { if(docs[id]) Object.assign(docs[id], patch, {bijgewerkt:new Date().toISOString()}); }, 'opvolging bijgewerkt');
  const mailBij = (id, patch) => wijzig('data/mails.json', docs => { if(docs[id]) Object.assign(docs[id], patch); }, 'mailstatus bijgewerkt');

  const inst = R.instellingen((await lees('data/instellingen.json')).docs.algemeen);
  const robot = (await lees('data/robot.json')).docs.status || {};
  const gekoppeld = !!(MS_TENANT_ID && MS_CLIENT_ID && MS_CLIENT_SECRET && MS_AFZENDER);
  async function status(extra){
    const oud = robot.laatsteRun ? nu - new Date(robot.laatsteRun) : Infinity;
    if(robot.gekoppeld === gekoppeld && oud < 50*60*1000 && !extra) return;   // niet elk kwartier een commit
    await wijzig('data/robot.json', docs => { docs.status = {gekoppeld, laatsteRun:nu.toISOString(), ...(extra || {})}; }, 'status');
  }
  if(!gekoppeld){
    console.log('Microsoft 365 is nog niet gekoppeld; er worden geen mails verstuurd.');
    await status();
    return telling;
  }

  /* ---------- Microsoft Graph ---------- */
  const tokenRes = await fetch(`https://login.microsoftonline.com/${MS_TENANT_ID}/oauth2/v2.0/token`, {method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({client_id:MS_CLIENT_ID, client_secret:MS_CLIENT_SECRET, scope:'https://graph.microsoft.com/.default', grant_type:'client_credentials'})});
  if(!tokenRes.ok) throw new Error(`Aanmelden bij Microsoft mislukt (${tokenRes.status})`);
  const token = (await tokenRes.json()).access_token;
  const graph = (pad, opts = {}) => fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(MS_AFZENDER)}${pad}`, {...opts,
    headers:{Authorization:`Bearer ${token}`, 'Content-Type':'application/json', ...(opts.headers || {})}});
  async function reactiesVan(email, sinds){
    const filter = encodeURIComponent(`from/emailAddress/address eq '${email.replace(/'/g, "''")}'`);
    const r = await graph(`/messages?$filter=${filter}&$top=20&$select=id,subject,receivedDateTime`);
    if(!r.ok) throw new Error(`Mailbox lezen mislukt (${r.status})`);
    return ((await r.json()).value || []).filter(m => m.receivedDateTime > sinds);
  }
  async function verstuur(m){
    const r = await graph('/sendMail', {method:'POST', body:JSON.stringify({saveToSentItems:true, message:{
      subject:m.onderwerp, body:{contentType:'Text', content:m.tekst}, toRecipients:[{emailAddress:{address:m.email, name:m.aan}}]}})});
    if(r.status !== 202 && !r.ok) throw new Error(`Versturen mislukt (${r.status})`);
  }

  const bedrijven = (await lees('data/bedrijven.json')).docs;
  let mails = (await lees('data/mails.json')).docs;
  const metId = (docs, id) => ({id, ...docs[id]});

  async function annuleerAlles(b, reden){
    const ids = Object.keys(mails).filter(id => mails[id].bedrijfId === b.id && mails[id].status === 'gepland');
    for(const id of ids){
      await mailBij(id, {status:'geannuleerd', reden, geannuleerdOp:new Date().toISOString()});
      await activiteit(b, {type:'systeem', tekst:`Ingeplande mail "${mails[id].onderwerp}" niet verstuurd: ${reden}.`});
      telling.geannuleerd++;
    }
  }
  /* Een echte reactie: in de tijdlijn, opvolging stoppen, ingeplande mails annuleren. */
  async function verwerkReactie(b, r){
    const acts = (await lees(`data/activiteiten/${b.id}.json`)).docs;
    if(Object.values(acts).some(a => a.graphId === r.id)) return false;
    if(AUTO_ANTWOORD.test(r.subject || '')){
      await activiteit(b, {type:'systeem', graphId:r.id, tekst:`Automatisch antwoord ontvangen: "${r.subject}". De opvolging loopt door.`});
      return false;
    }
    await activiteit(b, {type:'mail_in', graphId:r.id, datum:r.receivedDateTime, contactNaam:b.opvolging?.contact != null ? (b.contacten?.[b.opvolging.contact]?.naam || '') : '',
      tekst:`Onderwerp: ${r.subject || ''}\n\nAntwoord ontvangen in de mailbox. Open Outlook voor de volledige mail.`});
    const patch = {laatsteContact:R.ds(new Date(r.receivedDateTime))};
    if(b.kopje === 'prospect' && b.status === 'nieuw') patch.status = 'contact gehad';
    if(b.opvolging?.actief) patch.opvolging = {...b.opvolging, actief:false};
    await bedrijfBij(b.id, patch);
    Object.assign(b, patch);
    await annuleerAlles(b, 'er kwam een reactie');
    await activiteit(b, {type:'systeem', tekst:'Opvolging gestopt: reactie ontvangen.'});
    telling.reacties++;
    return true;
  }

  /* 1. Reacties op eerder verstuurde mails. */
  const verstuurdPerBedrijf = {};
  for(const m of Object.values(mails)) if(m.status === 'verstuurd' && m.verstuurdOp) (verstuurdPerBedrijf[m.bedrijfId] ||= []).push(m);
  for(const [id, lijst] of Object.entries(verstuurdPerBedrijf)){
    const b = bedrijven[id] && {id, ...bedrijven[id]};
    if(!b?.opvolging?.actief) continue;
    const recent = lijst.filter(m => !b.opvolging.gestart || m.verstuurdOp.slice(0,10) >= b.opvolging.gestart);
    for(const email of new Set(recent.map(m => m.email))){
      const sinds = recent.filter(m => m.email === email).map(m => m.verstuurdOp).sort()[0];
      try{ for(const r of await reactiesVan(email, sinds)) if(await verwerkReactie(b, r)) break; }
      catch(e){ telling.fouten++; console.log(e.message); }
      if(!b.opvolging?.actief) break;
    }
  }

  /* 2. Ingeplande mails die aan de beurt zijn. */
  const {datum, tijd} = nlNu(nu);
  const kt = inst.kantoortijden || {};
  const kantoortijd = R.isWerkdag(datum) && tijd >= (kt.van || '08:30') && tijd < (kt.tot || '17:00');
  mails = (await lees('data/mails.json')).docs;
  const aanDeBeurt = Object.keys(mails).map(id => metId(mails, id))
    .filter(m => m.status === 'gepland' && (m.datum < datum || (m.datum === datum && (m.tijd || '09:30') <= tijd)))
    .sort((a, b) => (a.datum + a.tijd).localeCompare(b.datum + b.tijd));
  if(!kantoortijd) telling.overgeslagen = aanDeBeurt.length;
  else for(const m of aanDeBeurt){
    const bd = bedrijven[m.bedrijfId];
    if(!bd){ await mailBij(m.id, {status:'geannuleerd', reden:'bedrijf bestaat niet meer'}); telling.geannuleerd++; continue; }
    const b = {id:m.bedrijfId, ...bd};
    if(!m.handmatig){
      if(!b.opvolging?.actief || b.opvolging.stap !== 'mail'){ await annuleerAlles(b, 'de opvolging is gestopt'); continue; }
      if(b.opvolging.gepauzeerd){ telling.overgeslagen++; continue; }
    }
    const acts = Object.values((await lees(`data/activiteiten/${b.id}.json`)).docs);
    if(!m.handmatig && R.contactSinds(acts, m.aangemaakt)){ await annuleerAlles(b, 'er is al contact geweest'); continue; }
    try{
      if(!m.handmatig){
        let reactie = false;
        for(const r of await reactiesVan(m.email, m.aangemaakt)) if(await verwerkReactie(b, r)){ reactie = true; break; }
        if(reactie) continue;
      }
      await verstuur(m);
    }catch(e){
      telling.fouten++; console.log(e.message);
      await mailBij(m.id, {fout:e.message, foutOp:new Date().toISOString()});
      continue;
    }
    const verstuurdOp = new Date().toISOString();
    await mailBij(m.id, {status:'verstuurd', verstuurdOp, fout:null});
    telling.verstuurd++;
    await activiteit(b, {type:'mail_uit', contactNaam:m.aan, aan:m.email, onderwerp:m.onderwerp, tekst:`Onderwerp: ${m.onderwerp}\n\n${m.tekst}`});
    const patch = {laatsteContact:datum};
    if(b.opvolging?.actief || !m.handmatig){
      const {opvolging, volgende} = R.naVerzending(b, m, inst, datum);
      patch.opvolging = opvolging;
      if(volgende) await wijzig('data/mails.json', docs => { docs[randomUUID()] = {...volgende, aangemaakt:verstuurdOp}; }, 'volgende mail ingepland');
      await activiteit(b, {type:'systeem', tekst: volgende
        ? `Mail automatisch verstuurd. Volgende mail ("${volgende.onderwerp}") ingepland voor ${volgende.datum} als er geen reactie komt.`
        : `Mail automatisch verstuurd. Geen reactie voor ${opvolging.datum}? Dan krijg je een herinnering om te bellen of te mailen.`});
    }
    await bedrijfBij(b.id, patch);
  }

  await status(telling.verstuurd || telling.reacties ? {laatsteVerzending:new Date().toISOString()} : null);
  console.log(`Klaar. Verstuurd: ${telling.verstuurd}, reacties: ${telling.reacties}, geannuleerd: ${telling.geannuleerd}, buiten kantoortijd of gepauzeerd: ${telling.overgeslagen}, fouten: ${telling.fouten}.`);
  return telling;
}

if(process.argv[1] === fileURLToPath(import.meta.url)){
  main().catch(e => { console.log(`Mailrobot gestopt: ${e.message}`); process.exit(1); });
}
