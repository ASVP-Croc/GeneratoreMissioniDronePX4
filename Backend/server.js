const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const processKML = require('./routes/processKML');

const app = express();
const port = process.env.PORT || 3000;

// Middleware CORS
app.use(cors({
    origin: process.env.NODE_ENV === 'production' 
        ? false
        : 'http://localhost:4200',
    credentials: true
}));

// Middleware per parsing JSON
app.use(express.json());

// SERVERE FILE STATICI ANGULAR
app.use(express.static(path.join(__dirname, 'public')));

// Gestione errori globale
app.use((error, req, res, next) => {
    console.error('Errore globale non gestito:', error);
    
    // Evita di esporre dettagli interni in produzione
    const message = process.env.NODE_ENV === 'development' 
        ? error.message 
        : 'Errore interno del server';
    
    res.status(500).json({ error: message });
});

// Gestione processi non catturati
process.on('uncaughtException', (error) => {
    console.error('ERRORE NON CATTURATO:', error);
});

process.on('unhandledRejection', (reason) => {
    console.error('PROMISE NON GESTITA:', reason);
});

// Configurazione Multer per upload file
const upload = multer({ dest: 'uploads/' });

// Route principale
app.get('/', (req, res) => {
    console.log('Richiesta ricevuta sulla root - servendo Angular');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Endpoint POST per processare KML
app.post('/api/process-kml', upload.single('kmlFile'), processKML);


app.get('*', (req, res) => {
    console.log('Catch-all route per Angular:', req.originalUrl);
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Gestione errori globali
app.use((err, req, res, next) => {
    console.error('Errore nel server:', err);
    res.status(500).json({ error: 'Errore interno del server' });
});

// Pulisci la cartella uploads all'avvio
function cleanupUploads() {
    const uploadsDir = 'uploads';
    if (fs.existsSync(uploadsDir)) {
        fs.readdir(uploadsDir, (err, files) => {
            if (err) throw err;
            for (const file of files) {
                fs.unlink(path.join(uploadsDir, file), err => {
                    if (err) console.error('Errore nella pulizia dei file', err);
                });
            }
        });
    }
}

// Avvio server
app.listen(port, () => {
    console.log(`Server in ascolto sulla porta ${port}`);
    console.log(`Ambiente: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Frontend Angular servito dalla cartella: ${path.join(__dirname, 'public')}`);
    cleanupUploads();
});

module.exports = app;