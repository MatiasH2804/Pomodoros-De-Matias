/**
 * Pomodoro Tracker API para publicar como Google Apps Script Web App.
 * Hoja esperada:
 * IDEstudio | Fecha | Materia | cantidad | Tiempo | Total minutos
 */
const SPREADSHEET_ID = '1nUvNjLWvdBSrDaSS7unFw33Fpwt-LSZbPsCSANs6Yas';
const SHEET_NAME = 'Hoja 1';

function doGet(e) {
  try {
    const action = e && e.parameter ? e.parameter.action : '';
    if (action !== 'getData') {
      return jsonOutput_({ ok: false, error: 'Accion GET no valida.' });
    }

    return jsonOutput_({ ok: true, data: getData() });
  } catch (error) {
    return jsonOutput_({ ok: false, error: error.message });
  }
}

function doPost(e) {
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (payload.action !== 'saveRecord' || !payload.data) {
      return jsonOutput_({ ok: false, error: 'Accion POST no valida.' });
    }

    return jsonOutput_({ ok: true, data: saveRecord(payload.data) });
  } catch (error) {
    return jsonOutput_({ ok: false, error: error.message });
  }
}

function getData() {
  const sheet = getSheet_();
  if (sheet.getLastRow() <= 1) return { headers: [], rows: [] };

  const data = sheet.getDataRange().getDisplayValues();
  return { headers: data.shift(), rows: data };
}

function saveRecord(formObject) {
  const clean = validateRecord_(formObject);
  const sheet = getSheet_();
  let id = String(formObject.idEstudio || '').trim();
  let rowIndex = 0;

  if (id) {
    const foundRange = sheet.createTextFinder(id).matchEntireCell(true).findNext();
    if (foundRange && foundRange.getColumn() === 1) rowIndex = foundRange.getRow();
  }

  const values = [
    clean.fecha,
    clean.materia,
    clean.cantidad,
    clean.tiempo,
    clean.totalMinutos
  ];

  if (rowIndex) {
    sheet.getRange(rowIndex, 2, 1, 5).setValues([values]);
    return { status: 'Updated', row: [id].concat(values) };
  }

  // Conserva el ID propuesto por el frontend para que los reintentos sean idempotentes.
  id = id || Utilities.getUuid();
  const newRow = [id].concat(values);
  sheet.appendRow(newRow);
  return { status: 'Created', row: newRow };
}

function getSheet_() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('No existe la hoja "' + SHEET_NAME + '".');
  return sheet;
}

function validateRecord_(formObject) {
  const materia = String(formObject.materia || '').trim();
  const cantidad = Number(formObject.cantidad);
  const tiempo = Number(formObject.tiempo);
  const fecha = formatDate_(String(formObject.fecha || '').trim());

  if (!materia) throw new Error('La materia es obligatoria.');
  if (!Number.isFinite(cantidad) || cantidad < 1) {
    throw new Error('La cantidad debe ser mayor o igual a 1.');
  }
  if (!Number.isFinite(tiempo) || tiempo < 1) {
    throw new Error('El tiempo debe ser mayor o igual a 1.');
  }

  return {
    fecha: fecha,
    materia: materia,
    cantidad: cantidad,
    tiempo: tiempo,
    totalMinutos: cantidad * tiempo
  };
}

function formatDate_(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error('La fecha debe tener formato YYYY-MM-DD.');
  return match[3] + '/' + match[2] + '/' + match[1];
}

function jsonOutput_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
