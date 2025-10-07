const turf = require('@turf/turf');
const turfArea = require('@turf/area').default;
const turfBuffer = require('@turf/buffer').default;
const turfIntersect = require('@turf/intersect').default;
const turfCentroid = require('@turf/centroid').default;
const proj4 = require('proj4');

// Definizione dei sistemi di coordinate
proj4.defs('WGS84', '+proj=longlat +datum=WGS84 +no_defs');
proj4.defs('EPSG:32632', '+proj=utm +zone=32 +datum=WGS84 +units=m +no_defs');
proj4.defs('EPSG:32633', '+proj=utm +zone=33 +datum=WGS84 +units=m +no_defs');

// Funzione per validare il poligono (il file kml deve contenere almeno 3 coordinate)
function validatePolygonCoordinates(coordinates) {
    if (!coordinates || !Array.isArray(coordinates)) {
        throw new Error('Coordinate del poligono non valide');
    }
    
    if (coordinates.length < 3) {
        throw new Error(`Poligono non valido: sono richieste almeno 3 coordinate, trovate ${coordinates.length}`);
    }
    
    // Verifica che tutte le coordinate siano numeri validi
    coordinates.forEach((coord, index) => {
        if (typeof coord.lat !== 'number' || typeof coord.lon !== 'number' || 
            isNaN(coord.lat) || isNaN(coord.lon)) {
            throw new Error(`Coordinate non valide alla posizione ${index}: lat=${coord.lat}, lon=${coord.lon}`);
        }
    });
    
    return true;
}

// Funzione per determinare la zona UTM appropriata in base alla longitudine
function getUTMZone(longitude) {
  return Math.floor((longitude + 180) / 6) + 1;
}

// Funzione per ottenere il codice EPSG per la zona UTM
function getUTMEPSG(latitude, longitude) {
  const zone = getUTMZone(longitude);
  return latitude >= 0 ? `EPSG:326${zone}` : `EPSG:327${zone}`;
}

// Funzione per validare il poligono
function validatePolygon(polygon) {
  if (!polygon || !polygon.geometry) {
    throw new Error('Poligono non valido: geometria mancante');
  }
  
  if (polygon.geometry.type !== 'Polygon') {
    throw new Error('Poligono non valido: tipo di geometria non supportato');
  }
  
  const coords = polygon.geometry.coordinates[0];
  if (coords.length < 4) {
    throw new Error('Poligono non valido: insufficienti coordinate');
  }
  
  // Verifica che il poligono sia chiuso
  const firstCoord = coords[0];
  const lastCoord = coords[coords.length - 1];
  if (firstCoord[0] !== lastCoord[0] || firstCoord[1] !== lastCoord[1]) {
    throw new Error('Poligono non valido: non è chiuso');
}
return true;
}

// Funzione per convertire le coordinate in un poligono Turf
function createTurfPolygon(coordinates) {
    console.log('Creazione poligono Turf da', coordinates.length, 'coordinate');
    
    // Converti le coordinate nel formato corretto [lng, lat] per Turf
    const turfCoords = coordinates.map(coord => {
        // Il parser KML restituisce {lat, lon}, ma Turf vuole [lng, lat]
        return [coord.lon, coord.lat];
    });
    
    // Chiudi l'anello del poligono se non è già chiuso
    const firstCoord = turfCoords[0];
    const lastCoord = turfCoords[turfCoords.length - 1];
    
    if (firstCoord[0] !== lastCoord[0] || firstCoord[1] !== lastCoord[1]) {
        turfCoords.push([firstCoord[0], firstCoord[1]]);
    }
    
    return turf.polygon([turfCoords]);
}

