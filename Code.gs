/**
 * ============================================================
 * QQR LOCK PROJECT — Code.gs
 * Module 1: Project Scaffold
 * ------------------------------------------------------------
 * This file contains only the base setup for the Web App:
 *   - Configuration constants (Spreadsheet ID, Sheet names)
 *   - doGet() entry point that serves the web app
 *   - include() helper to assemble HTML from separate partials
 *
 * NOTE: No business logic (QR lookup, Employee lookup, PMO
 * lookup, Save logic, etc.) is implemented yet. Those will be
 * added module by module, per the agreed workflow.
 * ============================================================
 */

/**
 * ID of the Google Sheet that acts as the database for this project.
 * TODO: Replace with the actual Spreadsheet ID before deployment.
 * (Found in the sheet URL: .../spreadsheets/d/SPREADSHEET_ID/edit)
 */
const SPREADSHEET_ID = '1Xb6kJvbNMuRxQzOsa_9b4nbCsiijEvbJEKXD2yYYJOY';

/**
 * Centralized reference to all sheet (tab) names used in this project.
 * These MUST exactly match the existing tab names in the spreadsheet.
 * Using this constant object (instead of hardcoded strings) throughout
 * the codebase means the tab names only ever need to be defined once.
 */
const SHEET_NAMES = {
  PMO_MASTER: 'PMO_Master',
  QRLOCK_MASTER: 'QRLock_Master',
  EMPLOYEE_MASTER: 'Employee_Master',
  TICKET_MASTER: 'Ticket_Master',
  INSPECTION_HISTORY: 'Inspection_History',
  DEFECT_HISTORY: 'Defect_History',
  PART_MASTER: 'Part_Master',
  DEFECT_MASTER: 'Defect_Master',
  FIELD_DICTIONARY: 'Field_Dictionary'
};

/**
 * Returns the active Spreadsheet object for this project.
 * Centralizing this call makes it easy to swap the data source
 * (e.g. for testing) without touching every function that needs it.
 *
 * @return {Spreadsheet} The bound Google Spreadsheet object.
 */
function getDatabase() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

/**
 * Web App entry point. Runs when a user opens the Web App URL.
 * Serves Index.html as the main page of the application.
 *
 * @param {Object} e - Event object passed by the Apps Script runtime.
 * @return {HtmlOutput} The rendered HTML page.
 */
