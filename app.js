/* ====================================
   HB IMPIANTI - GESTIONALE TERMOIMPIANTI
   Versione: 2.0.0
   ==================================== */

// ==================== PWA SERVICE WORKER ====================
// Registrazione del Service Worker per funzionalità PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then((registration) => {
        console.log('SW registrato con successo: ', registration.scope);
      })
      .catch((registrationError) => {
        console.log('Errore registrazione SW: ', registrationError);
      });
  });
}

// ==================== ELECTRON INTEGRATION ====================
// Supporto per l'esecuzione in ambiente Electron (applicazione desktop)
let isElectron = false;
let electronAPI = null;

// Verifica se l'app sta girando in Electron
if (typeof window !== 'undefined' && window.electronAPI) {
  isElectron = true;
  electronAPI = window.electronAPI;
  
  // Configura i listener per backup/ripristino tramite Electron
  electronAPI.onExportData((filePath) => {
    exportAllData(filePath);
  });
  
  electronAPI.onImportData((event, data) => {
    importAllData(data);
  });
}

// ==================== SECURITY & ENCRYPTION ====================
// Stato di sicurezza dell'applicazione
let isAppLocked = false;
let encryptionKey = null;
let lockTimer = null;
const AUTO_LOCK_MINUTES = 30; // Auto-lock dopo 30 minuti di inattività

/**
 * Deriva una chiave crittografica dalla password usando PBKDF2
 * @param {string} password - Password inserita dall'utente
 * @param {Uint8Array} salt - Salt per la derivazione (o null per generarne uno nuovo)
 * @returns {Promise<{key: CryptoKey, salt: Uint8Array}>} Chiave e salt
 */
async function deriveKey(password, salt = null) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );
  
  if (!salt) {
    salt = crypto.getRandomValues(new Uint8Array(16));
  }
  
  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
  
  return { key, salt };
}

/**
 * Cripta dati usando AES-GCM
 * @param {string} data - Dati da criptare (stringa JSON)
 * @param {CryptoKey} key - Chiave di crittografia
 * @returns {Promise<string>} Dati criptati in base64 con IV e salt
 */
async function encryptData(data, key) {
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  
  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv },
    key,
    encoder.encode(data)
  );
  
  // Combina IV + encrypted data
  const combined = new Uint8Array(iv.length + encryptedBuffer.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encryptedBuffer), iv.length);
  
  // Converti in base64 per storage (chunk per evitare stack overflow)
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < combined.length; i += chunkSize) {
    const chunk = combined.slice(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

/**
 * Decripta dati usando AES-GCM
 * @param {string} encryptedData - Dati criptati in base64
 * @param {CryptoKey} key - Chiave di decrittografia
 * @returns {Promise<string>} Dati decriptati (stringa JSON)
 */
async function decryptData(encryptedData, key) {
  try {
    // Decodifica da base64
    const binaryString = atob(encryptedData);
    const combined = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      combined[i] = binaryString.charCodeAt(i);
    }
    
    // Separa IV e dati criptati
    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12);
    
    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      encrypted
    );
    
    const decoder = new TextDecoder();
    return decoder.decode(decryptedBuffer);
  } catch (error) {
    throw new Error('Password errata o dati corrotti');
  }
}

// ==================== UTILITY FUNCTIONS ====================
/**
 * Recupera dati dal localStorage con fallback
 * @param {string} key - Chiave dello storage
 * @param {*} fallback - Valore di default se non trovato
 * @returns {*} Dati parsati o fallback
 */
function getStorage(key, fallback) {
  try { 
    const data = localStorage.getItem(key);
    if (!data) return fallback;
    
    // Se l'app è bloccata e i dati sono criptati, non restituirli
    if (isAppLocked && data.startsWith('encrypted:')) {
      return fallback;
    }
    
    return JSON.parse(data) ?? fallback; 
  } catch { 
    return fallback; 
  }
}

/**
 * Salva dati nel localStorage
 * @param {string} key - Chiave dello storage
 * @param {*} val - Valore da salvare
 */
function setStorage(key, val) { 
  localStorage.setItem(key, JSON.stringify(val)); 
}

/**
 * Cripta tutti i dati sensibili e blocca l'applicazione
 * @param {string} password - Password per la crittografia
 * @returns {Promise<boolean>} True se operazione riuscita
 */
async function lockApp(password) {
  try {
    // Verifica che ci sia una password
    if (!password || password.length < 4) {
      alert('La password deve contenere almeno 4 caratteri');
      return false;
    }
    
    // Crea la chiave di crittografia
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const { key } = await deriveKey(password, salt);
    
    // Raccogli tutti i dati da criptare
    const allData = {
      clients: getStorage('clients', []),
      materials: getStorage('materials', []),
      jobs: getStorage('jobs', []),
      quotes: getStorage('quotes', []),
      invoices: getStorage('invoices', []),
      appointments: getStorage('appointments', [])
    };
    
    // Cripta i dati
    const jsonData = JSON.stringify(allData);
    const encrypted = await encryptData(jsonData, key);
    
    // Salva i dati criptati e il salt
    localStorage.setItem('encrypted_data', encrypted);
    let saltBinary = '';
    for (let i = 0; i < salt.length; i++) {
      saltBinary += String.fromCharCode(salt[i]);
    }
    localStorage.setItem('encryption_salt', btoa(saltBinary));
    
    // Rimuovi i dati in chiaro
    localStorage.removeItem('clients');
    localStorage.removeItem('materials');
    localStorage.removeItem('jobs');
    localStorage.removeItem('quotes');
    localStorage.removeItem('invoices');
    localStorage.removeItem('appointments');
    
    // Marca l'app come bloccata
    localStorage.setItem('app_locked', 'true');
    isAppLocked = true;
    encryptionKey = null;
    
    return true;
  } catch (error) {
    console.error('Errore durante il blocco:', error);
    alert('Errore durante il blocco dell\'applicazione');
    return false;
  }
}

/**
 * Decripta i dati e sblocca l'applicazione
 * @param {string} password - Password per la decrittografia
 * @returns {Promise<boolean>} True se operazione riuscita
 */
async function unlockApp(password) {
  try {
    // Recupera salt e dati criptati
    const saltBase64 = localStorage.getItem('encryption_salt');
    const encryptedData = localStorage.getItem('encrypted_data');
    
    if (!saltBase64 || !encryptedData) {
      alert('Nessun dato criptato trovato');
      return false;
    }
    
    // Ricrea la chiave dalla password
    const saltBinary = atob(saltBase64);
    const salt = new Uint8Array(saltBinary.length);
    for (let i = 0; i < saltBinary.length; i++) {
      salt[i] = saltBinary.charCodeAt(i);
    }
    const { key } = await deriveKey(password, salt);
    
    // Decripta i dati
    const decryptedJson = await decryptData(encryptedData, key);
    const allData = JSON.parse(decryptedJson);
    
    // Ripristina i dati in localStorage
    setStorage('clients', allData.clients || []);
    setStorage('materials', allData.materials || []);
    setStorage('jobs', allData.jobs || []);
    setStorage('quotes', allData.quotes || []);
    setStorage('invoices', allData.invoices || []);
    setStorage('appointments', allData.appointments || []);
    
    // Rimuovi i dati criptati
    localStorage.removeItem('encrypted_data');
    localStorage.removeItem('encryption_salt');
    localStorage.removeItem('app_locked');
    
    // Sblocca l'app
    isAppLocked = false;
    encryptionKey = key;
    
    // Avvia il timer di auto-lock
    resetLockTimer();
    
    return true;
  } catch (error) {
    console.error('Errore durante lo sblocco:', error);
    alert('Password errata o dati corrotti');
    return false;
  }
}

/**
 * Resetta il timer di auto-lock
 */
function resetLockTimer() {
  if (lockTimer) {
    clearTimeout(lockTimer);
  }
  
  lockTimer = setTimeout(() => {
    if (!isAppLocked) {
      const shouldLock = confirm('Inattività rilevata. Vuoi bloccare l\'applicazione per sicurezza?');
      if (shouldLock) {
        showLockModal(true);
      }
    }
  }, AUTO_LOCK_MINUTES * 60 * 1000);
}

/**
 * Controlla se l'app è bloccata all'avvio
 */
function checkLockStatus() {
  const locked = localStorage.getItem('app_locked') === 'true';
  if (locked) {
    isAppLocked = true;
    showLockModal(false);
  } else {
    // Avvia il timer di auto-lock se non è bloccata
    resetLockTimer();
    
    // Aggiungi listener per attività utente
    ['click', 'keypress', 'mousemove', 'touchstart'].forEach(event => {
      document.addEventListener(event, resetLockTimer, { passive: true });
    });
  }
}

/**
 * Genera un nuovo ID univoco basato sull'ultimo elemento della lista
 * @param {Array} list - Array di oggetti con proprietà 'id'
 * @returns {number} Nuovo ID incrementale
 */
function uid(list) { 
  return (list.at(-1)?.id ?? 0) + 1; 
}

/**
 * Formatta un numero come valuta Euro
 * @param {number} n - Numero da formattare
 * @returns {string} Stringa formattata (es: "1.234,56 €")
 */
function currency(n) { 
  return Number(n || 0).toLocaleString('it-IT', { 
    style: 'currency', 
    currency: 'EUR' 
  }); 
}

// ==================== BACKUP E RIPRISTINO DATI ====================
/**
 * Crea un oggetto con tutti i dati dell'applicazione per il backup
 * @returns {Object} Oggetto contenente tutti i dati
 */
function createBackupData() {
  return {
    clients: getStorage('clients', []),
    materials: getStorage('materials', []),
    jobs: getStorage('jobs', []),
    quotes: getStorage('quotes', []),
    invoices: getStorage('invoices', []),
    appointments: getStorage('appointments', []),
    exportDate: new Date().toISOString(),
    appVersion: '2.0.0',
    appName: 'HB Impianti'
  };
}

/**
 * Esporta tutti i dati in un file JSON
 * @param {string|null} filePath - Percorso del file (per Electron)
 */