// Funzione per generare la griglia esagonale con proj4 per conversioni accurate
function generateHexGridWithBufferAndFilter(polygonCoords, r, threshold = 0.1) {
    console.log('Generazione griglia esagonale con raggio', r, 'metri');
    
    const polygon = createTurfPolygon(polygonCoords);
    const bbox = turf.bbox(polygon);
    
    // Verifica che il bounding box sia valido
    if (!bbox.every(val => typeof val === 'number' && !isNaN(val) && isFinite(val))) {
        console.error('Bounding box non valido:', bbox);
        console.error('Coordinate del poligono:', polygonCoords);
        throw new Error('Bounding box contiene valori non numerici: ' + JSON.stringify(bbox));
    }
    
    const [minx, miny, maxx, maxy] = bbox;
    
    console.log('Bounding box del poligono:', bbox);
    
    // Calcola il centro per determinare la zona UTM
    const center = turf.centroid(polygon);
    const centerCoords = center.geometry.coordinates;
    const utmEPSG = getUTMEPSG(centerCoords[1], centerCoords[0]);
    
    console.log('Centro del poligono:', centerCoords, 'Zona UTM:', utmEPSG);
    
    // Converti il bounding box a UTM per calcoli metrici precisi
    const minUTM = proj4('WGS84', utmEPSG, [minx, miny]);
    const maxUTM = proj4('WGS84', utmEPSG, [maxx, maxy]);
    
    console.log('Bounding box in UTM:', minUTM, maxUTM);
    
    const rowPoints = [];
    const removedPoints = [];
    
    // Calcoli in metri (sistema UTM)
    const dx = Math.sqrt(3) * r;
    const dy = 1.5 * r;
    
    let y = minUTM[1] - r;
    let row = 0;
    let totalPoints = 0;
    
    console.log('Inizio generazione griglia in UTM...');
    
    while (y <= maxUTM[1] + r) {
        const xOffset = (row % 2 === 1) ? dx / 2 : 0;
        let x = minUTM[0] - r + xOffset;
        const currentRow = [];
        
        while (x <= maxUTM[0] + r) {
            totalPoints++;
            
            // Converti il punto UTM back to WGS84 per i calcoli Turf
            const pointWGS84 = proj4(utmEPSG, 'WGS84', [x, y]);
            const point = turf.point(pointWGS84);
            
            // Verifica se il punto è dentro il poligono
            if (turf.booleanPointInPolygon(point, polygon)) {
                currentRow.push(pointWGS84);
            } else {
                // Verifica più precisa con buffer
                try {
                    // Crea il buffer con opzioni più conservative
                    const circle = turfBuffer(point, r, { 
                        units: 'meters',
                        steps: 32
                    });
                    
                    if (!circle || !circle.geometry || !polygon || !polygon.geometry) {
                        removedPoints.push(pointWGS84);
                        x += dx;
                        continue;
                    }
                    
                    // Verifica che le geometrie siano valide per l'intersezione
                    const circleCoords = circle.geometry.coordinates;
                    const polygonCoords = polygon.geometry.coordinates;
                    
                    if (!circleCoords || !polygonCoords || 
                        circleCoords.length === 0 || polygonCoords.length === 0) {
                        removedPoints.push(pointWGS84);
                        x += dx;
                        continue;
                    }
                    
                    // Calcola l'intersezione solo se entrambe le geometrie sono valide
                    const intersection = turfIntersect(circle, polygon);
                    
                    if (intersection && intersection.geometry) {
                        const intersectionArea = turfArea(intersection);
                        const circleArea = turfArea(circle);
                        
                        if (intersectionArea > 0 && circleArea > 0 && 
                            intersectionArea / circleArea >= threshold) {
                            currentRow.push(pointWGS84);
                        } else {
                            removedPoints.push(pointWGS84);
                        }
                    } else {
                        removedPoints.push(pointWGS84);
                    }
                } catch (error) {
                    // Gestione più specifica degli errori
                    if (error.message.includes('at least 2 geometries')) {
                        // Punto troppo lontano dal poligono, salta semplicemente
                        removedPoints.push(pointWGS84);
                    } else {
                        console.error('Errore nel calcolo dell\'intersezione per punto:', [x, y], error.message);
                        removedPoints.push(pointWGS84);
                    }
                }
            }
            x += dx;
        }
        
        if (currentRow.length > 0) {
            rowPoints.push(currentRow);
        }
        
        y += dy;
        row += 1;

        // Safety check - interrompi se stiamo generando troppi punti
            if (totalPoints > 500) {
                console.warn('Interruzione anticipata: troppi punti generati (> 500)');
                break;
            }
    }
    
    console.log('Griglia generata con', rowPoints.length, 'righe e', totalPoints, 'punti totali');
    console.log('Punti rimossi:', removedPoints.length);
    
    return { rowPoints, removedPoints };
}