function doGet(e) {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('QQR Lock')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Helper function used inside HTML templates to include separate
 * HTML partial files (e.g. CSS or JS files) into the main page.
 * Usage in HTML: <?!= include('Stylesheet'); ?>
 *
 * @param {string} filename - Name of the HTML file to include (no extension).
 * @return {string} The raw content of the specified HTML file.
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * ============================================================
 * JSON API Router (doPost)
 * ------------------------------------------------------------
 * Added because camera access (getUserMedia) is blocked inside
 * the iframe that Apps Script uses to serve HtmlService pages.
 * The frontend now lives on a separate static host (e.g. GitHub
 * Pages) as a normal top-level page, and calls this Web App as a
 * JSON API instead of using google.script.run.
 *
 * All existing lookup functions (getQRLockData, getEmployeeList,
 * etc.) are unchanged - this just routes requests to them.
 *
 * Expected POST body (JSON): { "action": "functionName", "payload": {...} }
 * Sent with Content-Type: text/plain to avoid CORS preflight,
 * since Apps Script cannot respond to OPTIONS preflight requests.
 * ============================================================
 */
function doPost(e) {
  let result;

  try {
    const request = JSON.parse(e.postData.contents);
    const action = request.action;
    const payload = request.payload || {};

    switch (action) {
      case 'getQRLockData':
        result = getQRLockData(payload.qrLockId);
        break;
      case 'getEmployeeList':
        result = getEmployeeList();
        break;
      case 'getEmployeeData':
        result = getEmployeeData(payload.employeeId);
        break;
      case 'getPmoList':
        result = getPmoList();
        break;
      case 'getPmoData':
        result = getPmoData(payload.pmo);
        break;
      case 'getPartList':
        result = getPartList();
        break;
      case 'getDefectList':
        result = getDefectList();
        break;
      case 'saveNewTicket':
        result = saveNewTicket(payload);
        break;
      case 'saveContinueInspection':
        result = saveContinueInspection(payload);
        break;
      default:
        result = { error: 'Unknown action: ' + action };
    }
  } catch (err) {
    result = { error: err.message };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * ============================================================
 * Module 2: QR Scan -> Auto-retrieve Stage / Floor / Line
 * ============================================================
 */

/**
 * Generic helper: reads all data from a given sheet and returns it
 * as an array of plain objects, where each object's keys are taken
 * from the header row (row 1) and values come from that row's cells.
 * Blank rows (all cells empty) are skipped.
 *
 * This is reused by every lookup module (QR Lock, Employee, PMO, etc.)
 * so we don't repeat the same "read sheet -> map to headers" logic.
 *
 * @param {string} sheetName - Exact name of the sheet/tab to read.
 * @return {Object[]} Array of row objects keyed by column header.
 */
function getSheetDataAsObjects(sheetName) {
  const sheet = getDatabase().getSheetByName(sheetName);
  if (!sheet) {
    throw new Error('Sheet not found: ' + sheetName);
  }
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const rows = data.slice(1);

  return rows
    .filter(function (row) {
      return row.some(function (cell) { return cell !== ''; });
    })
    .map(function (row) {
      const obj = {};
      headers.forEach(function (header, i) {
        const value = row[i];
        // Convert Date objects to plain strings - google.script.run (and
        // JSON serialization for the API) can fail on raw Date objects.
        obj[header] = (value instanceof Date)
          ? Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss')
          : value;
      });
      return obj;
    });
}

/**
 * Looks up a scanned QRLockID in QRLock_Master and returns its
 * Stage, Floor, Line, and Status.
 *
 * If the lock's Status is "In Use", this also attaches the full
 * history of the ticket currently assigned to it (Ticket_Master
 * record + related Inspection_History and Defect_History rows),
 * per the agreed behavior: show existing data instead of blocking.
 *
 * @param {string} qrLockId - The QRLockID value scanned from the QR code.
 * @return {Object} Result object describing what was found.
 */
function getQRLockData(qrLockId) {
  const lockRows = getSheetDataAsObjects(SHEET_NAMES.QRLOCK_MASTER);
  const lock = lockRows.find(function (r) {
    return String(r.QRLockID).trim() === String(qrLockId).trim();
  });

  if (!lock) {
    return {
      found: false,
      message: 'QR Lock ID "' + qrLockId + '" was not found in QRLock_Master.'
    };
  }

  const result = {
    found: true,
    qrLockId: lock.QRLockID,
    stage: lock.Stage,
    floor: lock.Floor,
    line: lock.Line,
    status: lock.Status,
    currentTicket: lock.CurrentTicket,
    ticketHistory: null
  };

  // If this lock is already in use, pull the existing ticket's history
  // so the user can see what was previously entered for it.
  if (lock.Status === 'In Use' && lock.CurrentTicket) {
    result.ticketHistory = getTicketHistory(lock.CurrentTicket);
  }

  return result;
}

/**
 * Retrieves the full recorded history for a given TicketNo:
 * the Ticket_Master record itself, plus all related rows from
 * Inspection_History and Defect_History.
 *
 * @param {string} ticketNo - The TicketNo to look up.
 * @return {Object} { ticket, inspections, defects }
 */
function getTicketHistory(ticketNo) {
  const tickets = getSheetDataAsObjects(SHEET_NAMES.TICKET_MASTER);
  const ticket = tickets.find(function (t) {
    return String(t.TicketNo).trim() === String(ticketNo).trim();
  }) || null;

  const inspections = getSheetDataAsObjects(SHEET_NAMES.INSPECTION_HISTORY)
    .filter(function (i) {
      return String(i.TicketNo).trim() === String(ticketNo).trim();
    });

  const defects = getSheetDataAsObjects(SHEET_NAMES.DEFECT_HISTORY)
    .filter(function (d) {
      return String(d.TicketNo).trim() === String(ticketNo).trim();
    });

  return { ticket: ticket, inspections: inspections, defects: defects };
}

/**
 * ============================================================
 * Module 3: Employee ID -> Auto-retrieve Employee Name
 * ============================================================
 */

/**
 * Returns the full list of employees from Employee_Master, used to
 * populate the client-side searchable Employee ID dropdown.
 * Includes Status so the client can flag/block inactive employees
 * as soon as one is selected.
 *
 * @return {Object[]} Array of { EmployeeID, EmployeeName, Department, Status }.
 */
function getEmployeeList() {
  return getSheetDataAsObjects(SHEET_NAMES.EMPLOYEE_MASTER).map(function (e) {
    return {
      EmployeeID: e.EmployeeID,
      EmployeeName: e.EmployeeName,
      Department: e.Department,
      Status: e.Status
    };
  });
}

/**
 * Looks up a single employee by EmployeeID in Employee_Master.
 * Used as an authoritative server-side re-check (in addition to the
 * client-side cached list) before allowing the workflow to proceed,
 * in case the sheet changed since the dropdown was loaded.
 *
 * @param {string} employeeId - The EmployeeID to look up.
 * @return {Object} Result object describing what was found.
 */
function getEmployeeData(employeeId) {
  const employees = getSheetDataAsObjects(SHEET_NAMES.EMPLOYEE_MASTER);
  const employee = employees.find(function (e) {
    return String(e.EmployeeID).trim() === String(employeeId).trim();
  });

  if (!employee) {
    return {
      found: false,
      message: 'Employee ID "' + employeeId + '" was not found in Employee_Master.'
    };
  }

  return {
    found: true,
    employeeId: employee.EmployeeID,
    employeeName: employee.EmployeeName,
    department: employee.Department,
    status: employee.Status
  };
}

/**
 * ============================================================
 * Module 4: PMO -> Auto-retrieve Customer / File / Style / Color
 * ============================================================
 */

/**
 * Returns the full list of PMO records from PMO_Master, used to
 * populate the client-side searchable PMO dropdown.
 *
 * @return {Object[]} Array of { PMO, Customer, File, Style, Color }.
 */
function getPmoList() {
  return getSheetDataAsObjects(SHEET_NAMES.PMO_MASTER).map(function (p) {
    return {
      PMO: p.PMO,
      Customer: p.Customer,
      File: p.File,
      Style: p.Style,
      Color: p.Color
    };
  });
}

/**
 * Looks up a single PMO record by PMO code in PMO_Master.
 *
 * @param {string} pmo - The PMO code to look up.
 * @return {Object} Result object describing what was found.
 */
function getPmoData(pmo) {
  const rows = getSheetDataAsObjects(SHEET_NAMES.PMO_MASTER);
  const match = rows.find(function (r) {
    return String(r.PMO).trim() === String(pmo).trim();
  });

  if (!match) {
    return {
      found: false,
      message: 'PMO "' + pmo + '" was not found in PMO_Master.'
    };
  }

  return {
    found: true,
    pmo: match.PMO,
    customer: match.Customer,
    file: match.File,
    style: match.Style,
    color: match.Color
  };
}

/**
 * ============================================================
 * Module 5: Select Part -> Select Defect -> Add multiple defects
 * ============================================================
 */

/**
 * Returns the full list of parts from Part_Master, used to
 * populate the client-side searchable Part dropdown.
 *
 * @return {Object[]} Array of { PartName }.
 */
function getPartList() {
  return getSheetDataAsObjects(SHEET_NAMES.PART_MASTER);
}

/**
 * Returns the full list of defects from Defect_Master, used to
 * populate the client-side searchable Defect dropdown.
 *
 * @return {Object[]} Array of { DefectName }.
 */
function getDefectList() {
  return getSheetDataAsObjects(SHEET_NAMES.DEFECT_MASTER);
}

/**
 * ============================================================
 * Module 6: Save
 * ============================================================
 */

/**
 * Generates a reasonably unique ID string with a given prefix.
 * Format: PREFIX-yyyyMMddHHmmss-xxx
 *
 * @param {string} prefix - e.g. 'TCK', 'INS', 'DEF'.
 * @return {string} Generated ID.
 */
function generateId(prefix) {
  const ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMddHHmmss');
  const rand = Math.floor(100 + Math.random() * 900);
  return prefix + '-' + ts + '-' + rand;
}

/**
 * Appends a row to a sheet, mapping an object's keys to the sheet's
 * actual header row - so column order in the sheet doesn't need to
 * match the order keys are written in code.
 *
 * @param {string} sheetName - Exact sheet/tab name.
 * @param {Object} rowObject - Keys must match column headers.
 */
function appendRowByHeaders(sheetName, rowObject) {
  const sheet = getDatabase().getSheetByName(sheetName);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const row = headers.map(function (h) {
    return rowObject.hasOwnProperty(h) ? rowObject[h] : '';
  });
  sheet.appendRow(row);
}

/**
 * Updates specific columns of the first row where keyColumn matches
 * keyValue.
 *
 * @param {string} sheetName - Exact sheet/tab name.
 * @param {string} keyColumn - Header name to match on (e.g. 'TicketNo').
 * @param {string} keyValue - Value to find in that column.
 * @param {Object} updates - { ColumnHeader: newValue, ... }
 * @return {boolean} True if a matching row was found and updated.
 */
function updateRowByKey(sheetName, keyColumn, keyValue, updates) {
  const sheet = getDatabase().getSheetByName(sheetName);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const keyIndex = headers.indexOf(keyColumn);

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][keyIndex]).trim() === String(keyValue).trim()) {
      Object.keys(updates).forEach(function (col) {
        const colIndex = headers.indexOf(col);
        if (colIndex !== -1) {
          sheet.getRange(i + 1, colIndex + 1).setValue(updates[col]);
        }
      });
      return true;
    }
  }
  return false;
}

