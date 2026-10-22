/* Leadradar voor het Desko CRM.
   Draait elke maandagochtend via GitHub Actions (.github/workflows/leadradar.yml).
   Claude zoekt met de zoekfunctie op het web naar bedrijven in de regio die kantoorinrichting
   nodig kunnen hebben (verhuizing, nieuw kantoor, uitbreiding, groei, verbouwing) en zet de
   beste nieuwe leads in data/leads.json. In de app (Leadradar) worden ze beoordeeld; afgewezen
   leads met hun reden gaan de volgende keer mee, zodat de zoektocht beter wordt.
   Alleen bedrijfsgegevens; geen persoonsgegevens van particulieren.
   Dit logboek is openbaar: schrijf hier nooit namen of bedrijven weg. */
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { nlNu } from './mailrobot.mjs';

export const MODEL = 'claude-opus-5-5';
const MAX_PAUZES = 6;

export const STANDAARD = {
  aantal: 10,
  regio: 'Noord-Holland en de rest van de Randstad (Amsterdam, Haarlem, Zaandam, Hoofddorp, Amstelveen, Utrecht, Den Haag, Rotterdam)',
  focus: 'Bedrijven en organisaties met een kantoor van ongeveer 10 tot 250 werkplekken.',
  extra: ''
};