// Funzione per ottimizzare il percorso
function optimizePathLayeredWithFinalInterleaved(rowPoints) {
  console.log('Ottimizzazione percorso con', rowPoints.length, 'righe');
  
  const optimizedPath = [];
  const skippedPoints = [];
  const totalRows = rowPoints.length;
  let interleavedHandled = false;
  let normalRows = rowPoints;
  
  if (totalRows % 2 === 1 && totalRows >= 2) {
    console.log('Gestione righe interleave');
    const interleavedRows = [rowPoints[totalRows - 2], rowPoints[totalRows - 1]];
    normalRows = rowPoints.slice(0, -2);
    interleavedHandled = true;
  }
  
  // Processa le righe normali
  normalRows.forEach((row, idx) => {
    if (!row || row.length === 0) return;
    
    const sortedRow = [...row].sort((a, b) => a[0] - b[0]);
    const skipped = sortedRow[0];
    const mainPoints = sortedRow.slice(1);
    
    const mainOrder = (idx % 2 === 0) ? mainPoints : [...mainPoints].reverse();
    optimizedPath.push(...mainOrder);
    skippedPoints.unshift(skipped);
  });
  
  // Processa le righe interleave se necessario
  if (interleavedHandled) {
    console.log('Elaborazione righe interleave');
    const row1 = [...rowPoints[totalRows - 2]].sort((a, b) => a[0] - b[0]);
    const row2 = [...rowPoints[totalRows - 1]].sort((a, b) => a[0] - b[0]);
    
    const skipped1 = row1[0];
    const main1 = row1.slice(1);
    const main2 = row2;
    
    const interleaved = [];
    const minLength = Math.min(main1.length, main2.length);
    
    for (let i = 0; i < minLength; i++) {
      interleaved.push(main1[main1.length - 1 - i]);
      interleaved.push(main2[main2.length - 1 - i]);
    }
    
    if (main1.length > main2.length) {
      interleaved.push(...main1.slice(0, main1.length - main2.length).reverse());
    } else if (main2.length > main1.length) {
      interleaved.push(...main2.slice(0, main2.length - main1.length).reverse());
    }
    
    optimizedPath.push(...interleaved);
    skippedPoints.unshift(skipped1);
  }
  
  // Aggiungi i punti saltati alla fine
  optimizedPath.push(...skippedPoints);
  
  console.log('Percorso ottimizzato con', optimizedPath.length, 'waypoints');
  
  return optimizedPath;
}

function convertGeographicToCartesian(waypoints, referencePoint = null) {
    console.log('Conversione coordinate geografiche in cartesiane...');
    
    if (!waypoints || waypoints.length === 0) {
        return waypoints;
    }

    // Se non viene fornito un punto di riferimento, usa il primo waypoint
    const refPoint = referencePoint || {
        lat: waypoints[0].lat,
        lng: waypoints[0].lng
    };
    
    const EARTH_RADIUS = 6371000; // Raggio terrestre in metri
    
    const cartesianWaypoints = waypoints.map(waypoint => {
        const lat = waypoint.lat;
        const lng = waypoint.lng;
        
        // Calcola le differenze in gradi
        const dLat = lat - refPoint.lat;
        const dLng = lng - refPoint.lng;
        
        // Converti in metri (approssimazione per piccole distanze)
        const x = dLng * (Math.PI/180) * EARTH_RADIUS * Math.cos(refPoint.lat * Math.PI/180);
        const y = dLat * (Math.PI/180) * EARTH_RADIUS;
        
        return {
            id: waypoint.id,
            x: parseFloat(x.toFixed(2)),
            y: parseFloat(y.toFixed(2)),
            z: waypoint.alt || 50
        };
    });
    
    console.log('Conversione completata. Primo waypoint cartesiano:', cartesianWaypoints[0]);
    return cartesianWaypoints;
}

