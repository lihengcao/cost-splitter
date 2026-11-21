/**
 * Cost Splitter - Core Logic
 * Handles real-time math, proportional tax/tip splitting,
 * and Base64 URL state persistence.
 */

let saveTimeout = null;
let copyResetTimeout = null;
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

  // Debounce URL persistence (status flips to "Synced" once this actually runs)
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(persistStateToUrl, 300);
}

// --- 2. Data Helpers ---

// Lenient number parsing: tolerates "$12.50", " 12 ", and "1,200.50".
// Commas are only stripped when they look like thousands separators,
// so "12,50" still parses the same way it did before (as 12).
function parseAmount(text) {
  const cleaned = String(text || "")
    .replace(/[$\s]/g, "")
    .replace(/,(?=\d{3}(\D|$))/g, "");
  return parseFloat(cleaned);
}

function getNumericValue(idOrEl) {
  const el =
    typeof idOrEl === "string" ? document.getElementById(idOrEl) : idOrEl;
  return el ? parseAmount(el.innerText) || 0 : 0;
}

function getMultiplierValue(idOrEl = "globalMultiplier") {
  const el =
    typeof idOrEl === "string" ? document.getElementById(idOrEl) : idOrEl;
  if (!el) return 1.0;
  const raw = el.innerText.trim();
  if (raw === "") return 1.0;
  // Allow "18%" as shorthand for a 1.18 multiplier (rounded to avoid IEEE-754 artifacts like 1.1400000000000001)
  if (raw.endsWith("%")) {
    const pct = parseAmount(raw.slice(0, -1));
    return isNaN(pct) ? 1.0 : Number((1 + pct / 100).toPrecision(12));
  }
  const val = parseAmount(raw);
  return isNaN(val) || val === 0 ? 1.0 : val;
}

function booleansToBitmask(boolArray) {
  return boolArray.reduce((acc, val, i) => acc + (val ? Math.pow(2, i) : 0), 0);
}

function bitmaskToBooleans(mask, length) {
  // Use arithmetic instead of bitwise ops so groups larger than 31 people
  // decode the same way booleansToBitmask encoded them (up to 53 people).
  const arr = [];
  for (let i = 0; i < length; i++) {
    arr.push(Math.floor(mask / Math.pow(2, i)) % 2 === 1);
  }
  return arr;
}

function makeCheckbox(checked = false) {
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = checked;
  cb.onchange = triggerFullRefresh;
  return cb;
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
        .call(atob(str.replace(/ /g, "+")), (c) => {
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
    subtotal += getNumericValue(cell);
  });
  document.getElementById("subtotalDisplay").innerText = subtotal.toFixed(2);
  return subtotal;
}

function calculateGrandTotals(subtotal) {
  const adder = getNumericValue("globalAdder");
  const multiplier = getMultiplierValue("globalMultiplier");
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
    const itemCost = getNumericValue(costCell);
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
  n.innerText = "";
  const c = row.insertCell(2);
  c.className = "cost";
  c.contentEditable = true;
  c.innerText = "";
  row.insertCell(3).className = "spacer";

  // Add person checkboxes
  const peopleCount = document
    .getElementById("costTable")
    .rows[0].querySelectorAll(".person-header").length;
  for (let i = 0; i < peopleCount; i++) {
    row.insertCell(-1).appendChild(makeCheckbox());
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
  th.innerText = "";
  costTable.rows[0].appendChild(th);

  // Add body checkboxes (makeCheckbox binds onchange; bindInputEvents(th)
  // below only covers the header, not these new inputs)
  for (let i = 1; i < costTable.rows.length; i++) {
    costTable.rows[i].insertCell(-1).appendChild(makeCheckbox());
  }

  // Update payment table
  payTable.rows[0].insertCell(-1).innerText = "";
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
    window.location.href = url.toString();
  }
}

// --- 5. Persistence (URL) ---

