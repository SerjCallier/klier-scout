require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { google } = require('googleapis');

// --- Configuración ---
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const databasePath = path.join(__dirname, 'database.json');

/**
 * Carga datos desde CSV o JSON
 * @param {string} filePath 
 */
function loadData(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const content = fs.readFileSync(filePath, 'utf-8');

    if (ext === '.json') {
        return JSON.parse(content);
    } else if (ext === '.csv') {
        return parse(content, {
            columns: true,
            skip_empty_lines: true,
            trim: true
        });
    } else {
        throw new Error('Formato no soportado. Usa .csv o .json');
    }
}

/**
 * Procesa y limpia la data: deduplicación y ordenado por rating
 * @param {Array} data 
 */
function processData(data) {
    const map = new Map();

    data.forEach(item => {
        // Usamos el nombre o ID como clave para evitar duplicados
        const key = item.place_id || item.Nombre || item.name;
        if (!map.has(key)) {
            map.set(key, {
                nombre: item.Nombre || item.name || 'Sin Nombre',
                direccion: item.Dirección || item.address || item.formatted_address || 'Sin Dirección',
                telefono: item.Teléfono || item.phone || item.international_phone_number || 'Sin Teléfono',
                rating: parseFloat(item.Rating || item.rating || 0),
                resenas: parseInt(item.Total_reseñas || item.user_ratings_total || 0),
                web: item.Sitio_web || item.website || 'Sin Web'
            });
        }
    });

    // Ordenar por rating descendente
    return Array.from(map.values()).sort((a, b) => b.rating - a.rating);
}

/**
 * Autenticación con Google Sheets
 */
async function getSheetsClient() {
    const auth = new google.auth.JWT(
        process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        null,
        process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        SCOPES
    );
    return google.sheets({ version: 'v4', auth });
}

/**
 * Sincroniza con Google Sheets
 * @param {Array} processedData 
 */
async function syncToSheets(processedData) {
    try {
        const sheets = await getSheetsClient();
        const spreadsheetId = process.env.GOOGLE_SHEET_ID;

        // Formatear data para Sheets
        const values = [
            ['Nombre', 'Dirección', 'Teléfono', 'Rating', 'Reseñas', 'Sitio Web'],
            ...processedData.map(item => [
                item.nombre,
                item.direccion,
                item.telefono,
                item.rating,
                item.resenas,
                item.web
            ])
        ];

        // Limpiar hoja existente y escribir nueva data
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: 'Sheet1!A1',
            valueInputOption: 'RAW',
            resource: { values },
        });

        console.log('✅ Sincronización con Google Sheets completada.');
    } catch (error) {
        console.error('❌ Error sincronizando con Google Sheets:', error.message);
    }
}

/**
 * Función Principal
 */
async function main() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.log('Uso: node index.js <ruta_al_archivo.csv|.json>');
        return;
    }

    const inputPath = path.resolve(args[0]);
    if (!fs.existsSync(inputPath)) {
        console.error(`Archivo no encontrado: ${inputPath}`);
        return;
    }

    console.log('--- Iniciando Procesamiento ---');
    try {
        const rawData = loadData(inputPath);
        const processedData = processData(rawData);

        // Guardar localmente
        fs.writeFileSync(databasePath, JSON.stringify(processedData, null, 2));
        console.log(`✅ ${processedData.length} registros guardados en database.json`);

        // Sincronizar si las credenciales están presentes
        if (process.env.GOOGLE_SHEET_ID) {
            console.log('Sincronizando con Google Sheets...');
            await syncToSheets(processedData);
        } else {
            console.log('ℹ️ GOOGLE_SHEET_ID no definido. Sincronización omitida.');
        }

    } catch (error) {
        console.error('❌ Error crítico:', error.message);
    }
}

main();
