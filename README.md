# HB Termoimpianti

> **Gestionale completo per imprese termoidrauliche**  
> Clienti • Interventi • Preventivi • Fatture • Calendario

---

## 🚀 Accesso Rapido

| Piattaforma | Download/Accesso |
|-------------|------------------|
| **🌐 Web/Mobile (PWA)** | [Apri App](https://tamburini-christofer.github.io/HB_Impianti/Hb_home.html) |
| **💻 Windows** | [Releases](https://github.com/Tamburini-Christofer/HB_Impianti/releases) → `.exe` |
| **🍎 macOS** | [Releases](https://github.com/Tamburini-Christofer/HB_Impianti/releases) → `.dmg` |

---

## 📱 Installazione PWA (Mobile)

### Android
1. Apri il [link](https://tamburini-christofer.github.io/HB_Impianti/Hb_home.html) in Chrome
2. Menu ⋮ → **"Installa app"**
3. L'icona apparirà nella home

### iPhone/iPad
1. Apri il [link](https://tamburini-christofer.github.io/HB_Impianti/Hb_home.html) in Safari
2. Condividi □↗ → **"Aggiungi alla schermata Home"**

---

## ✨ Funzionalità

| Modulo | Descrizione |
|--------|-------------|
| 📊 Dashboard | Statistiche e grafici in tempo reale |
| 👥 Clienti | Anagrafica completa con storico |
| 🔧 Materiali | Catalogo con prezzi e gestione magazzino |
| ⚒️ Interventi | Registro lavori con dettagli e allegati |
| 📋 Preventivi | Generazione PDF professionale |
| 🧾 Fatture | Tracciamento pagamenti |
| 📅 Calendario | Pianificazione appuntamenti mensile |
| 💾 Backup | Esporta/Importa con merge intelligente |

---

## 🔐 Sicurezza e Privacy

- **🔒 Crittografia AES-256** con PBKDF2 (100k iterazioni)
- **📴 100% Offline** - Nessun server, dati solo sul dispositivo
- **🔑 Blocco Password** opzionale con auto-lock (30 min)
- **🛡️ Privacy Totale** - I tuoi dati restano tuoi

---

## 🛠️ Sviluppo

### Prerequisiti
- Node.js 18+
- npm

### Comandi

```bash
# Installazione dipendenze
npm install

# Avvia in modalità sviluppo (Electron)
npm start

# Build Windows
npm run dist

# Build macOS (solo su Mac)
npm run build:mac
```

### Release Automatiche (CI/CD)

Le build vengono generate automaticamente da GitHub Actions:

```bash
git tag v2.1.0
git push origin v2.1.0
```

→ Windows `.exe` e macOS `.dmg` saranno disponibili in [Releases](https://github.com/Tamburini-Christofer/HB_Impianti/releases)

---

## 📁 Struttura Progetto

```
HB_Impianti/
├── Hb_home.html      # Pagina principale
├── app.js            # Logica applicazione
├── style.css         # Stili
├── main.js           # Processo Electron
├── sw.js             # Service Worker (PWA)
├── manifest.json     # Configurazione PWA
├── package.json      # Dipendenze e build config
└── img/              # Risorse grafiche
```

---

## 📊 Stack Tecnologico

| Categoria | Tecnologia |
|-----------|------------|
| Frontend | HTML5, CSS3, Vanilla JS |
| Desktop | Electron 33.x |
| Build | electron-builder 25.x |
| Grafici | Chart.js 4.4.0 |
| PDF | jsPDF 2.5.1 |
| Icone | Font Awesome 7.0.1 |
| Font | Inter (Google Fonts) |
| Crittografia | Web Crypto API |
| CI/CD | GitHub Actions |
| Hosting | GitHub Pages |

---

## 📄 Licenze

| Componente | Licenza |
|------------|---------|
| Applicazione | Proprietario © Tamburini Christofer |
| Chart.js | MIT |
| jsPDF | MIT |
| Font Awesome Free | SIL OFL 1.1 + MIT |
| Inter Font | SIL OFL |
| Electron | MIT |

---

## 👨‍💻 Autore

**Tamburini Christofer**  
Web Developer

---

<div align="center">

**Versione 2.1.0** • Gennaio 2026  
*Sviluppato per HB Termoimpianti*

</div>
