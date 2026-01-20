// ==================== ELECTRON MAIN PROCESS ====================
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');

// Mantieni un riferimento globale alla finestra
let mainWindow;

function createWindow() {
  // Crea la finestra del browser
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    icon: path.join(__dirname, 'img', 'logo.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      // Abilita localStorage
      webSecurity: true
    },
    // Stile finestra
    titleBarStyle: 'default',
    backgroundColor: '#0d1117',
    show: false // Mostra dopo il caricamento
  });

  // Carica la pagina HTML principale
  mainWindow.loadFile('Hb_home.html');

  // Mostra la finestra quando è pronta (evita flash bianco)
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Apri link esterni nel browser predefinito
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Gestisci la chiusura della finestra
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Crea il menu dell'applicazione
  createMenu();
}

function createMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Nuova Finestra',
          accelerator: 'CmdOrCtrl+N',
          click: () => createWindow()
        },
        { type: 'separator' },
        {
          label: 'Esci',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Alt+F4',
          click: () => app.quit()
        }
      ]
    },
    {
      label: 'Modifica',
      submenu: [
        { label: 'Annulla', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: 'Ripeti', accelerator: 'Shift+CmdOrCtrl+Z', role: 'redo' },
        { type: 'separator' },
        { label: 'Taglia', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: 'Copia', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: 'Incolla', accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { label: 'Seleziona Tutto', accelerator: 'CmdOrCtrl+A', role: 'selectAll' }
      ]
    },
    {
      label: 'Visualizza',
      submenu: [
        { label: 'Ricarica', accelerator: 'CmdOrCtrl+R', role: 'reload' },
        { label: 'Ricarica Forzata', accelerator: 'CmdOrCtrl+Shift+R', role: 'forceReload' },
        { type: 'separator' },
        { label: 'Zoom Avanti', accelerator: 'CmdOrCtrl+Plus', role: 'zoomIn' },
        { label: 'Zoom Indietro', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { label: 'Zoom Reale', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
        { type: 'separator' },
        { label: 'Schermo Intero', accelerator: 'F11', role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Aiuto',
      submenu: [
        {
          label: 'Informazioni',
          click: () => {
            const { dialog } = require('electron');
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'HB Termoimpianti',
              message: 'HB Termoimpianti - Gestionale',
              detail: 'Versione 2.0.0\n\nSviluppato da Tamburini Christofer\n\nApplicazione per la gestione di clienti, interventi, preventivi e fatture.'
            });
          }
        }
      ]
    }
  ];

  // Menu specifico per macOS
  if (process.platform === 'darwin') {
    template.unshift({
      label: app.getName(),
      submenu: [
        { label: 'Informazioni su HB Termoimpianti', role: 'about' },
        { type: 'separator' },
        { label: 'Servizi', role: 'services', submenu: [] },
        { type: 'separator' },
        { label: 'Nascondi HB Termoimpianti', accelerator: 'Cmd+H', role: 'hide' },
        { label: 'Nascondi Altri', accelerator: 'Cmd+Alt+H', role: 'hideOthers' },
        { label: 'Mostra Tutti', role: 'unhide' },
        { type: 'separator' },
        { label: 'Esci', accelerator: 'Cmd+Q', role: 'quit' }
      ]
    });
  }

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// Quando Electron ha finito l'inizializzazione
app.whenReady().then(() => {
  createWindow();

  // Su macOS, ricrea la finestra se si clicca sull'icona nel dock
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Esci quando tutte le finestre sono chiuse (eccetto su macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Sicurezza: previeni navigazione verso URL esterni
app.on('web-contents-created', (event, contents) => {
  contents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    if (parsedUrl.protocol !== 'file:') {
      event.preventDefault();
    }
  });
});
