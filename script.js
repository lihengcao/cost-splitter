/**
 * Cost Splitter - Core Logic
 * Handles real-time math, proportional tax/tip splitting,
 * and Base64 URL state persistence.
 */

let saveTimeout = null;
let isBuildingDOM = false;
let nextRowId = 3;

// --- 1. UI & Sync Indicators ---

function updateSyncStatus(msg, isReady) {
  const statusEl = document.getElementById("sync-status");
  if (!statusEl) return;
  statusEl.innerHTML = isReady ? "&#10003; " + msg : "&#8635; " + msg;
  statusEl.style.color = isReady ? "#28a745" : "#e67e22";
}

function triggerFullRefresh() {
  if (isBuildingDOM) return;
  updateSyncStatus("Syncing...", false);

  // Execute logic
  refreshCalculations();

  // Debounce URL persistence
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(persistStateToUrl, 300);
}

// --- 2. Data Helpers ---

function getNumericValue(idOrEl) {
  const el =
    typeof idOrEl === "string" ? document.getElementById(idOrEl) : idOrEl;
  return el ? parseFloat(el.innerText) || 0 : 0;
}

function booleansToBitmask(boolArray) {
  return boolArray.reduce((acc, val, i) => acc + (val ? Math.pow(2, i) : 0), 0);
}

function bitmaskToBooleans(mask, length) {
  const arr = [];
  for (let i = 0; i < length; i++) {
    arr.push(!!(mask & (1 << i)));
  }
  return arr;
}

function toB64(str) {
  return btoa(
    encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (match, p1) => {
      return String.fromCharCode("0x" + p1);
    }),
  );
}

function fromB64(str) {
  try {
    return decodeURIComponent(
      Array.prototype.map
        .call(atob(str), (c) => {
          return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
        })
        .join(""),
    );
  } catch (e) {
    return null;
  }
}

// --- 3. Mathematical Engine ---

function refreshCalculations() {
  const costTable = document.getElementById("costTable");
  const paymentTable = document.getElementById("paymentTable");
  if (!costTable || !paymentTable) return;

  const people = syncPeopleHeaders(costTable, paymentTable);
  const subtotal = calculateSubtotal();
  const totals = calculateGrandTotals(subtotal);

  splitCostsProportionally(people, subtotal, totals, costTable, paymentTable);

  updateSyncStatus("Synced to URL", true);
}

function syncPeopleHeaders(costTable, paymentTable) {
  const costHeader = costTable.rows[0];
  const paymentHeader = paymentTable.rows[0];
  const people = [];

  // Find where people columns start (marked by .person-header)
  let startIndex = -1;
  for (let i = 0; i < costHeader.cells.length; i++) {
    if (costHeader.cells[i].classList.contains("person-header")) {
      startIndex = i;
      break;
    }
  }

  if (startIndex === -1) return { names: [], colStart: 0 };

  // Clear and rebuild payment header to ensure perfect sync
  while (paymentHeader.cells.length > 0) paymentHeader.deleteCell(0);

  for (let i = startIndex; i < costHeader.cells.length; i++) {
    const name = costHeader.cells[i].innerText.trim() || "???";
    people.push(name);
    const pCell = paymentHeader.insertCell(-1);
    pCell.innerText = name;
    pCell.style.padding = "8px";
    pCell.style.fontWeight = "bold";
  }
  return { names: people, colStart: startIndex };
}

function calculateSubtotal() {
  let subtotal = 0;
  document.querySelectorAll("#costTable .cost").forEach((cell) => {
    subtotal += parseFloat(cell.innerText) || 0;
  });
  document.getElementById("subtotalDisplay").innerText = subtotal.toFixed(2);
  return subtotal;
}

function calculateGrandTotals(subtotal) {
  const adder = getNumericValue("globalAdder");
  const multiplier = getNumericValue("globalMultiplier");
  const addBefore = document.getElementById("add_before_mul").checked;

  const total = addBefore
    ? (subtotal + adder) * multiplier
    : subtotal * multiplier + adder;
  document.getElementById("totalDisplay").innerText = total.toFixed(2);

  return { adder, multiplier, addBefore };
}

