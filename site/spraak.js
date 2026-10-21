/* Ingesproken zin begrijpen: welk bedrijf, wat er gebeurde (bezoek, telefoontje, notitie),
   met wie, en wanneer de volgende stap is. Wat niet herkend wordt, blijft gewoon notitie.
   Voorbeeld: "Hoek Advocaten gebeld, Aukje gesproken, volgende week dinsdag om 2 uur terugbellen"
   In de browser beschikbaar als window.SPRAAK; in Node via require (voor de tests). */
(function(root, maak){
  if(typeof module === 'object' && module.exports) module.exports = maak(require('./reeks.js'));
  else root.SPRAAK = maak(root.REEKS);
})(typeof self !== 'undefined' ? self : this, function(R){

  const DAGEN = ['zondag','maandag','dinsdag','woensdag','donderdag','vrijdag','zaterdag'];
  const MAANDEN = ['januari','februari','maart','april','mei','juni','juli','augustus','september','oktober','november','december'];
  const GETAL = {een:1, één:1, twee:2, drie:3, vier:4, vijf:5, zes:6, zeven:7, acht:8, negen:9, tien:10, elf:11, twaalf:12, dertien:13, veertien:14};
  const getal = w => /^\d+$/.test(w) ? Number(w) : GETAL[w];
  const GETAL_RE = '(\\d+|een|één|twee|drie|vier|vijf|zes|zeven|acht|negen|tien|elf|twaalf|dertien|veertien)';
  const pad = n => String(n).padStart(2, '0');

  const ACTIES = [
    [/\b(terug ?bellen|bel(len)?|nabellen|opbellen)\b/, 'Bellen'],
    [/\b(mailen|e-?mailen|mail(tje)? (sturen|versturen|sturen)|mail sturen)\b/, 'Mailen'],
    [/\boffertes? (sturen|maken|versturen|opsturen)\b|\boffertes?\b/, 'Offerte sturen'],
    [/\b(afspraak (plannen|maken|inplannen))\b/, 'Afspraak plannen'],
    [/\b(langs ?gaan|langskomen|langsrijden|op bezoek)\b/, 'Langsgaan']
  ];

  /* "volgende week dinsdag", "morgen", "over 2 weken", "12 november", "eind van de week" ... */
  function leesDatum(t, vandaag){
    const dag = (naam, volgendeWeek) => {
      const doel = DAGEN.indexOf(naam), nu = R.parse(vandaag).getDay();
      let n = (doel - nu + 7) % 7; if(n === 0) n = 7;
      if(volgendeWeek){ const maandag = R.addDays(vandaag, ((1 - nu + 7) % 7) || 7); return R.addDays(maandag, (doel + 6) % 7); }
      return R.addDays(vandaag, n);
    };
    let m;
    if((m = t.match(/\bvolgende week (op )?(maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag)\b/))) return {datum:dag(m[2], true), stuk:m[0]};
    if((m = t.match(/\b(maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag) (van )?volgende week\b/))) return {datum:dag(m[1], true), stuk:m[0]};
    if((m = t.match(/\b(aanstaande |komende |deze )?(maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag)\b/))) return {datum:dag(m[2], false), stuk:m[0]};
    if((m = t.match(/\bovermorgen\b/))) return {datum:R.addDays(vandaag, 2), stuk:m[0]};
    if((m = t.match(/\bmorgen\b/))) return {datum:R.addDays(vandaag, 1), stuk:m[0]};
    if((m = t.match(/\b(vandaag|vanmiddag|vanavond|straks)\b/))) return {datum:vandaag, stuk:m[0]};
    if((m = t.match(new RegExp(`\\bover ${GETAL_RE} (werk)?dag(en)?\\b`)))) return {datum:m[2] ? R.addWerkdagen(vandaag, getal(m[1])) : R.addDays(vandaag, getal(m[1])), stuk:m[0]};
    if((m = t.match(new RegExp(`\\bover ${GETAL_RE} weken?\\b`)))) return {datum:R.addDays(vandaag, 7 * getal(m[1])), stuk:m[0]};
    if((m = t.match(new RegExp(`\\bover ${GETAL_RE} maand(en)?\\b`)))) { const d = R.parse(vandaag); d.setMonth(d.getMonth() + getal(m[1])); return {datum:R.ds(d), stuk:m[0]}; }
    if((m = t.match(/\bover een weekje\b|\bover een week\b/))) return {datum:R.addDays(vandaag, 7), stuk:m[0]};
    if((m = t.match(/\bbegin (van de )?volgende week\b/))) return {datum:dag('maandag', true), stuk:m[0]};
    if((m = t.match(/\beind (van )?(deze|de) week\b/))) return {datum:dag('vrijdag', false), stuk:m[0]};
    if((m = t.match(/\bvolgende week\b/))) return {datum:R.addDays(vandaag, 7), stuk:m[0]};
    if((m = t.match(/\bvolgende maand\b/))) { const d = R.parse(vandaag); d.setMonth(d.getMonth() + 1, 1); return {datum:R.ds(d), stuk:m[0]}; }
    if((m = t.match(new RegExp(`\\b(\\d{1,2})(e|ste|de)? (${MAANDEN.join('|')})\\b`)))){
      const v = R.parse(vandaag); let d = new Date(v.getFullYear(), MAANDEN.indexOf(m[3]), Number(m[1]));
      if(R.ds(d) < vandaag) d = new Date(v.getFullYear() + 1, d.getMonth(), d.getDate());
      return {datum:R.ds(d), stuk:m[0]};
    }
    return null;
  }

  /* "om 2 uur" (14:00), "om half 3" (14:30), "om kwart over 10", "om 14.15", "'s ochtends om 9 uur" */
  function leesTijd(t){
    let m, u, mi = 0;
    if((m = t.match(/\bom (\d{1,2})[:.](\d{2})( uur)?\b/))){ u = +m[1]; mi = +m[2]; }
    else if((m = t.match(/\bom half (\d{1,2}|een|twee|drie|vier|vijf|zes|zeven|acht|negen|tien|elf|twaalf)\b/))){ u = getal(m[1]) - 1; mi = 30; }
    else if((m = t.match(/\bom kwart (over|voor) (\d{1,2}|een|twee|drie|vier|vijf|zes|zeven|acht|negen|tien|elf|twaalf)\b/))){ u = getal(m[2]); mi = 15; if(m[1] === 'voor'){ u -= 1; mi = 45; } }
    else if((m = t.match(/\bom (\d{1,2}|een|twee|drie|vier|vijf|zes|zeven|acht|negen|tien|elf|twaalf)( uur)?\b/)) && (m[2] || /^\d/.test(m[1]))){ u = getal(m[1]); }
    else return null;
    const ochtend = /'s ochtends|\bochtend\b|'s morgens/.test(t);
    if(u >= 1 && u <= 7 && !ochtend) u += 12;            // "om 2 uur" op kantoor = 14:00
    if(u < 0 || u > 23 || mi > 59) return null;
    return {tijd:`${pad(u)}:${pad(mi)}`, stuk:m[0]};
  }

  /* Uitgespelde namen samenvoegen: "Aukje A, U, K, J, E" → "Aukje". Ook letternamen zoals
     "ka" en "jee". Staat er vlak voor een (verkeerd verstaan) woord dat erop lijkt, dan wint
     de gespelde versie. */
  const LETTERNAAM = {aa:'a', bee:'b', cee:'c', dee:'d', ee:'e', ef:'f', gee:'g', ha:'h', haa:'h', ie:'i', jee:'j', ka:'k', kaa:'k',
    el:'l', em:'m', en:'n', oo:'o', pee:'p', ku:'q', kuu:'q', er:'r', es:'s', tee:'t', uu:'u', vee:'v', wee:'w', iks:'x', ij:'ij', zet:'z'};
  const GEWOON_WOORD = new Set(['en', 'er', 'es', 'el', 'em', 'ie', 'ha', 'ij']);   // ook gewone woorden: niet als eerste letter
  const LET = `(?:${Object.keys(LETTERNAAM).sort((a, b) => b.length - a.length).join('|')}|\\p{L})`;
  const RUN = new RegExp(`(?<!\\p{L})${LET}(?:[\\s,.\\-]+${LET}(?!\\p{L})){2,}`, 'iu');
  function afstand(a, b){
    const d = Array.from({length:a.length + 1}, (_, i) => [i, ...Array(b.length).fill(0)]);
    for(let j = 1; j <= b.length; j++) d[0][j] = j;
    for(let i = 1; i <= a.length; i++) for(let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i-1][j] + 1, d[i][j-1] + 1, d[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1));
    return d[a.length][b.length];
  }
  function spel(tekst){
    let uit = String(tekst || ''), vanaf = 0, m;
    while((m = RUN.exec(uit.slice(vanaf)))){
      const begin = vanaf + m.index, stukken = m[0].split(/[\s,.\-]+/).filter(Boolean);
      if(GEWOON_WOORD.has(stukken[0].toLowerCase())){ vanaf = begin + stukken[0].length; continue; }
      const enkel = stukken.filter(x => x.length === 1).length;
      if(enkel < 2 || enkel < stukken.length / 2){ vanaf = begin + stukken[0].length; continue; }   // gewone woorden
      const woord = stukken.map(x => x.length === 1 ? x.toLowerCase() : LETTERNAAM[x.toLowerCase()]).join('');
      const naam = woord.charAt(0).toUpperCase() + woord.slice(1);
      let voor = uit.slice(0, begin);
      const vorig = voor.match(/(\p{L}+)[\s,]*$/u);
      if(vorig && vorig[1].length > 1){
        const v = vorig[1].toLowerCase();
        if(v === woord || afstand(v, woord) <= Math.max(1, Math.floor(woord.length / 2)) || v.slice(0, 2) === woord.slice(0, 2)) voor = voor.slice(0, vorig.index);
      }
      if(voor && !/\s$/.test(voor)) voor += ' ';
      uit = voor + naam + uit.slice(begin + m[0].length);
      vanaf = voor.length + naam.length;
    }
    return uit;
  }

  const kern = n => String(n || '').toLowerCase().replace(/\b(b\.?v\.?|n\.?v\.?|v\.?o\.?f\.?|holding|groep|group)\b/g, '').replace(/\([^)]*\)/g, '').replace(/[^a-z0-9à-ÿ ]/g, ' ').replace(/\s+/g, ' ').trim();

  /* Bedrijf in de zin: de langste naam die erin voorkomt (ook zonder "b.v." enzovoort). */
  function vindBedrijf(t, bedrijven){
    let beste = null;
    for(const b of bedrijven){
      const k = kern(b.naam); if(k.length < 3) continue;
      const kandidaten = [k, k.split(' ').slice(0, 2).join(' ')].filter(x => x.length >= 4);
      for(const x of kandidaten) if(new RegExp(`\\b${x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t) && (!beste || x.length > beste.len)) beste = {b, len:x.length};
    }
    return beste && beste.b;
  }
  function vindContact(t, b){
    const cs = (b && b.contacten) || [];
    let i = cs.findIndex(c => c.naam && t.includes(c.naam.toLowerCase()));
    if(i < 0) i = cs.findIndex(c => { const v = (c.naam || '').toLowerCase().split(/\s+/)[0]; return v.length >= 3 && new RegExp(`\\b${v}\\b`).test(t); });
    return i;
  }

  function lees(tekst, {bedrijven = [], bedrijf = null, vandaag}){
    const ruw = spel(String(tekst || '').trim()), t = ruw.toLowerCase().replace(/[,;!?]/g, ' ').replace(/\s+/g, ' ');
    const b = bedrijf || vindBedrijf(t, bedrijven);
    const ci = vindContact(t, b);

    // Wat er gebeurde
    let type = 'notitie', uitkomst = null;
    if(/\b(niet opgenomen|neemt niet op|voicemail|ingesproken|geen gehoor|niet bereikt|niet bereikbaar)\b/.test(t)){ type = 'bel'; uitkomst = 'niet opgenomen'; }
    else if(/\b(gebeld|telefonisch|aan de telefoon|aan de lijn|belde)\b/.test(t)){ type = 'bel'; uitkomst = 'gesproken'; }
    else if(/\b(langs geweest|langsgeweest|bezocht|bezoek gehad|op bezoek geweest|binnengelopen|binnen gelopen|aan de deur|langsgegaan|langs gegaan)\b/.test(t)) type = 'bezoek';
    else if(/\b(gesproken|spreken)\b/.test(t) && !/\b(terug|nog|moet|wil)\b[^.]*\bspreken\b/.test(t)){ type = 'bel'; uitkomst = 'gesproken'; }

    // Volgende stap
    const d = leesDatum(t, vandaag), tm = leesTijd(t);
    let actie = null;
    // zoek de actie bij voorkeur in het stuk na de datum ("... volgende week dinsdag terugbellen")
    const naDatum = d ? t.slice(t.indexOf(d.stuk)) : t;
    for(const [re, naam] of ACTIES) if(re.test(naDatum) || (!d && re.test(t))){ actie = naam; break; }
    if(!actie && d) for(const [re, naam] of ACTIES) if(re.test(t)){ actie = naam; break; }
    // "gebeld" zelf is geen volgende stap
    if(actie === 'Bellen' && !/\b(terug ?bellen|nabellen|opbellen|bellen)\b/.test(t)) actie = null;
    let plan = null;
    if(d) plan = {actie:actie || 'Opvolgen', datum:R.volgendeWerkdag(d.datum), tijd:tm ? tm.tijd : null};
    else if(actie && /\b(terug ?bellen|nabellen|mailen|langsgaan|offerte|afspraak plannen)\b/.test(t)) plan = {actie, datum:R.addWerkdagen(vandaag, 2), tijd:tm ? tm.tijd : null, geschat:true};

    return {bedrijfId:b ? b.id : null, contact:ci, type, uitkomst, plan, tekst:ruw.charAt(0).toUpperCase() + ruw.slice(1)};
  }

  return {lees, spel, leesDatum, leesTijd, vindBedrijf};
});
