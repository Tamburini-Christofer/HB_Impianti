/*
  fix_invoices_22_to_10.js

  Uso (browser): apri DevTools Console nella tua app, incolla e invoca
    fixInvoicesInLocalStorage();

  Uso (node):
    node scripts/fix_invoices_22_to_10.js export.json [out.json]

  Cosa fa:
  - esegue il backup della chiave `invoices` (se esiste) in localStorage
    con suffisso timestamp.
  - sostituisce le aliquote 22 con 10 nelle fatture e nelle righe,
    ricalcola imponibile/iva/totale e salva.
*/

(function(){
  function parseRate(r){
    if (r == null) return null;
    if (typeof r === 'number') return r;
    const s = String(r).trim().replace('%','').replace(',', '.').replace(/[^0-9.\-]/g,'');
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  function fixInvoiceObj(i){
    let changed = false;
    if (parseRate(i.aliquota) === 22){ i.aliquota = 10; changed = true; }
    const items = i.items || i.voci || i.articoli || [];
    items.forEach(it => {
      const raw = (it.vat != null) ? it.vat : (it.iva != null ? it.iva : (it.aliquota != null ? it.aliquota : null));
      const pr = parseRate(raw);
      if (pr === 22){
        if (it.vat != null) it.vat = 10;
        if (it.iva != null) it.iva = +( ((it.qty||1) * (it.unit||it.prezzo||0)) * 0.10 ).toFixed(2);
        if (it.aliquota != null) it.aliquota = 10;
        changed = true;
      }
      // ensure item.totale exists
      const qty = Number(it.qty || it.quantita || 1);
      const unit = Number(it.unit || it.prezzo || 0);
      it.totale = +((qty * unit).toFixed(2));
    });

    // ricalcola riepiloghi
    const subtotal = items.reduce((s,it)=> s + (Number(it.totale)||0), 0);
    const tax = items.reduce((s,it)=> {
      const rate = parseRate(it.vat != null ? it.vat : (i.aliquota != null ? i.aliquota : (i.tax != null ? i.tax : 10)));
      return s + ((Number(it.totale)||0) * (rate||0) / 100);
    }, 0);
    const newImponibile = +subtotal.toFixed(2);
    const newIva = +tax.toFixed(2);
    const newTotale = +((newImponibile + newIva).toFixed(2));
    if (Number(i.imponibile || 0) !== newImponibile){ i.imponibile = newImponibile; changed = true; }
    if (Number(i.iva || 0) !== newIva){ i.iva = newIva; changed = true; }
    if (Number(i.totale || 0) !== newTotale){ i.totale = newTotale; changed = true; }
    return changed;
  }

  // Browser entry
  function fixInvoicesInLocalStorage(){
    if (typeof window === 'undefined' || !window.localStorage) {
      console.error('Questo metodo va eseguito in un browser con localStorage.');
      return;
    }
    const key = 'invoices';
    const raw = localStorage.getItem(key);
    if (!raw){ console.warn('Nessuna chiave "invoices" in localStorage.'); return; }
    try{
      const arr = JSON.parse(raw || '[]');
      const backupKey = key + '_backup_' + (new Date()).toISOString().replace(/[:.]/g,'-');
      localStorage.setItem(backupKey, raw);
      let changedCount = 0;
      arr.forEach(inv => { if (fixInvoiceObj(inv)) changedCount++; });
      localStorage.setItem(key, JSON.stringify(arr));
      console.log('Backup salvato in', backupKey);
      console.log('Fatture modificate:', changedCount);
      return { backupKey, changedCount };
    } catch(e){ console.error('Errore parsing invoices:', e); }
  }

  // Node entry: node scripts/fix_invoices_22_to_10.js in.json out.json
  async function fixFileNode(inPath, outPath){
    const fs = require('fs');
    const raw = fs.readFileSync(inPath, 'utf8');
    const arr = JSON.parse(raw || '[]');
    let changedCount = 0;
    arr.forEach(inv => { if (fixInvoiceObj(inv)) changedCount++; });
    fs.writeFileSync(outPath, JSON.stringify(arr, null, 2), 'utf8');
    console.log('File scritto:', outPath, 'Fatture modificate:', changedCount);
  }

  // export API
  if (typeof window !== 'undefined' && window.localStorage){ window.fixInvoicesInLocalStorage = fixInvoicesInLocalStorage; }
  if (typeof module !== 'undefined' && require.main === module){
    const args = process.argv.slice(2);
    if (!args[0]){ console.error('Uso: node fix_invoices_22_to_10.js input.json [output.json]'); process.exit(1); }
    const inP = args[0];
    const outP = args[1] || ('fixed_' + inP);
    fixFileNode(inP, outP).catch(e=>{ console.error(e); process.exit(2); });
  }

})();
