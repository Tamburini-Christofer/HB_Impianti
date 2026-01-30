/*
  generate_invoice.js
  Uso: includi le librerie CDN prima di questo file:

  <script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
  <script src="generate_invoice.js"></script>

  Poi chiama `generateInvoicePDF()` per scaricare la fattura come PDF.
*/

(function(){
  async function generateInvoicePDF(filename = 'fattura.pdf'){
    // Trova l'elemento che contiene la fattura. Il file HTML usa "page-container".
    const element = document.getElementById('page-container') || document.body;

    // Individua la classe jsPDF disponibile (UMD o globale)
    const jsPDFClass = (window.jspdf && window.jspdf.jsPDF) ? window.jspdf.jsPDF : (window.jsPDF ? window.jsPDF : null);
    if(!jsPDFClass){
      throw new Error('jsPDF non trovato. Includi jspdf.umd.min.js prima di questo script.');
    }

    const doc = new jsPDFClass({ unit: 'pt', format: 'a4' });

    // Margini A4 in punti (pt)
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20; // pt

    // Usa doc.html per renderizzare l'elemento (usa html2canvas internamente)
    await doc.html(element, {
      x: margin,
      y: margin,
      html2canvas: {
        scale: 2, // migliore qualità
        useCORS: true
      },
      callback: function(pdf){
        // Salva il PDF
        pdf.save(filename);
      },
      autoPaging: 'text'
    });
  }

  // Esporta la funzione globalmente
  window.generateInvoicePDF = generateInvoicePDF;
  // Nota: non aggiungiamo pulsanti di test automaticamente per evitare UI demo.
})();
