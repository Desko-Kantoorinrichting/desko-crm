/* Tests voor de herinneringen (pushmeldingen) met een nagebootste GitHub-API.
   Starten met: node --test tests/*.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { main, teVersturen } from '../scripts/herinneringen.mjs';

const ENV = {DATA_REPO:'o/data', DATA_TOKEN:'t'};
const op = iso => new Date(iso);
const bedrijf = (opvolging, extra = {}) => ({naam:'Hoek Advocaten', kopje:'prospect', contacten:[{naam:'Pietje Puk'}], opvolging:{actief:true, contact:0, pogingen:0, ...opvolging}, ...extra});

function wereld({bedrijven, mails = {}, abonnementen = {a1:{endpoint:'https://push.example/1', keys:{p256dh:'x', auth:'y'}}}, log = {}}){
  const files = {
    'data/bedrijven.json':bedrijven, 'data/mails.json':mails, 'data/instellingen.json':{}, 'data/robot.json':{},
    'data/meldingen.json':abonnementen, 'data/herinneringen.json':log, 'data/push-sleutel.json':{vapid:{publicKey:'pub', privateKey:'priv'}}
  };
  let n = 0;
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(url), pad = u.pathname.split('/contents/')[1];
    if((opts.method || 'GET') === 'GET'){
      if(!files[pad]) return new Response(JSON.stringify({message:'Not Found'}), {status:404});
      return new Response(JSON.stringify({sha:'s' + n, content:Buffer.from(JSON.stringify(files[pad])).toString('base64')}), {status:200});
    }
    files[pad] = JSON.parse(Buffer.from(JSON.parse(opts.body).content, 'base64').toString('utf8')); n++;
    return new Response(JSON.stringify({content:{sha:'s' + n}}), {status:200});
  };
  const gestuurd = [];
  const stuur = async (sub, payload) => {
    if(sub.endpoint.includes('verlopen')){ const e = new Error('gone'); e.statusCode = 410; throw e; }
    gestuurd.push({sub, ...JSON.parse(payload)});
  };
  return {files, gestuurd, stuur};
}

test('opvolging van vandaag: melding "Neem vandaag contact op met ..." met link naar het profiel', async () => {
  const w = wereld({bedrijven:{b1:bedrijf({stap:'actie', actie:'Bellen', datum:'2026-10-21'})}});
  const t = await main(ENV, op('2026-10-21T07:00:00Z'), {stuur:w.stuur});   // 09:00 in Nederland
  assert.equal(t.verstuurd, 1);
  assert.equal(w.gestuurd[0].titel, 'Neem vandaag contact op met Pietje Puk');
  assert.equal(w.gestuurd[0].tekst, 'Hoek Advocaten · Bellen');
  assert.equal(w.gestuurd[0].url, '#/b/b1');
  // een kwartier later niet nog een keer
  const t2 = await main(ENV, op('2026-10-21T07:15:00Z'), {stuur:w.stuur});
  assert.equal(t2.verstuurd, 0); assert.equal(w.gestuurd.length, 1);
});

test('met een tijd: pas vanaf die tijd', async () => {
  const w = wereld({bedrijven:{b1:bedrijf({stap:'actie', actie:'Bellen', datum:'2026-10-21', tijd:'14:00'})}});
  await main(ENV, op('2026-10-21T10:00:00Z'), {stuur:w.stuur});   // 12:00
  assert.equal(w.gestuurd.length, 0);
  await main(ENV, op('2026-10-21T12:05:00Z'), {stuur:w.stuur});   // 14:05
  assert.equal(w.gestuurd.length, 1); assert.match(w.gestuurd[0].tekst, /om 14:00/);
});

test('niet in het weekend, niet voor de werkdag begint, niet voor morgen', async () => {
  const w = wereld({bedrijven:{b1:bedrijf({stap:'actie', datum:'2026-10-24'}), b2:bedrijf({stap:'actie', datum:'2026-10-22'})}});
  assert.equal((await main(ENV, op('2026-10-24T09:00:00Z'), {stuur:w.stuur})).verstuurd, 0);   // zaterdag
  assert.equal((await main(ENV, op('2026-10-21T05:30:00Z'), {stuur:w.stuur})).verstuurd, 0);   // 07:30
  assert.equal(w.gestuurd.length, 0);
});

test('te laat: één samenvatting per dag; uitgesteld of gepauzeerd: niets', async () => {
  const w = wereld({bedrijven:{b1:bedrijf({stap:'wacht', datum:'2026-10-19'}), b2:bedrijf({stap:'actie', datum:'2026-10-20'}),
    b3:bedrijf({stap:'actie', datum:'2026-10-19', gepauzeerd:true}), b4:bedrijf({stap:'actie', datum:'2026-10-28'})}});
  await main(ENV, op('2026-10-21T07:00:00Z'), {stuur:w.stuur});
  assert.deepEqual(w.gestuurd.map(x => x.titel), ['2 opvolgingen zijn te laat']);
  await main(ENV, op('2026-10-21T09:00:00Z'), {stuur:w.stuur});
  assert.equal(w.gestuurd.length, 1);
});

test('mailstap: herinnering om te mailen, tenzij de mailrobot het automatisch doet', () => {
  const bedrijven = {b1:bedrijf({stap:'mail', datum:'2026-10-21'})};
  const mails = {m1:{bedrijfId:'b1', status:'gepland', onderwerp:'Je collega wees me jouw kant op', datum:'2026-10-21', tijd:'09:30'}};
  const args = {bedrijven, mails, inst:{kantoortijden:{van:'08:30'}}, log:{}, datum:'2026-10-21', tijd:'09:45'};
  const [m] = teVersturen({...args, robotActief:false});
  assert.equal(m.titel, 'Mail vandaag Pietje Puk'); assert.match(m.tekst, /Je collega wees me/);
  assert.equal(teVersturen({...args, tijd:'09:00', robotActief:false}).length, 0);   // mail staat op 09:30
  assert.equal(teVersturen({...args, robotActief:true}).length, 0);
});

test('veel tegelijk: samenvatting; verlopen telefoon wordt opgeruimd', async () => {
  const bedrijven = Object.fromEntries(Array.from({length:9}, (_, i) => [`b${i}`, bedrijf({stap:'actie', datum:'2026-10-21'})]));
  const w = wereld({bedrijven, abonnementen:{a1:{endpoint:'https://push.example/1', keys:{}}, a2:{endpoint:'https://push.example/verlopen', keys:{}}}});
  const t = await main(ENV, op('2026-10-21T07:00:00Z'), {stuur:w.stuur});
  assert.equal(w.gestuurd.length, 7); assert.equal(w.gestuurd[6].titel, 'Nog 3 opvolgingen vandaag');
  assert.equal(t.verlopen, 1); assert.deepEqual(Object.keys(w.files['data/meldingen.json']), ['a1']);
  assert.equal(Object.keys(w.files['data/herinneringen.json']).length, 9);
});

test('zonder DATA_TOKEN of zonder aangemelde telefoons: stil stoppen', async () => {
  assert.equal((await main({}, op('2026-10-21T07:00:00Z'))).verstuurd, 0);
  const w = wereld({bedrijven:{b1:bedrijf({stap:'actie', datum:'2026-10-21'})}, abonnementen:{}});
  assert.equal((await main(ENV, op('2026-10-21T07:00:00Z'), {stuur:w.stuur})).verstuurd, 0);
});

test('route van vandaag: één melding aan het begin van de werkdag', () => {
  const bedrijven = {b1:bedrijf({stap:'actie', datum:'2026-10-30'}), b2:bedrijf({stap:'actie', datum:'2026-10-30'}, {naam:'Van Dijk Architecten'})};
  const routes = {'2026-10-21--ferry':{datum:'2026-10-21', voor:'Ferry', stops:[{id:'b1', status:'open'}, {id:'b2', status:'open'}, {id:'weg', status:'open'}]},
    '2026-10-22--ferry':{datum:'2026-10-22', voor:'Ferry', stops:[{id:'b1'}]}};
  const args = {bedrijven, mails:{}, inst:{kantoortijden:{van:'08:30'}}, robotActief:false, datum:'2026-10-21', routes};
  assert.equal(teVersturen({...args, log:{}, tijd:'08:00'}).length, 0);
  const [m] = teVersturen({...args, log:{}, tijd:'08:45'});
  assert.equal(m.titel, 'Route vandaag voor Ferry: 2 bezoeken'); assert.equal(m.tekst, 'Hoek Advocaten, Van Dijk Architecten'); assert.equal(m.url, '#/vandaag');
  assert.equal(teVersturen({...args, log:{[m.sleutel]:'x'}, tijd:'09:00'}).length, 0);
});

test('leadradar: één melding per week zolang er leads te beoordelen zijn', () => {
  const args = {bedrijven:{}, mails:{}, inst:{kantoortijden:{van:'08:30'}}, robotActief:false, datum:'2026-10-26', tijd:'09:00',
    leads:{a:{status:'nieuw', week:'2026-W44'}, b:{status:'nieuw', week:'2026-W44'}, c:{status:'afgewezen', week:'2026-W43'}}};
  const [m] = teVersturen({...args, log:{}});
  assert.equal(m.titel, 'Leadradar: 2 nieuwe leads'); assert.equal(m.url, '#/leadradar');
  assert.equal(teVersturen({...args, log:{[m.sleutel]:'x'}}).length, 0);
});