function splitCostsProportionally(
  people,
  subtotal,
  globals,
  costTable,
  paymentTable,
) {
  const personBaseCosts = Array(people.names.length).fill(0);
  const itemRows = document.querySelectorAll("#costTable tr[id^='row_']");

  itemRows.forEach((row) => {
    const costCell = row.querySelector(".cost");
    const itemCost = costCell ? parseFloat(costCell.innerText) || 0 : 0;
    const checkboxes = row.querySelectorAll("input[type='checkbox']");

    let checkedIndices = [];
    checkboxes.forEach((cb, idx) => {
      if (cb.checked) checkedIndices.push(idx);
    });

    const divisor = checkedIndices.length || people.names.length || 1;
    const split = itemCost / divisor;

    if (checkedIndices.length === 0) {
      for (let i = 0; i < personBaseCosts.length; i++)
        personBaseCosts[i] += split;
    } else {
      checkedIndices.forEach((idx) => {
        if (idx < personBaseCosts.length) personBaseCosts[idx] += split;
      });
    }
  });

  const resultRow = paymentTable.rows[1];
  // Clear and rebuild result row to ensure perfect sync
  while (resultRow.cells.length > 0) resultRow.deleteCell(0);

  for (let i = 0; i < people.names.length; i++) {
    const shareRatio =
      subtotal === 0
        ? 1 / (people.names.length || 1)
        : personBaseCosts[i] / subtotal;
    let finalVal = 0;

    if (globals.addBefore) {
      finalVal =
        globals.multiplier * (personBaseCosts[i] + shareRatio * globals.adder);
    } else {
      finalVal =
        personBaseCosts[i] * globals.multiplier + shareRatio * globals.adder;
    }

    const resCell = resultRow.insertCell(-1);
    resCell.innerText = finalVal.toFixed(2);
    resCell.style.padding = "8px";
    resCell.style.borderTop = "1px solid #dee2e6";
  }
}

// --- 4. DOM Manipulation ---

function addNewRow() {
  const table = document.getElementById("costTable");
  const row = table.insertRow(-1);
  const id = nextRowId++;
  row.id = "row_" + id;

  row.insertCell(0).innerHTML =
    `<button onclick="deleteRow(${id})">❌</button>`;

  const n = row.insertCell(1);
  n.className = "itemName";
  n.contentEditable = true;
  n.innerText = "Item " + id;
  const c = row.insertCell(2);
  c.className = "cost";
  c.contentEditable = true;
  c.innerText = "0";
  row.insertCell(3).className = "spacer";

  // Add person checkboxes
  const peopleCount = document
    .getElementById("costTable")
    .rows[0].querySelectorAll(".person-header").length;
  for (let i = 0; i < peopleCount; i++) {
    const cell = row.insertCell(-1);
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cell.appendChild(cb);
  }

  bindInputEvents(row);
  triggerFullRefresh();
}

function addNewPerson() {
  const costTable = document.getElementById("costTable");
  const payTable = document.getElementById("paymentTable");

  // Add Header
  const th = document.createElement("th");
  th.contentEditable = true;
  th.className = "person-header";
  th.innerText = "✏️ New";
  costTable.rows[0].appendChild(th);

  // Add body checkboxes
  for (let i = 1; i < costTable.rows.length; i++) {
    const cell = costTable.rows[i].insertCell(-1);
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cell.appendChild(cb);
  }

  // Update payment table
  payTable.rows[0].insertCell(-1).innerText = "New";
  payTable.rows[1].insertCell(-1).innerText = "0.00";

  bindInputEvents(th);
  triggerFullRefresh();
}

function deleteRow(id) {
  const row = document.getElementById("row_" + id);
  if (row) row.remove();
  triggerFullRefresh();
}

function resetState() {
  if (confirm("Are you sure you want to clear everything?")) {
    const url = new URL(window.location.href);
    url.searchParams.delete("s");
    url.searchParams.delete("state");
    window.location.href = url.pathname;
  }
}

// --- 5. Persistence (URL) ---

function copyLink() {
  const input = document.getElementById("shareUrlInput");
  if (!input) return;

  // Select the text
  input.select();
  input.setSelectionRange(0, 99999); // For mobile

  // Copy to clipboard
  navigator.clipboard.writeText(input.value).then(() => {
    const btn = document.getElementById("copyBtn");
    if (btn) {
      const oldText = btn.innerText;
      btn.innerText = "Copied!";
      btn.style.background = "#28a745";
      setTimeout(() => {
        btn.innerText = oldText;
        btn.style.background = "#007bff";
      }, 2000);
    }
  });
}

