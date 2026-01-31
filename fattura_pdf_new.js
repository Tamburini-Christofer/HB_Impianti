// Generatore PDF fattura cliente con pdfmake
// Versione fedele al prototipo, dinamica



async function generaFatturaPDF(invoice, client) {
  // Preferisci generare il PDF a partire dall'HTML (più fedele al prototipo) usando html2pdf.js
  try {
    const html = generaFatturaHTMLString(invoice, client);
    // Crea un contenitore nascosto nella pagina
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.left = '-10000px';
    container.style.top = '0';
    container.style.width = '800px';
    container.style.padding = '0';
    container.innerHTML = html;
    document.body.appendChild(container);

    const filenameSafe = (invoice && invoice.numero) ? String(invoice.numero).replace(/\//g, '_') : Date.now();

    if (window.html2pdf) {
      const opt = {
        margin:       10,
        filename:     `Fattura_${filenameSafe}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2, useCORS: true },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
      };
      await window.html2pdf().set(opt).from(container).save();
    } else if (window.pdfMake && window.pdfMake.createPdf) {
      // Fallback: usa l'implementazione precedente con pdfMake (meno fedele)
      console.warn('html2pdf non disponibile, uso pdfMake come fallback');
      // semplice fallback che tenta di convertire l'HTML a testo (non sempre perfetto)
      const testo = container.innerText || container.textContent || '';
      const docDefinition = { content: [{ text: testo }], pageSize: 'A4' };
      window.pdfMake.createPdf(docDefinition).download(`Fattura_${filenameSafe}.pdf`);
    } else {
      throw new Error('Nessuna libreria PDF disponibile (html2pdf o pdfMake)');
    }

    // pulizia
    setTimeout(() => { try { document.body.removeChild(container); } catch (e) {} }, 800);
  } catch (err) {
    console.error('Errore generazione PDF:', err);
    showNotification ? showNotification('Errore generazione PDF', 'error') : alert('Errore generazione PDF: ' + String(err));
  }
}

function euro(val) {
  return typeof val === 'number' ? val.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' }) : val;
}

// Genera una stringa HTML della fattura (stile adattato dal template fornito)
function generaFatturaHTMLString(invoice, client) {
  const safe = v => (v === undefined || v === null) ? '' : v;
  const aliquotaVal = (invoice && invoice.aliquota != null) ? Number(invoice.aliquota) : 10;
  const imponibileVal = Number(invoice.imponibile) || (Array.isArray(invoice.voci) ? invoice.voci.reduce((s, v) => s + (Number(v.totale) || (Number(v.prezzo) || 0) * (Number(v.quantita) || 0)), 0) : 0);
  const ivaVal = (invoice && invoice.iva != null) ? Number(invoice.iva) : +(imponibileVal * aliquotaVal / 100);
  const totaleVal = (invoice && invoice.totale != null) ? Number(invoice.totale) : +(imponibileVal + ivaVal);
  const rows = (Array.isArray(invoice.voci) ? invoice.voci : []).map(v => `
    <tr>
      <td>${safe(v.quantita)}</td>
      <td>${(safe(v.descrizione)).replace(/\n/g, '<br>')}</td>
      <td>${safe(euro(v.prezzo))}</td>
      <td>${safe(euro(v.totale))}</td>
    </tr>
  `).join('');

  // costruiamo il corpo della fattura (HTML semplice) che poi inseriremo nel template pdf2htmlEX
  const invoiceInner = `
    <div class="fattura-content">
      <header>
        <div>
          <strong>Destinatario</strong><br>
          Copia di cortesia<br>
          <strong>${safe(client.ragioneSociale) || (safe(client.nome) + ' ' + safe(client.cognome))}</strong><br>
          ${safe(client.indirizzo)}<br>
          ${safe(client.cap)} ${safe(client.citta)} ${safe(client.provincia)}<br>
          ${client.cf ? `C.F. ${client.cf}` : ''}
        </div>
        <div class="dati-fattura">
          <table>
            <tr><td>Numero</td><td>${safe(invoice.numero)}</td></tr>
            <tr><td>Data</td><td>${safe(invoice.data)}</td></tr>
            <tr><td>Scadenza</td><td>${safe(invoice.scadenza)}</td></tr>
            <tr class="totale"><td><strong>Totale</strong></td><td><strong>${euro(totaleVal)}</strong></td></tr>
          </table>
        </div>
      </header>

      <table class="articoli">
        <thead>
          <tr>
            <th>Q.tà</th>
            <th>Descrizione</th>
            <th>Importo U.</th>
            <th>Importo</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>

      <div class="riepilogo">
        <table>
          <tr><td>Imponibile</td><td>${euro(imponibileVal)}</td></tr>
          <tr><td>IVA ${aliquotaVal}%</td><td>${euro(ivaVal)}</td></tr>
          <tr class="totale"><td>Totale</td><td>${euro(totaleVal)}</td></tr>
        </table>
      </div>

      <section class="pagamento">
        <strong>Modalità di pagamento</strong><br>
        ${safe(invoice.pagamento) || 'Bonifico 30 giorni'}<br>
        Banca: ${safe(invoice.banca) || 'BANCA'}<br>
        IBAN: ${safe(invoice.iban) || 'IT82R0802635320000006108906'}
      </section>

      <footer>
        <strong>Dati societari</strong><br>
        ${safe(invoice.societa) || 'HERNANDEZ SORACA BRAYAN'}<br>
        P.IVA ${safe(invoice.piva) || '02625040221'} – C.F. ${safe(invoice.cfSocieta) || 'HRNBYN88P19Z604L'}<br>
        ${safe(invoice.societaIndirizzo) || 'Via Trapione 16 – 38062 Arco'}<br>
        Email: ${safe(invoice.societaEmail) || 'brayan88@pec.it'}
      </footer>
    </div>`;

  // Template wrapper: includiamo il CSS/struttura prodotta da pdf2htmlEX (semplificata) e inseriamo il contenuto dinamico
  const template = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="generator" content="pdf2htmlEX"/>
<meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1"/>
<style type="text/css">
/* minimal styles from pdf2htmlEX to preserve the look */
body{background:#fff;margin:0;padding:0;font-family:Arial, sans-serif}
.pf{margin:13px auto}
.fattura-content{width:100%;padding:20px}
/* original complex CSS omitted for brevity; core layout preserved */
</style>
</head>
<body>
  <div class="pf">
    <!-- INVOICE_PLACEHOLDER -->
  </div>
</body>
</html>`;

  const html = template.replace('<!-- INVOICE_PLACEHOLDER -->', invoiceInner);
  return html;
}

// Esponi funzione globale per uso in app.js
window.generaFatturaHTMLString = generaFatturaHTMLString;
