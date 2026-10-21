/* Tests voor het begrijpen van ingesproken zinnen. Starten met: node --test tests/*.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const S = createRequire(import.meta.url)('../site/spraak.js');

const VANDAAG = '2026-10-21';   // woensdag
const BEDRIJVEN = [
  {id:'b1', naam:'Hoek Advocaten', contacten:[{naam:'Aukje de Vries'}, {naam:'Tom Bakker'}]},
  {id:'b2', naam:'Van Dijk Architecten B.V.', contacten:[{naam:'Tom van Dijk'}]},
  {id:'b3', naam:'Navingo BV (offshoreWIND.biz)', contacten:[]}
];
const lees = (t, extra = {}) => S.lees(t, {bedrijven:BEDRIJVEN, vandaag:VANDAAG, ...extra});

test('voorbeeld: volgende week dinsdag terugbellen', () => {
  const r = lees('Volgende week dinsdag terugbellen', {bedrijf:BEDRIJVEN[0]});
  assert.deepEqual(r.plan, {actie:'Bellen', datum:'2026-10-27', tijd:null});
  assert.equal(r.type, 'notitie');
});

test('bedrijf, contact, gebeld en tijd uit één zin', () => {
  const r = lees('Hoek Advocaten gebeld, Aukje gesproken, ze verhuizen in maart. Volgende week dinsdag om 2 uur terugbellen');
  assert.equal(r.bedrijfId, 'b1'); assert.equal(r.contact, 0);
  assert.equal(r.type, 'bel'); assert.equal(r.uitkomst, 'gesproken');
  assert.deepEqual(r.plan, {actie:'Bellen', datum:'2026-10-27', tijd:'14:00'});
});

test('bedrijfsnaam zonder b.v. en met haakjes', () => {
  assert.equal(lees('van dijk architecten langs geweest').bedrijfId, 'b2');
  assert.equal(lees('navingo offerte sturen').bedrijfId, 'b3');
  assert.equal(lees('niets bekends hier').bedrijfId, null);
});

test('datums', () => {
  const d = t => S.leesDatum(t, VANDAAG)?.datum;
  assert.equal(d('morgen'), '2026-10-22');
  assert.equal(d('overmorgen'), '2026-10-23');
  assert.equal(d('vrijdag'), '2026-10-23');
  assert.equal(d('woensdag'), '2026-10-28');          // vandaag is woensdag: volgende
  assert.equal(d('maandag volgende week'), '2026-10-26');
  assert.equal(d('volgende week vrijdag'), '2026-10-30');
  assert.equal(d('over twee weken'), '2026-11-04');
  assert.equal(d('over 3 dagen'), '2026-10-24');
  assert.equal(d('over drie werkdagen'), '2026-10-26');
  assert.equal(d('over een maand'), '2026-11-21');
  assert.equal(d('eind van de week'), '2026-10-23');
  assert.equal(d('begin volgende week'), '2026-10-26');
  assert.equal(d('12 november'), '2026-11-12');
  assert.equal(d('3 maart'), '2027-03-03');
  assert.equal(d('volgende week'), '2026-10-28');
});

test('tijden', () => {
  const t = x => S.leesTijd(x)?.tijd;
  assert.equal(t('om 2 uur'), '14:00');
  assert.equal(t('om 10 uur'), '10:00');
  assert.equal(t('om half 3'), '14:30');
  assert.equal(t('om kwart over 10'), '10:15');
  assert.equal(t('om kwart voor 4'), '15:45');
  assert.equal(t('om 14.15'), '14:15');
  assert.equal(t("'s ochtends om 7 uur"), '07:00');
  assert.equal(t('om twee uur'), '14:00');
  assert.equal(t('om de hoek'), undefined);
});

test('weekend schuift naar de volgende werkdag', () => {
  assert.equal(lees('zaterdag mailen', {bedrijf:BEDRIJVEN[0]}).plan.datum, '2026-10-26');
});

test('niet opgenomen, bezoek en gewone notitie', () => {
  const a = lees('Tom niet opgenomen, voicemail ingesproken. Morgen nog een keer bellen', {bedrijf:BEDRIJVEN[0]});
  assert.equal(a.type, 'bel'); assert.equal(a.uitkomst, 'niet opgenomen'); assert.equal(a.contact, 1);
  assert.deepEqual(a.plan, {actie:'Bellen', datum:'2026-10-22', tijd:null});
  const b = lees('Langs geweest bij de receptie, folder achtergelaten', {bedrijf:BEDRIJVEN[0]});
  assert.equal(b.type, 'bezoek'); assert.equal(b.plan, null);
  const c = lees('ze zijn tevreden over de stoelen', {bedrijf:BEDRIJVEN[0]});
  assert.equal(c.type, 'notitie'); assert.equal(c.plan, null); assert.equal(c.tekst, 'Ze zijn tevreden over de stoelen');
});

test('actie zonder datum: over 2 werkdagen; offerte en mailen', () => {
  assert.deepEqual(lees('nog even nabellen', {bedrijf:BEDRIJVEN[0]}).plan, {actie:'Bellen', datum:'2026-10-23', tijd:null, geschat:true});
  assert.equal(lees('vrijdag offerte sturen voor 30 werkplekken', {bedrijf:BEDRIJVEN[0]}).plan.actie, 'Offerte sturen');
  assert.equal(lees('morgen mailen met de brochure', {bedrijf:BEDRIJVEN[0]}).plan.actie, 'Mailen');
  assert.equal(lees('donderdag afspraak plannen', {bedrijf:BEDRIJVEN[0]}).plan.actie, 'Afspraak plannen');
  assert.equal(lees('volgende week langsgaan', {bedrijf:BEDRIJVEN[0]}).plan.actie, 'Langsgaan');
  assert.equal(lees('vrijdag', {bedrijf:BEDRIJVEN[0]}).plan.actie, 'Opvolgen');
});

test('uitgespelde namen worden samengevoegd', () => {
  assert.equal(S.spel('gesproken met Aukje A,u,k,j,e, volgende week bellen'), 'gesproken met Aukje, volgende week bellen');
  assert.equal(S.spel('gesproken met Okje a u k j e'), 'gesproken met Aukje');            // verkeerd verstaan: gespeld wint
  assert.equal(S.spel('gesproken met A-U-K-J-E'), 'gesproken met Aukje');
  assert.equal(S.spel('Tom van Dijk d i j k gebeld'), 'Tom van Dijk gebeld');
  assert.equal(S.spel('mevrouw b ij l'), 'mevrouw Bijl');
  assert.equal(S.spel('Jessica j e s s i c a'), 'Jessica');
  assert.equal(S.spel('Mark m a r ka gesproken'), 'Mark gesproken');                    // letternaam "ka" voor de k
  // gewone zinnen blijven heel
  for(const z of ['Hoek Advocaten gebeld, Aukje de Vries gesproken', 'ze willen een offerte en ik bel ze', 'met Tom en Aukje op locatie', 'om 2 uur bellen', 'plan a of b']) assert.equal(S.spel(z), z);
});

test('gespelde naam wordt herkend als contactpersoon', () => {
  const r = lees('Gesproken met Okje A, U, K, J, E. Morgen terugbellen', {bedrijf:BEDRIJVEN[0]});
  assert.equal(r.contact, 0); assert.match(r.tekst, /^Gesproken met Aukje\. Morgen/);
  assert.equal(r.type, 'bel'); assert.equal(r.plan.datum, '2026-10-22');
});
