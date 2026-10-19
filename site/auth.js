/* Inloggen met e-mail en wachtwoord, zonder eigen server.
   gebruikers.json bevat per gebruiker de GitHub-toegangssleutel, versleuteld met
   diens wachtwoord (PBKDF2-SHA256 + AES-GCM). Het e-mailadres staat er alleen als
   hash in. Zonder het juiste wachtwoord is de sleutel onbruikbaar. */
const AUTH = (() => {
  const ITERATIES = 310000;
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const normEmail = e => String(e || '').trim().toLowerCase();

  async function hashEmail(email){
    return b64(await crypto.subtle.digest('SHA-256', enc.encode('desko-crm:' + normEmail(email))));
  }
  async function sleutel(wachtwoord, zout, iteraties){
    const basis = await crypto.subtle.importKey('raw', enc.encode(wachtwoord), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({name:'PBKDF2', salt:zout, iterations:iteraties, hash:'SHA-256'}, basis, {name:'AES-GCM', length:256}, false, ['encrypt', 'decrypt']);
  }
  async function maakGebruiker({naam, email, wachtwoord, admin, token}){
    const zout = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const k = await sleutel(wachtwoord, zout, ITERATIES);
    const ct = await crypto.subtle.encrypt({name:'AES-GCM', iv}, k, enc.encode(JSON.stringify({token})));
    return {id:await hashEmail(email), naam, admin:!!admin, iter:ITERATIES, zout:b64(zout), iv:b64(iv), data:b64(ct)};
  }
  async function ontsleutel(gebruiker, wachtwoord){
    const k = await sleutel(wachtwoord, unb64(gebruiker.zout), gebruiker.iter || ITERATIES);
    try{
      const pt = await crypto.subtle.decrypt({name:'AES-GCM', iv:unb64(gebruiker.iv)}, k, unb64(gebruiker.data));
      return JSON.parse(dec.decode(pt)).token;
    }catch{ return null; }
  }
  async function inloggen(gebruikers, email, wachtwoord){
    const id = await hashEmail(email);
    const g = (gebruikers || []).find(x => x.id === id);
    const token = g && await ontsleutel(g, wachtwoord);
    if(!token) throw new Error('E-mailadres of wachtwoord klopt niet.');
    return {token, naam:g.naam, admin:!!g.admin, id};
  }
  return {hashEmail, maakGebruiker, inloggen, normEmail};
})();
