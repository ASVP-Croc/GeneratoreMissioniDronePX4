const { parseKML } = require('../utils/kmlParser');
const { calculateWaypoints } = require('../utils/waypointCalculator');
const { generatePythonScript, generatePlanFile } = require('../utils/fileGenerator');
const fs = require('fs').promises;

const processKML = async (req, res) => {
    let filePath = null;
    
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Nessun file fornito' });
        }

        filePath = req.file.path;
        console.log('Elaborazione file KML:', filePath);

        // 1. PARSING E VALIDAZIONE KML
        console.log('Validazione file KML...');
        const coordinates = await parseKML(filePath);
        console.log('KML validato con successo. Coordinate:', coordinates.length);

        // 2. CALCOLO WAYPOINTS
        console.log('Calcolo waypoints...');
        const outputType = req.body.outputType || 'python';
        const needCartesian = outputType === 'python';
        
        const waypoints = calculateWaypoints(coordinates, needCartesian);
        console.log('Waypoints calcolati:', waypoints.absolute.length);

        // 3. GENERAZIONE FILE
        console.log('Generazione file', outputType);
        let generatedFile;
        const firstWaypoint = waypoints.absolute[0];

        if (outputType === 'python') {
            const templateData = {
                absoluteWaypoints: waypoints.absolute,
                cartesianWaypoints: waypoints.cartesian
            };
            generatedFile = await generatePythonScript(templateData);
            res.setHeader('Content-Type', 'text/plain');
            res.setHeader('Content-Disposition', 'attachment; filename="mission_script.py"');
        } else {
            const templateData = {
                homeLat: firstWaypoint.lat,
                homeLng: firstWaypoint.lng,
                waypoints: waypoints.absolute
            };
            generatedFile = await generatePlanFile(templateData);
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', 'attachment; filename="mission.plan"');
        }

        console.log('File generato con successo');
        res.send(generatedFile);

    } catch (error) {
        console.error('Errore durante il processing:', error);
        
        // Messaggi di errore specifici per l'utente
        let userMessage = error.message;
        
        if (error.message.includes('POLIGONO') || error.message.includes('coordinate')) {
            userMessage = `File KML non valido: ${error.message}. Si prega di ricontrollare il file.`;
        } else if (error.message.includes('XML')) {
            userMessage = `File KML corrotto: ${error.message}. Si prega di verificare il formato del file.`;
        } else {
            userMessage = `Errore durante l'elaborazione: ${error.message}`;
        }
        
        res.status(400).json({ error: userMessage });
        
    } finally {
        // Pulizia del file uploaded
        if (filePath) {
            try {
                await fs.unlink(filePath);
                console.log('File temporaneo rimosso:', filePath);
            } catch (cleanupError) {
                console.error('Errore nella pulizia del file:', cleanupError);
            }
        }
    }
};

module.exports = processKML;