const { DOMParser } = require('xmldom');
const fs = require('fs').promises;

const parseKML = async (filePath) => {
    try {
        const kmlContent = await fs.readFile(filePath, 'utf-8');
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(kmlContent, 'text/xml');

        // Verifica che non ci siano errori di parsing XML
        const parseError = xmlDoc.getElementsByTagName('parsererror');
        if (parseError.length > 0) {
            throw new Error('File KML non valido: errore di formato XML');
        }

        // Cerca STRETTAMENTE solo poligoni (ignora punti, linee, etc.)
        const polygonElements = xmlDoc.getElementsByTagName('Polygon');
        
        if (polygonElements.length === 0) {
            throw new Error('Il file KML deve contenere un POLIGONO. Sono stati trovati altri elementi (punti, linee, etc.) che non sono supportati.');
        }

        if (polygonElements.length > 1) {
            throw new Error('Il file KML deve contenere UN SOLO poligono. Sono stati trovati multipli poligoni.');
        }

        // Estrai le coordinate dal poligono
        const coordinatesElements = polygonElements[0].getElementsByTagName('coordinates');
        if (coordinatesElements.length === 0) {
            throw new Error('Poligono non valido: nessuna coordinata trovata');
        }

        const coordinatesText = coordinatesElements[0].textContent;
        const coordinatesArray = coordinatesText.trim().split(/\s+/)
            .filter(coord => coord.trim() !== '' && coord.includes(','));

        if (coordinatesArray.length < 3) {
            throw new Error(`Poligono non valido: sono richieste almeno 3 coordinate, trovate solo ${coordinatesArray.length}`);
        }

        // Conversione in array di oggetti {lat, lon}
        const points = coordinatesArray.map(coord => {
            const parts = coord.split(',');
            const lon = parseFloat(parts[0]);
            const lat = parseFloat(parts[1]);
            
            if (isNaN(lon) || isNaN(lat)) {
                throw new Error(`Coordinate non numeriche: ${coord}`);
            }
            
            return { lat, lon };
        });

        console.log('Parsing KML completato. Coordinate del poligono trovate:', points.length);
        return points;

    } catch (error) {
        console.error('Errore nel parsing KML:', error);
        throw new Error(error.message);
    }
};

module.exports = { parseKML };