/**
 * Saves a brand-new ticket (used when the scanned QR Lock's Status
 * was "Available"). Creates Round 1: inserts Ticket_Master,
 * Inspection_History, and (if any defects were found) Defect_History
 * rows, then updates QRLock_Master.
 *
 * If no defects were added, the ticket passes immediately and the
 * lock is released back to "Available".
 *
 * @param {Object} data - {
 *   qrLockId, stage, floor, line,
 *   employeeId, employeeName,
 *   pmo, customer, file, style, color,
 *   defects: [{part, defect}, ...]
 * }
 * @return {Object} { success, ticketNo, round, result, status }
 */
function saveNewTicket(data) {
  const now = new Date();
  const ticketNo = generateId('TCK');
  const round = 1;
  const defects = data.defects || [];
  const result = defects.length === 0 ? 'Pass' : 'Fail';
  const status = result === 'Pass' ? 'Closed' : 'Open';

  appendRowByHeaders(SHEET_NAMES.TICKET_MASTER, {
    TicketNo: ticketNo,
    QRLockID: data.qrLockId,
    Stage: data.stage,
    Floor: data.floor,
    Line: data.line,
    EmployeeID: data.employeeId,
    EmployeeName: data.employeeName,
    PMO: data.pmo,
    Customer: data.customer,
    File: data.file,
    Style: data.style,
    Color: data.color,
    Status: status,
    CurrentRound: round,
    CreatedDateTime: now,
    ClosedDateTime: status === 'Closed' ? now : ''
  });

  appendRowByHeaders(SHEET_NAMES.INSPECTION_HISTORY, {
    InspectionID: generateId('INS'),
    TicketNo: ticketNo,
    Round: round,
    CheckedByEmployeeID: data.employeeId,
    CheckedByEmployeeName: data.employeeName,
    Result: result,
    InspectionDateTime: now
  });

  defects.forEach(function (d) {
    appendRowByHeaders(SHEET_NAMES.DEFECT_HISTORY, {
      DefectID: generateId('DEF'),
      TicketNo: ticketNo,
      Round: round,
      Part: d.part,
      Defect: d.defect
    });
  });

  updateRowByKey(SHEET_NAMES.QRLOCK_MASTER, 'QRLockID', data.qrLockId, {
    Status: status === 'Closed' ? 'Available' : 'In Use',
    CurrentTicket: status === 'Closed' ? '' : ticketNo
  });

  return { success: true, ticketNo: ticketNo, round: round, result: result, status: status };
}

