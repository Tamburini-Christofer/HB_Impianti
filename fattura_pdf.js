// Generatore PDF fattura cliente con pdfmake
// Versione fedele al prototipo, dinamica


// Generatore PDF fattura cliente con pdfmake
// Versione fedele al prototipo, dinamica



async function generaFatturaPDF(invoice, client) {
  // Preferisci generare il PDF a partire dall'HTML (più fedele al prototipo) usando html2pdf.js
  try {
    const html = generaFatturaHTMLString(invoice, client);
    const filenameSafe = (invoice && invoice.numero) ? String(invoice.numero).replace(/\//g, '_') : Date.now();

    // Prefer fallback stampa: apri una nuova finestra, inserisci l'HTML via DOMParser e chiama print()
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      try {
        const parser = new DOMParser();
        const parsed = parser.parseFromString(html, 'text/html');

        try { printWindow.document.title = parsed.title || `Fattura ${invoice.numero}`; } catch (e) {}

        // Copia elementi head utili (style/link)
        const headChildren = parsed.head ? Array.from(parsed.head.children) : [];
        headChildren.forEach(node => {
          try {
            printWindow.document.head.appendChild(printWindow.document.importNode(node, true));
          } catch (e) {}
        });

        // Inserisci il body
        try {
          printWindow.document.body.innerHTML = parsed.body ? parsed.body.innerHTML : html;
        } catch (e) {
          // fallback: crea un container e append
          const container = printWindow.document.createElement('div');
          container.innerHTML = parsed.body ? parsed.body.innerHTML : html;
          printWindow.document.body.appendChild(container);
        }

        printWindow.focus();
        printWindow.print();
        // opzionale: chiudi dopo un breve ritardo
        setTimeout(() => { try { printWindow.close(); } catch (e) {} }, 600);
        return;
      } catch (errWin) {
        console.warn('Errore anteprima di stampa, provo html2pdf/pdMake fallback', errWin);
      }
    }

    // Se non riusciamo ad aprire/usar la finestra, prova html2pdf se disponibile
    if (window.html2pdf) {
      const container = document.createElement('div');
      container.style.width = '800px';
      container.innerHTML = html;
      document.body.appendChild(container);
      const opt = {
        margin:       10,
        filename:     `Fattura_${filenameSafe}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2, useCORS: true },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
      };
      await window.html2pdf().set(opt).from(container).save();
      setTimeout(() => { try { document.body.removeChild(container); } catch (e) {} }, 800);
      return;
    }

    // Fallback finale: usa pdfMake minimamente
    if (window.pdfMake && window.pdfMake.createPdf) {
      console.warn('Usando pdfMake come fallback finale');
      const testo = (new DOMParser().parseFromString(html, 'text/html').body.innerText) || '';
      const docDefinition = { content: [{ text: testo }], pageSize: 'A4' };
      window.pdfMake.createPdf(docDefinition).download(`Fattura_${filenameSafe}.pdf`);
      return;
    }

    throw new Error('Nessuna libreria PDF disponibile (print, html2pdf o pdfMake)');
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

  // Template wrapper: css + struttura compatta per la fattura
  const template = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="generator" content="pdf2htmlEX"/>
  <meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1"/>
  <style>
    html,body{font-family: Arial, Helvetica, sans-serif;color:#222;margin:0;padding:0;background:#fff}
    .pf{width:794px;margin:10px auto;padding:18px;background:#fff}
    .fattura-content{width:100%;box-sizing:border-box}
    header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid #ddd;padding-bottom:12px;margin-bottom:12px}
    .dati-fattura table{border-collapse:collapse}
    .dati-fattura td{padding:2px 6px}
    .articoli{width:100%;border-collapse:collapse;margin-top:8px}
    .articoli th,.articoli td{border:1px solid #ddd;padding:8px;text-align:left}
    .articoli th{background:#f6f6f6}
    .riepilogo{float:right;margin-top:12px}
    .riepilogo table{border-collapse:collapse}
    .riepilogo td{padding:4px 8px}
    .totale td{font-weight:700}
    footer{margin-top:30px;font-size:12px;color:#555;border-top:1px solid #eee;padding-top:8px}
    @media print{body{background:#fff} .pf{box-shadow:none;margin:0} }
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
