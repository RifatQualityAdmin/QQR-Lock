/**
 * ============================================================
 * QQR LOCK PROJECT — script.js
 * Standalone static frontend, calls the Apps Script Web App as
 * a JSON API (doPost) instead of using google.script.run, since
 * this page runs as a normal top-level site (fixes camera
 * permission issues caused by Apps Script's iframe wrapper).
 * ============================================================
 */

// TODO: Paste your Apps Script Web App URL here (must end in /exec).
// Deploy -> Manage deployments -> copy the "Web app" URL.
const API_URL = 'PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE';

/**
 * Calls the Apps Script backend as a JSON API.
 * Uses Content-Type: text/plain to avoid triggering a CORS
 * preflight (OPTIONS) request, since Apps Script Web Apps
 * cannot respond to preflight requests.
 *
 * @param {string} action - Name of the server-side function to run.
 * @param {Object} [payload] - Optional arguments for that function.
 * @return {Promise<Object>} The parsed JSON response.
 */
async function callApi(action, payload) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: action, payload: payload || {} })
  });
  const data = await response.json();
  if (data && data.error) {
    throw new Error(data.error);
  }
  return data;
}

  /**
   * ============================================================
   * QQR LOCK PROJECT — JavaScript.html
   * Module 1: Scaffold only.
   * No workflow logic (QR scan, Employee lookup, PMO lookup,
   * Save, etc.) is implemented yet. Those will be added in
   * later modules.
   * ============================================================
   */

  /**
   * Runs once the DOM is fully loaded.
   * Currently just confirms the page initialized correctly.
   */
  /**
   * Shared state for the workflow, populated as the user completes
   * each step. Later modules (PMO, Part/Defect, Save) will read from
   * this object rather than re-fetching already-known data.
   */
  const appState = {
    qrLock: null,   // result from getQRLockData()
    employee: null, // selected employee record ({EmployeeID, EmployeeName, Department, Status})
    pmo: null,      // selected PMO record ({PMO, Customer, File, Style, Color})
    defects: [],    // list of added { part, defect } pairs (new ticket path)
    continueData: null // { ticketNo, round, previousDefects, resolvedStates, checker, newDefects } (continue path)
  };

  document.addEventListener('DOMContentLoaded', function () {
    console.log('QQR Lock app scaffold loaded.');
    initQrScanStep();
    initEmployeeStep();
    initPmoStep();
    initDefectStep();
    initContinueStep();
    initSaveStep();
  });

  /**
   * ============================================================
   * Module 2: QR Scan -> Auto-retrieve Stage / Floor / Line
   * ============================================================
   */

  // Holds the active html5-qrcode scanner instance so it can be stopped later.
  let qrScanner = null;

  /**
   * Wires up all event listeners for the QR Scan step:
   * the "Start Camera Scan" button and the manual entry fallback.
   */
  function initQrScanStep() {
    document.getElementById('btn-start-scan')
      .addEventListener('click', startCameraScan);

    document.getElementById('btn-manual-lookup')
      .addEventListener('click', function () {
        const manualId = document.getElementById('manual-qrlock-id').value.trim();
        if (!manualId) {
          showQrMessage('Please enter a QR Lock ID.', 'error');
          return;
        }
        lookupQrLockId(manualId);
      });
  }

  /**
   * Starts the device camera and begins scanning for a QR code
   * using the html5-qrcode library. Once a code is successfully
   * decoded, the scanner stops and the code is looked up.
   */
  function startCameraScan() {
    const readerElementId = 'qr-reader';
    qrScanner = new Html5Qrcode(readerElementId);

    showQrMessage('Starting camera...', '');

    qrScanner.start(
      { facingMode: 'environment' }, // prefer rear camera
      { fps: 10, qrbox: 250 },
      function onScanSuccess(decodedText) {
        stopCameraScan();
        lookupQrLockId(decodedText);
      },
      function onScanFailure() {
        // Called continuously while no QR code is detected yet.
        // Intentionally left empty - not an error state.
      }
    ).catch(function (err) {
      showQrMessage('Could not start camera: ' + err, 'error');
    });
  }

  /**
   * Stops the active camera scanner, if running.
   */
  function stopCameraScan() {
    if (qrScanner) {
      qrScanner.stop().catch(function () { /* already stopped */ });
    }
  }

  /**
   * Calls the server-side getQRLockData() function for the given
   * QR Lock ID and renders the result (or an error message).
   *
   * @param {string} qrLockId - The scanned or manually entered QR Lock ID.
   */
  function lookupQrLockId(qrLockId) {
    showQrMessage('Looking up "' + qrLockId + '"...', '');

    callApi('getQRLockData', { qrLockId: qrLockId })
      .then(onQrLockDataReceived)
      .catch(function (err) {
        showQrMessage('Error: ' + err.message, 'error');
      });
  }

  /**
   * Handles the response from getQRLockData(): displays Stage/Floor/Line,
   * and if the lock is already in use, renders the existing ticket history.
   *
   * @param {Object} data - Result object returned from the server.
   */
  function onQrLockDataReceived(data) {
    appState.qrLock = data.found ? data : null;

    if (!data.found) {
      showQrMessage(data.message, 'error');
      document.getElementById('qr-result').classList.add('hidden');
      document.getElementById('ticket-history').classList.add('hidden');
      document.getElementById('new-ticket-flow').classList.add('hidden');
      disableEmployeeStep();
      return;
    }

    showQrMessage(data.qrLockId + ' Lock is ' + data.status, 'success');

    document.getElementById('res-stage').textContent = data.stage;
    document.getElementById('res-floor').textContent = data.floor;
    document.getElementById('res-line').textContent = data.line;
    document.getElementById('qr-result').classList.remove('hidden');

    if (data.status === 'In Use' && data.ticketHistory) {
      renderTicketHistory(data.ticketHistory);
      document.getElementById('ticket-history').classList.remove('hidden');
    } else {
      document.getElementById('ticket-history').classList.add('hidden');
    }

    // Only a lock that is currently "Available" shows Steps 2-5 (new
    // ticket flow); "In Use" hides them and shows Continue Inspection.
    if (data.status === 'Available') {
      document.getElementById('step-continue').classList.add('hidden');
      document.getElementById('new-ticket-flow').classList.remove('hidden');
      enableEmployeeStep();
    } else if (data.status === 'In Use' && data.ticketHistory) {
      document.getElementById('new-ticket-flow').classList.add('hidden');
      disableEmployeeStep();
      startContinueInspection(data.ticketHistory, data.qrLockId);
    } else {
      document.getElementById('step-continue').classList.add('hidden');
      document.getElementById('new-ticket-flow').classList.add('hidden');
      disableEmployeeStep();
    }
  }

  /**
   * Renders the existing ticket's PMO/Customer/File/Style/Color/Round
   * plus its related Inspection_History and Defect_History rows into
   * the #ticket-history section (nested inside the QR result box).
   *
   * @param {Object} history - { ticket, inspections, defects }
   */
  function renderTicketHistory(history) {
    if (history.ticket) {
      document.getElementById('res-scan-pmo').textContent = history.ticket.PMO;
      document.getElementById('res-scan-customer').textContent = history.ticket.Customer;
      document.getElementById('res-scan-file').textContent = history.ticket.File;
      document.getElementById('res-scan-style').textContent = history.ticket.Style;
      document.getElementById('res-scan-color').textContent = history.ticket.Color;
      document.getElementById('res-scan-round').textContent = history.ticket.CurrentRound;
    }

    const inspectionsDiv = document.getElementById('history-inspections');
    inspectionsDiv.innerHTML = '';
    if (history.inspections.length === 0) {
      inspectionsDiv.innerHTML = '<div class="history-entry">No inspection records yet.</div>';
    } else {
      history.inspections.forEach(function (row) {
        const el = document.createElement('div');
        el.className = 'history-entry';
        el.textContent = 'Round ' + row.Round + ' - ' + row.Result +
          ' (by ' + row.CheckedByEmployeeName + ' on ' + row.InspectionDateTime + ')';
        inspectionsDiv.appendChild(el);
      });
    }

    const defectsDiv = document.getElementById('history-defects');
    defectsDiv.innerHTML = '';
    if (history.defects.length === 0) {
      defectsDiv.innerHTML = '<div class="history-entry">No defect records yet.</div>';
    } else {
      history.defects.forEach(function (row) {
        const el = document.createElement('div');
        el.className = 'history-entry';
        el.textContent = 'Round ' + row.Round + ' - Part: ' + row.Part + ', Defect: ' + row.Defect;
        defectsDiv.appendChild(el);
      });
    }
  }

  /**
   * Displays a short status/error message under the scan controls.
   *
   * @param {string} text - Message to display.
   * @param {string} type - 'error', 'success', or '' for neutral.
   */
  function showQrMessage(text, type) {
    const el = document.getElementById('qr-scan-message');
    el.textContent = text;
    el.className = 'message' + (type ? ' ' + type : '');
  }

  /**
   * ============================================================
   * Module 3: Employee ID -> Auto-retrieve Employee Name
   * ============================================================
   */

  // Cached list of employees, fetched once from the server, used to
  // power the client-side searchable dropdown without repeated calls.
  let employeeListCache = null;

  /**
   * Wires up the Employee ID searchable dropdown: fetches the employee
   * list in the background, and attaches input/click handlers for
   * searching and selecting an employee.
   */
  function initEmployeeStep() {
    // Fetch the employee list early so it's ready by the time
    // this step becomes enabled.
    callApi('getEmployeeList')
      .then(function (list) { employeeListCache = list; })
      .catch(function (err) { console.error('Failed to load employee list: ' + err.message); });

    const searchInput = document.getElementById('employee-search');
    const dropdown = document.getElementById('employee-dropdown');

    searchInput.addEventListener('input', function () {
      renderEmployeeDropdown(searchInput.value.trim().toLowerCase());
    });

    searchInput.addEventListener('focus', function () {
      renderEmployeeDropdown(searchInput.value.trim().toLowerCase());
    });

    // Hide the dropdown when clicking elsewhere on the page.
    document.addEventListener('click', function (event) {
      if (!document.getElementById('employee-combobox').contains(event.target)) {
        dropdown.classList.add('hidden');
      }
    });
  }

  /**
   * Filters the cached employee list by the given search text
   * (matched against EmployeeID and EmployeeName) and renders the
   * matching results into the dropdown list.
   *
   * @param {string} filterText - Lowercased search text.
   */
  function renderEmployeeDropdown(filterText) {
    const dropdown = document.getElementById('employee-dropdown');
    dropdown.innerHTML = '';

    if (!employeeListCache) {
      dropdown.innerHTML = '<div class="dropdown-empty">Loading employees...</div>';
      dropdown.classList.remove('hidden');
      return;
    }

    const matches = employeeListCache.filter(function (emp) {
      const id = String(emp.EmployeeID).toLowerCase();
      const name = String(emp.EmployeeName).toLowerCase();
      return !filterText || id.indexOf(filterText) !== -1 || name.indexOf(filterText) !== -1;
    });

    if (matches.length === 0) {
      dropdown.innerHTML = '<div class="dropdown-empty">No matching employees.</div>';
    } else {
      matches.slice(0, 50).forEach(function (emp) {
        const item = document.createElement('div');
        item.className = 'dropdown-item';
        item.innerHTML =
          '<div class="item-id">' + emp.EmployeeID + '</div>' +
          '<div class="item-name">' + emp.EmployeeName + '</div>';
        item.addEventListener('click', function () {
          selectEmployee(emp);
        });
        dropdown.appendChild(item);
      });
    }

    dropdown.classList.remove('hidden');
  }

  /**
   * Handles selection of an employee from the dropdown: auto-fills
   * the Employee Name, and blocks the workflow with an error if the
   * employee's Status is not "Active".
   *
   * @param {Object} emp - The selected employee record.
   */
  function selectEmployee(emp) {
    document.getElementById('employee-search').value = emp.EmployeeID + ' - ' + emp.EmployeeName;
    document.getElementById('employee-dropdown').classList.add('hidden');

    if (emp.Status !== 'Active') {
      showEmployeeMessage('Employee "' + emp.EmployeeID + '" is not Active (Status: ' + emp.Status + '). Cannot proceed.', 'error');
      document.getElementById('employee-result').classList.add('hidden');
      appState.employee = null;
      disablePmoStep();
      return;
    }

    showEmployeeMessage('Employee found.', 'success');
    document.getElementById('res-empid').textContent = emp.EmployeeID;
    document.getElementById('res-empname').textContent = emp.EmployeeName;
    document.getElementById('employee-result').classList.remove('hidden');

    appState.employee = emp;
    enablePmoStep();
  }

  /**
   * Enables the Employee ID step (called once the QR Lock step
   * completes with Status = "Available").
   */
  function enableEmployeeStep() {
    document.getElementById('step-employee').classList.remove('disabled');
    document.getElementById('employee-search').disabled = false;
  }

  /**
   * Disables and resets the Employee ID step (called when the QR
   * Lock step hasn't completed, or the lock isn't "Available").
   */
  function disableEmployeeStep() {
    const section = document.getElementById('step-employee');
    section.classList.add('disabled');
    document.getElementById('employee-search').disabled = true;
    document.getElementById('employee-search').value = '';
    document.getElementById('employee-dropdown').classList.add('hidden');
    document.getElementById('employee-result').classList.add('hidden');
    showEmployeeMessage('', '');
    appState.employee = null;
    disablePmoStep();
  }

  /**
   * Displays a short status/error message under the Employee step.
   *
   * @param {string} text - Message to display.
   * @param {string} type - 'error', 'success', or '' for neutral.
   */
  function showEmployeeMessage(text, type) {
    const el = document.getElementById('employee-message');
    el.textContent = text;
    el.className = 'message' + (type ? ' ' + type : '');
  }

  /**
   * ============================================================
   * Module 4: PMO -> Auto-retrieve Customer / File / Style / Color
   * ============================================================
   */

  let pmoListCache = null;

  function initPmoStep() {
    callApi('getPmoList')
      .then(function (list) { pmoListCache = list; })
      .catch(function (err) { console.error('Failed to load PMO list: ' + err.message); });

    const searchInput = document.getElementById('pmo-search');
    const dropdown = document.getElementById('pmo-dropdown');

    searchInput.addEventListener('input', function () {
      renderPmoDropdown(searchInput.value.trim().toLowerCase());
    });

    searchInput.addEventListener('focus', function () {
      renderPmoDropdown(searchInput.value.trim().toLowerCase());
    });

    document.addEventListener('click', function (event) {
      if (!document.getElementById('pmo-combobox').contains(event.target)) {
        dropdown.classList.add('hidden');
      }
    });
  }

  function renderPmoDropdown(filterText) {
    const dropdown = document.getElementById('pmo-dropdown');
    dropdown.innerHTML = '';

    if (!pmoListCache) {
      dropdown.innerHTML = '<div class="dropdown-empty">Loading PMOs...</div>';
      dropdown.classList.remove('hidden');
      return;
    }

    const matches = pmoListCache.filter(function (p) {
      const pmo = String(p.PMO).toLowerCase();
      const customer = String(p.Customer).toLowerCase();
      return !filterText || pmo.indexOf(filterText) !== -1 || customer.indexOf(filterText) !== -1;
    });

    if (matches.length === 0) {
      dropdown.innerHTML = '<div class="dropdown-empty">No matching PMOs.</div>';
    } else {
      matches.slice(0, 50).forEach(function (p) {
        const item = document.createElement('div');
        item.className = 'dropdown-item';
        item.innerHTML =
          '<div class="item-id">' + p.PMO + '</div>' +
          '<div class="item-name">' + p.Customer + ' - ' + p.Style + '</div>';
        item.addEventListener('click', function () { selectPmo(p); });
        dropdown.appendChild(item);
      });
    }

    dropdown.classList.remove('hidden');
  }

  function selectPmo(p) {
    document.getElementById('pmo-search').value = p.PMO;
    document.getElementById('pmo-dropdown').classList.add('hidden');

    showPmoMessage('PMO found.', 'success');
    document.getElementById('res-pmo').textContent = p.PMO;
    document.getElementById('res-customer').textContent = p.Customer;
    document.getElementById('res-file').textContent = p.File;
    document.getElementById('res-style').textContent = p.Style;
    document.getElementById('res-color').textContent = p.Color;
    document.getElementById('pmo-result').classList.remove('hidden');

    appState.pmo = p;
    enableDefectStep();
    enableSaveStep();
  }

  function enablePmoStep() {
    document.getElementById('step-pmo').classList.remove('disabled');
    document.getElementById('pmo-search').disabled = false;
  }

  function disablePmoStep() {
    document.getElementById('step-pmo').classList.add('disabled');
    document.getElementById('pmo-search').disabled = true;
    document.getElementById('pmo-search').value = '';
    document.getElementById('pmo-dropdown').classList.add('hidden');
    document.getElementById('pmo-result').classList.add('hidden');
    showPmoMessage('', '');
    appState.pmo = null;
    disableDefectStep();
    disableSaveStep();
  }

  function showPmoMessage(text, type) {
    const el = document.getElementById('pmo-message');
    el.textContent = text;
    el.className = 'message' + (type ? ' ' + type : '');
  }

  /**
   * ============================================================
   * Module 5: Select Part -> Select Defect -> Add multiple defects
   * ============================================================
   */

  let partListCache = null;
  let defectListCache = null;
  let selectedPart = null;
  let selectedDefect = null;

  function initDefectStep() {
    callApi('getPartList')
      .then(function (list) { partListCache = list; })
      .catch(function (err) { console.error('Failed to load part list: ' + err.message); });

    callApi('getDefectList')
      .then(function (list) { defectListCache = list; })
      .catch(function (err) { console.error('Failed to load defect list: ' + err.message); });

    const partInput = document.getElementById('part-search');
    const partDropdown = document.getElementById('part-dropdown');
    partInput.addEventListener('input', function () { renderPartDropdown(partInput.value.trim().toLowerCase()); });
    partInput.addEventListener('focus', function () { renderPartDropdown(partInput.value.trim().toLowerCase()); });

    const defectInput = document.getElementById('defect-search');
    const defectDropdown = document.getElementById('defect-dropdown');
    defectInput.addEventListener('input', function () { renderDefectDropdown(defectInput.value.trim().toLowerCase()); });
    defectInput.addEventListener('focus', function () { renderDefectDropdown(defectInput.value.trim().toLowerCase()); });

    document.addEventListener('click', function (event) {
      if (!document.getElementById('part-combobox').contains(event.target)) partDropdown.classList.add('hidden');
      if (!document.getElementById('defect-combobox').contains(event.target)) defectDropdown.classList.add('hidden');
    });

    document.getElementById('btn-add-defect').addEventListener('click', addDefectRow);
  }

  function renderPartDropdown(filterText) {
    const dropdown = document.getElementById('part-dropdown');
    dropdown.innerHTML = '';
    if (!partListCache) {
      dropdown.innerHTML = '<div class="dropdown-empty">Loading parts...</div>';
      dropdown.classList.remove('hidden');
      return;
    }
    const matches = partListCache.filter(function (p) {
      return !filterText || String(p.PartName).toLowerCase().indexOf(filterText) !== -1;
    });
    if (matches.length === 0) {
      dropdown.innerHTML = '<div class="dropdown-empty">No matching parts.</div>';
    } else {
      matches.slice(0, 50).forEach(function (p) {
        const item = document.createElement('div');
        item.className = 'dropdown-item';
        item.innerHTML = '<div class="item-id">' + p.PartName + '</div>';
        item.addEventListener('click', function () {
          selectedPart = p;
          document.getElementById('part-search').value = p.PartName;
          dropdown.classList.add('hidden');
        });
        dropdown.appendChild(item);
      });
    }
    dropdown.classList.remove('hidden');
  }

  function renderDefectDropdown(filterText) {
    const dropdown = document.getElementById('defect-dropdown');
    dropdown.innerHTML = '';
    if (!defectListCache) {
      dropdown.innerHTML = '<div class="dropdown-empty">Loading defects...</div>';
      dropdown.classList.remove('hidden');
      return;
    }
    const matches = defectListCache.filter(function (d) {
      return !filterText || String(d.DefectName).toLowerCase().indexOf(filterText) !== -1;
    });
    if (matches.length === 0) {
      dropdown.innerHTML = '<div class="dropdown-empty">No matching defects.</div>';
    } else {
      matches.slice(0, 50).forEach(function (d) {
        const item = document.createElement('div');
        item.className = 'dropdown-item';
        item.innerHTML = '<div class="item-id">' + d.DefectName + '</div>';
        item.addEventListener('click', function () {
          selectedDefect = d;
          document.getElementById('defect-search').value = d.DefectName;
          dropdown.classList.add('hidden');
        });
        dropdown.appendChild(item);
      });
    }
    dropdown.classList.remove('hidden');
  }

  function addDefectRow() {
    if (!selectedPart || !selectedDefect) {
      showDefectMessage('Please select both a Part and a Defect.', 'error');
      return;
    }
    const isDuplicate = appState.defects.some(function (row) {
      return row.part === selectedPart.PartName && row.defect === selectedDefect.DefectName;
    });
    if (isDuplicate) {
      showDefectMessage('This Part + Defect combination is already added.', 'error');
      return;
    }
    appState.defects.push({ part: selectedPart.PartName, defect: selectedDefect.DefectName });
    renderDefectList();
    showDefectMessage('Defect added.', 'success');
    selectedPart = null;
    selectedDefect = null;
    document.getElementById('part-search').value = '';
    document.getElementById('defect-search').value = '';
  }

  function removeDefectRow(index) {
    appState.defects.splice(index, 1);
    renderDefectList();
  }

  function renderDefectList() {
    const container = document.getElementById('defect-list');
    container.innerHTML = '';
    appState.defects.forEach(function (row, index) {
      const item = document.createElement('div');
      item.className = 'defect-list-item';
      item.innerHTML =
        '<span class="defect-item-text">Part: ' + row.part + ' &nbsp;|&nbsp; Defect: ' + row.defect + '</span>' +
        '<button type="button" class="btn-remove">Remove</button>';
      item.querySelector('.btn-remove').addEventListener('click', function () { removeDefectRow(index); });
      container.appendChild(item);
    });
  }

  function enableDefectStep() {
    document.getElementById('step-defects').classList.remove('disabled');
    document.getElementById('part-search').disabled = false;
    document.getElementById('defect-search').disabled = false;
    document.getElementById('btn-add-defect').disabled = false;
  }

  function disableDefectStep() {
    document.getElementById('step-defects').classList.add('disabled');
    document.getElementById('part-search').disabled = true;
    document.getElementById('defect-search').disabled = true;
    document.getElementById('btn-add-defect').disabled = true;
    document.getElementById('part-search').value = '';
    document.getElementById('defect-search').value = '';
    document.getElementById('part-dropdown').classList.add('hidden');
    document.getElementById('defect-dropdown').classList.add('hidden');
    selectedPart = null;
    selectedDefect = null;
    appState.defects = [];
    renderDefectList();
    showDefectMessage('', '');
  }

  function showDefectMessage(text, type) {
    const el = document.getElementById('defect-message');
    el.textContent = text;
    el.className = 'message' + (type ? ' ' + type : '');
  }

  /**
   * ============================================================
   * Module 6a: Save (new ticket path - QR Lock was "Available")
   * ============================================================
   */

  function initSaveStep() {
    document.getElementById('btn-save-ticket').addEventListener('click', submitNewTicket);
  }

  function enableSaveStep() {
    document.getElementById('step-save').classList.remove('disabled');
    document.getElementById('btn-save-ticket').disabled = false;
  }

  function disableSaveStep() {
    document.getElementById('step-save').classList.add('disabled');
    document.getElementById('btn-save-ticket').disabled = true;
    document.getElementById('save-result').classList.add('hidden');
    showSaveMessage('', '');
  }

  function submitNewTicket() {
    if (!appState.qrLock || !appState.employee || !appState.pmo) {
      showSaveMessage('Please complete Steps 1-3 first.', 'error');
      return;
    }

    const payload = {
      qrLockId: appState.qrLock.qrLockId,
      stage: appState.qrLock.stage,
      floor: appState.qrLock.floor,
      line: appState.qrLock.line,
      employeeId: appState.employee.EmployeeID,
      employeeName: appState.employee.EmployeeName,
      pmo: appState.pmo.PMO,
      customer: appState.pmo.Customer,
      file: appState.pmo.File,
      style: appState.pmo.Style,
      color: appState.pmo.Color,
      defects: appState.defects
    };

    document.getElementById('btn-save-ticket').disabled = true;
    showSaveMessage('Saving...', '');

    callApi('saveNewTicket', payload)
      .then(onNewTicketSaved)
      .catch(function (err) {
        showSaveMessage('Error: ' + err.message, 'error');
        document.getElementById('btn-save-ticket').disabled = false;
      });
  }

  function onNewTicketSaved(result) {
    showSaveMessage('Saved successfully.', 'success');
    const box = document.getElementById('save-result');
    box.innerHTML =
      '<div class="result-row"><span class="result-label">Ticket No:</span> ' + result.ticketNo + '</div>' +
      '<div class="result-row"><span class="result-label">Result:</span> ' + result.result + '</div>' +
      '<div class="result-row"><span class="result-label">Status:</span> ' + result.status + '</div>';
    box.classList.remove('hidden');

    setTimeout(resetWholeForm, 2000);
  }

  function showSaveMessage(text, type) {
    const el = document.getElementById('save-message');
    el.textContent = text;
    el.className = 'message' + (type ? ' ' + type : '');
  }

  function resetWholeForm() {
    document.getElementById('qr-result').classList.add('hidden');
    document.getElementById('ticket-history').classList.add('hidden');
    document.getElementById('manual-qrlock-id').value = '';
    showQrMessage('', '');
    appState.qrLock = null;

    disableEmployeeStep();
    document.getElementById('step-continue').classList.add('hidden');
    document.getElementById('new-ticket-flow').classList.add('hidden');
  }

  /**
   * ============================================================
   * Module 6b: Continue Inspection (QR Lock was "In Use")
   * ============================================================
   */

  function initContinueStep() {
    const checkerInput = document.getElementById('checker-search');
    const checkerDropdown = document.getElementById('checker-dropdown');

    checkerInput.addEventListener('input', function () { renderCheckerDropdown(checkerInput.value.trim().toLowerCase()); });
    checkerInput.addEventListener('focus', function () { renderCheckerDropdown(checkerInput.value.trim().toLowerCase()); });

    const cPartInput = document.getElementById('continue-part-search');
    const cPartDropdown = document.getElementById('continue-part-dropdown');
    cPartInput.addEventListener('input', function () { renderContinuePartDropdown(cPartInput.value.trim().toLowerCase()); });
    cPartInput.addEventListener('focus', function () { renderContinuePartDropdown(cPartInput.value.trim().toLowerCase()); });

    const cDefectInput = document.getElementById('continue-defect-search');
    const cDefectDropdown = document.getElementById('continue-defect-dropdown');
    cDefectInput.addEventListener('input', function () { renderContinueDefectDropdown(cDefectInput.value.trim().toLowerCase()); });
    cDefectInput.addEventListener('focus', function () { renderContinueDefectDropdown(cDefectInput.value.trim().toLowerCase()); });

    document.addEventListener('click', function (event) {
      if (!document.getElementById('checker-combobox').contains(event.target)) checkerDropdown.classList.add('hidden');
      if (!document.getElementById('continue-part-combobox').contains(event.target)) cPartDropdown.classList.add('hidden');
      if (!document.getElementById('continue-defect-combobox').contains(event.target)) cDefectDropdown.classList.add('hidden');
    });

    document.getElementById('btn-continue-add-defect').addEventListener('click', addContinueDefectRow);
    document.getElementById('btn-save-continue').addEventListener('click', submitContinueInspection);
  }

  function startContinueInspection(history, qrLockId) {
    if (!history.ticket) {
      showQrMessage('Lock is In Use but its ticket record could not be found.', 'error');
      return;
    }

    const currentRound = Number(history.ticket.CurrentRound) || 1;
    const latestDefects = history.defects.filter(function (d) { return Number(d.Round) === currentRound; });

    appState.continueData = {
      ticketNo: history.ticket.TicketNo,
      qrLockId: qrLockId,
      newRound: currentRound + 1,
      previousDefects: latestDefects,
      resolvedStates: latestDefects.map(function () { return 'unsolved'; }),
      checker: null,
      newDefects: []
    };

    document.getElementById('continue-round-num').textContent = appState.continueData.newRound;
    document.getElementById('checker-search').value = '';
    document.getElementById('checker-result').classList.add('hidden');
    showCheckerMessage('', '');

    renderPreviousDefectsList();

    appState.continueData.newDefects = [];
    document.getElementById('continue-part-search').value = '';
    document.getElementById('continue-defect-search').value = '';
    renderContinueNewDefectList();
    showContinueDefectMessage('', '');
    showSaveContinueMessage('', '');

    document.getElementById('step-continue').classList.remove('hidden');
  }

  function renderPreviousDefectsList() {
    const container = document.getElementById('previous-defects-list');
    container.innerHTML = '';

    if (appState.continueData.previousDefects.length === 0) {
      container.innerHTML = '<div class="dropdown-empty">No open defects from the previous round.</div>';
      return;
    }

    appState.continueData.previousDefects.forEach(function (d, index) {
      const item = document.createElement('div');
      item.className = 'prev-defect-item';
      const groupName = 'prevdef_' + index;
      item.innerHTML =
        '<span class="prev-defect-text">Part: ' + d.Part + ' | Defect: ' + d.Defect + '</span>' +
        '<label><input type="radio" name="' + groupName + '" value="solved"> Solved</label>' +
        '<label><input type="radio" name="' + groupName + '" value="unsolved" checked> Unsolved</label>';

      item.querySelectorAll('input[type="radio"]').forEach(function (radio) {
        radio.addEventListener('change', function () {
          appState.continueData.resolvedStates[index] = radio.value;
        });
      });

      container.appendChild(item);
    });
  }

  function renderCheckerDropdown(filterText) {
    const dropdown = document.getElementById('checker-dropdown');
    dropdown.innerHTML = '';
    if (!employeeListCache) {
      dropdown.innerHTML = '<div class="dropdown-empty">Loading employees...</div>';
      dropdown.classList.remove('hidden');
      return;
    }
    const matches = employeeListCache.filter(function (emp) {
      const id = String(emp.EmployeeID).toLowerCase();
      const name = String(emp.EmployeeName).toLowerCase();
      return !filterText || id.indexOf(filterText) !== -1 || name.indexOf(filterText) !== -1;
    });
    if (matches.length === 0) {
      dropdown.innerHTML = '<div class="dropdown-empty">No matching employees.</div>';
    } else {
      matches.slice(0, 50).forEach(function (emp) {
        const item = document.createElement('div');
        item.className = 'dropdown-item';
        item.innerHTML = '<div class="item-id">' + emp.EmployeeID + '</div><div class="item-name">' + emp.EmployeeName + '</div>';
        item.addEventListener('click', function () { selectChecker(emp); });
        dropdown.appendChild(item);
      });
    }
    dropdown.classList.remove('hidden');
  }

  function selectChecker(emp) {
    document.getElementById('checker-search').value = emp.EmployeeID + ' - ' + emp.EmployeeName;
    document.getElementById('checker-dropdown').classList.add('hidden');

    if (emp.Status !== 'Active') {
      showCheckerMessage('Employee "' + emp.EmployeeID + '" is not Active. Cannot proceed.', 'error');
      document.getElementById('checker-result').classList.add('hidden');
      appState.continueData.checker = null;
      return;
    }

    showCheckerMessage('Employee found.', 'success');
    document.getElementById('res-checker-id').textContent = emp.EmployeeID;
    document.getElementById('res-checker-name').textContent = emp.EmployeeName;
    document.getElementById('checker-result').classList.remove('hidden');

    appState.continueData.checker = emp;
  }

  function showCheckerMessage(text, type) {
    const el = document.getElementById('checker-message');
    el.textContent = text;
    el.className = 'message' + (type ? ' ' + type : '');
  }

  function renderContinuePartDropdown(filterText) {
    const dropdown = document.getElementById('continue-part-dropdown');
    dropdown.innerHTML = '';
    if (!partListCache) {
      dropdown.innerHTML = '<div class="dropdown-empty">Loading parts...</div>';
      dropdown.classList.remove('hidden');
      return;
    }
    const matches = partListCache.filter(function (p) {
      return !filterText || String(p.PartName).toLowerCase().indexOf(filterText) !== -1;
    });
    if (matches.length === 0) {
      dropdown.innerHTML = '<div class="dropdown-empty">No matching parts.</div>';
    } else {
      matches.slice(0, 50).forEach(function (p) {
        const item = document.createElement('div');
        item.className = 'dropdown-item';
        item.innerHTML = '<div class="item-id">' + p.PartName + '</div>';
        item.addEventListener('click', function () {
          continueSelectedPart = p;
          document.getElementById('continue-part-search').value = p.PartName;
          dropdown.classList.add('hidden');
        });
        dropdown.appendChild(item);
      });
    }
    dropdown.classList.remove('hidden');
  }

  function renderContinueDefectDropdown(filterText) {
    const dropdown = document.getElementById('continue-defect-dropdown');
    dropdown.innerHTML = '';
    if (!defectListCache) {
      dropdown.innerHTML = '<div class="dropdown-empty">Loading defects...</div>';
      dropdown.classList.remove('hidden');
      return;
    }
    const matches = defectListCache.filter(function (d) {
      return !filterText || String(d.DefectName).toLowerCase().indexOf(filterText) !== -1;
    });
    if (matches.length === 0) {
      dropdown.innerHTML = '<div class="dropdown-empty">No matching defects.</div>';
    } else {
      matches.slice(0, 50).forEach(function (d) {
        const item = document.createElement('div');
        item.className = 'dropdown-item';
        item.innerHTML = '<div class="item-id">' + d.DefectName + '</div>';
        item.addEventListener('click', function () {
          continueSelectedDefect = d;
          document.getElementById('continue-defect-search').value = d.DefectName;
          dropdown.classList.add('hidden');
        });
        dropdown.appendChild(item);
      });
    }
    dropdown.classList.remove('hidden');
  }

  let continueSelectedPart = null;
  let continueSelectedDefect = null;

  function addContinueDefectRow() {
    if (!continueSelectedPart || !continueSelectedDefect) {
      showContinueDefectMessage('Please select both a Part and a Defect.', 'error');
      return;
    }
    const isDuplicate = appState.continueData.newDefects.some(function (row) {
      return row.part === continueSelectedPart.PartName && row.defect === continueSelectedDefect.DefectName;
    });
    if (isDuplicate) {
      showContinueDefectMessage('This Part + Defect combination is already added.', 'error');
      return;
    }
    appState.continueData.newDefects.push({ part: continueSelectedPart.PartName, defect: continueSelectedDefect.DefectName });
    renderContinueNewDefectList();
    showContinueDefectMessage('Defect added.', 'success');
    continueSelectedPart = null;
    continueSelectedDefect = null;
    document.getElementById('continue-part-search').value = '';
    document.getElementById('continue-defect-search').value = '';
  }

  function renderContinueNewDefectList() {
    const container = document.getElementById('continue-new-defect-list');
    container.innerHTML = '';
    appState.continueData.newDefects.forEach(function (row, index) {
      const item = document.createElement('div');
      item.className = 'defect-list-item';
      item.innerHTML =
        '<span class="defect-item-text">Part: ' + row.part + ' &nbsp;|&nbsp; Defect: ' + row.defect + '</span>' +
        '<button type="button" class="btn-remove">Remove</button>';
      item.querySelector('.btn-remove').addEventListener('click', function () {
        appState.continueData.newDefects.splice(index, 1);
        renderContinueNewDefectList();
      });
      container.appendChild(item);
    });
  }

  function showContinueDefectMessage(text, type) {
    const el = document.getElementById('continue-defect-message');
    el.textContent = text;
    el.className = 'message' + (type ? ' ' + type : '');
  }

  function submitContinueInspection() {
    if (!appState.continueData.checker) {
      showSaveContinueMessage('Please select the checking employee.', 'error');
      return;
    }

    const payload = {
      ticketNo: appState.continueData.ticketNo,
      qrLockId: appState.continueData.qrLockId,
      employeeId: appState.continueData.checker.EmployeeID,
      employeeName: appState.continueData.checker.EmployeeName,
      resolvedDefects: appState.continueData.previousDefects.map(function (d, index) {
        return { part: d.Part, defect: d.Defect, solved: appState.continueData.resolvedStates[index] === 'solved' };
      }),
      newDefects: appState.continueData.newDefects
    };

    document.getElementById('btn-save-continue').disabled = true;
    showSaveContinueMessage('Saving...', '');

    callApi('saveContinueInspection', payload)
      .then(onContinueSaved)
      .catch(function (err) {
        showSaveContinueMessage('Error: ' + err.message, 'error');
        document.getElementById('btn-save-continue').disabled = false;
      });
  }

  function onContinueSaved(result) {
    showSaveContinueMessage('Round ' + result.round + ' saved - Result: ' + result.result + ', Ticket Status: ' + result.status + '.', 'success');
    document.getElementById('btn-save-continue').disabled = false;
    setTimeout(resetWholeForm, 2000);
  }

  function showSaveContinueMessage(text, type) {
    const el = document.getElementById('save-continue-message');
    el.textContent = text;
    el.className = 'message' + (type ? ' ' + type : '');
  }