function exportAllData(filePath = null) {
  try {
    const allData = createBackupData();
    const dataString = JSON.stringify(allData, null, 2);
    
    if (isElectron) {
      // Export tramite Electron
      if (filePath) {
        // Export diretto con path specificato
        electronAPI.completeExport(dataString, filePath);
        showNotification('Esportazione in corso...', 'info');
      } else {
        // Export tramite dialog di sistema
        const today = new Date().toISOString().split('T')[0];
        const filename = `HB_Backup_${today}.json`;
        electronAPI.saveBackupData(dataString, filename).then(result => {
          showNotification(
            result.success ? 'Backup esportato!' : 'Errore esportazione', 
            result.success ? 'success' : 'error'
          );
        });
      }
    } else {
      // Browser fallback
      const blob = new Blob([dataString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `HB_Backup_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showNotification('Backup scaricato!', 'success');
    }
  } catch (error) {
    console.error('Errore esportazione:', error);
    showNotification('Errore durante l\'esportazione', 'error');
  }
}

function importAllData(dataString) {
  try {
    const data = JSON.parse(dataString);
    
    // Valida la struttura dei dati
    if (!data.clients || !data.materials || !data.jobs || !data.quotes) {
      throw new Error('Formato file non valido');
    }
    
    // Mostra dialog per scegliere modalità di importazione
    showImportModeDialog(data);
    
  } catch (error) {
    console.error('Errore durante l\'importazione:', error);
    showNotification('Errore durante l\'importazione. Verifica che il file sia valido.', 'error');
  }
}

/**
 * Mostra dialog per scegliere se sovrascrivere o unire i dati
 */
function showImportModeDialog(importData) {
  const existingClients = getStorage('clients', []).length;
  const existingMaterials = getStorage('materials', []).length;
  const existingJobs = getStorage('jobs', []).length;
  const existingQuotes = getStorage('quotes', []).length;
  const existingInvoices = getStorage('invoices', []).length;
  const existingAppointments = getStorage('appointments', []).length;
  
  const importClients = importData.clients.length;
  const importMaterials = importData.materials.length;
  const importJobs = importData.jobs.length;
  const importQuotes = importData.quotes.length;
  const importInvoices = (importData.invoices || []).length;
  const importAppointments = (importData.appointments || []).length;
  
  const hasExistingData = existingClients + existingMaterials + existingJobs + 
                          existingQuotes + existingInvoices + existingAppointments > 0;
  
  let message = `FILE BACKUP:\n`;
  message += `• Clienti: ${importClients}\n`;
  message += `• Materiali: ${importMaterials}\n`;
  message += `• Interventi: ${importJobs}\n`;
  message += `• Preventivi: ${importQuotes}\n`;
  message += `• Fatture: ${importInvoices}\n`;
  message += `• Appuntamenti: ${importAppointments}\n\n`;
  
  if (hasExistingData) {
    message += `DATI ATTUALI:\n`;
    message += `• Clienti: ${existingClients}\n`;
    message += `• Materiali: ${existingMaterials}\n`;
    message += `• Interventi: ${existingJobs}\n`;
    message += `• Preventivi: ${existingQuotes}\n`;
    message += `• Fatture: ${existingInvoices}\n`;
    message += `• Appuntamenti: ${existingAppointments}\n\n`;
    message += `Scegli come importare:\n\n`;
    message += `OK = UNISCI (aggiungi ai dati esistenti)\n`;
    message += `ANNULLA = SOVRASCRIVI (sostituisci tutto)`;
    
    const shouldMerge = window.confirm(message);
    
    if (shouldMerge) {
      mergeImportedData(importData);
    } else {
      // Chiedi conferma per sovrascrittura
      const confirmOverwrite = window.confirm(
        '⚠️ ATTENZIONE!\n\nQuesta operazione CANCELLERÀ tutti i dati esistenti.\n\nSei sicuro di voler continuare?'
      );
      if (confirmOverwrite) {
        overwriteAllData(importData);
      }
    }
  } else {
    // Nessun dato esistente, importa direttamente
    overwriteAllData(importData);
  }
}

/**
 * Unisce i dati importati con quelli esistenti
 */
function mergeImportedData(importData) {
  try {
    // Recupera dati esistenti
    const existingClients = getStorage('clients', []);
    const existingMaterials = getStorage('materials', []);
    const existingJobs = getStorage('jobs', []);
    const existingQuotes = getStorage('quotes', []);
    const existingInvoices = getStorage('invoices', []);
    const existingAppointments = getStorage('appointments', []);
    
    // Trova ID massimi per evitare conflitti
    const maxClientId = Math.max(0, ...existingClients.map(c => c.id));
    const maxMaterialId = Math.max(0, ...existingMaterials.map(m => m.id));
    const maxJobId = Math.max(0, ...existingJobs.map(j => j.id));
    const maxQuoteId = Math.max(0, ...existingQuotes.map(q => q.id));
    const maxInvoiceId = Math.max(0, ...existingInvoices.map(i => i.id));
    const maxAppointmentId = Math.max(0, ...existingAppointments.map(a => a.id));
    
    // Crea mappe per tracciare la corrispondenza degli ID
    const clientIdMap = {};
    const materialIdMap = {};
    const jobIdMap = {};
    const quoteIdMap = {};
    
    // Contatori per statistiche
    let stats = {
      clientsAdded: 0,
      clientsSkipped: 0,
      materialsAdded: 0,
      materialsSkipped: 0,
      jobsAdded: 0,
      jobsSkipped: 0,
      quotesAdded: 0,
      quotesSkipped: 0,
      invoicesAdded: 0,
      invoicesSkipped: 0,
      appointmentsAdded: 0,
      appointmentsSkipped: 0
    };
    
    // Helper: controlla se un cliente esiste già
    function clientExists(newClient, existingList) {
      return existingList.find(c => 
        c.nome?.toLowerCase() === newClient.nome?.toLowerCase() &&
        c.cognome?.toLowerCase() === newClient.cognome?.toLowerCase() &&
        c.telefono === newClient.telefono
      );
    }
    
    // Helper: controlla se un materiale esiste già
    function materialExists(newMaterial, existingList) {
      return existingList.find(m => 
        m.descrizione?.toLowerCase() === newMaterial.descrizione?.toLowerCase() &&
        Math.abs((m.prezzo || 0) - (newMaterial.prezzo || 0)) < 0.01
      );
    }
    
    // Helper: controlla se un intervento esiste già (stesso cliente, data, descrizione)
    function jobExists(newJob, existingList, clientIdMapping) {
      const mappedClientId = clientIdMapping[newJob.clientId] || newJob.clientId;
      return existingList.find(j => 
        j.clientId === mappedClientId &&
        j.data === newJob.data &&
        j.descrizione?.toLowerCase() === newJob.descrizione?.toLowerCase()
      );
    }
    
    // Helper: controlla se un preventivo esiste già (stesso numero o stesso cliente + data)
    function quoteExists(newQuote, existingList, clientIdMapping) {
      const mappedClientId = clientIdMapping[newQuote.clientId] || newQuote.clientId;
      return existingList.find(q => 
        q.numero === newQuote.numero ||
        (q.clientId === mappedClientId && q.data === newQuote.data)
      );
    }
    
    // Helper: controlla se una fattura esiste già (stesso numero)
    function invoiceExists(newInvoice, existingList) {
      return existingList.find(i => i.numero === newInvoice.numero);
    }
    
    // Helper: controlla se un appuntamento esiste già (stesso cliente, data, ora)
    function appointmentExists(newAppointment, existingList, clientIdMapping) {
      const mappedClientId = clientIdMapping[newAppointment.clientId] || newAppointment.clientId;
      return existingList.find(a => 
        a.clientId === mappedClientId &&
        a.data === newAppointment.data &&
        a.ora === newAppointment.ora
      );
    }
    
    // Unisci clienti (evitando duplicati)
    let newClientId = maxClientId + 1;
    const mergedClients = [...existingClients];
    importData.clients.forEach(client => {
      const existing = clientExists(client, mergedClients);
      if (existing) {
        // Cliente già esistente, mappa il vecchio ID al nuovo
        clientIdMap[client.id] = existing.id;
        stats.clientsSkipped++;
      } else {
        // Nuovo cliente, aggiungilo
        const oldId = client.id;
        const newClient = { ...client, id: newClientId };
        clientIdMap[oldId] = newClientId;
        mergedClients.push(newClient);
        newClientId++;
        stats.clientsAdded++;
      }
    });
    
    // Unisci materiali (evitando duplicati)
    let newMaterialId = maxMaterialId + 1;
    const mergedMaterials = [...existingMaterials];
    importData.materials.forEach(material => {
      const existing = materialExists(material, mergedMaterials);
      if (existing) {
        // Materiale già esistente
        materialIdMap[material.id] = existing.id;
        stats.materialsSkipped++;
      } else {
        // Nuovo materiale
        const oldId = material.id;
        const newMaterial = { ...material, id: newMaterialId };
        materialIdMap[oldId] = newMaterialId;
        mergedMaterials.push(newMaterial);
        newMaterialId++;
        stats.materialsAdded++;
      }
    });
    
    // Unisci interventi (evitando duplicati, aggiornando riferimenti clientId)
    let newJobId = maxJobId + 1;
    const mergedJobs = [...existingJobs];
    importData.jobs.forEach(job => {
      const existing = jobExists(job, mergedJobs, clientIdMap);
      if (existing) {
        // Intervento già esistente
        jobIdMap[job.id] = existing.id;
        stats.jobsSkipped++;
      } else {
        // Nuovo intervento
        const oldId = job.id;
        const newJob = { 
          ...job, 
          id: newJobId,
          clientId: clientIdMap[job.clientId] || job.clientId
        };
        jobIdMap[oldId] = newJobId;
        mergedJobs.push(newJob);
        newJobId++;
        stats.jobsAdded++;
      }
    });
    
    // Unisci preventivi (evitando duplicati, aggiornando riferimenti)
    let newQuoteId = maxQuoteId + 1;
    const mergedQuotes = [...existingQuotes];
    importData.quotes.forEach(quote => {
      const existing = quoteExists(quote, mergedQuotes, clientIdMap);
      if (existing) {
        // Preventivo già esistente
        quoteIdMap[quote.id] = existing.id;
        stats.quotesSkipped++;
      } else {
        // Nuovo preventivo
        const oldId = quote.id;
        const newQuote = { 
          ...quote, 
          id: newQuoteId,
          clientId: clientIdMap[quote.clientId] || quote.clientId,
          items: (quote.items || []).map(item => ({
            ...item,
            materialId: materialIdMap[item.materialId] || item.materialId
          }))
        };
        quoteIdMap[oldId] = newQuoteId;
        mergedQuotes.push(newQuote);
        newQuoteId++;
        stats.quotesAdded++;
      }
    });
    
    // Unisci fatture (evitando duplicati, aggiornando riferimenti)
    let newInvoiceId = maxInvoiceId + 1;
    const mergedInvoices = [...existingInvoices];
    (importData.invoices || []).forEach(invoice => {
      const existing = invoiceExists(invoice, mergedInvoices);
      if (existing) {
        // Fattura già esistente (stesso numero)
        stats.invoicesSkipped++;
      } else {
        // Nuova fattura
        const newInvoice = { 
          ...invoice, 
          id: newInvoiceId,
          clientId: clientIdMap[invoice.clientId] || invoice.clientId,
          jobId: jobIdMap[invoice.jobId] || invoice.jobId
        };
        mergedInvoices.push(newInvoice);
        newInvoiceId++;
        stats.invoicesAdded++;
      }
    });
    
    // Unisci appuntamenti (evitando duplicati, aggiornando riferimenti)
    let newAppointmentId = maxAppointmentId + 1;
    const mergedAppointments = [...existingAppointments];
    (importData.appointments || []).forEach(appointment => {
      const existing = appointmentExists(appointment, mergedAppointments, clientIdMap);
      if (existing) {
        // Appuntamento già esistente
        stats.appointmentsSkipped++;
      } else {
        // Nuovo appuntamento
        const newAppointment = { 
          ...appointment, 
          id: newAppointmentId,
          clientId: clientIdMap[appointment.clientId] || appointment.clientId
        };
        mergedAppointments.push(newAppointment);
        newAppointmentId++;
        stats.appointmentsAdded++;
      }
    });
    
    // Salva i dati uniti
    setStorage('clients', mergedClients);
    setStorage('materials', mergedMaterials);
    setStorage('jobs', mergedJobs);
    setStorage('quotes', mergedQuotes);
    setStorage('invoices', mergedInvoices);
    setStorage('appointments', mergedAppointments);
    
    // Aggiorna variabili globali
    clients = mergedClients;
    materials = mergedMaterials;
    jobs = mergedJobs;
    quotes = mergedQuotes;
    invoices = mergedInvoices;
    appointments = mergedAppointments;
    
    // Ricarica la vista
    const activeTab = document.querySelector('.tab.active');
    if (activeTab) {
      showTab(activeTab.dataset.tab);
    }
    
    // Mostra statistiche dettagliate
    const totalAdded = stats.clientsAdded + stats.materialsAdded + stats.jobsAdded + 
                       stats.quotesAdded + stats.invoicesAdded + stats.appointmentsAdded;
    const totalSkipped = stats.clientsSkipped + stats.materialsSkipped + stats.jobsSkipped + 
                         stats.quotesSkipped + stats.invoicesSkipped + stats.appointmentsSkipped;
    
    let message = `✅ Unione completata!\n\n`;
    message += `📊 AGGIUNTI:\n`;
    if (stats.clientsAdded > 0) message += `• Clienti: ${stats.clientsAdded}\n`;
    if (stats.materialsAdded > 0) message += `• Materiali: ${stats.materialsAdded}\n`;
    if (stats.jobsAdded > 0) message += `• Interventi: ${stats.jobsAdded}\n`;
    if (stats.quotesAdded > 0) message += `• Preventivi: ${stats.quotesAdded}\n`;
    if (stats.invoicesAdded > 0) message += `• Fatture: ${stats.invoicesAdded}\n`;
    if (stats.appointmentsAdded > 0) message += `• Appuntamenti: ${stats.appointmentsAdded}\n`;
    
    if (totalSkipped > 0) {
      message += `\n⏭️ DUPLICATI SALTATI:\n`;
      if (stats.clientsSkipped > 0) message += `• Clienti: ${stats.clientsSkipped}\n`;
      if (stats.materialsSkipped > 0) message += `• Materiali: ${stats.materialsSkipped}\n`;
      if (stats.jobsSkipped > 0) message += `• Interventi: ${stats.jobsSkipped}\n`;
      if (stats.quotesSkipped > 0) message += `• Preventivi: ${stats.quotesSkipped}\n`;
      if (stats.invoicesSkipped > 0) message += `• Fatture: ${stats.invoicesSkipped}\n`;
      if (stats.appointmentsSkipped > 0) message += `• Appuntamenti: ${stats.appointmentsSkipped}\n`;
    }
    
    message += `\n📈 Totale: +${totalAdded} elementi`;
    
    alert(message);
    showNotification(`Dati uniti: +${totalAdded} nuovi, ${totalSkipped} duplicati saltati`, 'success');
    
  } catch (error) {
    console.error('Errore durante l\'unione:', error);
    showNotification('Errore durante l\'unione dei dati', 'error');
  }
}

/**
 * Sovrascrive tutti i dati esistenti
 */
function overwriteAllData(importData) {
  try {
    // Ripristina tutti i dati
    setStorage('clients', importData.clients);
    setStorage('materials', importData.materials);
    setStorage('jobs', importData.jobs);
    setStorage('quotes', importData.quotes);
    setStorage('invoices', importData.invoices || []);
    setStorage('appointments', importData.appointments || []);
    
    // Aggiorna le variabili globali
    clients = importData.clients;
    materials = importData.materials;
    jobs = importData.jobs;
    quotes = importData.quotes;
    invoices = importData.invoices || [];
    appointments = importData.appointments || [];
    
    // Ricarica la vista corrente
    const activeTab = document.querySelector('.tab.active');
    if (activeTab) {
      showTab(activeTab.dataset.tab);
    }
    
    showNotification('✅ Dati sovrascritti con successo!', 'success');
  } catch (error) {
    console.error('Errore durante la sovrascrittura:', error);
    showNotification('Errore durante la sovrascrittura', 'error');
  }
}

function showNotification(message, type = 'info') {
  // Crea notifica toast
  const notification = document.createElement('div');
  notification.className = `toast toast-${type}`;
  notification.innerHTML = `
    <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-triangle' : 'info-circle'}"></i>
    <span>${message}</span>
  `;
  
  // Stili inline per la notifica
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: var(--surface);
    color: var(--text);
    padding: 16px 20px;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    box-shadow: var(--shadow);
    backdrop-filter: blur(var(--blur));
    z-index: 10000;
    display: flex;
    align-items: center;
    gap: 12px;
    max-width: 400px;
    animation: slideInRight 0.3s ease;
    border-left: 4px solid ${type === 'success' ? 'var(--success)' : type === 'error' ? 'var(--danger)' : 'var(--accent)'};
  `;
  
  document.body.appendChild(notification);
  
  // Rimuovi dopo 4 secondi
  setTimeout(() => {
    notification.style.animation = 'slideOutRight 0.3s ease';
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  }, 4000);
}

// Funzioni per la gestione delle date in formato italiano
function formatDateIT(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleDateString('it-IT', { 
    day: '2-digit', 
    month: '2-digit', 
    year: 'numeric'
  });
}

function getCurrentDateIT() {
  return new Date().toLocaleDateString('it-IT', { 
    day: '2-digit', 
    month: '2-digit', 
    year: 'numeric'
  });
}

// Funzione per aggiornare i totali negli interventi
function updateTotals() {
  const ore = Number(document.getElementById('j_ore')?.value || 0);
  const tariffa = Number(document.getElementById('j_tariffa')?.value || 0);
  const sconto = Number(document.getElementById('j_sconto')?.value || 0);
  const iva = Number(document.getElementById('j_iva')?.value || 0);
  
  const subtotale = ore * tariffa - sconto;
  const totale = subtotale * (1 + iva / 100);
  
  const totaliDiv = document.getElementById('j_totali');
  if (totaliDiv) {
    totaliDiv.innerHTML = `Subtotale: ${currency(subtotale)} | Totale (IVA inclusa): ${currency(totale)}`;
  }
}

// Funzione per configurare il campo data
function setupDateInput() {
  const dateInput = document.getElementById('j_data');
  if (!dateInput) return;
  
  // Imposta la data odierna come default se il campo è vuoto
  if (!dateInput.value) {
    const today = new Date();
    const formattedDate = today.toISOString().split('T')[0];
    dateInput.value = formattedDate;
  }
  
  // Apri automaticamente il calendario quando il campo viene cliccato
  dateInput.addEventListener('click', function() {
    this.showPicker();
  });
  
  // Aggiungi effetto focus migliorato
  dateInput.addEventListener('focus', function() {
    this.classList.add('date-focused');
    // Prova ad aprire il picker anche al focus
    setTimeout(() => {
      try {
        this.showPicker();
      } catch (e) {
        // showPicker() non è supportato in tutti i browser, ignora l'errore
        console.log('showPicker() non supportato in questo browser');
      }
    }, 100);
  });
  
  dateInput.addEventListener('blur', function() {
    this.classList.remove('date-focused');
  });
  
  // Aggiorna i totali quando cambiano i valori numerici
  ['j_ore', 'j_tariffa', 'j_sconto', 'j_iva'].forEach(id => {
    const element = document.getElementById(id);
    if (element) {
      element.addEventListener('input', updateTotals);
      element.addEventListener('change', updateTotals);
    }
  });
  
  // Calcola i totali iniziali
  updateTotals();
}

// ---------- Charts ----------
let paymentChart, revenueChart, trendsChart;

function initializeCharts(jobs, incassati, pending, total, pendingValue) {
  // Distruggi grafici esistenti se presenti
  if (paymentChart) paymentChart.destroy();
  if (revenueChart) revenueChart.destroy();
  if (trendsChart) trendsChart.destroy();

  // Grafico a torta per lo stato dei pagamenti
  const paymentCtx = document.getElementById('paymentChart');
  if (paymentCtx) {
    paymentChart = new Chart(paymentCtx, {
      type: 'doughnut',
      data: {
        labels: ['Pagati', 'In Attesa'],
        datasets: [{
          data: [incassati, pending],
          backgroundColor: ['#3fb950', '#f0883e'],
          borderColor: ['#2d8f3f', '#e65100'],
          borderWidth: 2,
          hoverOffset: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: '#e6edf3',
              padding: 20,
              usePointStyle: true
            }
          }
        }
      }
    });
  }

  // Grafico a barre per il fatturato
  const revenueCtx = document.getElementById('revenueChart');
  if (revenueCtx) {
    const monthlyData = getMonthlyRevenue(jobs);
    revenueChart = new Chart(revenueCtx, {
      type: 'bar',
      data: {
        labels: monthlyData.labels,
        datasets: [{
          label: 'Fatturato (€)',
          data: monthlyData.values,
          backgroundColor: 'rgba(88, 166, 255, 0.8)',
          borderColor: '#58a6ff',
          borderWidth: 2,
          borderRadius: 8,
          borderSkipped: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              color: '#8b949e',
              callback: function(value) {
                return value.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
              }
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.1)'
            }
          },
          x: {
            ticks: {
              color: '#8b949e'
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.1)'
            }
          }
        }
      }
    });
  }

  // Grafico lineare per i trend
  const trendsCtx = document.getElementById('trendsChart');
  if (trendsCtx) {
    const trendsData = getTrendsData(jobs);
    trendsChart = new Chart(trendsCtx, {
      type: 'line',
      data: {
        labels: trendsData.labels,
        datasets: [
          {
            label: 'Interventi Totali',
            data: trendsData.total,
            borderColor: '#58a6ff',
            backgroundColor: 'rgba(88, 166, 255, 0.1)',
            borderWidth: 3,
            fill: true,
            tension: 0.4
          },
          {
            label: 'Interventi Pagati',
            data: trendsData.paid,
            borderColor: '#3fb950',
            backgroundColor: 'rgba(63, 185, 80, 0.1)',
            borderWidth: 3,
            fill: false,
            tension: 0.4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            labels: {
              color: '#e6edf3',
              padding: 20,
              usePointStyle: true
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              color: '#8b949e'
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.1)'
            }
          },
          x: {
            ticks: {
              color: '#8b949e'
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.1)'
            }
          }
        }
      }
    });
  }
}

function getMonthlyRevenue(jobs) {
  const monthlyRevenue = {};
  const months = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
  
  // Inizializza tutti i mesi a 0
  months.forEach(month => monthlyRevenue[month] = 0);
  
  jobs.forEach(job => {
    if (job.data) {
      const date = new Date(job.data);
      const monthName = months[date.getMonth()];
      const revenue = (job.ore * job.tariffa - job.sconto) * (1 + job.iva / 100);
      monthlyRevenue[monthName] += revenue;
    }
  });
  
  return {
    labels: months,
    values: Object.values(monthlyRevenue)
  };
}

function getTrendsData(jobs) {
  const trendsData = {};
  const months = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
  
  // Inizializza tutti i mesi
  months.forEach(month => {
    trendsData[month] = { total: 0, paid: 0 };
  });
  
  jobs.forEach(job => {
    if (job.data) {
      const date = new Date(job.data);
      const monthName = months[date.getMonth()];
      trendsData[monthName].total++;
      if (job.pagato) {
        trendsData[monthName].paid++;
      }
    }
  });
  
  return {
    labels: months,
    total: Object.values(trendsData).map(d => d.total),
    paid: Object.values(trendsData).map(d => d.paid)
  };
}

// ---------- Stato ----------
let clients = getStorage("clients", []);
let materials = getStorage("materials", []);
let jobs = getStorage("jobs", []);
let quotes = getStorage("quotes", []);
let invoices = getStorage("invoices", []);
let appointments = getStorage("appointments", []);
let currentQuoteItems = [];

// Applica classe Electron al body se siamo in Electron
if (isElectron) {
  document.addEventListener('DOMContentLoaded', () => {
    document.body.classList.add('electron');
  });
}

// ---------- Tabs ----------
const tabs = document.querySelectorAll(".tab");
const mobileMenuItems = document.querySelectorAll(".mobile-menu-item");
const content = document.getElementById("content");

// Gestione tabs desktop
tabs.forEach(tab => {
  tab.addEventListener("click", () => {
    tabs.forEach(t => t.classList.remove("active"));
    mobileMenuItems.forEach(m => m.classList.remove("active"));
    tab.classList.add("active");
    // Sincronizza con il menu mobile
    const mobileItem = document.querySelector(`.mobile-menu-item[data-tab="${tab.dataset.tab}"]`);
    if (mobileItem) mobileItem.classList.add("active");
    showTab(tab.dataset.tab);
  });
});

// Gestione menu mobile
mobileMenuItems.forEach(item => {
  item.addEventListener("click", () => {
    tabs.forEach(t => t.classList.remove("active"));
    mobileMenuItems.forEach(m => m.classList.remove("active"));
    item.classList.add("active");
    // Sincronizza con le tabs desktop
    const desktopTab = document.querySelector(`.tab[data-tab="${item.dataset.tab}"]`);
    if (desktopTab) desktopTab.classList.add("active");
    showTab(item.dataset.tab);
    // Chiudi il menu dopo la selezione
    closeMobileMenu();
  });
});

// ---------- Menu Mobile Hamburger ----------
function initializeMobileMenu() {
  const mobileMenuToggle = document.getElementById('mobileMenuToggle');
  const mobileMenuDropdown = document.getElementById('mobileMenuDropdown');
  
  if (mobileMenuToggle && mobileMenuDropdown) {
    mobileMenuToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMobileMenu();
    });
    
    // Chiudi menu quando si clicca fuori
    document.addEventListener('click', (e) => {
      if (!mobileMenuDropdown.contains(e.target) && !mobileMenuToggle.contains(e.target)) {
        closeMobileMenu();
      }
    });
    
    // Impedisci che il click sul dropdown chiuda il menu
    mobileMenuDropdown.addEventListener('click', (e) => {
      e.stopPropagation();
    });
  }
}

function toggleMobileMenu() {
  const dropdown = document.getElementById('mobileMenuDropdown');
  const toggle = document.getElementById('mobileMenuToggle');
  
  if (dropdown && toggle) {
    dropdown.classList.toggle('show');
    
    // Cambia icona hamburger
    const icon = toggle.querySelector('i');
    if (dropdown.classList.contains('show')) {
      icon.className = 'fas fa-times';
    } else {
      icon.className = 'fas fa-bars';
    }
  }
}

function closeMobileMenu() {
  const dropdown = document.getElementById('mobileMenuDropdown');
  const toggle = document.getElementById('mobileMenuToggle');
  
  if (dropdown && toggle) {
    dropdown.classList.remove('show');
    const icon = toggle.querySelector('i');
    icon.className = 'fas fa-bars';
  }
}

// Inizializza il menu mobile quando il DOM è pronto
document.addEventListener('DOMContentLoaded', initializeMobileMenu);

function showTab(name) {
  if (name === "dashboard") renderDashboard();
  if (name === "clienti") renderClients();
  if (name === "materiali") renderMaterials();
  if (name === "interventi") renderJobs();
  if (name === "preventivi") renderQuotes();
  if (name === "calendario") renderCalendar();
  if (name === "fatture") renderInvoices();
}

// ---------- Render Dashboard ----------
function renderDashboard() {
  const total = jobs.reduce((acc, j) => (acc + (j.ore * j.tariffa - j.sconto) * (1 + j.iva / 100)), 0);
  const incassati = jobs.filter(j => j.pagato).length;
  const pending = jobs.length - incassati;
  const pendingValue = jobs.filter(j => !j.pagato).reduce((acc, j) => (acc + (j.ore * j.tariffa - j.sconto) * (1 + j.iva / 100)), 0);

  content.innerHTML = `
    <div class="row">
      <div class="card dashboard-stat">
        <div class="stat-icon">
          <i class="fas fa-clipboard-list"></i>
        </div>
        <div class="stat-content">
          <div class="stat-number">${jobs.length}</div>
          <div class="stat-label">Interventi Totali</div>
        </div>
      </div>
      
      <div class="card dashboard-stat">
        <div class="stat-icon success">
          <i class="fas fa-check-circle"></i>
        </div>
        <div class="stat-content">
          <div class="stat-number">${incassati}</div>
          <div class="stat-label">Interventi Pagati</div>
        </div>
      </div>
      
      <div class="card dashboard-stat">
        <div class="stat-icon warning">
          <i class="fas fa-clock"></i>
        </div>
        <div class="stat-content">
          <div class="stat-number">${pending}</div>
          <div class="stat-label">In Attesa Pagamento</div>
        </div>
      </div>
    </div>

    <div class="row">
      <div class="card dashboard-stat">
        <div class="stat-icon primary">
          <i class="fas fa-euro-sign"></i>
        </div>
        <div class="stat-content">
          <div class="stat-number">${currency(total)}</div>
          <div class="stat-label">Valore Totale</div>
        </div>
      </div>
      
      <div class="card dashboard-stat">
        <div class="stat-icon warning">
          <i class="fas fa-exclamation-triangle"></i>
        </div>
        <div class="stat-content">
          <div class="stat-number">${currency(pendingValue)}</div>
          <div class="stat-label">Da Incassare</div>
        </div>
      </div>
      
      <div class="card dashboard-stat">
        <div class="stat-icon">
          <i class="fas fa-users"></i>
        </div>
        <div class="stat-content">
          <div class="stat-number">${clients.length}</div>
          <div class="stat-label">Clienti Registrati</div>
        </div>
      </div>
    </div>

    <!-- Sezione Grafici -->
    <div class="row">
      <div class="card chart-container">
        <div class="card-header">
          <h3><i class="fas fa-chart-pie"></i> Stato Pagamenti</h3>
        </div>
        <canvas id="paymentChart" width="400" height="400"></canvas>
      </div>
      
      <div class="card chart-container">
        <div class="card-header">
          <h3><i class="fas fa-chart-bar"></i> Fatturato Mensile</h3>
        </div>
        <canvas id="revenueChart" width="400" height="400"></canvas>
      </div>
    </div>

    <div class="card chart-container">
      <div class="card-header">
        <h3><i class="fas fa-chart-area"></i> Trend Interventi</h3>
      </div>
      <canvas id="trendsChart" width="800" height="400"></canvas>
    </div>`;

  // Inizializza i grafici dopo un breve delay per permettere al DOM di caricarsi
  setTimeout(() => {
    initializeCharts(jobs, incassati, pending, total, pendingValue);
  }, 100);
}