function copyLink() {
  const input = document.getElementById("shareUrlInput");
  if (!input) return;

  // Make sure the link reflects any edits still waiting on the debounce
  clearTimeout(saveTimeout);
  persistStateToUrl();

  // Select the text
  input.select();
  input.setSelectionRange(0, 99999); // For mobile

  const showCopied = () => {
    const btn = document.getElementById("copyBtn");
    if (btn) {
      btn.innerText = "Copied!";
      btn.style.background = "#28a745";
      clearTimeout(copyResetTimeout);
      copyResetTimeout = setTimeout(() => {
        btn.innerText = "Copy Link";
        btn.style.background = "#007bff";
      }, 2000);
    }
  };

  // Fallback for browsers/contexts without the async Clipboard API
  const legacyCopy = () => {
    try {
      if (document.execCommand("copy")) showCopied();
    } catch (e) {}
  };

  // Copy to clipboard
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(input.value).then(showCopied, legacyCopy);
  } else {
    legacyCopy();
  }
}

function persistStateToUrl() {
  const costTable = document.getElementById("costTable");
  const peopleHeaders = costTable.rows[0].querySelectorAll(".person-header");

  const state = {
    p: Array.from(peopleHeaders).map((th) => th.innerText.trim()),
    g: [
      getNumericValue("globalAdder"),
      getMultiplierValue("globalMultiplier"),
      document.getElementById("add_before_mul").checked ? 1 : 0,
    ],
    i: [],
  };

  document.querySelectorAll("#costTable tr[id^='row_']").forEach((row) => {
    const checkboxes = row.querySelectorAll("input[type='checkbox']");
    state.i.push([
      row.querySelector(".itemName").innerText.trim(),
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
  updateSyncStatus("Synced to URL", true);
}

function reconstructUIFromState(state) {
  if (!state || typeof state !== "object") return;

  isBuildingDOM = true;
  const costTable = document.getElementById("costTable");
  const payTable = document.getElementById("paymentTable");

  // 1. Rebuild Headers
  const costHead = costTable.rows[0];
  const payHead = payTable.rows[0];
  // Remove old people columns
  while (costHead.lastElementChild && costHead.lastElementChild.classList.contains("person-header")) {
    costHead.deleteCell(-1);
  }
  while (payHead.cells.length > 0) {
    payHead.deleteCell(0);
  }

  const peopleNames = Array.isArray(state.p || state.people)
    ? state.p || state.people
    : [];
  peopleNames.forEach((rawName) => {
    const name = String(rawName ?? "").trim();
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

  const items = Array.isArray(state.i || state.items)
    ? state.i || state.items
    : [];
  items.forEach((item) => {
    if (!item || typeof item !== "object") return;

    const row = costTable.insertRow(-1);
    const id = nextRowId++;
    row.id = "row_" + id;
    row.insertCell(0).innerHTML = `<button onclick="deleteRow(${id})">❌</button>`;

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
    n.innerText = String(name ?? "").trim();
    const c = row.insertCell(2);
    c.className = "cost";
    c.contentEditable = true;
    c.innerText = cost || "";
    row.insertCell(3).className = "spacer";

    const checks = bitmaskToBooleans(bitmask || 0, peopleNames.length);
    checks.forEach((checked) => {
      row.insertCell(-1).appendChild(makeCheckbox(checked));
    });
  });

  // 3. Globals
  const g = state.g || state.globals || [0, 1, 0];
  if (Array.isArray(g)) {
    document.getElementById("globalAdder").innerText = g[0] || "";
    const multVal = parseFloat(g[1]);
    document.getElementById("globalMultiplier").innerText =
      isNaN(multVal) || multVal === 1 || multVal === 0 ? "" : g[1];
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
      : root.classList &&
          (root.classList.contains("itemName") ||
            root.classList.contains("cost") ||
            root.classList.contains("person-header"))
        ? [root]
        : root.querySelectorAll(".itemName, .cost, .person-header");

  targets.forEach((el) => {
    el.oninput = triggerFullRefresh;
    el.onblur = (e) => {
      // Cleanup: if the cell only contains whitespace or a browser <br>, make it truly empty
      if (e.target.innerText.trim() === "") {
        e.target.innerHTML = "";
      }
      triggerFullRefresh();
    };
    el.onpaste = (e) => {
      // Strip rich formatting (bold, links, table HTML) and newlines on paste
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData)
        .getData("text")
        .replace(/\s*[\r\n]+\s*/g, " ")
        .trim();
      document.execCommand("insertText", false, text);
    };
    el.onkeydown = (e) => {
      // Ignore Enter while an IME (e.g. CJK input) is composing text
      if (e.key === "Enter" && !e.isComposing) {
        e.preventDefault(); // Prevent default inserting of <br>

        if (el.classList.contains("itemName") || el.classList.contains("cost")) {
          const currentRow = el.closest("tr");
          if (currentRow) {
            let nextRow = currentRow.nextElementSibling;
            if (!nextRow) {
              addNewRow();
              nextRow = currentRow.nextElementSibling;
            }
            if (nextRow) {
              const targetClass = el.classList.contains("itemName") ? ".itemName" : ".cost";
              const nextCell = nextRow.querySelector(targetClass);
              if (nextCell) {
                nextCell.focus();
                try {
                  const range = document.createRange();
                  range.selectNodeContents(nextCell);
                  const selection = window.getSelection();
                  selection.removeAllRanges();
                  selection.addRange(range);
                } catch (err) {}
              }
            }
          }
        } else if (el.classList.contains("person-header")) {
          let nextHeader = el.nextElementSibling;
          if (!nextHeader || !nextHeader.classList.contains("person-header")) {
            addNewPerson();
            const headers = document.querySelectorAll("#costTable .person-header");
            nextHeader = headers[headers.length - 1];
          }
          if (nextHeader) {
            nextHeader.focus();
            try {
              const range = document.createRange();
              range.selectNodeContents(nextHeader);
              const selection = window.getSelection();
              selection.removeAllRanges();
              selection.addRange(range);
            } catch (err) {}
          }
        } else if (el.id === "globalAdder") {
          const multiplierEl = document.getElementById("globalMultiplier");
          if (multiplierEl) {
            multiplierEl.focus();
            try {
              const range = document.createRange();
              range.selectNodeContents(multiplierEl);
              const selection = window.getSelection();
              selection.removeAllRanges();
              selection.addRange(range);
            } catch (err) {}
          }
        } else if (el.id === "globalMultiplier") {
          el.blur();
        }
      }
    };
  });

  const inputs =
    root === document
      ? document.querySelectorAll("input[type='checkbox']")
      : root.querySelectorAll("input[type='checkbox']");

  inputs.forEach((el) => {
    el.onchange = triggerFullRefresh;
  });
}

window.addEventListener("load", () => {
  const params = new URLSearchParams(window.location.search);
  const b64State = params.get("s");
  const legacyState = params.get("state");

  // A truncated or mangled link (common when pasted through chat apps) must
  // not crash init, otherwise no event handlers get bound.
  try {
    if (b64State) {
      const decoded = fromB64(b64State);
      if (decoded) reconstructUIFromState(JSON.parse(decoded));
    } else if (legacyState) {
      reconstructUIFromState(JSON.parse(legacyState));
    }
  } catch (e) {
    console.warn("Could not restore state from URL:", e);
  } finally {
    isBuildingDOM = false;
  }

  bindInputEvents();
  refreshCalculations();
  persistStateToUrl();
});

// Alias for HTML button compatibility
window.addItem = addNewRow;
window.addPerson = addNewPerson;
window.copyLink = copyLink;
window.deleteRow = deleteRow;
window.resetState = resetState;