/**
 * Saves the next inspection round for an existing "In Use" ticket.
 * Any previous-round defect marked "unsolved" is carried forward
 * into this round's Defect_History, combined with any newly added
 * defects. If the combined list is empty, the ticket passes and
 * closes, and the QR Lock is released back to "Available".
 *
 * @param {Object} data - {
 *   ticketNo, qrLockId, employeeId, employeeName,
 *   resolvedDefects: [{part, defect, solved: boolean}, ...],
 *   newDefects: [{part, defect}, ...]
 * }
 * @return {Object} { success, ticketNo, round, result, status }
 */
function saveContinueInspection(data) {
  const now = new Date();

  const inspections = getSheetDataAsObjects(SHEET_NAMES.INSPECTION_HISTORY)
    .filter(function (i) { return String(i.TicketNo).trim() === String(data.ticketNo).trim(); });
  const maxRound = inspections.reduce(function (max, i) {
    return Math.max(max, Number(i.Round) || 0);
  }, 0);
  const round = maxRound + 1;

  const unsolvedCarried = (data.resolvedDefects || [])
    .filter(function (d) { return !d.solved; })
    .map(function (d) { return { part: d.part, defect: d.defect }; });

  const combined = unsolvedCarried.concat(data.newDefects || []);
  const result = combined.length === 0 ? 'Pass' : 'Fail';
  const status = result === 'Pass' ? 'Closed' : 'Open';

  appendRowByHeaders(SHEET_NAMES.INSPECTION_HISTORY, {
    InspectionID: generateId('INS'),
    TicketNo: data.ticketNo,
    Round: round,
    CheckedByEmployeeID: data.employeeId,
    CheckedByEmployeeName: data.employeeName,
    Result: result,
    InspectionDateTime: now
  });

  combined.forEach(function (d) {
    appendRowByHeaders(SHEET_NAMES.DEFECT_HISTORY, {
      DefectID: generateId('DEF'),
      TicketNo: data.ticketNo,
      Round: round,
      Part: d.part,
      Defect: d.defect
    });
  });

  updateRowByKey(SHEET_NAMES.TICKET_MASTER, 'TicketNo', data.ticketNo, {
    Status: status,
    CurrentRound: round,
    ClosedDateTime: status === 'Closed' ? now : ''
  });

  updateRowByKey(SHEET_NAMES.QRLOCK_MASTER, 'QRLockID', data.qrLockId, {
    Status: status === 'Closed' ? 'Available' : 'In Use',
    CurrentTicket: status === 'Closed' ? '' : data.ticketNo
  });

  return { success: true, ticketNo: data.ticketNo, round: round, result: result, status: status };
}