function persistStateToUrl() {
  const costTable = document.getElementById("costTable");
  const peopleHeaders = costTable.rows[0].querySelectorAll(".person-header");

  const state = {
    p: Array.from(peopleHeaders).map((th) => th.innerText),
    g: [
      getNumericValue("globalAdder"),
      getNumericValue("globalMultiplier"),
      document.getElementById("add_before_mul").checked ? 1 : 0,
    ],
    i: [],
  };

  document.querySelectorAll("#costTable tr[id^='row_']").forEach((row) => {
    const checkboxes = row.querySelectorAll("input[type='checkbox']");
    state.i.push([
      row.querySelector(".itemName").innerText,
      getNumericValue(row.querySelector(".cost")),
      booleansToBitmask(Array.from(checkboxes).map((cb) => cb.checked)),
    ]);
  });

  const url = new URL(window.location.href);
  url.searchParams.delete("state");
  url.searchParams.set("s", toB64(JSON.stringify(state)));

  history.replaceState({}, "", url.toString());
  const shareInput = document.getElementById("shareUrlInput");
  if (shareInput) shareInput.value = url.toString();
}

function reconstructUIFromState(state) {
  isBuildingDOM = true;
  const costTable = document.getElementById("costTable");
  const payTable = document.getElementById("paymentTable");

  // 1. Rebuild Headers
  const costHead = costTable.rows[0];
  const payHead = payTable.rows[0];
  // Remove old people columns
  while (costHead.lastElementChild.classList.contains("person-header")) {
    costHead.deleteCell(-1);
  }
  while (payHead.cells.length > 0) {
    payHead.deleteCell(0);
  }

  const peopleNames = state.p || state.people || [];
  peopleNames.forEach((name) => {
    const th = document.createElement("th");
    th.contentEditable = true;
    th.className = "person-header";
    th.innerText = name;
    costHead.appendChild(th);
    payHead.insertCell(-1).innerText = name;
  });

  // 2. Rebuild Rows
  while (costTable.rows.length > 1) costTable.deleteRow(1);
  nextRowId = 1;

  const items = state.i || state.items || [];
  items.forEach((item) => {
    const row = costTable.insertRow(-1);
    const id = nextRowId++;
    row.id = "row_" + id;
    row.insertCell(0).innerHTML =
      `<button onclick="deleteRow(${id})">❌</button>`;

    let name, cost, bitmask;
    if (Array.isArray(item)) {
      [name, cost, bitmask] = item;
    } else {
      name = item.name || item.n;
      cost = item.cost || item.c;
      bitmask = booleansToBitmask(item.checks || item.s || []);
    }

    const n = row.insertCell(1);
    n.className = "itemName";
    n.contentEditable = true;
    n.innerText = name;
    const c = row.insertCell(2);
    c.className = "cost";
    c.contentEditable = true;
    c.innerText = cost;
    row.insertCell(3).className = "spacer";

    const checks = bitmaskToBooleans(bitmask, peopleNames.length);
    checks.forEach((checked) => {
      const cell = row.insertCell(-1);
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = checked;
      cell.appendChild(cb);
    });
  });

  // 3. Globals
  const g = state.g || state.globals || [0, 1, 0];
  if (Array.isArray(g)) {
    document.getElementById("globalAdder").innerText = g[0];
    document.getElementById("globalMultiplier").innerText = g[1];
    document.getElementById("add_before_mul").checked = g[2] === 1;
  }

  // 4. Payment data row
  const resRow = payTable.rows[1];
  while (resRow.cells.length > 0) resRow.deleteCell(0);
  peopleNames.forEach(() => (resRow.insertCell(-1).innerText = "0.00"));

  isBuildingDOM = false;
}

// --- 6. Initialization ---

function bindInputEvents(root = document) {
  const targets =
    root === document
      ? document.querySelectorAll(
          ".itemName, .cost, .person-header, #globalAdder, #globalMultiplier",
        )
      : [root, ...root.querySelectorAll(".itemName, .cost, .person-header")];

  targets.forEach((el) => {
    el.oninput = triggerFullRefresh;
    el.onblur = triggerFullRefresh;
  });

  const inputs =
    root === document
      ? document.querySelectorAll("input")
      : root.querySelectorAll("input");

  inputs.forEach((el) => {
    el.onchange = triggerFullRefresh;
  });
}

window.addEventListener("load", () => {
  const params = new URLSearchParams(window.location.search);
  const b64State = params.get("s");
  const legacyState = params.get("state");

  if (b64State) {
    const decoded = fromB64(b64State);
    if (decoded) reconstructUIFromState(JSON.parse(decoded));
  } else if (legacyState) {
    try {
      reconstructUIFromState(JSON.parse(legacyState));
    } catch (e) {}
  }

  bindInputEvents();
  triggerFullRefresh();
});

// Alias for HTML button compatibility
window.addItem = addNewRow;
window.addPerson = addNewPerson;
window.copyLink = copyLink;
window.deleteRow = deleteRow;
window.resetState = resetState;
