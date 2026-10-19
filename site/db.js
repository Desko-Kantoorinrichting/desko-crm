/* Dunne laag tussen de app en Supabase.
   Alle gegevens staan in één tabel `documenten` (collection, id, data jsonb).
   De app gebruikt een document-API: collection(..).doc(..).set/update/delete,
   where/orderBy/limit, en onSnapshot voor live bijwerken via Supabase Realtime. */
function makeDb(sb){
  const TABEL = 'documenten';
  const luisteraars = new Set();

  const melden = collectie => luisteraars.forEach(l => { if(!collectie || l.collectie === collectie) l.ververs(); });
  sb.channel('documenten-wijzigingen')
    .on('postgres_changes', {event:'*', schema:'public', table:TABEL}, p => melden((p.new && p.new.collection) || (p.old && p.old.collection)))
    .subscribe();
  // Na terugkomen in de app (telefoon uit slaapstand) alles verversen.
  document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible') melden(); });

  const debounce = (fn, ms) => { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; };
  const snap = r => ({id:r.id, exists:true, data:() => r.data});
  const nieuwId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

  function docRef(collectie, id){
    return {
      id, path:`${collectie}/${id}`,
      async get(){
        const {data, error} = await sb.from(TABEL).select('id,data').eq('collection', collectie).eq('id', id).maybeSingle();
        if(error) throw error;
        return data ? snap(data) : {id, exists:false, data:() => undefined};
      },
      async set(d){
        const {error} = await sb.from(TABEL).upsert({collection:collectie, id, data:d});
        if(error) throw error; melden(collectie);
      },
      async update(patch){
        const {error} = await sb.rpc('doc_merge', {p_collection:collectie, p_id:id, p_patch:patch});
        if(error) throw error; melden(collectie);
      },
      async delete(){
        const {error} = await sb.from(TABEL).delete().eq('collection', collectie).eq('id', id);
        if(error) throw error; melden(collectie);
      },
      onSnapshot(next, fout){
        const l = {collectie, ververs:debounce(() => this.get().then(next, e => fout && fout(e)), 120)};
        luisteraars.add(l); l.ververs();
        return () => luisteraars.delete(l);
      }
    };
  }

  function query(collectie, o = {}){
    return {
      path: collectie,
      where(veld, op, waarde){
        if(op !== '==') throw new Error('Alleen == wordt ondersteund');
        return query(collectie, {...o, where:[...(o.where || []), [veld, waarde]]});
      },
      orderBy(veld, richting = 'asc'){ return query(collectie, {...o, order:[veld, richting]}); },
      limit(n){ return query(collectie, {...o, limit:n}); },
      async get(){
        const rijen = [], blok = 1000, max = o.limit || Infinity;
        for(let van = 0; rijen.length < max; van += blok){
          let q = sb.from(TABEL).select('id,data').eq('collection', collectie);
          for(const [veld, waarde] of o.where || []) q = q.eq(`data->>${veld}`, waarde);
          q = o.order ? q.order(`data->>${o.order[0]}`, {ascending:o.order[1] !== 'desc'}) : q.order('id');
          const tot = Math.min(van + blok, max) - 1;
          const {data, error} = await q.range(van, tot);
          if(error) throw error;
          rijen.push(...data);
          if(data.length < tot - van + 1) break;
        }
        const docs = rijen.map(snap);
        return {docs, size:docs.length, empty:!docs.length};
      },
      onSnapshot(next, fout){
        const l = {collectie, ververs:debounce(() => this.get().then(next, e => fout && fout(e)), 120)};
        luisteraars.add(l); l.ververs();
        return () => luisteraars.delete(l);
      },
      doc(id){ return docRef(collectie, id || nieuwId()); },
      async add(d){ const r = docRef(collectie, nieuwId()); await r.set(d); return r; }
    };
  }

  return {
    collection: naam => query(naam),
    doc: pad => { const [c, id] = pad.split('/'); return docRef(c, id); }
  };
}