// ---------- Render Clients ----------
function renderClients() {
  content.innerHTML = `
    <div class="card">
      <div class="row two-cols">
        <div><label class="required">Nome</label><input id="c_nome" required></div>
        <div><label class="required">Cognome</label><input id="c_cognome" required></div>
      </div>
      <div class="row">
        <div><label>Email</label><input id="c_email" type="email"></div>
        <div><label class="required">Telefono</label><input id="c_tel" required></div>
      </div>

      <div class="button-group">
        <button id="addClient" class="primary"><i class="fa-solid fa-plus"></i> Aggiungi</button>
        <button id="exportClients" class="pdf"><i class="fa-solid fa-file-pdf"></i> Esporta PDF</button>
      </div>

      <div class="search-container" style="margin: 20px 0;">
        <div class="search-field">
          <i class="fas fa-search"></i>
          <input type="text" id="searchClients" placeholder="Cerca clienti per nome, cognome, email o telefono...">
          <button id="clearSearchClients" class="clear-search" title="Cancella ricerca">
            <i class="fas fa-times"></i>
          </button>
        </div>
      </div>

      <div class="table-container">
        <table id="clientTable" style="margin-top:14px">
          <thead><tr><th>ID</th><th>Nome</th><th class="mobile-hide">Email</th><th>Telefono</th><th>Azioni</th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </div>`;

  const tbody = document.querySelector("#clientTable tbody");
  updateClientsTable(tbody);

  // Ricerca clienti
  let filteredClients = [...clients];
  
  document.getElementById("searchClients").oninput = function() {
    const searchTerm = this.value.toLowerCase();
    if (searchTerm === '') {
      filteredClients = [...clients];
    } else {
      filteredClients = clients.filter(client => 
        client.nome.toLowerCase().includes(searchTerm) ||
        client.cognome.toLowerCase().includes(searchTerm) ||
        client.email.toLowerCase().includes(searchTerm) ||
        client.telefono.toLowerCase().includes(searchTerm)
      );
    }
    updateClientsTable(tbody, filteredClients);
  };

  document.getElementById("clearSearchClients").onclick = () => {
    document.getElementById("searchClients").value = '';
    filteredClients = [...clients];
    updateClientsTable(tbody, filteredClients);
  };

  document.getElementById("addClient").onclick = () => {
    const nome = c_nome.value.trim();
    const cognome = c_cognome.value.trim();
    const telefono = c_tel.value.trim();
    
    // Validazione campi obbligatori
    if (!nome) {
      alert("⚠️ Il campo Nome è obbligatorio!");
      c_nome.focus();
      return;
    }
    if (!cognome) {
      alert("⚠️ Il campo Cognome è obbligatorio!");
      c_cognome.focus();
      return;
    }
    if (!telefono) {
      alert("⚠️ Il campo Telefono è obbligatorio!");
      c_tel.focus();
      return;
    }
    
    clients.push({
      id: uid(clients),
      nome: nome,
      cognome: cognome,
      email: c_email.value.trim(),
      telefono: telefono
    });
    setStorage("clients", clients);
    renderClients();
  };

  document.getElementById("exportClients").onclick = () => exportToPDF("Clienti", "clientTable");
}

function updateClientsTable(tbody, clientsToShow = clients) {
  tbody.innerHTML = clientsToShow.map(c => {
    const clientJobs = jobs.filter(j => j.clienteId === c.id);
    const totalValue = clientJobs.reduce((sum, j) => sum + (j.ore * j.tariffa - j.sconto) * (1 + j.iva / 100), 0);
    const lastJob = clientJobs.sort((a, b) => new Date(b.data) - new Date(a.data))[0];
    
    return `
    <tr>
      <td>${c.id}</td>
      <td>
        <div class="client-info">
          <strong>${c.nome} ${c.cognome}</strong>
          <div class="client-stats">
            ${clientJobs.length} interventi • ${currency(totalValue)}
            ${lastJob ? `• Ultimo: ${formatDateIT(lastJob.data)}` : ''}
          </div>
        </div>
      </td>
      <td class="mobile-hide">${c.email}</td>
      <td>${c.telefono}</td>
      <td>
        <div class="action-buttons">
          <button onclick="viewClientHistory(${c.id})" class="primary" title="Storico"><i class="fas fa-history"></i></button>
          <button onclick="editClient(${c.id})" class="edit"><i class="fa-solid fa-edit"></i></button>
          <button onclick="deleteClient(${c.id})" class="delete"><i class="fa-solid fa-trash"></i></button>
        </div>
      </td>
    </tr>`;
  }).join("");
}
function editClient(id) {
  const client = clients.find(c => c.id === id);
  if (!client) return;
  
  // Popola i campi con i dati esistenti
  document.getElementById('c_nome').value = client.nome || '';
  document.getElementById('c_cognome').value = client.cognome || '';
  document.getElementById('c_email').value = client.email || '';
  document.getElementById('c_tel').value = client.telefono || '';
  
  // Cambia il bottone Aggiungi in Salva Modifiche
  const addButton = document.getElementById('addClient');
  addButton.innerHTML = '<i class="fa-solid fa-save"></i> Salva Modifiche';
  addButton.className = 'success';
  addButton.onclick = () => {
    // Aggiorna il cliente esistente
    const clientIndex = clients.findIndex(c => c.id === id);
    if (clientIndex !== -1) {
      clients[clientIndex] = {
        id: id,
        nome: document.getElementById('c_nome').value,
        cognome: document.getElementById('c_cognome').value,
        email: document.getElementById('c_email').value,
        telefono: document.getElementById('c_tel').value
      };
      setStorage("clients", clients);
      
      // Reset del form e del bottone
      document.getElementById('c_nome').value = '';
      document.getElementById('c_cognome').value = '';
      document.getElementById('c_email').value = '';
      document.getElementById('c_tel').value = '';
      
      renderClients(); // Ricarica la vista
    }
  };
  
  // Scrolla verso l'alto per mostrare il form
  document.querySelector('.card').scrollIntoView({ behavior: 'smooth' });
}

function deleteClient(id) {
  if (confirm('Sei sicuro di voler eliminare questo cliente?')) {
    clients = clients.filter(c => c.id !== id);
    setStorage("clients", clients);
    renderClients();
  }
}

// ---------- Render Materials ----------
function renderMaterials() {
  content.innerHTML = `
    <div class="card">
      <div class="row">
        <div><label class="required">Descrizione</label><input id="m_descr" required></div>
        <div><label>Q.tà</label><input id="m_qta" type="number"></div>
        <div><label>Costo Unit.</label><input id="m_costo" type="number"></div>
        <div><label class="required">Prezzo Unit.</label><input id="m_prezzo" type="number" required></div>
        <div><label>IVA %</label><input id="m_iva" type="number" value="22"></div>
      </div>

      <div class="button-group">
        <button id="addMaterial" class="primary"><i class="fa-solid fa-plus"></i> Aggiungi</button>
        <button id="exportMaterials" class="pdf"><i class="fa-solid fa-file-pdf"></i> Esporta PDF</button>
      </div>

      <div class="search-container" style="margin: 20px 0;">
        <div class="search-field">
          <i class="fas fa-search"></i>
          <input type="text" id="searchMaterials" placeholder="Cerca materiali per descrizione...">
          <button id="clearSearchMaterials" class="clear-search" title="Cancella ricerca">
            <i class="fas fa-times"></i>
          </button>
        </div>
      </div>

      <div class="table-container">
        <table id="materialTable" style="margin-top:14px">
          <thead><tr><th>ID</th><th>Descrizione</th><th class="right mobile-hide">Q.tà</th><th class="right mobile-hide">Costo</th><th class="right">Prezzo</th><th class="right mobile-hide">IVA%</th><th>Azioni</th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </div>`;

  const tbody = document.querySelector("#materialTable tbody");
  updateMaterialsTable(tbody);

  // Ricerca materiali
  let filteredMaterials = [...materials];
  
  document.getElementById("searchMaterials").oninput = function() {
    const searchTerm = this.value.toLowerCase();
    if (searchTerm === '') {
      filteredMaterials = [...materials];
    } else {
      filteredMaterials = materials.filter(material => 
        material.descrizione.toLowerCase().includes(searchTerm)
      );
    }
    updateMaterialsTable(tbody, filteredMaterials);
  };

  document.getElementById("clearSearchMaterials").onclick = () => {
    document.getElementById("searchMaterials").value = '';
    filteredMaterials = [...materials];
    updateMaterialsTable(tbody, filteredMaterials);
  };

  document.getElementById("addMaterial").onclick = () => {
    const descrizione = m_descr.value.trim();
    const prezzo = m_prezzo.value.trim();
    
    // Validazione campi obbligatori
    if (!descrizione) {
      alert("⚠️ Il campo Descrizione è obbligatorio!");
      m_descr.focus();
      return;
    }
    if (!prezzo || isNaN(Number(prezzo))) {
      alert("⚠️ Il campo Prezzo Unitario è obbligatorio e deve essere un numero!");
      m_prezzo.focus();
      return;
    }
    
    materials.push({
      id: uid(materials),
      descrizione: descrizione,
      qta: Number(m_qta.value || 0),
      costo: Number(m_costo.value || 0),
      prezzo: Number(prezzo),
      iva: Number(m_iva.value || 22)
    });
    setStorage("materials", materials);
    renderMaterials();
  };

  document.getElementById("exportMaterials").onclick = () => exportToPDF("Materiali", "materialTable");
}

function updateMaterialsTable(tbody, materialsToShow = materials) {
  tbody.innerHTML = materialsToShow.map(m => `
    <tr>
      <td>${m.id}</td>
      <td>${m.descrizione}</td>
      <td class="right mobile-hide">${m.qta}</td>
      <td class="right mobile-hide">${currency(m.costo)}</td>
      <td class="right">${currency(m.prezzo)}</td>
      <td class="right mobile-hide">${m.iva}</td>
      <td>
        <div class="action-buttons">
          <button onclick="editMaterial(${m.id})" class="edit"><i class="fa-solid fa-edit"></i></button>
          <button onclick="deleteMaterial(${m.id})" class="delete"><i class="fa-solid fa-trash"></i></button>
        </div>
      </td>
    </tr>`).join("");
}
function editMaterial(id) {
  const material = materials.find(m => m.id === id);
  if (!material) return;
  
  // Popola i campi con i dati esistenti
  document.getElementById('m_descr').value = material.descrizione || '';
  document.getElementById('m_qta').value = material.qta || '';
  document.getElementById('m_costo').value = material.costo || '';
  document.getElementById('m_prezzo').value = material.prezzo || '';
  document.getElementById('m_iva').value = material.iva || '';
  
  // Cambia il bottone Aggiungi in Salva Modifiche
  const addButton = document.getElementById('addMaterial');
  addButton.innerHTML = '<i class="fa-solid fa-save"></i> Salva Modifiche';
  addButton.className = 'success';
  addButton.onclick = () => {
    // Aggiorna il materiale esistente
    const materialIndex = materials.findIndex(m => m.id === id);
    if (materialIndex !== -1) {
      materials[materialIndex] = {
        id: id,
        descrizione: document.getElementById('m_descr').value,
        qta: +document.getElementById('m_qta').value,
        costo: +document.getElementById('m_costo').value,
        prezzo: +document.getElementById('m_prezzo').value,
        iva: +document.getElementById('m_iva').value
      };
      setStorage("materials", materials);
      
      // Reset del form e del bottone
      document.getElementById('m_descr').value = '';
      document.getElementById('m_qta').value = '';
      document.getElementById('m_costo').value = '';
      document.getElementById('m_prezzo').value = '';
      document.getElementById('m_iva').value = '22';
      
      renderMaterials(); // Ricarica la vista
    }
  };
  
  // Scrolla verso l'alto per mostrare il form
  document.querySelector('.card').scrollIntoView({ behavior: 'smooth' });
}

function deleteMaterial(id) {
  if (confirm('Sei sicuro di voler eliminare questo materiale?')) {
    materials = materials.filter(m => m.id !== id);
    setStorage("materials", materials);
    renderMaterials();
  }
}

// ---------- Render Jobs ----------
function renderJobs() {
  content.innerHTML = `
    <div class="card">
      <div class="row">
        <div><label class="required">Data</label><input id="j_data" type="date" placeholder="Seleziona data" required></div>
        <div>
          <label class="required">Cliente</label>
          <select id="j_cliente" required><option value="">Seleziona...</option>
            ${clients.map(c=>`<option value="${c.id}">${c.id} - ${c.nome} ${c.cognome}</option>`).join("")}
          </select>
        </div>
        <div><label>Luogo</label><input id="j_luogo" placeholder="Indirizzo intervento"></div>
      </div>
      
      <div class="row">
        <div><label class="required">Ore</label><input id="j_ore" type="number" required></div>
        <div><label>Tariffa €/h</label><input id="j_tariffa" type="number" value="35"></div>
        <div><label>Sconto €</label><input id="j_sconto" type="number" value="0"></div>
        <div><label>IVA %</label><input id="j_iva" type="number" value="22"></div>
      </div>
      
      <div class="row">
        <div><label class="required">Descrizione Lavoro</label><textarea id="j_descrizione" placeholder="Descrizione dettagliata dell'intervento..." required></textarea></div>
        <div>
          <label>Foto/Documenti</label>
          <div class="file-upload-container">
            <input type="file" id="j_files" multiple accept="image/*,.pdf,.doc,.docx" style="display: none;">
            <button type="button" class="file-upload-btn" onclick="document.getElementById('j_files').click()">
              <i class="fas fa-cloud-upload-alt"></i>
              <span>Scegli File</span>
              <small>Immagini, PDF, DOC</small>
            </button>
            <div class="file-upload-info">
              <i class="fas fa-info-circle"></i>
              <span>Max 5MB per file</span>
            </div>
          </div>
          <div id="j_files_preview" class="files-preview"></div>
        </div>
      </div>

      <div class="muted" id="j_totali" style="margin-top:10px"></div>

      <div class="button-group">
        <button id="addJob" class="primary"><i class="fa-solid fa-plus"></i> Registra</button>
        <button id="exportJobs" class="pdf"><i class="fa-solid fa-file-pdf"></i> Esporta PDF</button>
        <button id="exportAllFiles" class="secondary"><i class="fas fa-download"></i> Esporta File</button>
        <button id="saveToFolder" class="success"><i class="fas fa-folder-open"></i> Salva in Cartella</button>
      </div>

      <div class="search-container" style="margin: 20px 0;">
        <div class="search-field">
          <i class="fas fa-search"></i>
          <input type="text" id="searchJobs" placeholder="Cerca interventi per cliente...">
          <button id="clearSearchJobs" class="clear-search" title="Cancella ricerca">
            <i class="fas fa-times"></i>
          </button>
        </div>
      </div>

      <div class="table-container">
        <table id="jobTable" style="margin-top:14px">
          <thead><tr><th>ID</th><th>Data</th><th>Cliente</th><th class="right">Totale</th><th class="right mobile-hide">Margine</th><th>Pagato</th><th>Azioni</th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </div>`;

  updateJobsTable();
  
  // Ricerca interventi
  let filteredJobs = [...jobs];
  
  document.getElementById("searchJobs").oninput = function() {
    const searchTerm = this.value.toLowerCase();
    if (searchTerm === '') {
      filteredJobs = [...jobs];
    } else {
      filteredJobs = jobs.filter(job => {
        const client = clients.find(c => c.id === job.clienteId);
        const clientName = client ? `${client.nome} ${client.cognome}`.toLowerCase() : '';
        return clientName.includes(searchTerm);
      });
    }
    updateJobsTable(filteredJobs);
  };

  document.getElementById("clearSearchJobs").onclick = () => {
    document.getElementById("searchJobs").value = '';
    filteredJobs = [...jobs];
    updateJobsTable(filteredJobs);
  };
  
  document.getElementById("exportJobs").onclick = () => exportToPDF("Interventi", "jobTable");
  document.getElementById("addJob").onclick = addJob;
  document.getElementById("exportAllFiles").onclick = exportAllFiles;
  document.getElementById("saveToFolder").onclick = saveAllFilesToFolder;
  
  // Event listener per preview file
  const filesInput = document.getElementById('j_files');
  if (filesInput) {
    filesInput.addEventListener('change', updateFilesPreview);
  }
  
  // Migliora l'esperienza del campo data
  setupDateInput();
}

function addJob() {
  // Controlli di validazione campi obbligatori
  const data = document.getElementById('j_data').value.trim();
  const clienteId = document.getElementById('j_cliente').value;
  const ore = document.getElementById('j_ore').value.trim();
  const descrizione = document.getElementById('j_descrizione').value.trim();
  
  // Validazione campi obbligatori
  if (!data) {
    alert("⚠️ Il campo Data è obbligatorio!");
    document.getElementById('j_data').focus();
    return;
  }
  if (!clienteId) {
    alert("⚠️ Il campo Cliente è obbligatorio!");
    document.getElementById('j_cliente').focus();
    return;
  }
  if (!ore || isNaN(Number(ore)) || Number(ore) <= 0) {
    alert("⚠️ Il campo Ore è obbligatorio e deve essere maggiore di 0!");
    document.getElementById('j_ore').focus();
    return;
  }
  if (!descrizione) {
    alert("⚠️ Il campo Descrizione Lavoro è obbligatorio!");
    document.getElementById('j_descrizione').focus();
    return;
  }
  
  const tariffa = Number(document.getElementById('j_tariffa').value);
  
  if (!tariffa || isNaN(tariffa)) {
    alert("⚠️ Il campo Tariffa è obbligatorio e deve essere un numero!");
    document.getElementById('j_tariffa').focus();
    return;
  }
  
  // Disabilita il pulsante per evitare doppi click
  const addButton = document.getElementById('addJob');
  if (addButton.disabled) return;
  addButton.disabled = true;
  addButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...';
  
  const filesInput = document.getElementById('j_files');
  const files = filesInput ? Array.from(filesInput.files) : [];
  
  // Se non ci sono file, salva immediatamente
  if (files.length === 0) {
    saveJobData([]);
    return;
  }
  
  // Converti i file in base64 per storage locale
  const filePromises = files.map(file => {
    return new Promise((resolve, reject) => {
      // Controllo dimensione file (max 5MB per file)
      if (file.size > 5 * 1024 * 1024) {
        reject(new Error(`File "${file.name}" troppo grande (max 5MB)`));
        return;
      }
      
      const reader = new FileReader();
      reader.onload = (e) => {
        resolve({
          name: file.name,
          type: file.type,
          size: file.size,
          data: e.target.result,
          uploadDate: new Date().toISOString()
        });
      };
      reader.onerror = () => {
        reject(new Error(`Errore nella lettura del file "${file.name}"`));
      };
      reader.readAsDataURL(file);
    });
  });
  
  Promise.all(filePromises)
    .then(fileData => {
      saveJobData(fileData);
    })
    .catch(error => {
      console.error('Errore elaborazione file:', error);
      showNotification(error.message || 'Errore durante il caricamento dei file', 'error');
      resetAddJobButton();
    });
}