// Funzione per applicare la traslazione di x=3m, y=3m
function applyTranslation(waypoints, translationX = 3.0, translationY = 3.0) {
    console.log(`Applicazione traslazione: x=${translationX}m, y=${translationY}m`);
    
    return waypoints.map(waypoint => ({
        ...waypoint,
        x: waypoint.x + translationX,
        y: waypoint.y + translationY
    }));
}

// Funzione principale per calcolare i waypoints
const calculateWaypoints = (polygonCoordinates, needCartesian = true) => {
    console.log('CALCOLO WAYPOINTS - INIZIO');
    
    try {
        // Validazione input
        validatePolygonCoordinates(polygonCoordinates);
        console.log('Coordinate del poligono validate:', polygonCoordinates.length);
        
        // Converti le coordinate nel formato corretto per Turf.js
        const turfCoords = polygonCoordinates.map(coord => {
            return {
                lat: coord.lat,
                lon: coord.lon
            };
        });
        
        console.log('Coordinate convertite per Turf.js');
        
        // Crea e valida il poligono
        const polygon = createTurfPolygon(turfCoords);
        validatePolygon(polygon);
        console.log('Poligono validato con successo');
        
        // Genera la griglia esagonale con raggio di 3 metri
        console.log('Generazione griglia esagonale...');
        const { rowPoints } = generateHexGridWithBufferAndFilter(turfCoords, 3, 0.1);
        
        console.log('Griglia generata con', rowPoints.length, 'righe');
        
        // Se non ci sono punti nella griglia, usa i vertici del poligono come fallback
        if (rowPoints.length === 0) {
            console.log('Nessun punto nella griglia, uso i vertici del poligono come fallback');
            const absoluteWaypoints = turfCoords.map((coord, index) => ({
                id: index + 1,
                lat: coord.lat,
                lng: coord.lon,
                alt: 3.5
            }));
            
            let cartesianWaypoints = [];
            if (needCartesian) {
                cartesianWaypoints = convertGeographicToCartesian(absoluteWaypoints);
                cartesianWaypoints = applyTranslation(cartesianWaypoints);
            }
            
            return {
                absolute: absoluteWaypoints,
                cartesian: cartesianWaypoints
            };
        }
        
        // Ottimizza il percorso
        console.log('Ottimizzazione percorso...');
        const optimizedPath = optimizePathLayeredWithFinalInterleaved(rowPoints);
        
        console.log('Percorso ottimizzato con', optimizedPath.length, 'punti');
        
        // Converti i waypoint nel formato assoluto (geografico)
        const absoluteWaypoints = optimizedPath.map((point, index) => ({
            id: index + 1,
            lat: point[1],
            lng: point[0],
            alt: 3.5
        }));
        
        let cartesianWaypoints = [];
        if (needCartesian) {
            // Converti in coordinate cartesiane solo se richiesto
            console.log('Conversione in coordinate cartesiane...');
            cartesianWaypoints = convertGeographicToCartesian(absoluteWaypoints);
            cartesianWaypoints = applyTranslation(cartesianWaypoints);
        }
        
        console.log('CALCOLO WAYPOINTS - COMPLETATO');
        console.log('Waypoints assoluti (geografici):', absoluteWaypoints.length);
        console.log('Waypoints cartesiani (traslati):', cartesianWaypoints.length);
        
        return {
            absolute: absoluteWaypoints,
            cartesian: cartesianWaypoints
        };
   } catch (error) {
        console.error('Errore nel calcolo dei waypoint:', error);
        throw new Error(error.message);
    }
};

module.exports = { calculateWaypoints };