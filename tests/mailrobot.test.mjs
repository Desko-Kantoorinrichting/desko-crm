/* Tests voor de mailrobot met nagebootste GitHub- en Microsoft-API's.
   Starten met: node --test tests/ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { main, nlNu } from '../scripts/mailrobot.mjs';
const R = createRequire(import.meta.url)('../site/reeks.js');

const INST = {algemeen:{
  mailreeksen:[{id:'koud', naam:'Koude acquisitie', tag:'door to door', stappen:[{sjabloon:'koud-1', werkdagenNa:1},{sjabloon:'koud-2', dagenNa:7}]}],
  sjablonen:[{id:'koud-1', kopje:'prospect', naam:'1', onderwerp:'Testonderwerp', tekst:'Hi {voornaam},\nGroet,\n{mijnnaam}'},
             {id:'koud-2', kopje:'prospect', naam:'2', onderwerp:'Re: Testonderwerp', tekst:'Hi {voornaam}, nog even...'}]}};
const ENV = {DATA_REPO:'o/data', DATA_TOKEN:'t', MS_TENANT_ID:'x', MS_CLIENT_ID:'x', MS_CLIENT_SECRET:'x', MS_AFZENDER:'ferry@desko.nl'};

function wereld({bedrijf = {}, mail = {}, acts = {}, inbox = []} = {}){
  const b = {naam:'Hoek Advocaten', kopje:'prospect', status:'contact gehad', tags:['door to door'],
    contacten:[{naam:'Aukje de Vries', email:'aukje@hoek.nl'}],
    opvolging:{actief:true, stap:'mail', reeks:'koud', contact:0, pogingen:0, datum:'2026-10-21', gestart:'2026-10-20'}, ...bedrijf};
  const m = {status:'gepland', bedrijfId:'b1', bedrijf:b.naam, kopje:'prospect', reeks:'koud', stap:0, contact:0, aan:'Aukje de Vries',
    email:'aukje@hoek.nl', onderwerp:'Testonderwerp', tekst:'Hi Aukje', datum:'2026-10-21', tijd:'09:30', afzender:'Ferry',
    aangemaakt:'2026-10-20T12:00:00.000Z', ...mail};
  const files = {
    'data/instellingen.json': INST,
    'data/bedrijven.json': {b1:b},
    'data/mails.json': {m1:m},
    'data/activiteiten/b1.json': acts,
  };
  const verzonden = [];
  let n = 0;
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(url), method = opts.method || 'GET';
    const json = (status, body) => new Response(body == null ? null : JSON.stringify(body), {status});
    if(u.hostname === 'login.microsoftonline.com') return json(200, {access_token:'tok'});
    if(u.hostname === 'graph.microsoft.com'){
      if(u.pathname.endsWith('/sendMail')){ verzonden.push(JSON.parse(opts.body).message); return new Response(null, {status:202}); }
      const van = decodeURIComponent(u.search).match(/address eq '([^']+)'/)[1];
      return json(200, {value: inbox.filter(x => x.van === van)});
    }
    const pad = u.pathname.split('/contents/')[1];
    if(method === 'GET'){
      if(!(pad in files)) return json(404, {});
      return json(200, {sha:'s'+n, content:Buffer.from(JSON.stringify(files[pad])).toString('base64')});
    }
    files[pad] = JSON.parse(Buffer.from(JSON.parse(opts.body).content, 'base64').toString()); n++;
    return json(200, {content:{sha:'s'+n}});
  };
  return {files, verzonden, acts:() => Object.values(files['data/activiteiten/b1.json'] || {})};
}
const op = iso => new Date(iso);   // UTC; 07:45Z = 09:45 NL (zomertijd)

test('nlNu rekent naar Nederlandse tijd', () => {
  assert.deepEqual(nlNu(op('2026-10-21T07:45:00Z')), {datum:'2026-10-21', tijd:'09:45'});
  assert.deepEqual(nlNu(op('2026-12-01T07:45:00Z')), {datum:'2026-12-01', tijd:'08:45'});
});

test('mail 1 gaat op tijd en mail 2 wordt een week later ingepland', async () => {
  const w = wereld();
  const t = await main(ENV, op('2026-10-21T07:45:00Z'));
  assert.equal(t.verstuurd, 1);
  assert.equal(w.verzonden[0].toRecipients[0].emailAddress.address, 'aukje@hoek.nl');
  const mails = Object.values(w.files['data/mails.json']);
  assert.equal(mails.find(m => m.stap === 0).status, 'verstuurd');
  const m2 = mails.find(m => m.stap === 1);
  assert.equal(m2.status, 'gepland'); assert.equal(m2.datum, '2026-10-28'); assert.match(m2.onderwerp, /^Re:/);
  const b = w.files['data/bedrijven.json'].b1;
  assert.equal(b.opvolging.stap, 'mail'); assert.equal(b.opvolging.pogingen, 1); assert.equal(b.opvolging.datum, '2026-10-28');
  assert.ok(w.acts().some(a => a.type === 'mail_uit'));
});

test('laatste mail verstuurd: daarna wacht op reactie en herinnering na 5 werkdagen', async () => {
  const w = wereld({mail:{stap:1, onderwerp:'Re: x', datum:'2026-10-28'}, bedrijf:{opvolging:{actief:true, stap:'mail', reeks:'koud', contact:0, pogingen:1, datum:'2026-10-28', gestart:'2026-10-20'}}});
  const t = await main(ENV, op('2026-10-28T09:00:00Z'));
  assert.equal(t.verstuurd, 1, JSON.stringify(t));
  const b = w.files['data/bedrijven.json'].b1;
  assert.equal(b.opvolging.stap, 'wacht'); assert.equal(b.opvolging.datum, '2026-11-04'); assert.equal(b.opvolging.pogingen, 2);
  assert.equal(Object.values(w.files['data/mails.json']).filter(m => m.status === 'gepland').length, 0);
});

test('reactie vlak voor het verzendmoment: mail gaat niet en reeks stopt', async () => {
  const w = wereld({inbox:[{id:'g1', van:'aukje@hoek.nl', subject:'Re: langskomen', bodyPreview:'Kom maar', receivedDateTime:'2026-10-21T07:30:00Z'}]});
  const t = await main(ENV, op('2026-10-21T07:45:00Z'));
  assert.equal(t.verstuurd, 0); assert.equal(t.reacties, 1); assert.equal(w.verzonden.length, 0);
  assert.equal(w.files['data/mails.json'].m1.status, 'geannuleerd');
  assert.equal(w.files['data/bedrijven.json'].b1.opvolging.actief, false);
  assert.ok(w.acts().some(a => a.type === 'mail_in'));
});

test('automatisch afwezigheidsbericht stopt de reeks niet', async () => {
  const w = wereld({inbox:[{id:'g2', van:'aukje@hoek.nl', subject:'Automatisch antwoord: afwezig', receivedDateTime:'2026-10-21T07:30:00Z'}]});
  const t = await main(ENV, op('2026-10-21T07:45:00Z'));
  assert.equal(t.verstuurd, 1); assert.equal(t.reacties, 0);
});

test('Ferry belde al zelf: geen automatische mail', async () => {
  const w = wereld({acts:{a1:{bedrijfId:'b1', type:'bel', uitkomst:'gesproken', datum:'2026-10-20T15:00:00.000Z'}}});
  const t = await main(ENV, op('2026-10-21T07:45:00Z'));
  assert.equal(t.verstuurd, 0); assert.equal(w.verzonden.length, 0);
  assert.equal(w.files['data/mails.json'].m1.status, 'geannuleerd');
});

test('niet opgenomen telt niet als contact: mail gaat wel', async () => {
  wereld({acts:{a1:{bedrijfId:'b1', type:'bel', uitkomst:'niet opgenomen', datum:'2026-10-20T15:00:00.000Z'}}});
  const t = await main(ENV, op('2026-10-21T07:45:00Z'));
  assert.equal(t.verstuurd, 1);
});

test('weekend, feestdag en buiten kantoortijd: niets versturen', async () => {
  wereld({mail:{datum:'2026-10-23'}});
  assert.equal((await main(ENV, op('2026-10-24T08:00:00Z'))).verstuurd, 0);   // zaterdag
  wereld({mail:{datum:'2026-12-24'}});
  assert.equal((await main(ENV, op('2026-12-25T09:00:00Z'))).verstuurd, 0);   // eerste kerstdag
  wereld();
  assert.equal((await main(ENV, op('2026-10-21T05:00:00Z'))).verstuurd, 0);   // 07:00 NL
  wereld();
  assert.equal((await main(ENV, op('2026-10-21T07:15:00Z'))).verstuurd, 0);   // 09:15, mail staat op 09:30
});

test('gepauzeerde opvolging: mail blijft staan', async () => {
  const w = wereld({bedrijf:{opvolging:{actief:true, stap:'mail', reeks:'koud', contact:0, pogingen:0, datum:'2026-10-21', gepauzeerd:true}}});
  assert.equal((await main(ENV, op('2026-10-21T07:45:00Z'))).verstuurd, 0);
  assert.equal(w.files['data/mails.json'].m1.status, 'gepland');
});

test('bedrijf verplaatst of opvolging gestopt tijdens de reeks: mail wordt geannuleerd', async () => {
  const w = wereld({bedrijf:{kopje:'klant', opvolging:{actief:false, stap:'mail'}}});
  await main(ENV, op('2026-10-21T07:45:00Z'));
  assert.equal(w.verzonden.length, 0);
  assert.equal(w.files['data/mails.json'].m1.status, 'geannuleerd');
});

test('niet gekoppeld: niets versturen, wel status melden', async () => {
  const w = wereld();
  await main({DATA_REPO:'o/data', DATA_TOKEN:'t'}, op('2026-10-21T07:45:00Z'));
  assert.equal(w.verzonden.length, 0);
  assert.equal(w.files['data/robot.json'].status.gekoppeld, false);
});

test('planMail: geen e-mailadres betekent geen mail; werkdagen en weekenden kloppen', () => {
  const inst = R.instellingen(INST.algemeen);
  const reeks = inst.mailreeksen[0];
  const b = {id:'b', naam:'X', kopje:'prospect', contacten:[{naam:'Aukje de Vries', email:''}]};
  assert.equal(R.planMail(b, reeks, 0, '2026-10-23', inst, 'Ferry', 0), null);
  b.contacten[0].email = 'a@x.nl';
  const m = R.planMail(b, reeks, 0, '2026-10-23', inst, 'Ferry Jansen', 0);   // vrijdag
  assert.equal(m.datum, '2026-10-26');                                         // maandag
  assert.equal(m.tekst, 'Hi Aukje,\nGroet,\nFerry Jansen');
  assert.equal(R.planMail(b, reeks, 1, '2026-12-19', inst, 'F', 0).datum, '2026-12-28');   // +7 = kerst → maandag 28
});