function saveJobData(fileData) {
  try {
    const newJob = {
      id: uid(jobs),
      data: document.getElementById('j_data').value,
      clienteId: Number(document.getElementById('j_cliente').value),
      luogo: document.getElementById('j_luogo')?.value || '',
      descrizione: document.getElementById('j_descrizione')?.value || '',
      ore: Number(document.getElementById('j_ore').value),
      tariffa: Number(document.getElementById('j_tariffa').value),
      sconto: Number(document.getElementById('j_sconto').value || 0),
      iva: Number(document.getElementById('j_iva').value || 22),
      pagato: false,
      files: fileData,
      createdAt: new Date().toISOString()
    };
    
    jobs.push(newJob);
    setStorage("jobs", jobs);
    
    // Reset form
    document.getElementById('j_data').value = '';
    document.getElementById('j_cliente').value = '';
    document.getElementById('j_luogo').value = '';
    document.getElementById('j_descrizione').value = '';
    document.getElementById('j_ore').value = '';
    document.getElementById('j_tariffa').value = '35';
    document.getElementById('j_sconto').value = '0';
    document.getElementById('j_iva').value = '22';
    const filesInput = document.getElementById('j_files');
    if (filesInput) {
      filesInput.value = '';
      updateFilesPreview(); // Reset preview
    }
    
    renderJobs();
    showNotification(`Intervento registrato con successo! ${fileData.length > 0 ? `(${fileData.length} file allegati)` : ''}`, 'success');
    
  } catch (error) {
    console.error('Errore salvataggio intervento:', error);
    showNotification('Errore durante il salvataggio dell\'intervento', 'error');
  } finally {
    resetAddJobButton();
  }
}

function resetAddJobButton() {
  const addButton = document.getElementById('addJob');
  if (addButton) {
    addButton.disabled = false;
    addButton.innerHTML = '<i class="fa-solid fa-plus"></i> Registra';
  }
}

// Funzione per esportare tutti i file degli interventi
function exportAllFiles() {
  const allFiles = [];
  
  // Raccogli tutti i file da tutti gli interventi
  jobs.forEach(job => {
    if (job.files && job.files.length > 0) {
      job.files.forEach(file => {
        allFiles.push({
          jobId: job.id,
          jobDate: job.data,
          clientId: job.clienteId,
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size,
          fileData: file.data,
          uploadDate: file.uploadDate
        });
      });
    }
  });
  
  if (allFiles.length === 0) {
    showNotification('Nessun file da esportare', 'warning');
    return;
  }
  
  // Scarica ogni file individualmente
  allFiles.forEach((fileInfo, index) => {
    setTimeout(() => {
      downloadFileFromData(
        fileInfo.fileData, 
        `Intervento_${fileInfo.jobId}_${fileInfo.fileName}`,
        fileInfo.fileType
      );
    }, index * 500); // Ritardo per evitare blocchi del browser
  });
  
  showNotification(`Esportazione avviata per ${allFiles.length} file`, 'success');
}

// Funzione helper per scaricare un file da dati base64
function downloadFileFromData(base64Data, filename, mimeType) {
  try {
    const byteCharacters = atob(base64Data.split(',')[1]);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], {type: mimeType});
    
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Errore nel download del file:', error);
  }
}

// Funzione per salvare tutti i file in una cartella (per browser moderni)
async function saveAllFilesToFolder() {
  // Verifica se il browser supporta File System Access API
  if (!window.showDirectoryPicker) {
    showNotification('Il tuo browser non supporta il salvataggio diretto in cartelle. Usa "Esporta Tutti i File" invece.', 'warning');
    exportAllFiles();
    return;
  }
  
  try {
    // Chiedi all'utente di selezionare una cartella
    const dirHandle = await window.showDirectoryPicker();
    
    // Crea una sottocartella per HB_Impianti
    const hbFolder = await dirHandle.getDirectoryHandle('HB_Impianti_Files', { create: true });
    
    const allFiles = [];
    jobs.forEach(job => {
      if (job.files && job.files.length > 0) {
        job.files.forEach(file => {
          allFiles.push({
            jobId: job.id,
            jobDate: job.data,
            client: clients.find(c => c.id === job.clienteId),
            fileName: file.name,
            fileType: file.type,
            fileData: file.data
          });
        });
      }
    });
    
    if (allFiles.length === 0) {
      showNotification('Nessun file da salvare', 'warning');
      return;
    }
    
    // Salva ogni file nella cartella
    for (const fileInfo of allFiles) {
      try {
        // Crea nome file univoco
        const clientName = fileInfo.client ? `${fileInfo.client.nome}_${fileInfo.client.cognome}` : 'Cliente_Sconosciuto';
        const safeFileName = `${fileInfo.jobDate}_${clientName}_${fileInfo.jobId}_${fileInfo.fileName}`.replace(/[^\w\.-]/g, '_');
        
        // Converti base64 in blob
        const byteCharacters = atob(fileInfo.fileData.split(',')[1]);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], {type: fileInfo.fileType});
        
        // Crea il file nella cartella
        const fileHandle = await hbFolder.getFileHandle(safeFileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        
      } catch (error) {
        console.error(`Errore nel salvare il file ${fileInfo.fileName}:`, error);
      }
    }
    
    showNotification(`${allFiles.length} file salvati nella cartella selezionata!`, 'success');
    
  } catch (error) {
    if (error.name === 'AbortError') {
      showNotification('Operazione annullata dall\'utente', 'info');
    } else {
      console.error('Errore nel salvataggio:', error);
      showNotification('Errore nel salvataggio. Usa "Esporta Tutti i File" come alternativa.', 'error');
      exportAllFiles();
    }
  }
}

function updateFilesPreview() {
  const filesInput = document.getElementById('j_files');
  const previewContainer = document.getElementById('j_files_preview');
  
  if (!filesInput || !previewContainer) return;
  
  const files = Array.from(filesInput.files);
  
  if (files.length === 0) {
    previewContainer.innerHTML = '';
    return;
  }
  
  previewContainer.innerHTML = files.map((file, index) => {
    const fileSize = formatFileSize(file.size);
    const fileIcon = getFileIcon(file.type);
    const isOversize = file.size > 5 * 1024 * 1024;
    
    return `
      <div class="file-preview-item ${isOversize ? 'file-oversize' : ''}">
        <i class="fas ${fileIcon}"></i>
        <span class="file-name" title="${file.name}">${file.name.length > 20 ? file.name.substring(0, 17) + '...' : file.name}</span>
        <span class="file-size ${isOversize ? 'size-error' : ''}">${fileSize}</span>
        ${isOversize ? '<i class="fas fa-exclamation-triangle file-error" title="File troppo grande (max 5MB)"></i>' : ''}
        <i class="fas fa-times remove-file" onclick="removeFileFromPreview(${index})" title="Rimuovi file"></i>
      </div>
    `;
  }).join('');
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getFileIcon(mimeType) {
  if (mimeType.startsWith('image/')) return 'fa-image';
  if (mimeType === 'application/pdf') return 'fa-file-pdf';
  if (mimeType.includes('word') || mimeType.includes('document')) return 'fa-file-word';
  if (mimeType.includes('excel') || mimeType.includes('spreadsheet')) return 'fa-file-excel';
  return 'fa-file';
}

function removeFileFromPreview(index) {
  const filesInput = document.getElementById('j_files');
  if (!filesInput) return;
  
  // Crea un nuovo FileList senza il file selezionato
  const dt = new DataTransfer();
  const files = Array.from(filesInput.files);
  
  files.forEach((file, i) => {
    if (i !== index) {
      dt.items.add(file);
    }
  });
  
  filesInput.files = dt.files;
  updateFilesPreview();
}

function updateJobsTable(jobsToShow = jobs) {
  const tbody = document.querySelector("#jobTable tbody");
  tbody.innerHTML = jobsToShow.map(j => {
    const c = clients.find(x => x.id === j.clienteId);
    const totale = (j.ore * j.tariffa - j.sconto) * (1 + j.iva / 100);
    const costo = j.ore * (j.tariffa * 0.5);
    const margine = totale - costo;
    const hasFiles = j.files && j.files.length > 0;
    const hasDescription = j.descrizione && j.descrizione.trim() !== '';
    
    return `
      <tr class="job-row" data-job-id="${j.id}">
        <td>${j.id}</td>
        <td>
          <div class="job-date-info">
            ${formatDateIT(j.data)}
            ${hasFiles ? `<i class="fas fa-paperclip job-attachment" title="${j.files.length} allegati"></i>` : ''}
            ${hasDescription ? `<i class="fas fa-sticky-note job-note" title="Ha note"></i>` : ''}
          </div>
        </td>
        <td>
          <div class="job-client-info">
            ${c ? c.nome + " " + c.cognome : "-"}
            ${j.luogo ? `<div class="job-location"><i class="fas fa-map-marker-alt"></i> ${j.luogo}</div>` : ''}
          </div>
        </td>
        <td class="right">${currency(totale)}</td>
        <td class="right mobile-hide">${currency(margine)}</td>
        <td><input type="checkbox" ${j.pagato ? "checked" : ""} onchange="togglePaid(${j.id})"></td>
        <td>
          <div class="action-buttons">
            <button onclick="viewJobDetails(${j.id}, this)" class="primary" title="Dettagli"><i class="fas fa-eye"></i></button>
            <button onclick="editJob(${j.id})" class="edit"><i class="fa-solid fa-edit"></i></button>
            <button class="delete" onclick="deleteJob(${j.id})"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>`;
  }).join("");
}
function editJob(id) {
  const job = jobs.find(j => j.id === id);
  if (!job) return;
  
  // Popola i campi con i dati esistenti
  document.getElementById('j_data').value = job.data || '';
  document.getElementById('j_cliente').value = job.clienteId || '';
  document.getElementById('j_ore').value = job.ore || '';
  document.getElementById('j_tariffa').value = job.tariffa || '';
  document.getElementById('j_sconto').value = job.sconto || '';
  document.getElementById('j_iva').value = job.iva || '';
  
  // Aggiorna i totali
  updateTotals();
  
  // Cambia il bottone Registra in Salva Modifiche
  const addButton = document.getElementById('addJob');
  addButton.innerHTML = '<i class="fa-solid fa-save"></i> Salva Modifiche';
  addButton.className = 'success';
  addButton.onclick = () => {
    // Aggiorna l'intervento esistente
    const jobIndex = jobs.findIndex(j => j.id === id);
    if (jobIndex !== -1) {
      jobs[jobIndex] = {
        id: id,
        data: document.getElementById('j_data').value,
        clienteId: Number(document.getElementById('j_cliente').value),
        ore: Number(document.getElementById('j_ore').value),
        tariffa: Number(document.getElementById('j_tariffa').value),
        sconto: Number(document.getElementById('j_sconto').value),
        iva: Number(document.getElementById('j_iva').value),
        pagato: job.pagato // Mantieni lo stato di pagamento
      };
      setStorage("jobs", jobs);
      
      // Reset del form e del bottone
      document.getElementById('j_data').value = '';
      document.getElementById('j_cliente').value = '';
      document.getElementById('j_ore').value = '';
      document.getElementById('j_tariffa').value = '35';
      document.getElementById('j_sconto').value = '0';
      document.getElementById('j_iva').value = '22';
      
      renderJobs(); // Ricarica la vista
    }
  };
  
  // Scrolla verso l'alto per mostrare il form
  document.querySelector('.card').scrollIntoView({ behavior: 'smooth' });
}

function deleteJob(id) {
  if (confirm('Sei sicuro di voler eliminare questo intervento?')) {
    jobs = jobs.filter(j => j.id !== id);
    setStorage("jobs", jobs);
    renderJobs();
  }
}

function viewJobDetails(id, buttonElement) {
  // Chiudi eventuali overlay aperti
  closeAllJobOverlays();
  
  const job = jobs.find(j => j.id === id);
  if (!job) return;

  const client = clients.find(c => c.id === job.clienteId);
  const totale = (job.ore * job.tariffa - job.sconto) * (1 + job.iva / 100);
  
  // Trova la riga della tabella
  const row = buttonElement.closest('tr');
  
  // Crea l'overlay come riga di tabella
  const overlay = document.createElement('tr');
  overlay.className = 'job-details-overlay';
  overlay.innerHTML = `
    <td colspan="7">
      <div class="overlay-content">
        <div class="overlay-header">
          <h4><i class="fas fa-clipboard-list"></i> Dettagli Intervento #${job.id}</h4>
          <button class="overlay-close" onclick="closeJobOverlay(this)">
            <i class="fas fa-times"></i>
          </button>
        </div>
        <div class="overlay-body">
          <div class="detail-grid">
            <div class="detail-item">
              <label>Data</label>
              <span>${formatDateIT(job.data)}</span>
            </div>
            <div class="detail-item">
              <label>Cliente</label>
              <span>${client ? `${client.nome} ${client.cognome}` : '-'}</span>
            </div>
            <div class="detail-item">
              <label>Luogo</label>
              <span>${job.luogo || 'Non specificato'}</span>
            </div>
            <div class="detail-item">
              <label>Ore Lavorate</label>
              <span>${job.ore || 0} ore</span>
            </div>
            <div class="detail-item">
              <label>Tariffa Oraria</label>
              <span>${currency(job.tariffa || 0)}</span>
            </div>
            <div class="detail-item">
              <label>Sconto Applicato</label>
              <span>${currency(job.sconto || 0)}</span>
            </div>
            <div class="detail-item">
              <label>IVA</label>
              <span>${job.iva || 0}%</span>
            </div>
            <div class="detail-item">
              <label>Totale Fatturato</label>
              <span class="amount">${currency(totale)}</span>
            </div>
            ${job.descrizione ? `
            <div class="detail-item full-width">
              <label>Descrizione</label>
              <div class="description-text">${job.descrizione}</div>
            </div>
            ` : ''}
            ${job.files && job.files.length > 0 ? `
            <div class="detail-item full-width">
              <label>File Allegati (${job.files.length})</label>
              <div class="files-compact">
                ${job.files.map(file => `
                  <div class="file-compact">
                    <i class="fas ${getFileIcon(file.type)}"></i>
                    <span>${file.name}</span>
                    <button onclick="downloadFile('${file.data}', '${file.name}', '${file.type}')" class="download-btn">
                      <i class="fas fa-download"></i>
                    </button>
                  </div>
                `).join('')}
              </div>
            </div>
            ` : ''}
          </div>
        </div>
      </div>
    </td>
  `;
  
  // Inserisci l'overlay dopo la riga
  row.insertAdjacentElement('afterend', overlay);
  
  // Animazione di apertura
  setTimeout(() => overlay.classList.add('active'), 10);
}

function closeJobOverlay(button) {
  const overlay = button.closest('.job-details-overlay');
  overlay.classList.remove('active');
  setTimeout(() => overlay.remove(), 300);
}

function closeAllJobOverlays() {
  document.querySelectorAll('.job-details-overlay').forEach(overlay => {
    overlay.classList.remove('active');
    setTimeout(() => overlay.remove(), 300);
  });
}

function getFileIcon(mimeType) {
  if (mimeType.startsWith('image/')) return 'fa-image';
  if (mimeType === 'application/pdf') return 'fa-file-pdf';
  if (mimeType.includes('word')) return 'fa-file-word';
  if (mimeType.includes('excel') || mimeType.includes('spreadsheet')) return 'fa-file-excel';
  if (mimeType.includes('text')) return 'fa-file-text';
  return 'fa-file';
}

function downloadFile(base64Data, filename, mimeType) {
  try {
    const byteCharacters = atob(base64Data.split(',')[1]);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], {type: mimeType});
    
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    alert('Errore nel download del file: ' + error.message);
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.style.display = 'none';
  }
}

function togglePaid(id) {
  jobs = jobs.map(j => j.id === id ? {...j, pagato: !j.pagato} : j);
  setStorage("jobs", jobs);
  updateJobsTable();
}

