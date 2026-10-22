/* Tests voor de leadradar met een nagebootste Claude en GitHub. Starten met: node --test tests/*.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { main, filter, weekSleutel, opdracht, onderzoek, STANDAARD } from '../scripts/leadradar.mjs';

const ENV = {DATA_REPO:'o/data', DATA_TOKEN:'t', ANTHROPIC_API_KEY:'k'};
const lead = (bedrijf, extra = {}) => ({bedrijf, plaats:'Amsterdam', website:`https://www.${bedrijf.toLowerCase().replace(/\W/g, '')}.nl`, signaal:'Verhuist naar nieuw kantoor',
  toelichting:'Groeit hard', bron_url:`https://nieuws.nl/${bedrijf.toLowerCase().replace(/\W/g, '')}`, bron_titel:'Nieuws', datum_signaal:'2026-10-10', branche:'ICT', werkplekken:'40', aanpak:'Bellen', ...extra});

function wereld({bedrijven = {}, leads = {}, inst = {}} = {}){
  const files = {'data/bedrijven.json':bedrijven, 'data/leads.json':leads, 'data/instellingen.json':{algemeen:{leadradar:inst}}};
  globalThis.fetch = async (url, opts = {}) => {
    const pad = new URL(url).pathname.split('/contents/')[1];
    if((opts.method || 'GET') === 'GET'){
      if(!files[pad]) return new Response('{}', {status:404});
      return new Response(JSON.stringify({sha:'s', content:Buffer.from(JSON.stringify(files[pad])).toString('base64')}), {status:200});
    }
    files[pad] = JSON.parse(Buffer.from(JSON.parse(opts.body).content, 'base64').toString('utf8'));
    return new Response(JSON.stringify({content:{sha:'s2'}}), {status:200});
  };
  return files;
}
/* Nep-Claude: eerst een pauze (zoekactie), dan het verslag; daarna de structuur. */
function nepClaude(leads, urls){
  const vragen = [];
  let ronde = 0;
  return {vragen, beta:{messages:{stream:params => ({finalMessage:async () => {
    vragen.push(params); ronde++;
    const zoek = [{type:'server_tool_use', name:'web_search', id:'s'+ronde, input:{query:'kantoor verhuist'}}, {type:'web_search_tool_result', tool_use_id:'s'+ronde, content:urls.map(url => ({type:'web_search_result', url, title:'x'}))}];
    return ronde === 1 ? {stop_reason:'pause_turn', content:zoek} : {stop_reason:'end_turn', content:[...zoek, {type:'text', text:'Verslag met leads'}]};
  }})}}, messages:{parse:async params => { vragen.push(params); return {parsed_output:{leads}}; }}};
}

test('maandag: leads zoeken, controleren en opslaan; pauze wordt hervat', async () => {
  const files = wereld({bedrijven:{b1:{naam:'Hoek Advocaten B.V.', contacten:[{email:'a@hoekadvocaten.nl'}]}}});
  const leads = [lead('Nieuw Bedrijf'), lead('Hoek Advocaten'), lead('Verzonnen BV', {bron_url:'https://bestaat-niet.nl/x'}), lead('Ander Bedrijf'), lead('Nieuw Bedrijf B.V.')];
  const claude = nepClaude(leads, ['https://nieuws.nl/nieuwbedrijf', 'https://nieuws.nl/hoekadvocaten', 'https://nieuws.nl/anderbedrijf']);
  const t = await main(ENV, new Date('2026-10-26T05:00:00Z'), {client:claude});
  assert.equal(t.nieuw, 2); assert.equal(t.zoekacties, 2);
  const opgeslagen = Object.values(files['data/leads.json']);
  assert.deepEqual(opgeslagen.map(l => l.bedrijf).sort(), ['Ander Bedrijf', 'Nieuw Bedrijf']);
  assert.ok(opgeslagen.every(l => l.status === 'nieuw' && l.week === '2026-W44'));
  // tweede verzoek bevat de gepauzeerde beurt van de eerste
  assert.equal(claude.vragen[1].messages.length, 2); assert.equal(claude.vragen[1].messages[1].role, 'assistant');
  assert.equal(claude.vragen[0].tools[0].type, 'web_search_20260209'); assert.equal(claude.vragen[0].model, 'claude-opus-5-5');
  // zelfde week niet nog een keer
  assert.equal((await main(ENV, new Date('2026-10-26T09:00:00Z'), {client:claude})).nieuw, 0);
});

test('afgewezen leads met reden en extra aanwijzingen gaan mee in de opdracht', () => {
  const tekst = opdracht({inst:{...STANDAARD, extra:'Geen horeca'}, bekend:['Hoek Advocaten'], datum:'2026-10-26',
    eerder:[{bedrijf:'Kapper Jan', status:'afgewezen', reden:'te klein'}, {bedrijf:'Groot BV', status:'toegevoegd', signaal:'Nieuw kantoor'}]});
  assert.match(tekst, /Kapper Jan: te klein/); assert.match(tekst, /Groot BV: Nieuw kantoor/); assert.match(tekst, /Geen horeca/); assert.match(tekst, /Hoek Advocaten/);
  assert.match(tekst, /Noem geen namen van personen/);
});

test('filter: ook eerder voorgestelde leads en bekende domeinen eruit', () => {
  const uit = filter([lead('Eerder Gezien'), lead('Zelfde Domein', {website:'https://www.klant.nl'}), lead('Prima')],
    {bedrijven:{b:{naam:'Klant', contacten:[{email:'x@klant.nl'}]}}, eerder:[{bedrijf:'Eerder gezien b.v.', website:''}],
     urls:new Set(['https://nieuws.nl/eerdergezien', 'https://nieuws.nl/zelfdedomein', 'https://nieuws.nl/prima'])});
  assert.deepEqual(uit.map(l => l.bedrijf), ['Prima']);
});

test('weeknummer en stil stoppen zonder sleutel', async () => {
  assert.equal(weekSleutel('2026-10-26'), '2026-W44'); assert.equal(weekSleutel('2027-01-01'), '2026-W53');
  assert.equal((await main({DATA_REPO:'o/d', DATA_TOKEN:'t'})).nieuw, 0);
});

test('onderzoek stopt na een weigering met een fout', async () => {
  const client = {beta:{messages:{stream:() => ({finalMessage:async () => ({stop_reason:'refusal', content:[]})})}}};
  await assert.rejects(() => onderzoek(client, 'x'), /geweigerd/);
});