/* Weeknummer (ISO) als sleutel, bijv. 2026-W44. */
export function weekSleutel(datum){
  const d = new Date(datum + 'T12:00:00Z'); const dag = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dag + 3); const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const wk = 1 + Math.round(((d - jan4) / 864e5 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(wk).padStart(2, '0')}`;
}
export const naamKern = n => String(n || '').toLowerCase().replace(/\b(b\.?v\.?|n\.?v\.?|v\.?o\.?f\.?|holding|groep|group|nederland|the)\b/g, '').replace(/[^a-z0-9]/g, '');
export const domein = u => { try{ return new URL(/^https?:/.test(u) ? u : 'https://' + u).hostname.replace(/^www\./, '').toLowerCase(); }catch{ return ''; } };

export function opdracht({inst, bekend, eerder, datum}){
  const afgewezen = eerder.filter(l => l.status === 'afgewezen' && l.reden).slice(-25);
  const goed = eerder.filter(l => ['toegevoegd', 'kijkje'].includes(l.status)).slice(-15);
  return `Je zoekt nieuwe zakelijke leads voor Desko, een Nederlands bedrijf in kantoorinrichting (bureaus, stoelen, zit-sta, akoestiek, complete kantoorinrichting en werkplekadvies). Vandaag is het ${datum}.

Zoek op het web naar ${inst.aantal} bedrijven die nu of binnenkort kantoorinrichting nodig hebben.
Regio: ${inst.regio}.
Doelgroep: ${inst.focus}

Sterke signalen (recent, liefst de afgelopen 3 maanden):
- het bedrijf verhuist, heeft een nieuw kantoor gehuurd of gekocht, of opent een nieuwe vestiging (bijv. berichten van bedrijfsmakelaars als "verhuurd aan", nieuws over nieuwbouw of herontwikkeling met bekende huurder)
- uitbreiding of verbouwing van het kantoor
- snelle groei: veel vacatures, financieringsronde, overname, fusie
- nieuwe vestiging in Nederland van een buitenlands bedrijf

Werkwijze: zoek met verschillende zoekvragen (nieuws, vastgoedberichten van makelaars, regionale zakelijke media, persberichten). Lees alleen openbare pagina's; log nergens op in. Controleer per lead dat het signaal echt over dat bedrijf gaat en recent is.

Regels:
- Alleen bedrijven en organisaties, geen particulieren. Noem geen namen van personen.
- Sla bedrijven over die al bekend zijn (lijst hieronder), ook in een andere schrijfwijze.
- Geef per lead de pagina waar je het signaal vond (exacte URL uit je zoekresultaten), het bedrijf, de plaats, de website als je die vond, wat het signaal is, wanneer ze verhuizen of het nieuwe kantoor in gebruik nemen (zoek dit actief op; zet erbij als het onbekend is) en waarom dit kansrijk is voor Desko, en een korte suggestie voor het eerste contact.
- Liever minder leads dan zwakke of onzekere leads.

Al bekend (niet opnieuw voorstellen):
${bekend.join('; ') || '(geen)'}
${afgewezen.length ? `
Eerder afgewezen, met de reden (leer hiervan en zoek niet naar vergelijkbare leads):
${afgewezen.map(l => `- ${l.bedrijf}: ${l.reden}`).join('\n')}` : ''}${goed.length ? `
Eerder goed bevonden (zoek meer van dit soort):
${goed.map(l => `- ${l.bedrijf}: ${l.signaal}`).join('\n')}` : ''}${inst.extra ? `
Extra aanwijzingen van Desko:
${inst.extra}` : ''}

Eindig met een overzicht van alle gevonden leads.`;
}

/* Stap 1: onderzoek met zoeken op het web (server-side zoektool, pauzes hervatten). */
export async function onderzoek(client, tekst){
  const messages = [{role:'user', content:tekst}];
  const urls = new Set(); let zoekacties = 0, laatste;
  for(let i = 0; i <= MAX_PAUZES; i++){
    laatste = await client.beta.messages.stream({
      model:MODEL, max_tokens:64000,
      betas:['server-side-fallback-2026-07-01'], fallbacks:'default',
      output_config:{effort:'high'},
      tools:[{type:'web_search_20260209', name:'web_search', max_uses:30, user_location:{type:'approximate', country:'NL', city:'Amsterdam', timezone:'Europe/Amsterdam'}}],
      messages
    }).finalMessage();
    for(const b of laatste.content){
      if(b.type === 'server_tool_use' && b.name === 'web_search') zoekacties++;
      if(b.type === 'web_search_tool_result' && Array.isArray(b.content)) b.content.forEach(r => r.url && urls.add(r.url));
    }
    if(laatste.stop_reason !== 'pause_turn') break;
    messages.push({role:'assistant', content:laatste.content});   // hervatten waar de zoektocht pauzeerde
  }
  if(laatste.stop_reason === 'refusal') throw new Error('Onderzoek geweigerd');
  const verslag = laatste.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  return {verslag, urls, zoekacties};
}

/* Stap 2: het verslag omzetten naar een vaste structuur. */
export async function structureer(client, verslag, aantal){
  const { z } = await import('zod');
  const { zodOutputFormat } = await import('@anthropic-ai/sdk/helpers/zod');
  const Lead = z.object({
    bedrijf:z.string(), plaats:z.string(), website:z.string(),
    signaal:z.string().describe('Korte kop: wat er gebeurt, bijv. "Verhuist naar nieuw kantoor aan de Zuidas"'),
    toelichting:z.string().describe('1-3 zinnen: waarom dit kansrijk is voor Desko'),
    bron_url:z.string(), bron_titel:z.string(), datum_signaal:z.string().describe('Datum van het bericht als JJJJ-MM-DD, of leeg'),
    verhuisdatum:z.string().describe('Wanneer het bedrijf verhuist of het nieuwe kantoor in gebruik neemt, zoals in de bron staat (bijv. "1 maart 2027", "Q1 2027", "al verhuisd in oktober 2026"), of leeg'),
    branche:z.string(), werkplekken:z.string().describe('Schatting aantal werkplekken of medewerkers, of leeg'),
    aanpak:z.string().describe('Suggestie voor het eerste contact')
  });
  const res = await client.messages.parse({
    model:MODEL, max_tokens:16000, output_config:{effort:'low', format:zodOutputFormat(z.object({leads:z.array(Lead)}))},
    messages:[{role:'user', content:`Zet de leads uit dit onderzoeksverslag om naar de gevraagde structuur (maximaal ${aantal}). Neem alleen informatie over die in het verslag staat; laat onbekende velden leeg.\n\n${verslag}`}]
  });
  return res.parsed_output?.leads || [];
}

/* Dubbele en onbetrouwbare leads eruit: al bekend, eerder voorgesteld, of bron niet in de zoekresultaten. */
export function filter(leads, {bedrijven, eerder, urls}){
  const namen = new Set([...Object.values(bedrijven).map(b => naamKern(b.naam)), ...eerder.map(l => naamKern(l.bedrijf))].filter(Boolean));
  const domeinen = new Set([...Object.values(bedrijven).flatMap(b => (b.contacten || []).map(c => String(c.email || '').split('@')[1] || '')), ...eerder.map(l => domein(l.website))].filter(d => d && !/^(gmail|hotmail|outlook|live|icloud|ziggo|kpnmail)\./.test(d)));
  const gezien = new Set(), uit = [];
  for(const l of leads){
    const k = naamKern(l.bedrijf), d = domein(l.website);
    if(!k || namen.has(k) || gezien.has(k) || (d && domeinen.has(d))) continue;
    if(!l.bron_url || !urls.has(l.bron_url)) continue;   // bron moet echt gevonden zijn
    gezien.add(k); uit.push(l);
  }
  return uit;
}

export async function main(env = process.env, nu = new Date(), {client} = {}){
  const {DATA_REPO, DATA_TOKEN, ANTHROPIC_API_KEY} = env;
  if(!DATA_REPO || !DATA_TOKEN || (!ANTHROPIC_API_KEY && !client)){ console.log('Leadradar is nog niet ingesteld (DATA_TOKEN of ANTHROPIC_API_KEY ontbreekt); niets te doen.'); return {nieuw:0}; }
  const gh = (pad, opts = {}) => fetch(`https://api.github.com/repos/${DATA_REPO}/contents/${pad}`, {...opts, headers:{
    Authorization:`Bearer ${DATA_TOKEN}`, Accept:'application/vnd.github+json', 'X-GitHub-Api-Version':'2022-11-28', 'User-Agent':'desko-leadradar'}});
  async function lees(pad){
    const r = await gh(`${pad}?ref=main`);
    if(r.status === 404) return {docs:{}, sha:null};
    if(!r.ok) throw new Error(`Lezen mislukt (${r.status})`);
    const j = await r.json();
    let tekst = j.content ? Buffer.from(j.content, 'base64').toString('utf8') : '';
    if(!j.content && j.sha){
      const b = await fetch(`https://api.github.com/repos/${DATA_REPO}/git/blobs/${j.sha}`, {headers:{Authorization:`Bearer ${DATA_TOKEN}`, Accept:'application/vnd.github+json', 'User-Agent':'desko-leadradar'}});
      tekst = Buffer.from((await b.json()).content, 'base64').toString('utf8');
    }
    return {docs:JSON.parse(tekst || '{}'), sha:j.sha};
  }
  async function wijzig(pad, fn, bericht){
    for(let poging = 0; poging < 5; poging++){
      const {docs, sha} = await lees(pad); fn(docs);
      const gesorteerd = Object.fromEntries(Object.keys(docs).sort().map(k => [k, docs[k]]));
      const r = await gh(pad, {method:'PUT', body:JSON.stringify({message:`Leadradar: ${bericht}`, branch:'main',
        content:Buffer.from(JSON.stringify(gesorteerd, null, 1) + '\n').toString('base64'), ...(sha ? {sha} : {})})});
      if(r.ok) return;
      if(r.status !== 409 && r.status !== 422) throw new Error(`Schrijven mislukt (${r.status})`);
    }
    throw new Error('Schrijven mislukt: te veel gelijktijdige wijzigingen');
  }

  const {datum} = nlNu(nu), week = weekSleutel(datum);
  const [bedrijven, leads, inst0] = await Promise.all(['data/bedrijven.json', 'data/leads.json', 'data/instellingen.json'].map(p => lees(p).then(x => x.docs)));
  const eerder = Object.values(leads);
  if(eerder.some(l => l.week === week) && !env.LEADRADAR_OPNIEUW){ console.log('Deze week zijn er al leads gezocht.'); return {nieuw:0}; }
  const inst = {...STANDAARD, ...((inst0.algemeen || {}).leadradar || {})};
  const bekend = [...new Set([...Object.values(bedrijven).map(b => b.naam), ...eerder.map(l => l.bedrijf)])].sort();

  if(!client){ const { default: Anthropic } = await import('@anthropic-ai/sdk'); client = new Anthropic({apiKey:ANTHROPIC_API_KEY}); }
  const {verslag, urls, zoekacties} = await onderzoek(client, opdracht({inst, bekend, eerder, datum}));
  const ruw = await structureer(client, verslag, inst.aantal + 5);
  const goed = filter(ruw, {bedrijven, eerder, urls}).slice(0, inst.aantal);
  const nuIso = nu.toISOString();
  await wijzig('data/leads.json', docs => { for(const l of goed) docs[randomUUID()] = {...l, week, gevonden:nuIso, status:'nieuw'}; }, `${goed.length} nieuwe leads (${week})`);
  console.log(`Klaar. Zoekacties: ${zoekacties}, voorgesteld: ${ruw.length}, na controle: ${goed.length}.`);
  return {nieuw:goed.length, voorgesteld:ruw.length, zoekacties};
}

if(process.argv[1] === fileURLToPath(import.meta.url)){
  main().catch(e => { console.log(`Leadradar gestopt: ${e.message}`); process.exit(1); });
}