// ---------- Render Quotes ----------
function renderQuotes() {
  // Aggiorna la variabile materials dal localStorage per assicurarsi di avere i dati più recenti
  materials = getStorage("materials", []);
  clients = getStorage("clients", []);
  
  content.innerHTML = `
    <div class="card">
      <div class="row">
        <div><label class="required">Numero Preventivo</label><input id="q_numero" placeholder="es. 2025-001" required></div>
        <div><label class="required">Data</label><input id="q_data" type="date" required></div>
        <div>
          <label class="required">Cliente</label>
          <select id="q_cliente" required><option value="">Seleziona...</option>
            ${clients.map(c=>`<option value="${c.id}">${c.id} - ${c.nome} ${c.cognome}</option>`).join("")}
          </select>
        </div>
        <div><label class="required">Oggetto</label><input id="q_oggetto" placeholder="Descrizione lavoro" required></div>
      </div>

      <div class="row">
        <div><label>Validità (giorni)</label><input id="q_validita" type="number" value="30"></div>
        <div><label>Tempi di consegna</label><input id="q_tempi" placeholder="es. 7-10 giorni lavorativi"></div>
        <div><label>Note</label><textarea id="q_note" rows="2" placeholder="Note aggiuntive..."></textarea></div>
      </div>

      <div class="card" style="margin-top: 20px;">
        <h3><i class="fas fa-list"></i> Voci del Preventivo</h3>
        
        <div class="material-selector">
          <label style="margin: 0; min-width: fit-content;"><i class="fas fa-tools"></i> Seleziona Materiale:</label>
          <select id="materialSelector">
            <option value="">-- Seleziona materiale --</option>
            ${materials.filter(m => m && m.id && m.descrizione && m.prezzo !== undefined).map(m=>
              `<option value="${m.id}" data-price="${m.prezzo}">${m.descrizione} (${currency(m.prezzo || 0)})</option>`
            ).join("")}
          </select>
          <button id="addFromMaterial" class="btn-icon secondary" title="Aggiungi materiale selezionato">
            <i class="fas fa-plus"></i>
          </button>
        </div>
        
        <div class="row">
          <div><label>Descrizione</label><input id="qitem_desc" placeholder="Descrizione voce"></div>
          <div><label>Quantità</label><input id="qitem_qty" type="number" value="1"></div>
          <div><label>Prezzo Unitario €</label><input id="qitem_price" type="number" step="0.01"></div>
        </div>
        
        <button id="addQuoteItem" class="primary" style="margin: 15px 0;">
          <i class="fas fa-plus"></i> Aggiungi Voce
        </button>
        
        <table id="quoteItemsTable">
          <thead>
            <tr><th>Descrizione</th><th>Q.tà</th><th class="right">Prezzo Unit.</th><th class="right">Totale</th><th></th></tr>
          </thead>
          <tbody></tbody>
          <tfoot>
            <tr style="font-weight: bold; background: var(--surface-light);">
              <td colspan="3" class="right">Subtotale:</td>
              <td class="right" id="quote-subtotal">€ 0,00</td>
              <td></td>
            </tr>
            <tr style="font-weight: bold; background: var(--surface-light);">
              <td colspan="3" class="right">IVA 22%:</td>
              <td class="right" id="quote-iva">€ 0,00</td>
              <td></td>
            </tr>
            <tr style="font-weight: bold; background: var(--accent); color: white;">
              <td colspan="3" class="right">TOTALE:</td>
              <td class="right" id="quote-total">€ 0,00</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div class="button-group">
        <button id="saveQuote" class="primary"><i class="fas fa-save"></i> Salva Preventivo</button>
        <button id="exportQuotes" class="pdf"><i class="fas fa-file-pdf"></i> Esporta PDF</button>
      </div>

      <table id="quotesTable" style="margin-top: 30px;">
        <thead>
          <tr><th>N°</th><th>Data</th><th>Cliente</th><th>Oggetto</th><th class="right">Totale</th><th>Stato</th><th style="width: 140px;">Azioni</th></tr>
        </thead>
        <tbody></tbody>
      </table>
      
      <div style="margin-top: 20px; padding: 15px; background: var(--surface-light); border-radius: var(--radius-small); font-size: 0.9rem; color: var(--muted);">
        <h4 style="margin: 0 0 10px 0; color: var(--text);"><i class="fas fa-info-circle"></i> Azioni Preventivi</h4>
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px;">
          <div>
            <strong>Prima Riga:</strong><br>
            <i class="fas fa-edit" style="color: var(--warning);"></i> Modifica •
            <i class="fas fa-check-circle" style="color: var(--success);"></i> Stato •
            <i class="fas fa-envelope" style="color: var(--accent);"></i> Email
          </div>
          <div>
            <strong>Seconda Riga:</strong><br>
            <i class="fas fa-file-pdf" style="color: var(--danger);"></i> PDF •
            <i class="fas fa-trash" style="color: var(--danger);"></i> Elimina
          </div>
        </div>
      </div>
    </div>`;

  // Imposta la data odierna
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('q_data').value = today;
  
  // Genera numero preventivo automatico
  const nextNumber = generateQuoteNumber();
  document.getElementById('q_numero').value = nextNumber;

  updateQuotesTable();
  updateQuoteItemsTable();

  // Debug: Verifica materiali
  console.log('Materiali disponibili:', materials);
  console.log('Materiali validi:', materials.filter(m => m && m.id && m.nome && m.marca && m.prezzo !== undefined));

  // Ripopola il select dei materiali per sicurezza
  setTimeout(() => {
    const materialSelect = document.getElementById('materialSelector');
    if (materialSelect) {
      const validMaterials = materials.filter(m => m && m.id && m.descrizione && m.prezzo !== undefined);
      const options = validMaterials.map(m => 
        `<option value="${m.id}" data-price="${m.prezzo}">${m.descrizione} (${currency(m.prezzo)})</option>`
      ).join('');
      
      materialSelect.innerHTML = `<option value="">-- Seleziona materiale --</option>${options}`;
      console.log('Select materiali ripopolato con', validMaterials.length, 'materiali validi');
    }
  }, 100);

  // Event listeners
  // Selettore materiali - auto-riempimento campi
  document.getElementById("materialSelector").onchange = function() {
    const selectedOption = this.options[this.selectedIndex];
    if (selectedOption.value) {
      const material = materials.find(m => m && m.id == selectedOption.value);
      if (material && material.descrizione && material.prezzo !== undefined) {
        // Imposta descrizione esatta del materiale
        document.getElementById('qitem_desc').value = material.descrizione;
        document.getElementById('qitem_price').value = Number(material.prezzo).toFixed(2);
        document.getElementById('qitem_qty').focus();
        
        // Memorizza il materiale selezionato per riferimento
        this.setAttribute('data-selected-material', material.id);
      } else {
        alert('Materiale non valido o incompleto. Verificare i dati del materiale.');
        this.value = ''; // Reset selezione
      }
    } else {
      // Reset quando non c'è selezione
      this.removeAttribute('data-selected-material');
    }
  };

  // Aggiungi materiale direttamente
  document.getElementById("addFromMaterial").onclick = () => {
    const selectedMaterial = document.getElementById('materialSelector');
    const selectedOption = selectedMaterial.options[selectedMaterial.selectedIndex];
    
    if (!selectedOption.value) {
      alert('Seleziona prima un materiale dal dropdown');
      return;
    }
    
    const material = materials.find(m => m && m.id == selectedOption.value);
    const qty = Number(document.getElementById('qitem_qty').value) || 1;
    
    if (!material) {
      alert('Materiale non trovato');
      return;
    }
    
    if (!material.descrizione) {
      alert('Il materiale non ha una descrizione valida');
      return;
    }
    
    const prezzoUnitario = parseFloat(material.prezzo) || 0;
    const totale = qty * prezzoUnitario;
    
    // Crea la voce con i dati esatti del materiale
    const newItem = {
      id: currentQuoteItems.length + 1,
      descrizione: material.descrizione,                   // Descrizione del materiale
      quantita: qty,                                        // Quantità inserita
      prezzo: prezzoUnitario,                              // Prezzo unitario del materiale
      totale: totale                                       // Prezzo unitario × quantità
    };
    
    console.log('Nuovo item aggiunto:', newItem);
    
    currentQuoteItems.push(newItem);
    
    // Reset completo del form
    selectedMaterial.value = '';
    selectedMaterial.removeAttribute('data-selected-material');
    document.getElementById('qitem_desc').value = '';
    document.getElementById('qitem_qty').value = '1';
    document.getElementById('qitem_price').value = '';
    
    updateQuoteItemsTable();
    
    alert(`Materiale aggiunto: ${newItem.descrizione}\nQuantità: ${qty}\nPrezzo unitario: ${currency(prezzoUnitario)}\nTotale: ${currency(totale)}`);
  };

  document.getElementById("addQuoteItem").onclick = () => {
    const desc = document.getElementById('qitem_desc').value;
    const qty = Number(document.getElementById('qitem_qty').value);
    const price = Number(document.getElementById('qitem_price').value);
    
    if (!desc || !qty || !price) {
      alert('Compila tutti i campi per aggiungere una voce');
      return;
    }
    
    // Verifica se è stato selezionato un materiale
    const materialSelector = document.getElementById('materialSelector');
    const selectedMaterialId = materialSelector.getAttribute('data-selected-material');
    
    // Se c'è un materiale selezionato, usa la sua descrizione esatta
    let finalDescription = desc;
    if (selectedMaterialId) {
      const selectedMaterial = materials.find(m => m.id == selectedMaterialId);
      if (selectedMaterial && selectedMaterial.descrizione) {
        finalDescription = selectedMaterial.descrizione;
      }
    }
    
    currentQuoteItems.push({
      id: currentQuoteItems.length + 1,
      descrizione: finalDescription,
      quantita: qty,
      prezzo: price,
      totale: qty * price
    });
    
    // Reset completo del form
    materialSelector.value = '';
    materialSelector.removeAttribute('data-selected-material');
    document.getElementById('qitem_desc').value = '';
    document.getElementById('qitem_qty').value = '1';
    document.getElementById('qitem_price').value = '';
    
    updateQuoteItemsTable();
  };

  document.getElementById("saveQuote").onclick = () => {
    const numero = document.getElementById('q_numero').value.trim();
    const data = document.getElementById('q_data').value;
    const clienteId = document.getElementById('q_cliente').value;
    const oggetto = document.getElementById('q_oggetto').value.trim();
    
    // Validazione campi obbligatori
    if (!numero) {
      alert("⚠️ Il campo Numero Preventivo è obbligatorio!");
      document.getElementById('q_numero').focus();
      return;
    }
    if (!data) {
      alert("⚠️ Il campo Data è obbligatorio!");
      document.getElementById('q_data').focus();
      return;
    }
    if (!clienteId) {
      alert("⚠️ Il campo Cliente è obbligatorio!");
      document.getElementById('q_cliente').focus();
      return;
    }
    if (!oggetto) {
      alert("⚠️ Il campo Oggetto è obbligatorio!");
      document.getElementById('q_oggetto').focus();
      return;
    }
    if (currentQuoteItems.length === 0) {
      alert("⚠️ Devi aggiungere almeno una voce al preventivo!");
      document.getElementById('qitem_desc').focus();
      return;
    }
    
    const quote = {
      id: uid(quotes),
      numero: numero,
      data: data,
      clienteId: Number(clienteId),
      oggetto: oggetto,
      validita: Number(document.getElementById('q_validita').value),
      tempi: document.getElementById('q_tempi').value.trim(),
      note: document.getElementById('q_note').value.trim(),
      voci: [...currentQuoteItems],
      stato: 'In attesa',
      createdAt: new Date().toISOString()
    };
    
    quotes.push(quote);
    setStorage("quotes", quotes);
    
    // Reset form
    currentQuoteItems = [];
    document.getElementById('q_numero').value = generateQuoteNumber();
    document.getElementById('q_cliente').value = '';
    document.getElementById('q_oggetto').value = '';
    document.getElementById('q_validita').value = '30';
    document.getElementById('q_tempi').value = '';
    document.getElementById('q_note').value = '';
    
    updateQuotesTable();
    updateQuoteItemsTable();
    
    alert('✅ Preventivo salvato con successo!');
  };

  document.getElementById("exportQuotes").onclick = () => exportQuotesToPDF();

}

// ---------- Quote Helper Functions ----------
function updateQuoteItemsTable() {
  const tbody = document.querySelector("#quoteItemsTable tbody");
  if (!tbody) return; // Safety check
  
  tbody.innerHTML = currentQuoteItems.map(item => {
    const prezzo = Number(item.prezzo) || 0;
    const quantita = Number(item.quantita) || 0;
    const totale = Number(item.totale) || (prezzo * quantita);
    
    return `
    <tr>
      <td>${item.descrizione || 'N/A'}</td>
      <td>${quantita}</td>
      <td class="right">${currency(prezzo)}</td>
      <td class="right">${currency(totale)}</td>
      <td>
        <button onclick="removeQuoteItem(${item.id})" class="delete">
          <i class="fas fa-trash"></i>
        </button>
      </td>
    </tr>
  `;
  }).join("");
  
  // Calcola totali
  const subtotal = currentQuoteItems.reduce((sum, item) => {
    const totale = Number(item.totale) || 0;
    return sum + totale;
  }, 0);
  const iva = subtotal * 0.22;
  const total = subtotal + iva;
  
  const subtotalEl = document.getElementById('quote-subtotal');
  const ivaEl = document.getElementById('quote-iva');
  const totalEl = document.getElementById('quote-total');
  
  if (subtotalEl) subtotalEl.textContent = currency(subtotal);
  if (ivaEl) ivaEl.textContent = currency(iva);
  if (totalEl) totalEl.textContent = currency(total);
}

window.removeQuoteItem = (id) => {
  currentQuoteItems = currentQuoteItems.filter(item => item.id !== id);
  updateQuoteItemsTable();
};

function generateQuoteNumber() {
  const year = new Date().getFullYear();
  const existing = quotes.filter(q => q.numero && q.numero.startsWith(year.toString()));
  const nextNum = existing.length + 1;
  return `${year}-${nextNum.toString().padStart(3, '0')}`;
}

