/* Gedeelde logica voor de app (browser) en de mailrobot (GitHub Actions, Node):
   datums en werkdagen, standaardinstellingen, mailsjablonen en het inplannen van
   de mails in een opvolgreeks. In de browser beschikbaar als window.REEKS. */
(function(root, maak){
  if(typeof module === 'object' && module.exports) module.exports = maak();
  else root.REEKS = maak();
})(typeof self !== 'undefined' ? self : this, function(){

  /* ---------- datums (YYYY-MM-DD, lokale tijd) ---------- */
  const pad = n => String(n).padStart(2,'0');
  const ds = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const parse = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); };
  const addDays = (s,n) => { const d = parse(s); d.setDate(d.getDate()+n); return ds(d); };
  const diffDays = (a,b) => Math.round((parse(b)-parse(a))/86400000);

  function pasen(y){
    const a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),
          h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),
          mo=Math.floor((h+l-7*m+114)/31),da=((h+l-7*m+114)%31)+1;
    return new Date(y,mo-1,da);
  }
  const _fd = {};
  function feestdagen(y){
    if(_fd[y]) return _fd[y];
    const p = pasen(y), plus = n => { const d = new Date(p); d.setDate(d.getDate()+n); return ds(d); };
    const kd = new Date(y,3,27); if(kd.getDay()===0) kd.setDate(26);
    const s = new Set([`${y}-01-01`, plus(1), ds(kd), plus(39), plus(50), `${y}-12-25`, `${y}-12-26`]);
    if(y%5===0) s.add(`${y}-05-05`);
    return _fd[y] = s;
  }
  function isWerkdag(s){ const d = parse(s), w = d.getDay(); return w!==0 && w!==6 && !feestdagen(d.getFullYear()).has(s); }
  function addWerkdagen(s,n){ let d = s; while(n>0){ d = addDays(d,1); if(isWerkdag(d)) n--; } return d; }
  function volgendeWerkdag(s){ let d = s; while(!isWerkdag(d)) d = addDays(d,1); return d; }

  const clone = o => JSON.parse(JSON.stringify(o));
  function merge(base, extra){
    const out = clone(base);
    for(const [k,v] of Object.entries(extra||{})){
      if(v && typeof v==='object' && !Array.isArray(v) && out[k] && typeof out[k]==='object' && !Array.isArray(out[k])) out[k] = merge(out[k], v);
      else out[k] = clone(v);
    }
    return out;
  }

  /* ---------- standaardinstellingen ---------- */
  const DEFAULT_INST = {
    termijnen: {
      prospect:  {opvolgWerkdagen:2, geenReactieWerkdagen:5, nietOpgenomenWerkdagen:2, maxPogingen:4},
      commissie: {opvolgWerkdagen:2, geenReactieWerkdagen:5, nietOpgenomenWerkdagen:2, maxPogingen:4, betaaltermijnDagen:30},
      klant:     {opvolgWerkdagen:2, geenReactieWerkdagen:5, nietOpgenomenWerkdagen:2, maxPogingen:4}
    },
    kantoortijden: {van:'08:30', tot:'17:00', verzendtijd:'09:30'},
    regios: [
      {naam:'Amsterdam e.o.',      postcodes:'1000-1199, 1380-1399, 1430-1439'},
      {naam:'Noord-Holland Noord', postcodes:'1600-1899'},
      {naam:'Randstad',            postcodes:'1200-1299, 2000-3399, 3500-3599'}
    ],
    /* Mailreeksen en sjablonen staan in de privé gegevensrepository (instellingen),
       niet in deze openbare code. Een prospect met de tag van een reeks krijgt die mails. */
    mailreeksen: [],
    sjablonen: []
  };

  /* Instellingen = standaard + opgeslagen. Sjablonen worden per id samengevoegd, zodat
     nieuwe standaardsjablonen ook verschijnen als er al eigen sjablonen zijn opgeslagen. */
  function instellingen(opgeslagen){
    const inst = merge(DEFAULT_INST, opgeslagen || {});
    const eigen = (opgeslagen && opgeslagen.sjablonen) || [];
    const weg = new Set((opgeslagen && opgeslagen.sjablonenVerwijderd) || []);
    const ids = new Set(eigen.map(t => t.id));
    inst.sjablonen = [...eigen, ...DEFAULT_INST.sjablonen.filter(t => !ids.has(t.id) && !weg.has(t.id))];
    return inst;
  }
  const termijn = (inst, kopje) => inst.termijnen[kopje] || inst.termijnen.prospect;

  /* ---------- mails ---------- */
  const voornaam = c => (c && c.naam || '').trim().split(/\s+/)[0] || '';
  function vul(tekst, b, c, afzender){
    const mij = afzender || '';
    return String(tekst||'')
      .replace(/\{voornaam\}|\[voornaam\]/gi, voornaam(c))
      .replace(/\{naam\}/g, (c && c.naam) || '')
      .replace(/\{bedrijf\}/g, (b && b.naam) || '')
      .replace(/\{mijnnaam\}|\[naam\]/gi, mij)
      .replace(/\{mijnvoornaam\}/g, mij.split(' ')[0]);
  }
  function reeksVoor(b, inst){
    const tags = (b.tags || []).map(t => t.toLowerCase());
    return (inst.mailreeksen || []).find(r => r.tag && tags.includes(r.tag.toLowerCase())) || null;
  }
  /* Mail voor stap `idx` van een reeks, vanaf datum `vanaf`. null als er geen e-mailadres of sjabloon is. */
  function planMail(b, reeks, idx, vanaf, inst, afzender, ci){
    const stap = reeks && reeks.stappen[idx];
    const sj = stap && (inst.sjablonen || []).find(s => s.id === stap.sjabloon);
    const c = (b.contacten || [])[ci || 0];
    if(!sj || !c || !c.email) return null;
    const datum = stap.werkdagenNa != null ? addWerkdagen(vanaf, stap.werkdagenNa) : volgendeWerkdag(addDays(vanaf, stap.dagenNa || 0));
    return {status:'gepland', bedrijfId:b.id, bedrijf:b.naam, kopje:b.kopje, reeks:reeks.id, stap:idx, laatste:idx === reeks.stappen.length-1,
      contact:ci || 0, aan:c.naam, email:c.email, onderwerp:vul(sj.onderwerp, b, c, afzender), tekst:vul(sj.tekst, b, c, afzender),
      sjabloon:sj.id, datum, tijd:(inst.kantoortijden && inst.kantoortijden.verzendtijd) || '09:30', afzender:afzender || '', aangemaakt:new Date().toISOString()};
  }
  /* Na het versturen van een (reeks)mail: nieuwe opvolging en eventueel de volgende mail. */
  function naVerzending(b, mail, inst, vandaag){
    const t = termijn(inst, b.kopje);
    const o = Object.assign({}, b.opvolging, {actief:true, gepauzeerd:false, tijd:null, pogingen:((b.opvolging && b.opvolging.pogingen) || 0) + 1});
    const reeks = mail && mail.reeks ? (inst.mailreeksen || []).find(r => r.id === mail.reeks) : null;
    const volgende = reeks ? planMail(b, reeks, mail.stap + 1, vandaag, inst, mail.afzender, mail.contact) : null;
    if(volgende){ o.stap = 'mail'; o.datum = volgende.datum; }
    else { o.stap = 'wacht'; o.datum = addWerkdagen(vandaag, t.geenReactieWerkdagen ?? 5); }   // herinnering om op te volgen
    return {opvolging:o, volgende};
  }
  /* Is er sinds `sinds` (ISO) contact geweest waardoor er geen automatische mail meer mag? */
  const CONTACT = a => a.type === 'mail_in' || a.type === 'afspraak' || a.type === 'bezoek' || (a.type === 'bel' && a.uitkomst === 'gesproken');
  const contactSinds = (acts, sinds) => acts.some(a => CONTACT(a) && a.datum > sinds);

  return {pad, ds, parse, addDays, diffDays, feestdagen, isWerkdag, addWerkdagen, volgendeWerkdag, clone, merge,
    DEFAULT_INST, instellingen, termijn, voornaam, vul, reeksVoor, planMail, naVerzending, contactSinds};
});
