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
    origin: 'http://localhost:4200',
    credentials: true
}));

// Middleware per parsing JSON
app.use(express.json());

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
app.get('/', (res) => {
    console.log('Richiesta ricevuta sulla root');
    res.json({
        message: 'Backend KML Processor is running!',
        timeStamp: new Date().toISOString()
    });
});

// Endpoint POST per processare KML
app.post('/api/process-kml', upload.single('kmlFile'), processKML);

// Gestione errori 404 (catch-all)
app.use((req, res) => {
    console.log('Route non trovata:', req.originalUrl);
    res.status(404).json({ error: 'Route non trovata' });
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
    cleanupUploads();
});

module.exports = app;