function updateQuotesTable() {
  const tbody = document.querySelector("#quotesTable tbody");
  tbody.innerHTML = quotes.map(q => {
    const client = clients.find(c => c.id === q.clienteId);
    const total = q.voci.reduce((sum, v) => sum + v.totale, 0) * 1.22; // Con IVA
    return `
      <tr>
        <td>${q.numero}</td>
        <td>${formatDateIT(q.data)}</td>
        <td>${client ? client.nome + " " + client.cognome : "-"}</td>
        <td>${q.oggetto}</td>
        <td class="right">${currency(total)}</td>
        <td><span class="status-badge ${q.stato.toLowerCase().replace(' ', '-')}">${q.stato}</span></td>
        <td>
          <div class="action-buttons">
            <div class="action-row">
              <button onclick="editQuote(${q.id})" class="edit" title="Modifica"><i class="fas fa-edit"></i></button>
              <button onclick="changeQuoteStatus(${q.id})" class="success" style="width: 36px; height: 36px;" title="Cambia Stato">
                <i class="fas fa-check-circle"></i>
              </button>
              <button onclick="emailQuote(${q.id})" class="primary" style="width: 36px; height: 36px;" title="Invia Email">
                <i class="fas fa-envelope"></i>
              </button>
            </div>
            <div class="action-row">
              <button onclick="exportSingleQuote(${q.id})" class="pdf" style="width: 36px; height: 36px;" title="Esporta PDF">
                <i class="fas fa-file-pdf"></i>
              </button>
              <button onclick="deleteQuote(${q.id})" class="delete" title="Elimina"><i class="fas fa-trash"></i></button>
            </div>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function editQuote(id) {
  // Implementazione modifica preventivo (semplificata)
  alert('Funzionalità di modifica in sviluppo');
}

function deleteQuote(id) {
  if (confirm('Sei sicuro di voler eliminare questo preventivo?')) {
    quotes = quotes.filter(q => q.id !== id);
    setStorage("quotes", quotes);
    updateQuotesTable();
  }
}

function changeQuoteStatus(id) {
  const quote = quotes.find(q => q.id === id);
  if (!quote) return;
  
  const currentStatus = quote.stato;
  let newStatus;
  
  // Determina il prossimo stato in base allo stato attuale
  if (currentStatus === 'In attesa') {
    const choice = confirm('Vuoi approvare questo preventivo?\n\nOK = Approvato\nAnnulla = Rifiutato');
    newStatus = choice ? 'Approvato' : 'Rifiutato';
  } else if (currentStatus === 'Approvato') {
    const choice = confirm('Questo preventivo è già approvato.\nVuoi cambiarlo in "Rifiutato"?');
    if (choice) newStatus = 'Rifiutato';
  } else if (currentStatus === 'Rifiutato') {
    const choice = confirm('Questo preventivo è rifiutato.\nVuoi cambiarlo in "Approvato"?');
    if (choice) newStatus = 'Approvato';
  }
  
  if (newStatus && newStatus !== currentStatus) {
    quote.stato = newStatus;
    quote.dataModifica = new Date().toISOString();
    setStorage("quotes", quotes);
    
    // Se il preventivo viene approvato, crea automaticamente una fattura
    if (newStatus === 'Approvato') {
      createInvoiceFromApprovedQuote(quote);
    }
    
    updateQuotesTable();
    
    alert(`Stato preventivo cambiato in: ${newStatus}${newStatus === 'Approvato' ? '\n\nFattura creata automaticamente!' : ''}`);
  }
}

function emailQuote(id) {
  const quote = quotes.find(q => q.id === id);
  if (!quote) return;
  
  const client = clients.find(c => c.id === quote.clienteId);
  if (!client || !client.email) {
    alert('Cliente non trovato o email non disponibile.\nVerifica che il cliente abbia un indirizzo email inserito.');
    return;
  }
  
  // Calcola il totale con IVA
  const subtotal = quote.voci.reduce((sum, v) => sum + v.totale, 0);
  const total = subtotal * 1.22;
  
  // Crea il corpo dell'email
  const subject = `Preventivo ${quote.numero} - ${quote.oggetto}`;
  const body = `Gentile ${client.nome} ${client.cognome},
  
Le inviamo in allegato il preventivo numero ${quote.numero} del ${formatDateIT(quote.data)}.

DETTAGLI PREVENTIVO:
- Oggetto: ${quote.oggetto}
- Importo totale: ${currency(total)}
- Validità: ${quote.validita} giorni
- Tempi di consegna: ${quote.tempi || 'Da concordare'}

${quote.note ? `Note aggiuntive: ${quote.note}` : ''}

Per qualsiasi chiarimento non esiti a contattarci.

Cordiali saluti,
HB Impianti`;

  // Crea il link mailto
  const mailtoLink = `mailto:${client.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  
  // Apri il client email
  window.open(mailtoLink);
  
  // Suggerisci di generare il PDF
  setTimeout(() => {
    const generatePDF = confirm('Email preparata!\n\nVuoi generare anche il PDF del preventivo da allegare?');
    if (generatePDF) {
      exportSingleQuote(id);
    }
  }, 500);
}

function exportSingleQuote(id) {
  const quote = quotes.find(q => q.id === id);
  if (!quote) return;
  
  exportQuoteToPDF(quote);
}

function exportQuotesToPDF() {
  if (quotes.length === 0) {
    alert('Nessun preventivo da esportare');
    return;
  }
  exportToPDF("Preventivi", "quotesTable");
}

// ---------- PDF Export Semplificato ----------
function exportToPDF(title, tableId) {
  try {
    // Controlla se jsPDF è caricato
    if (!window.jspdf) {
      alert("Errore: jsPDF non è caricato. Ricarica la pagina.");
      return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    // Header semplice
    doc.setFontSize(18);
    doc.text("HB TERMOIMPIANTI", 20, 20);
    doc.setFontSize(12);
    doc.text(`Report: ${title}`, 20, 35);
    doc.text(`Data: ${getCurrentDateIT()}`, 20, 45);
    
    // Linea separatrice
    doc.line(20, 50, 190, 50);
    
    let yPos = 65;
    
    // Dati basati sul tipo
    if (title === "Clienti" && clients.length > 0) {
      doc.text("ELENCO CLIENTI:", 20, yPos);
      yPos += 10;
      clients.slice(0, 30).forEach((client, index) => {
        doc.text(`${client.id} - ${client.nome} ${client.cognome} - ${client.telefono || ''}`, 20, yPos);
        yPos += 8;
        if (yPos > 280) { doc.addPage(); yPos = 20; }
      });
    }
    else if (title === "Materiali" && materials.length > 0) {
      doc.text("ELENCO MATERIALI:", 20, yPos);
      yPos += 10;
      materials.slice(0, 30).forEach((material, index) => {
        doc.text(`${material.id} - ${material.descrizione} - ${currency(material.prezzo)}`, 20, yPos);
        yPos += 8;
        if (yPos > 280) { doc.addPage(); yPos = 20; }
      });
    }
    else if (title === "Interventi" && jobs.length > 0) {
      doc.text("ELENCO INTERVENTI:", 20, yPos);
      yPos += 10;
      jobs.slice(0, 30).forEach((job, index) => {
        doc.text(`${job.id} - Cliente: ${job.cliente} - Data: ${formatDateIT(job.data)}`, 20, yPos);
        yPos += 8;
        if (yPos > 280) { doc.addPage(); yPos = 20; }
      });
    }
    else {
      doc.text("Nessun dato disponibile", 20, yPos);
    }
    
    // Footer
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.text(`Pagina ${i} di ${pageCount}`, 160, 290);
    }
    
    // Salva il file
    const today = getCurrentDateIT().replace(/\//g, '-');
    doc.save(`HB_${title}_${today}.pdf`);
    
    alert(`PDF "${title}" generato con successo!`);
    
  } catch (error) {
    console.error('Errore PDF:', error);
    alert(`Errore durante la generazione del PDF: ${error.message}`);
  }
}

// Header PDF ottimizzato
function addPDFHeaderFast(doc, title) {
  // Header veloce
  doc.setFillColor(88, 166, 255);
  doc.rect(0, 0, 595, 70, 'F');
  
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("HB TERMOIMPIANTI", 40, 30);
  
  doc.setFontSize(12);
  doc.setFont("helvetica", "normal");
  doc.text(`Report ${title}`, 40, 50);
  
  // Data veloce
  const dateStr = getCurrentDateIT();
  
  doc.setTextColor(...lightGray);
  doc.setFontSize(10);
  doc.text(`Generato il ${dateStr} alle ${timeStr}`, 350, 35);
  
  // Titolo sezione
  doc.setTextColor(...darkColor);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(`REPORT: ${title.toUpperCase()}`, 40, 110);
  
  // Linea di separazione
  doc.setDrawColor(...primaryColor);
  doc.setLineWidth(2);
  doc.line(40, 115, 555, 115);
}

// Funzione per aggiungere statistiche interventi
function addJobsStatistics(doc, startY) {
  const total = jobs.reduce((acc, j) => (acc + (j.ore * j.tariffa - j.sconto) * (1 + j.iva / 100)), 0);
  const incassati = jobs.filter(j => j.pagato).length;
  const pending = jobs.length - incassati;
  const pendingValue = jobs.filter(j => !j.pagato).reduce((acc, j) => (acc + (j.ore * j.tariffa - j.sconto) * (1 + j.iva / 100)), 0);
  
  // Box statistiche
  doc.setFillColor(248, 249, 250);
  doc.rect(40, startY, 515, 80, 'F');
  doc.setDrawColor(220, 220, 220);
  doc.rect(40, startY, 515, 80, 'S');
  
  doc.setTextColor(13, 17, 23);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("RIEPILOGO STATISTICHE", 50, startY + 20);
  
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  
  const stats = [
    `Interventi Totali: ${jobs.length}`,
    `Interventi Pagati: ${incassati}`,
    `In Attesa Pagamento: ${pending}`,
    `Valore Totale: ${currency(total)}`,
    `Da Incassare: ${currency(pendingValue)}`
  ];
  
  let y = startY + 40;
  stats.forEach((stat, index) => {
    if (index < 3) {
      doc.text(stat, 50, y);
    } else {
      doc.text(stat, 300, y - 20 + (index - 3) * 15);
    }
    if (index < 2) y += 15;
  });
  
  return startY + 100;
}

// Funzione per aggiungere tabella con stile
function addStyledTable(doc, table, startY) {
  const rows = [...table.querySelectorAll("tr")].map(tr =>
    [...tr.querySelectorAll("th,td")].map(td => td.innerText.trim())
  );
  
  if (rows.length === 0) return startY;
  
  const headers = rows[0];
  const data = rows.slice(1);
  
  // Calcola larghezze colonne dinamicamente
  const pageWidth = 555;
  const colWidth = Math.floor((pageWidth - 40) / headers.length);
  
  let y = startY + 20;
  const rowHeight = 25;
  const headerHeight = 30;
  
  // Header tabella
  doc.setFillColor(88, 166, 255);
  doc.rect(40, y, pageWidth - 40, headerHeight, 'F');
  
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  
  headers.forEach((header, index) => {
    if (header && header !== 'Azioni') { // Salta la colonna azioni
      const x = 40 + (index * colWidth) + 10;
      doc.text(header, x, y + 20);
    }
  });
  
  y += headerHeight;
  
  // Righe dati
  doc.setTextColor(13, 17, 23);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  
  data.forEach((row, rowIndex) => {
    // Colore alternato per le righe
    if (rowIndex % 2 === 0) {
      doc.setFillColor(249, 250, 251);
      doc.rect(40, y, pageWidth - 40, rowHeight, 'F');
    }
    
    // Border riga
    doc.setDrawColor(229, 231, 235);
    doc.setLineWidth(0.5);
    doc.line(40, y + rowHeight, pageWidth, y + rowHeight);
    
    row.forEach((cell, colIndex) => {
      if (headers[colIndex] !== 'Azioni' && cell) {
        const x = 40 + (colIndex * colWidth) + 10;
        
        // Formattazione speciale per alcuni tipi di dati
        let displayText = cell;
        if (cell.includes('€')) {
          doc.setFont("helvetica", "bold");
        } else if (cell === 'true' || cell === '✓') {
          displayText = '✓ Sì';
          doc.setTextColor(63, 185, 80);
        } else if (cell === 'false' || cell === '✗') {
          displayText = '✗ No';
          doc.setTextColor(255, 76, 76);
        }
        
        // Tronca testo se troppo lungo
        if (displayText.length > 25) {
          displayText = displayText.substring(0, 22) + '...';
        }
        
        doc.text(displayText, x, y + 15);
        
        // Reset colore e font
        doc.setTextColor(13, 17, 23);
        doc.setFont("helvetica", "normal");
      }
    });
    
    y += rowHeight;
    
    // Nuova pagina se necessario
    if (y > 750) {
      doc.addPage();
      addPDFHeader(doc, "Continua");
      y = 150;
    }
  });
  
  return y + 30;
}

// Funzione per aggiungere footer
function addPDFFooter(doc) {
  const pageCount = doc.internal.getNumberOfPages();
  
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    
    // Linea footer
    doc.setDrawColor(88, 166, 255);
    doc.setLineWidth(1);
    doc.line(40, 770, 555, 770);
    
    // Informazioni footer
    doc.setTextColor(139, 148, 158);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    
    doc.text("HB Termoimpianti - Gestione Professionale", 40, 785);
    doc.text("Documento generato automaticamente", 40, 795);
    
    // Numero pagina
    doc.text(`Pagina ${i} di ${pageCount}`, 500, 785);
    
    // Data di generazione
    const now = new Date().toLocaleDateString('it-IT');
    doc.text(`${now}`, 500, 795);
  }
}

// ---------- Quote PDF Export ----------
function exportQuoteToPDF(quote) {
  const { jsPDF } = window.jspdf;
  if (!jsPDF) return alert("Errore: jsPDF non è caricato correttamente.");

  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const client = clients.find(c => c.id === quote.clienteId);
  
  // Header
  addQuotePDFHeader(doc, quote, client);
  
  // Tabella voci
  let y = addQuoteItemsTable(doc, quote, 280);
  
  // Totali
  y = addQuoteTotals(doc, quote, y + 20);
  
  // Note e condizioni
  y = addQuoteFooterInfo(doc, quote, y + 30);
  
  // Footer
  addPDFFooter(doc);

  // Salva veloce
  const today = getCurrentDateIT().replace(/\//g, '-');
  doc.save(`Preventivo_${quote.numero}_${today}.pdf`);
}

function addQuotePDFHeader(doc, quote, client) {
  // Header aziendale
  doc.setFillColor(88, 166, 255);
  doc.rect(0, 0, 595, 80, 'F');
  
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(24);
  doc.text("HB TERMOIMPIANTI", 40, 35);
  
  doc.setFontSize(14);
  doc.setFont("helvetica", "normal");
  doc.text("Gestione Professionale Impianti Termici", 40, 55);
  
  // Titolo preventivo
  doc.setTextColor(13, 17, 23);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text(`PREVENTIVO N° ${quote.numero}`, 40, 120);
  
  // Informazioni cliente e preventivo
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  
  // Colonna sinistra - Cliente
  doc.setFont("helvetica", "bold");
  doc.text("CLIENTE:", 40, 160);
  doc.setFont("helvetica", "normal");
  if (client) {
    doc.text(`${client.nome} ${client.cognome}`, 40, 180);
    doc.text(`${client.email || ''}`, 40, 195);
    doc.text(`${client.telefono || ''}`, 40, 210);
  }
  
  // Colonna destra - Dati preventivo
  doc.setFont("helvetica", "bold");
  doc.text("DATA:", 350, 160);
  doc.text("VALIDITÀ:", 350, 180);
  doc.text("CONSEGNA:", 350, 200);
  
  doc.setFont("helvetica", "normal");
  doc.text(formatDateIT(quote.data), 420, 160);
  doc.text(`${quote.validita} giorni`, 420, 180);
  doc.text(quote.tempi || 'Da concordare', 420, 200);
  
  // Oggetto
  doc.setFont("helvetica", "bold");
  doc.text("OGGETTO:", 40, 240);
  doc.setFont("helvetica", "normal");
  doc.text(quote.oggetto, 120, 240);
  
  // Linea separatrice
  doc.setDrawColor(88, 166, 255);
  doc.setLineWidth(1);
  doc.line(40, 260, 555, 260);
}

function addQuoteItemsTable(doc, quote, startY) {
  let y = startY;
  
  // Header tabella
  doc.setFillColor(88, 166, 255);
  doc.rect(40, y, 515, 25, 'F');
  
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  
  doc.text("DESCRIZIONE", 50, y + 16);
  doc.text("Q.TÀ", 350, y + 16);
  doc.text("PREZZO UNIT.", 400, y + 16);
  doc.text("TOTALE", 480, y + 16);
  
  y += 25;
  
  // Righe
  doc.setTextColor(13, 17, 23);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  
  quote.voci.forEach((voce, index) => {
    // Sfondo alternato
    if (index % 2 === 0) {
      doc.setFillColor(249, 250, 251);
      doc.rect(40, y, 515, 20, 'F');
    }
    
    // Border
    doc.setDrawColor(229, 231, 235);
    doc.setLineWidth(0.5);
    doc.line(40, y + 20, 555, y + 20);
    
    // Contenuto
    doc.text(voce.descrizione.length > 40 ? voce.descrizione.substring(0, 37) + '...' : voce.descrizione, 50, y + 13);
    doc.text(voce.quantita.toString(), 360, y + 13);
    doc.text(currency(voce.prezzo), 410, y + 13);
    
    doc.setFont("helvetica", "bold");
    doc.text(currency(voce.totale), 490, y + 13);
    doc.setFont("helvetica", "normal");
    
    y += 20;
    
    // Nuova pagina se necessario
    if (y > 700) {
      doc.addPage();
      y = 50;
    }
  });
  
  return y;
}

function addQuoteTotals(doc, quote, startY) {
  const subtotal = quote.voci.reduce((sum, v) => sum + v.totale, 0);
  const iva = subtotal * 0.22;
  const total = subtotal + iva;
  
  let y = startY;
  
  // Box totali
  doc.setFillColor(248, 249, 250);
  doc.rect(350, y, 205, 80, 'F');
  doc.setDrawColor(220, 220, 220);
  doc.rect(350, y, 205, 80, 'S');
  
  doc.setTextColor(13, 17, 23);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  
  doc.text("Subtotale:", 360, y + 20);
  doc.text(currency(subtotal), 480, y + 20);
  
  doc.text("IVA 22%:", 360, y + 40);
  doc.text(currency(iva), 480, y + 40);
  
  // Totale in evidenza
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("TOTALE:", 360, y + 65);
  doc.text(currency(total), 480, y + 65);
  
  return y + 80;
}

function addQuoteFooterInfo(doc, quote, startY) {
  let y = startY;
  
  // Note
  if (quote.note) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("NOTE:", 40, y);
    
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const lines = doc.splitTextToSize(quote.note, 500);
    doc.text(lines, 40, y + 15);
    y += 15 + (lines.length * 12);
  }
  
  // Condizioni generali
  y += 20;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("CONDIZIONI GENERALI:", 40, y);
  
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  const conditions = [
    `• Il presente preventivo è valido ${quote.validita} giorni dalla data di emissione`,
    "• I prezzi si intendono IVA inclusa",
    "• Il pagamento dovrà essere effettuato come da accordi",
    "• Eventuali variazioni ai lavori dovranno essere concordate per iscritto"
  ];
  
  conditions.forEach((condition, index) => {
    doc.text(condition, 40, y + 15 + (index * 12));
  });
  
  return y + 15 + (conditions.length * 12);
}

// ---------- Funzioni PDF Ottimizzate ----------

// Statistiche ottimizzate
function addJobsStatisticsFast(doc, startY) {
  const total = jobs.reduce((acc, j) => (acc + (j.ore * j.tariffa - j.sconto) * (1 + j.iva / 100)), 0);
  const incassati = jobs.filter(j => j.pagato).length;
  const pending = jobs.length - incassati;
  
  doc.setFillColor(240, 240, 240);
  doc.rect(40, startY, 515, 60, 'F');
  
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("STATISTICHE", 50, startY + 20);
  
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`Totali: ${jobs.length} | Pagati: ${incassati} | Attesa: ${pending} | Valore: ${currency(total)}`, 50, startY + 40);
  
  return startY + 70;
}

// Tabella ottimizzata
function addStyledTableFast(doc, table, startY) {
  const rows = Array.from(table.querySelectorAll('tr'));
  let y = startY;
  
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(0, 0, 0);
  
  rows.forEach((row, index) => {
    const cells = Array.from(row.querySelectorAll('th, td'));
    let x = 40;
    
    cells.forEach((cell, cellIndex) => {
      if (cellIndex < 6) { // Limita colonne per velocità
        let text = cell.textContent.trim();
        // Rimuove i bottoni dalla visualizzazione
        if (text.includes('Modifica') || text.includes('Elimina')) return;
        
        const width = 80;
        
        if (index === 0) {
          doc.setFillColor(220, 220, 220);
          doc.rect(x, y - 10, width, 15, 'F');
          doc.setFont("helvetica", "bold");
        } else {
          doc.setFont("helvetica", "normal");
        }
        
        // Tronca testo lungo
        if (text.length > 15) text = text.substring(0, 12) + '...';
        doc.text(text, x + 2, y);
        x += width;
      }
    });
    
    y += 15;
    if (y > 700) return false; // Evita overflow
  });
}

// Footer veloce
function addPDFFooterFast(doc) {
  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  doc.text(`Generato il ${getCurrentDateIT()} - HB Termoimpianti`, 40, 780);
}

// ---------- Backup Buttons ----------
document.addEventListener('DOMContentLoaded', () => {
  // Controlla lo stato di blocco all'avvio
  checkLockStatus();
  
  // Pulsante backup
  const backupBtn = document.getElementById('backupBtn');
  if (backupBtn) {
    backupBtn.addEventListener('click', () => {
      const currentDate = new Date();
      const dateString = currentDate.toISOString().split('T')[0]; // YYYY-MM-DD
      const timeString = currentDate.toTimeString().slice(0, 5).replace(':', '-'); // HH-MM
      const filename = `HB_Backup_${dateString}_${timeString}.json`;
      
      // Utilizza la funzione di export esistente
      exportAllData();
      
      showNotification('Backup creato e scaricato!', 'success');
    });
  }
  
  // Pulsante ripristino
  const restoreBtn = document.getElementById('restoreBtn');
  const restoreFileInput = document.getElementById('restoreFileInput');
  
  if (restoreBtn && restoreFileInput) {
    restoreBtn.addEventListener('click', () => {
      restoreFileInput.click();
    });
    
    restoreFileInput.addEventListener('change', (event) => {
      const file = event.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const data = e.target.result;
            importAllData(data);
          } catch (error) {
            showNotification('Errore nel caricamento del file backup', 'error');
            console.error('Errore backup:', error);
          }
        };
        reader.readAsText(file);
      }
      // Reset del valore per permettere di selezionare lo stesso file più volte
      event.target.value = '';
    });
  }
  
  // Pulsante blocco/sblocco
  const lockBtn = document.getElementById('lockBtn');
  const lockBtnText = document.getElementById('lockBtnText');
  
  if (lockBtn) {
    lockBtn.addEventListener('click', () => {
      const locked = localStorage.getItem('app_locked') === 'true';
      showLockModal(!locked);
    });
  }
  
  // Gestione modal blocco
  const lockModal = document.getElementById('lockModal');
  const lockModalCancel = document.getElementById('lockModalCancel');
  const lockModalConfirm = document.getElementById('lockModalConfirm');
  const lockPassword = document.getElementById('lockPassword');
  const lockPasswordConfirm = document.getElementById('lockPasswordConfirm');
  
  if (lockModalCancel) {
    lockModalCancel.addEventListener('click', () => {
      hideLockModal();
    });
  }
  
  if (lockModalConfirm) {
    lockModalConfirm.addEventListener('click', async () => {
      const isLocking = lockModal.dataset.mode === 'lock';
      const password = lockPassword.value;
      
      if (isLocking) {
        const confirmPassword = lockPasswordConfirm.value;
        
        if (!password || password.length < 4) {
          alert('La password deve contenere almeno 4 caratteri');
          return;
        }
        
        if (password !== confirmPassword) {
          alert('Le password non corrispondono');
          return;
        }
        
        // Blocca l'app
        lockModalConfirm.disabled = true;
        lockModalConfirm.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Crittografia in corso...';
        
        const success = await lockApp(password);
        
        if (success) {
          hideLockModal();
          updateLockButton(true);
          showNotification('Applicazione bloccata con successo! I dati sono ora criptati.', 'success');
          
          // Ricarica la pagina per nascondere i dati
          setTimeout(() => {
            window.location.reload();
          }, 1000);
        }
        
        lockModalConfirm.disabled = false;
        lockModalConfirm.innerHTML = '<i class="fas fa-lock"></i> <span>Blocca</span>';
      } else {
        // Sblocca l'app
        if (!password) {
          alert('Inserisci la password');
          return;
        }
        
        lockModalConfirm.disabled = true;
        lockModalConfirm.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Decrittografia in corso...';
        
        const success = await unlockApp(password);
        
        if (success) {
          hideLockModal();
          updateLockButton(false);
          showNotification('Applicazione sbloccata! Benvenuto.', 'success');
          
          // Ricarica la pagina per mostrare i dati
          setTimeout(() => {
            window.location.reload();
          }, 1000);
        }
        
        lockModalConfirm.disabled = false;
        lockModalConfirm.innerHTML = '<i class="fas fa-unlock"></i> <span>Sblocca</span>';
      }
    });
  }
  
  // Enter per confermare
  if (lockPassword) {
    lockPassword.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        const isLocking = lockModal.dataset.mode === 'lock';
        if (isLocking) {
          lockPasswordConfirm.focus();
        } else {
          lockModalConfirm.click();
        }
      }
    });
  }
  
  if (lockPasswordConfirm) {
    lockPasswordConfirm.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        lockModalConfirm.click();
      }
    });
  }
});

/**
 * Mostra il modal di blocco/sblocco
 * @param {boolean} isLocking - True se sta bloccando, false se sta sbloccando
 */
function showLockModal(isLocking) {
  const lockModal = document.getElementById('lockModal');
  const lockModalTitle = document.getElementById('lockModalTitleText');
  const lockModalDescription = document.getElementById('lockModalDescription');
  const confirmPasswordGroup = document.getElementById('confirmPasswordGroup');
  const lockWarning = document.getElementById('lockWarning');
  const lockModalConfirmText = document.getElementById('lockModalConfirmText');
  const lockPassword = document.getElementById('lockPassword');
  const lockPasswordConfirm = document.getElementById('lockPasswordConfirm');
  
  lockModal.dataset.mode = isLocking ? 'lock' : 'unlock';
  
  if (isLocking) {
    lockModalTitle.textContent = 'Blocca Applicazione';
    lockModalDescription.textContent = 'Inserisci una password per proteggere i tuoi dati. I dati verranno criptati con algoritmo AES-256.';
    confirmPasswordGroup.classList.add('show');
    lockWarning.classList.add('show');
    lockModalConfirmText.innerHTML = '<i class="fas fa-lock"></i> Blocca';
  } else {
    lockModalTitle.textContent = 'Sblocca Applicazione';
    lockModalDescription.textContent = 'Inserisci la password per decriptare e accedere ai tuoi dati.';
    confirmPasswordGroup.classList.remove('show');
    lockWarning.classList.remove('show');
    lockModalConfirmText.innerHTML = '<i class="fas fa-unlock"></i> Sblocca';
  }
  
  // Reset campi
  lockPassword.value = '';
  lockPasswordConfirm.value = '';
  
  // Mostra modal
  lockModal.classList.add('show');
  lockModal.style.display = 'flex';
  
  // Focus sul campo password
  setTimeout(() => lockPassword.focus(), 100);
}

/**
 * Nasconde il modal di blocco
 */
function hideLockModal() {
  const lockModal = document.getElementById('lockModal');
  lockModal.classList.remove('show');
  lockModal.style.display = 'none';
}

/**
 * Aggiorna il pulsante di blocco in base allo stato
 * @param {boolean} locked - True se l'app è bloccata
 */
function updateLockButton(locked) {
  const lockBtn = document.getElementById('lockBtn');
  const lockBtnText = document.getElementById('lockBtnText');
  const lockBtnIcon = lockBtn.querySelector('i');
  
  if (locked) {
    lockBtn.classList.add('locked');
    lockBtnIcon.className = 'fas fa-lock';
    lockBtnText.textContent = 'Sblocca';
    lockBtn.title = 'Sblocca applicazione';
  } else {
    lockBtn.classList.remove('locked');
    lockBtnIcon.className = 'fas fa-unlock';
    lockBtnText.textContent = 'Blocca';
    lockBtn.title = 'Blocca applicazione';
  }
}

// ---------- Render Calendar ----------
// Variabili globali per il calendario
let currentCalendarMonth = new Date().getMonth();
let currentCalendarYear = new Date().getFullYear();

function renderCalendar() {
  const today = new Date();
  currentCalendarMonth = today.getMonth();
  currentCalendarYear = today.getFullYear();
  
  content.innerHTML = `
    <div class="card">
      <div class="calendar-header">
        <h2><i class="fas fa-calendar-alt"></i> Calendario Interventi</h2>
        <div class="calendar-controls">
          <div class="year-controls">
            <button id="prevYear" class="btn-secondary" title="Anno precedente">
              <i class="fas fa-angle-double-left"></i>
            </button>
          </div>
          <div class="month-controls">
            <button id="prevMonth" class="btn-secondary" title="Mese precedente">
              <i class="fas fa-chevron-left"></i>
            </button>
            <span id="currentMonthYear" class="current-date">${getMonthName(currentCalendarMonth)} ${currentCalendarYear}</span>
            <button id="nextMonth" class="btn-secondary" title="Mese successivo">
              <i class="fas fa-chevron-right"></i>
            </button>
          </div>
          <div class="year-controls">
            <button id="nextYear" class="btn-secondary" title="Anno successivo">
              <i class="fas fa-angle-double-right"></i>
            </button>
          </div>
          <button id="todayBtn" class="btn-primary" title="Vai a oggi">
            <i class="fas fa-calendar-day"></i> Oggi
          </button>
        </div>
      </div>
      
      <div class="row">
        <div class="calendar-add-section">
          <h3><i class="fas fa-plus"></i> Nuovo Appuntamento</h3>
          <div class="row">
            <div><label class="required">Data e Ora</label><input id="apt_datetime" type="datetime-local" required></div>
            <div>
              <label class="required">Cliente</label>
              <select id="apt_cliente" required>
                <option value="">Seleziona cliente...</option>
                ${clients.map(c => `<option value="${c.id}">${c.nome} ${c.cognome}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="row">
            <div><label>Tipo Intervento</label>
              <select id="apt_tipo">
                <option value="Manutenzione">Manutenzione</option>
                <option value="Riparazione">Riparazione</option>
                <option value="Installazione">Installazione</option>
                <option value="Sopralluogo">Sopralluogo</option>
                <option value="Controllo">Controllo</option>
              </select>
            </div>
            <div><label>Durata (ore)</label><input id="apt_durata" type="number" value="2" step="0.5"></div>
          </div>
          <div class="row">
            <div><label>Note</label><textarea id="apt_note" placeholder="Note aggiuntive..."></textarea></div>
          </div>
          
          <button id="addAppointment" class="primary">
            <i class="fas fa-calendar-plus"></i> Aggiungi Appuntamento
          </button>
        </div>
        
        <div class="calendar-view">
          <div id="calendarGrid" class="calendar-grid"></div>
        </div>
      </div>
      
      <div class="appointments-list">
        <div class="appointments-tabs">
          <button class="appointments-tab active" data-tab="upcoming">
            <i class="fas fa-clock"></i> Prossimi Appuntamenti
          </button>
          <button class="appointments-tab" data-tab="completed">
            <i class="fas fa-check-circle"></i> Completati
          </button>
        </div>
        
        <div id="upcomingAppointments" class="appointments-tab-content active"></div>
        <div id="completedAppointments" class="appointments-tab-content" style="display: none;"></div>
      </div>
    </div>`;
  
  // Imposta datetime di default (oggi + 1 ora)
  const defaultDate = new Date();
  defaultDate.setHours(defaultDate.getHours() + 1);
  defaultDate.setMinutes(0);
  document.getElementById('apt_datetime').value = defaultDate.toISOString().slice(0, 16);
  
  updateCalendarView(currentCalendarMonth, currentCalendarYear);
  updateUpcomingAppointments();
  
  // Event listeners
  document.getElementById('addAppointment').onclick = addAppointment;
  document.getElementById('prevMonth').onclick = () => navigateMonth(-1);
  document.getElementById('nextMonth').onclick = () => navigateMonth(1);
  document.getElementById('prevYear').onclick = () => navigateYear(-1);
  document.getElementById('nextYear').onclick = () => navigateYear(1);
  document.getElementById('todayBtn').onclick = goToToday;
  
  // Tab switching per appuntamenti
  document.querySelectorAll('.appointments-tab').forEach(tab => {
    tab.onclick = function() {
      const tabType = this.getAttribute('data-tab');
      
      // Rimuovi active da tutti i tab
      document.querySelectorAll('.appointments-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.appointments-tab-content').forEach(c => c.style.display = 'none');
      
      // Aggiungi active al tab selezionato
      this.classList.add('active');
      
      // Mostra il contenuto corrispondente
      if (tabType === 'upcoming') {
        document.getElementById('upcomingAppointments').style.display = 'block';
      } else if (tabType === 'completed') {
        document.getElementById('completedAppointments').style.display = 'block';
      }
    };
  });
}

function addAppointment() {
  const datetime = document.getElementById('apt_datetime').value;
  const clienteId = document.getElementById('apt_cliente').value;
  const tipo = document.getElementById('apt_tipo').value;
  const durata = Number(document.getElementById('apt_durata').value);
  const note = document.getElementById('apt_note').value.trim();
  
  // Validazione campi obbligatori
  if (!datetime) {
    alert('⚠️ Il campo Data e Ora è obbligatorio!');
    document.getElementById('apt_datetime').focus();
    return;
  }
  if (!clienteId) {
    alert('⚠️ Il campo Cliente è obbligatorio!');
    document.getElementById('apt_cliente').focus();
    return;
  }
  
  appointments.push({
    id: uid(appointments),
    datetime: datetime,
    clienteId: Number(clienteId),
    tipo: tipo,
    durata: durata,
    note: note,
    stato: 'Programmato',
    createdAt: new Date().toISOString()
  });
  
  setStorage('appointments', appointments);
  
  // Reset form
  document.getElementById('apt_datetime').value = '';
  document.getElementById('apt_cliente').value = '';
  document.getElementById('apt_tipo').value = 'Manutenzione';
  document.getElementById('apt_durata').value = '2';
  document.getElementById('apt_note').value = '';
  
  updateCalendarView();
  updateUpcomingAppointments();
  
  showNotification('✅ Appuntamento aggiunto con successo!', 'success');
}

function navigateMonth(direction) {
  currentCalendarMonth += direction;
  
  if (currentCalendarMonth > 11) {
    currentCalendarMonth = 0;
    currentCalendarYear++;
  } else if (currentCalendarMonth < 0) {
    currentCalendarMonth = 11;
    currentCalendarYear--;
  }
  
  updateCalendarDisplay();
}

function navigateYear(direction) {
  currentCalendarYear += direction;
  updateCalendarDisplay();
}

function goToToday() {
  const today = new Date();
  currentCalendarMonth = today.getMonth();
  currentCalendarYear = today.getFullYear();
  updateCalendarDisplay();
}

function updateCalendarDisplay() {
  // Aggiorna il display del mese/anno
  const monthYearElement = document.getElementById('currentMonthYear');
  if (monthYearElement) {
    monthYearElement.textContent = `${getMonthName(currentCalendarMonth)} ${currentCalendarYear}`;
  }
  
  // Aggiorna la vista del calendario
  updateCalendarView(currentCalendarMonth, currentCalendarYear);
}

function updateCalendarView(month = new Date().getMonth(), year = new Date().getFullYear()) {
  // Implementazione semplificata del calendario
  const calendarGrid = document.getElementById('calendarGrid');
  if (!calendarGrid) return;
  
  // Header giorni settimana
  const daysOfWeek = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
  let calendarHTML = '<div class="calendar-header-days">';
  daysOfWeek.forEach(day => {
    calendarHTML += `<div class="calendar-day-header">${day}</div>`;
  });
  calendarHTML += '</div><div class="calendar-days">';
  
  // Giorni del mese con appuntamenti
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDate = new Date(firstDay);
  startDate.setDate(startDate.getDate() - (firstDay.getDay() || 7) + 1);
  
  for (let i = 0; i < 42; i++) {
    const currentDate = new Date(startDate);
    currentDate.setDate(startDate.getDate() + i);
    
    const dayAppointments = appointments.filter(apt => {
      const aptDate = new Date(apt.datetime);
      return aptDate.toDateString() === currentDate.toDateString();
    });
    
    const isCurrentMonth = currentDate.getMonth() === month;
    const isToday = currentDate.toDateString() === new Date().toDateString();
    
    calendarHTML += `
      <div class="calendar-day ${isCurrentMonth ? 'current-month' : 'other-month'} ${isToday ? 'today' : ''}">
        <div class="day-number">${currentDate.getDate()}</div>
        <div class="day-appointments">
          ${dayAppointments.slice(0, 2).map(apt => {
            const client = clients.find(c => c.id === apt.clienteId);
            const time = new Date(apt.datetime).toLocaleTimeString('it-IT', {hour: '2-digit', minute: '2-digit'});
            return `
              <div class="appointment-item" 
                   title="${apt.tipo} - ${client ? client.nome + ' ' + client.cognome : 'Cliente non trovato'}\nClicca per visualizzare dettagli"
                   onclick="showAppointmentDetails(${apt.id})">
                <span class="appointment-text">${time} ${apt.tipo.slice(0,3)}</span>
                <button class="appointment-delete" 
                        onclick="event.stopPropagation(); deleteAppointmentFromCalendar(${apt.id})"
                        title="Elimina appuntamento">
                  ×
                </button>
              </div>`;
          }).join('')}
          ${dayAppointments.length > 2 ? `<div class="more-appointments" onclick="showDayAppointments('${currentDate.toDateString()}')">+${dayAppointments.length - 2}</div>` : ''}
        </div>
      </div>`;
  }
  
  calendarHTML += '</div>';
  calendarGrid.innerHTML = calendarHTML;
  
  // Aggiorna header mese/anno
  const monthYearSpan = document.getElementById('currentMonthYear');
  if (monthYearSpan) {
    monthYearSpan.textContent = `${getMonthName(month)} ${year}`;
  }
}

function updateUpcomingAppointments() {
  const upcomingContainer = document.getElementById('upcomingAppointments');
  const completedContainer = document.getElementById('completedAppointments');
  
  if (!upcomingContainer) return;
  
  const now = new Date();
  
  // Appuntamenti prossimi (non completati e futuri)
  const upcoming = appointments
    .filter(apt => apt.stato !== 'Completato' && new Date(apt.datetime) >= now)
    .sort((a, b) => new Date(a.datetime) - new Date(b.datetime))
    .slice(0, 10);
  
  upcomingContainer.innerHTML = upcoming.length > 0 ? upcoming.map(apt => {
    const client = clients.find(c => c.id === apt.clienteId);
    const date = new Date(apt.datetime);
    return `
      <div class="appointment-card">
        <div class="appointment-info">
          <div class="appointment-title">${apt.tipo} - ${client ? client.nome + ' ' + client.cognome : 'Cliente non trovato'}</div>
          <div class="appointment-datetime">
            <i class="fas fa-calendar"></i> ${formatDateIT(date.toISOString())} 
            <i class="fas fa-clock"></i> ${date.toLocaleTimeString('it-IT', {hour: '2-digit', minute: '2-digit'})}
          </div>
          ${apt.note ? `<div class="appointment-note">${apt.note}</div>` : ''}
        </div>
        <div class="appointment-actions">
          <button onclick="completeAppointment(${apt.id})" class="success" title="Segna come completato">
            <i class="fas fa-check"></i>
          </button>
          <button onclick="deleteAppointment(${apt.id})" class="delete" title="Elimina">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>`;
  }).join('') : '<div class="no-data">Nessun appuntamento in programma</div>';
  
  // Appuntamenti completati
  if (completedContainer) {
    const completed = appointments
      .filter(apt => apt.stato === 'Completato')
      .sort((a, b) => new Date(b.completedAt || b.datetime) - new Date(a.completedAt || a.datetime))
      .slice(0, 20);
    
    completedContainer.innerHTML = completed.length > 0 ? completed.map(apt => {
      const client = clients.find(c => c.id === apt.clienteId);
      const date = new Date(apt.datetime);
      const completedDate = apt.completedAt ? new Date(apt.completedAt) : null;
      return `
        <div class="appointment-card">
          <div class="appointment-info">
            <div class="appointment-title">
              ${apt.tipo} - ${client ? client.nome + ' ' + client.cognome : 'Cliente non trovato'}
              <span class="history-status status-completato">Completato</span>
            </div>
            <div class="appointment-datetime">
              <i class="fas fa-calendar"></i> ${formatDateIT(date.toISOString())} 
              <i class="fas fa-clock"></i> ${date.toLocaleTimeString('it-IT', {hour: '2-digit', minute: '2-digit'})}
            </div>
            ${completedDate ? `<div class="appointment-datetime" style="color: var(--success);">
              <i class="fas fa-check-circle"></i> Completato il ${formatDateIT(completedDate.toISOString())}
            </div>` : ''}
            ${apt.note ? `<div class="appointment-note">${apt.note}</div>` : ''}
          </div>
          <div class="appointment-actions">
            <button onclick="deleteAppointment(${apt.id})" class="delete" title="Elimina">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </div>`;
    }).join('') : '<div class="no-data">Nessun appuntamento completato</div>';
  }
}

function getMonthName(monthIndex) {
  const months = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
                 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
  return months[monthIndex];
}

function completeAppointment(id) {
  const appointment = appointments.find(a => a.id === id);
  if (appointment) {
    appointment.stato = 'Completato';
    appointment.completedAt = new Date().toISOString();
    setStorage('appointments', appointments);
    updateUpcomingAppointments();
    showNotification('Appuntamento completato!', 'success');
  }
}

function deleteAppointment(id) {
  if (confirm('Sei sicuro di voler eliminare questo appuntamento?')) {
    appointments = appointments.filter(a => a.id !== id);
    setStorage('appointments', appointments);
    updateCalendarView();
    updateUpcomingAppointments();
    showNotification('Appuntamento eliminato', 'success');
  }
}

function deleteAppointmentFromCalendar(id) {
  const appointment = appointments.find(a => a.id === id);
  if (!appointment) return;
  
  const client = clients.find(c => c.id === appointment.clienteId);
  const clientName = client ? `${client.nome} ${client.cognome}` : 'Cliente non trovato';
  const datetime = new Date(appointment.datetime);
  const dateStr = datetime.toLocaleDateString('it-IT');
  const timeStr = datetime.toLocaleTimeString('it-IT', {hour: '2-digit', minute: '2-digit'});
  
  if (confirm(`Eliminare l'appuntamento?\n\n${appointment.tipo}\n${clientName}\n${dateStr} alle ${timeStr}`)) {
    appointments = appointments.filter(a => a.id !== id);
    setStorage('appointments', appointments);
    updateCalendarView();
    updateUpcomingAppointments();
    showNotification('Appuntamento eliminato dal calendario', 'success');
  }
}

function showAppointmentDetails(id) {
  const appointment = appointments.find(a => a.id === id);
  if (!appointment) return;
  
  const client = clients.find(c => c.id === appointment.clienteId);
  const datetime = new Date(appointment.datetime);
  const dateStr = datetime.toLocaleDateString('it-IT');
  const timeStr = datetime.toLocaleTimeString('it-IT', {hour: '2-digit', minute: '2-digit'});
  
  // Crea modal per i dettagli dell'appuntamento
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content appointment-details-modal">
      <div class="modal-header">
        <h3><i class="fas fa-calendar-check"></i> Dettagli Appuntamento</h3>
        <button class="modal-close">&times;</button>
      </div>
      
      <div class="appointment-details-content">
        <div class="detail-row">
          <span class="detail-label"><i class="fas fa-calendar"></i> Data:</span>
          <span class="detail-value">${dateStr}</span>
        </div>
        
        <div class="detail-row">
          <span class="detail-label"><i class="fas fa-clock"></i> Ora:</span>
          <span class="detail-value">${timeStr}</span>
        </div>
        
        <div class="detail-row">
          <span class="detail-label"><i class="fas fa-tools"></i> Tipo:</span>
          <span class="detail-value">${appointment.tipo}</span>
        </div>
        
        <div class="detail-row">
          <span class="detail-label"><i class="fas fa-user"></i> Cliente:</span>
          <span class="detail-value">${client ? `${client.nome} ${client.cognome}` : 'Cliente non trovato'}</span>
        </div>
        
        ${client && client.telefono ? `
        <div class="detail-row">
          <span class="detail-label"><i class="fas fa-phone"></i> Telefono:</span>
          <span class="detail-value">
            <a href="tel:${client.telefono}" class="phone-link">${client.telefono}</a>
          </span>
        </div>` : ''}
        
        <div class="detail-row">
          <span class="detail-label"><i class="fas fa-hourglass-half"></i> Durata:</span>
          <span class="detail-value">${appointment.durata} ore</span>
        </div>
        
        <div class="detail-row">
          <span class="detail-label"><i class="fas fa-info-circle"></i> Stato:</span>
          <span class="detail-value status-badge status-${appointment.stato.toLowerCase()}">${appointment.stato}</span>
        </div>
        
        ${appointment.note ? `
        <div class="detail-row full-width">
          <span class="detail-label"><i class="fas fa-sticky-note"></i> Note:</span>
          <div class="detail-note">${appointment.note}</div>
        </div>` : ''}
      </div>
      
      <div class="appointment-actions-modal">
        <button onclick="completeAppointmentFromModal(${appointment.id})" class="success">
          <i class="fas fa-check"></i> Completa
        </button>
        <button onclick="editAppointmentFromModal(${appointment.id})" class="primary">
          <i class="fas fa-edit"></i> Modifica
        </button>
        <button onclick="deleteAppointmentFromModal(${appointment.id})" class="delete">
          <i class="fas fa-trash"></i> Elimina
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Event handlers per chiudere il modal
  modal.querySelector('.modal-close').onclick = () => document.body.removeChild(modal);
  modal.onclick = (e) => { if (e.target === modal) document.body.removeChild(modal); };
}

function showDayAppointments(dateString) {
  const date = new Date(dateString);
  const dayAppointments = appointments.filter(apt => {
    const aptDate = new Date(apt.datetime);
    return aptDate.toDateString() === date.toDateString();
  });
  
  if (dayAppointments.length === 0) return;
  
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content day-appointments-modal">
      <div class="modal-header">
        <h3><i class="fas fa-calendar-day"></i> Appuntamenti del ${date.toLocaleDateString('it-IT')}</h3>
        <button class="modal-close">&times;</button>
      </div>
      
      <div class="day-appointments-list">
        ${dayAppointments.map(apt => {
          const client = clients.find(c => c.id === apt.clienteId);
          const time = new Date(apt.datetime).toLocaleTimeString('it-IT', {hour: '2-digit', minute: '2-digit'});
          return `
            <div class="day-appointment-item" onclick="showAppointmentDetails(${apt.id})">
              <div class="appointment-time">${time}</div>
              <div class="appointment-info">
                <div class="appointment-title">${apt.tipo}</div>
                <div class="appointment-client">${client ? `${client.nome} ${client.cognome}` : 'Cliente non trovato'}</div>
                ${apt.note ? `<div class="appointment-note-preview">${apt.note.slice(0, 50)}${apt.note.length > 50 ? '...' : ''}</div>` : ''}
              </div>
              <div class="appointment-status status-${apt.stato.toLowerCase()}">${apt.stato}</div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Event handlers
  modal.querySelector('.modal-close').onclick = () => document.body.removeChild(modal);
  modal.onclick = (e) => { if (e.target === modal) document.body.removeChild(modal); };
}

function completeAppointmentFromModal(id) {
  completeAppointment(id);
  // Chiudi il modal
  const modal = document.querySelector('.appointment-details-modal').closest('.modal-overlay');
  if (modal) document.body.removeChild(modal);
}

function editAppointmentFromModal(id) {
  // Implementazione futura per la modifica
  showNotification('Funzionalità di modifica in sviluppo', 'info');
}

function deleteAppointmentFromModal(id) {
  const appointment = appointments.find(a => a.id === id);
  if (!appointment) return;
  
  if (confirm('Sei sicuro di voler eliminare questo appuntamento?')) {
    appointments = appointments.filter(a => a.id !== id);
    setStorage('appointments', appointments);
    updateCalendarView();
    updateUpcomingAppointments();
    showNotification('Appuntamento eliminato', 'success');
    
    // Chiudi il modal
    const modal = document.querySelector('.appointment-details-modal').closest('.modal-overlay');
    if (modal) document.body.removeChild(modal);
  }
}

function viewClientHistory(clientId) {
  const client = clients.find(c => c.id === clientId);
  if (!client) return;
  
  const clientJobs = jobs.filter(j => j.clienteId === clientId).sort((a, b) => new Date(b.data) - new Date(a.data));
  const clientQuotes = quotes.filter(q => q.clienteId === clientId).sort((a, b) => new Date(b.data) - new Date(a.data));
  const clientInvoices = invoices.filter(inv => inv.clienteId === clientId).sort((a, b) => new Date(b.data) - new Date(a.data));
  const clientAppointments = appointments.filter(apt => apt.clienteId === clientId).sort((a, b) => new Date(b.datetime) - new Date(a.datetime));
  
  const totalValue = clientJobs.reduce((sum, j) => sum + (j.ore * j.tariffa - j.sconto) * (1 + j.iva / 100), 0);
  const totalPaid = clientJobs.filter(j => j.pagato).reduce((sum, j) => sum + (j.ore * j.tariffa - j.sconto) * (1 + j.iva / 100), 0);
  
  // Crea modal per lo storico
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content client-history-modal">
      <div class="modal-header">
        <h3><i class="fas fa-user"></i> Storico Cliente: ${client.nome} ${client.cognome}</h3>
        <button class="modal-close">&times;</button>
      </div>
      
      <div class="client-summary">
        <div class="summary-card">
          <div class="summary-item">
            <span class="summary-label">Totale Interventi</span>
            <span class="summary-value">${clientJobs.length}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Valore Totale</span>
            <span class="summary-value">${currency(totalValue)}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Incassato</span>
            <span class="summary-value">${currency(totalPaid)}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Da Incassare</span>
            <span class="summary-value">${currency(totalValue - totalPaid)}</span>
          </div>
        </div>
      </div>
      
      <div class="history-tabs">
        <button class="history-tab active" data-section="jobs">Interventi (${clientJobs.length})</button>
        <button class="history-tab" data-section="quotes">Preventivi (${clientQuotes.length})</button>
        <button class="history-tab" data-section="invoices">Fatture (${clientInvoices.length})</button>
        <button class="history-tab" data-section="appointments">Appuntamenti (${clientAppointments.length})</button>
      </div>
      
      <div class="history-content">
        <div id="jobs-section" class="history-section active">
          ${clientJobs.length ? clientJobs.map(job => `
            <div class="history-item">
              <div class="history-item-header">
                <span class="history-date">${formatDateIT(job.data)}</span>
                <span class="history-value">${currency((job.ore * job.tariffa - job.sconto) * (1 + job.iva / 100))}</span>
                <span class="history-status ${job.pagato ? 'paid' : 'unpaid'}">${job.pagato ? 'Pagato' : 'Non pagato'}</span>
              </div>
              <div class="history-item-details">
                ${job.luogo ? `<div><i class="fas fa-map-marker-alt"></i> ${job.luogo}</div>` : ''}
                <div><i class="fas fa-clock"></i> ${job.ore}h × ${currency(job.tariffa)}/h</div>
                ${job.descrizione ? `<div class="job-description">${job.descrizione}</div>` : ''}
                ${job.files && job.files.length ? `<div class="job-files"><i class="fas fa-paperclip"></i> ${job.files.length} allegati</div>` : ''}
              </div>
            </div>
          `).join('') : '<p class="no-data">Nessun intervento registrato</p>'}
        </div>
        
        <div id="quotes-section" class="history-section">
          ${clientQuotes.length ? clientQuotes.map(quote => `
            <div class="history-item">
              <div class="history-item-header">
                <span class="history-date">${formatDateIT(quote.data)}</span>
                <span class="history-value">${currency(quote.voci.reduce((sum, v) => sum + v.totale, 0) * 1.22)}</span>
                <span class="history-status status-${quote.stato.toLowerCase().replace(' ', '-')}">${quote.stato}</span>
              </div>
              <div class="history-item-details">
                <div><strong>N° ${quote.numero}</strong> - ${quote.oggetto}</div>
                <div><i class="fas fa-list"></i> ${quote.voci.length} voci</div>
              </div>
            </div>
          `).join('') : '<p class="no-data">Nessun preventivo creato</p>'}
        </div>
        
        <div id="invoices-section" class="history-section">
          ${clientInvoices.length ? clientInvoices.map(invoice => `
            <div class="history-item">
              <div class="history-item-header">
                <span class="history-date">${formatDateIT(invoice.data)}</span>
                <span class="history-value">${currency(invoice.totale)}</span>
                <span class="history-status ${invoice.pagata ? 'paid' : 'unpaid'}">${invoice.pagata ? 'Pagata' : 'Non pagata'}</span>
              </div>
              <div class="history-item-details">
                <div><strong>N° ${invoice.numero}</strong> - ${invoice.oggetto}</div>
              </div>
            </div>
          `).join('') : '<p class="no-data">Nessuna fattura emessa</p>'}
        </div>
        
        <div id="appointments-section" class="history-section">
          ${clientAppointments.length ? clientAppointments.map(apt => {
            const aptDate = new Date(apt.datetime);
            return `
            <div class="history-item">
              <div class="history-item-header">
                <span class="history-date">${formatDateIT(apt.datetime)} ${aptDate.toLocaleTimeString('it-IT', {hour: '2-digit', minute: '2-digit'})}</span>
                <span class="history-value">${apt.durata}h</span>
                <span class="history-status status-${apt.stato.toLowerCase()}">${apt.stato}</span>
              </div>
              <div class="history-item-details">
                <div><strong>${apt.tipo}</strong></div>
                ${apt.note ? `<div>${apt.note}</div>` : ''}
              </div>
            </div>
          `}).join('') : '<p class="no-data">Nessun appuntamento programmato</p>'}
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Event handlers
  modal.querySelector('.modal-close').onclick = () => document.body.removeChild(modal);
  modal.onclick = (e) => { if (e.target === modal) document.body.removeChild(modal); };
  
  // Tab switching
  modal.querySelectorAll('.history-tab').forEach(tab => {
    tab.onclick = () => {
      modal.querySelectorAll('.history-tab').forEach(t => t.classList.remove('active'));
      modal.querySelectorAll('.history-section').forEach(s => s.classList.remove('active'));
      tab.classList.add('active');
      modal.querySelector(`#${tab.dataset.section}-section`).classList.add('active');
    };
  });
}

// ---------- Render Invoices ----------
function renderInvoices() {
  content.innerHTML = `
    <div class="card">
      <div class="invoice-header">
        <h2><i class="fas fa-file-invoice"></i> Gestione Fatture</h2>
        <div class="button-group">
          <button id="exportInvoices" class="pdf">
            <i class="fas fa-file-pdf"></i> Esporta PDF
          </button>
        </div>
      </div>
      
      <div class="invoices-section">
        <h3><i class="fas fa-file-invoice"></i> Fatture Emesse</h3>
        <div class="search-container">
          <div class="search-field">
            <i class="fas fa-search"></i>
            <input type="text" id="searchInvoices" placeholder="Cerca fatture...">
          </div>
        </div>
        
        <div class="table-container">
          <table id="invoicesTable">
            <thead>
              <tr><th>N° Fattura</th><th>Cliente</th><th>Data</th><th>Totale</th><th>Pagata</th><th>Azioni</th></tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
    </div>`;
  
  updateInvoicesTable();
  
  // Event listeners
  document.getElementById('exportInvoices').onclick = () => exportToPDF("Fatture", "invoicesTable");
}

function updateInvoicesTable() {
  const tbody = document.querySelector("#invoicesTable tbody");
  tbody.innerHTML = invoices.map(inv => {
    const client = clients.find(c => c.id === inv.clienteId);
    return `
      <tr>
        <td>${inv.numero}</td>
        <td>${client ? client.nome + " " + client.cognome : "-"}</td>
        <td>${formatDateIT(inv.data)}</td>
        <td class="right">${currency(inv.totale)}</td>
        <td><input type="checkbox" ${inv.pagata ? "checked" : ""} onchange="toggleInvoicePaid(${inv.id})"></td>
        <td>
          <div class="action-buttons">
            <button onclick="printInvoice(${inv.id})" class="primary" title="Stampa"><i class="fas fa-print"></i></button>
            <button onclick="exportInvoicePDF(${inv.id})" class="pdf" title="Esporta PDF"><i class="fas fa-file-pdf"></i></button>
            <button onclick="emailInvoice(${inv.id})" class="secondary" title="Invia Email"><i class="fas fa-envelope"></i></button>
            <button onclick="deleteInvoice(${inv.id})" class="delete" title="Elimina"><i class="fas fa-trash"></i></button>
          </div>
        </td>
      </tr>`;
  }).join("");
}

function createInvoiceFromApprovedQuote(quote) {
  // Verifica se esiste già una fattura per questo preventivo
  const existingInvoice = invoices.find(inv => inv.quoteId === quote.id);
  if (existingInvoice) {
    console.log('Fattura già esistente per questo preventivo');
    return;
  }
  
  const invoice = {
    id: uid(invoices),
    numero: generateInvoiceNumber(),
    data: new Date().toISOString().split('T')[0],
    clienteId: quote.clienteId,
    oggetto: quote.oggetto,
    voci: [...quote.voci],
    subtotale: quote.voci.reduce((sum, v) => sum + v.totale, 0),
    iva: quote.voci.reduce((sum, v) => sum + v.totale, 0) * 0.22,
    totale: quote.voci.reduce((sum, v) => sum + v.totale, 0) * 1.22,
    pagata: false,
    quoteId: quote.id,
    createdAt: new Date().toISOString()
  };
  
  invoices.push(invoice);
  setStorage('invoices', invoices);
  
  console.log(`Fattura ${invoice.numero} creata automaticamente da preventivo ${quote.numero}`);
}

function generateInvoiceNumber() {
  const year = new Date().getFullYear();
  const existing = invoices.filter(inv => inv.numero && inv.numero.startsWith(year.toString()));
  const nextNum = existing.length + 1;
  return `${year}/${nextNum.toString().padStart(4, '0')}`;
}

function toggleInvoicePaid(id) {
  const invoice = invoices.find(inv => inv.id === id);
  if (invoice) {
    invoice.pagata = !invoice.pagata;
    invoice.dataPagamento = invoice.pagata ? new Date().toISOString() : null;
    setStorage('invoices', invoices);
    updateInvoicesTable();
  }
}

function deleteInvoice(id) {
  if (confirm('Sei sicuro di voler eliminare questa fattura?')) {
    invoices = invoices.filter(inv => inv.id !== id);
    setStorage('invoices', invoices);
    updateInvoicesTable();
    showNotification('Fattura eliminata', 'success');
  }
}

function printInvoice(id) {
  const invoice = invoices.find(inv => inv.id === id);
  if (!invoice) return;
  
  const client = clients.find(c => c.id === invoice.clienteId);
  if (!client) {
    alert('Cliente non trovato');
    return;
  }
  
  // Crea una finestra di stampa con il contenuto della fattura
  const printWindow = window.open('', '_blank');
  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Fattura ${invoice.numero}</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; color: #333; }
        .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #007bff; padding-bottom: 20px; }
        .company-info { text-align: right; margin-bottom: 30px; }
        .client-info { margin-bottom: 30px; }
        .invoice-details { display: flex; justify-content: space-between; margin-bottom: 30px; }
        .items-table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
        .items-table th, .items-table td { border: 1px solid #ddd; padding: 10px; text-align: left; }
        .items-table th { background-color: #f8f9fa; font-weight: bold; }
        .totals { text-align: right; margin-top: 20px; }
        .total-row { display: flex; justify-content: space-between; margin: 5px 0; }
        .final-total { font-weight: bold; font-size: 1.2em; border-top: 2px solid #007bff; padding-top: 10px; }
        @media print { body { margin: 0; } }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>HB TERMOIMPIANTI</h1>
        <p>Gestione professionale degli impianti termici</p>
      </div>
      
      <div class="company-info">
        <strong>HB Termoimpianti</strong><br>
        Via Esempio 123<br>
        00000 Roma (RM)<br>
        P.IVA: 12345678901<br>
        Tel: +39 06 1234567<br>
        Email: info@hbtermoimpianti.it
      </div>
      
      <div class="client-info">
        <strong>Fattura a:</strong><br>
        ${client.nome} ${client.cognome}<br>
        ${client.indirizzo || ''}<br>
        ${client.telefono ? 'Tel: ' + client.telefono : ''}<br>
        ${client.email ? 'Email: ' + client.email : ''}
      </div>
      
      <div class="invoice-details">
        <div>
          <strong>Fattura N°:</strong> ${invoice.numero}<br>
          <strong>Data:</strong> ${formatDateIT(invoice.data)}<br>
          <strong>Oggetto:</strong> ${invoice.oggetto}
        </div>
        <div>
          <strong>Stato:</strong> ${invoice.pagata ? 'PAGATA' : 'NON PAGATA'}<br>
          ${invoice.pagata && invoice.dataPagamento ? '<strong>Data Pagamento:</strong> ' + formatDateIT(invoice.dataPagamento) : ''}
        </div>
      </div>
      
      <table class="items-table">
        <thead>
          <tr>
            <th>Descrizione</th>
            <th>Quantità</th>
            <th>Prezzo Unit.</th>
            <th>Totale</th>
          </tr>
        </thead>
        <tbody>
          ${invoice.voci.map(voce => `
            <tr>
              <td>${voce.descrizione}</td>
              <td>${voce.quantita}</td>
              <td>${currency(voce.prezzo)}</td>
              <td>${currency(voce.totale)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      
      <div class="totals">
        <div class="total-row">
          <span>Subtotale:</span>
          <span>${currency(invoice.subtotale)}</span>
        </div>
        <div class="total-row">
          <span>IVA (22%):</span>
          <span>${currency(invoice.iva)}</span>
        </div>
        <div class="total-row final-total">
          <span>TOTALE:</span>
          <span>${currency(invoice.totale)}</span>
        </div>
      </div>
      
      <div style="margin-top: 50px; font-size: 0.9em; color: #666;">
        <p>Fattura generata automaticamente da HB Termoimpianti - ${new Date().toLocaleDateString('it-IT')}</p>
      </div>
    </body>
    </html>
  `);
  
  printWindow.document.close();
  printWindow.print();
}

function exportInvoicePDF(id) {
  const invoice = invoices.find(inv => inv.id === id);
  if (!invoice) return;
  
  const client = clients.find(c => c.id === invoice.clienteId);
  if (!client) {
    alert('Cliente non trovato');
    return;
  }
  
  // Utilizza jsPDF per creare il PDF
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  
  // Header
  doc.setFontSize(20);
  doc.setTextColor(0, 123, 255);
  doc.text('HB TERMOIMPIANTI', 105, 20, null, null, 'center');
  
  doc.setFontSize(12);
  doc.setTextColor(100);
  doc.text('Gestione professionale degli impianti termici', 105, 30, null, null, 'center');
  
  // Informazioni azienda
  doc.setTextColor(0);
  doc.setFontSize(10);
  doc.text('HB Termoimpianti', 150, 50);
  doc.text('Via Esempio 123', 150, 55);
  doc.text('00000 Roma (RM)', 150, 60);
  doc.text('P.IVA: 12345678901', 150, 65);
  
  // Informazioni cliente
  doc.setFontSize(12);
  doc.text('Fattura a:', 20, 50);
  doc.setFontSize(10);
  doc.text(`${client.nome} ${client.cognome}`, 20, 60);
  if (client.indirizzo) doc.text(client.indirizzo, 20, 65);
  if (client.telefono) doc.text(`Tel: ${client.telefono}`, 20, 70);
  if (client.email) doc.text(`Email: ${client.email}`, 20, 75);
  
  // Dettagli fattura
  doc.setFontSize(12);
  doc.text(`Fattura N°: ${invoice.numero}`, 20, 90);
  doc.text(`Data: ${formatDateIT(invoice.data)}`, 20, 95);
  doc.text(`Oggetto: ${invoice.oggetto}`, 20, 100);
  doc.text(`Stato: ${invoice.pagata ? 'PAGATA' : 'NON PAGATA'}`, 120, 90);
  
  // Tabella voci
  let yPos = 120;
  doc.setFontSize(10);
  doc.text('Descrizione', 20, yPos);
  doc.text('Qta', 120, yPos);
  doc.text('Prezzo', 140, yPos);
  doc.text('Totale', 170, yPos);
  
  yPos += 5;
  doc.line(20, yPos, 190, yPos);
  yPos += 10;
  
  invoice.voci.forEach(voce => {
    doc.text(voce.descrizione.substring(0, 40), 20, yPos);
    doc.text(voce.quantita.toString(), 120, yPos);
    doc.text(currency(voce.prezzo), 140, yPos);
    doc.text(currency(voce.totale), 170, yPos);
    yPos += 10;
  });
  
  // Totali
  yPos += 10;
  doc.line(120, yPos, 190, yPos);
  yPos += 10;
  doc.text('Subtotale:', 120, yPos);
  doc.text(currency(invoice.subtotale), 170, yPos);
  yPos += 10;
  doc.text('IVA (22%):', 120, yPos);
  doc.text(currency(invoice.iva), 170, yPos);
  yPos += 10;
  doc.setFontSize(12);
  doc.text('TOTALE:', 120, yPos);
  doc.text(currency(invoice.totale), 170, yPos);
  
  // Salva il PDF
  doc.save(`Fattura_${invoice.numero.replace('/', '_')}.pdf`);
}

function emailInvoice(id) {
  const invoice = invoices.find(inv => inv.id === id);
  if (!invoice) return;
  
  const client = clients.find(c => c.id === invoice.clienteId);
  if (!client || !client.email) {
    alert('Cliente non trovato o email non disponibile');
    return;
  }
  
  // Crea un link mailto con i dettagli della fattura
  const subject = `Fattura ${invoice.numero} - HB Termoimpianti`;
  const body = `Gentile ${client.nome} ${client.cognome},

In allegato trova la fattura ${invoice.numero} del ${formatDateIT(invoice.data)}.

Dettagli fattura:
- Numero: ${invoice.numero}
- Data: ${formatDateIT(invoice.data)}
- Oggetto: ${invoice.oggetto}
- Totale: ${currency(invoice.totale)}

Cordiali saluti,
HB Termoimpianti

---
HB Termoimpianti
Tel: +39 06 1234567
Email: info@hbtermoimpianti.it`;

  const mailtoLink = `mailto:${client.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  
  // Apre il client email predefinito
  window.location.href = mailtoLink;
  
  showNotification(`Email preparata per ${client.email}`, 'success');
}

// ---------- Init ----------
showTab("dashboard");
