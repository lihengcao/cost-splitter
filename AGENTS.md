# Agent Context: Cost Splitter

> [!IMPORTANT]
> **Agent Directive:** This file (`AGENTS.md`) serves as the core context for AI agents working on this codebase. Whenever any architectural changes, new features, or modifications are implemented, this file **MUST** be updated immediately to keep the technical specifications fully accurate.

This is a single-page, **no-backend** web application used to split costs proportionally among groups. It is designed to be entirely stateless, relying on the URL for data persistence.

## 🏗 Architecture & Design
- **Frontend only:** No database, no accounts, no API calls.
- **URL-based Persistence:** All state is stored in the URL using a Base64-encoded JSON string (`?s=...`).
- **Event-Driven:** The app abandoned a timer-based update model in favor of a reactive approach using `oninput`, `onblur`, `onchange`, and `onkeydown` listeners (for spreadsheet-style navigation).
- **DOM as Source of Truth:** During active usage, the DOM elements (table cells and checkboxes) hold the primary state. This is serialized into the URL on every change.

## 💾 State Management (The `s` Parameter)
To keep URLs shareable and below the standard 2,000-character limit, the state is optimized before encoding:
1. **Key Minification:** Verbose keys like `people` or `items` are shortened to `p` and `i`.
2. **Structural Flattening:** Item objects are converted into flat arrays `[name, cost, bitmask]` to remove repeated JSON keys.
3. **Bitmasking:** Checkbox arrays are converted into a single integer bitmask.
   - Example: `[true, false, true]` becomes binary `101`, stored as `5`.
4. **Base64 Encoding:** The minified JSON is converted to Base64 to bypass URL-encoding bloat (`%22`, etc.) and handle Unicode characters (emojis).

## 🧮 Mathematical Engine
The core logic resides in `script.js` and follows this flow:
1. **Sync Headers:** Ensures the `paymentTable` headers match the `costTable` headers.
2. **Subtotal:** Sums all cells with the `.cost` class.
3. **Proportional Split:** 
   - Calculates the ratio of each person's spending vs. the subtotal.
   - Applies global fees (tax) and multipliers (tip) to each individual total based on that ratio.
   - **Multiplier Fallback & Placeholder Handling:** If the multiplier field is empty (or 0), `getMultiplierValue` defaults to `1.0` to prevent grand totals from being zeroed out. During URL serialization and DOM reconstruction, empty/default values (for multiplier, fixed fees, and item costs) are restored as empty strings (`""`) so CSS `:empty` placeholders (e.g. `1.0`, `0`, `0.00`) render correctly rather than displaying literal zeros.
   - Result: Someone buying a $5 appetizer pays proportionally less tax/tip than someone buying a $50 steak.

## 🛠 Key Files
- `index.html`: Contains the table structure and the "Shareable Link" UI.
- `script.js`: The "Brain." Contains math logic, DOM manipulation, Base64 sync logic, and spreadsheet-style key events.
- `style.css`: Handles UI polish and the `:empty` placeholder logic for `contenteditable` cells.

## ⚠️ Implementation Caveats
- **ContentEditable:** Browsers often insert `<br>` or `&nbsp;` when deleting text. `script.js` includes a `blur` cleanup utility to force these cells to be truly empty so CSS placeholders return, trims text on URL save/restore, and strips rich formatting/newlines on paste via `onpaste`.
- **Spreadsheet Navigation:** The app overrides the default behavior of the `Enter` key on `contenteditable` cells via `onkeydown`. Pressing `Enter` focuses the corresponding cell in the next row (or next header cell) and auto-creates a new row/person if at the boundary, selecting all text inside the focused cell for a premium editing flow. `Enter` is ignored while an IME composition is active (`e.isComposing`).
- **Number Parsing:** All numeric reads go through `parseAmount`, which strips `$`, whitespace, and thousands-separator commas (`1,200.50`). The multiplier also accepts a percent shorthand (`18%` → `1.18`, rounded via `toPrecision(12)` to avoid float artifacts); it is serialized as the numeric multiplier.
- **Checkbox Binding & UX:** Always create person checkboxes with `makeCheckbox()`, which attaches `onchange`. `bindInputEvents(el)` only binds matching editable cells and `input[type="checkbox"]` inside `el`, so it won't catch checkboxes added to other rows (e.g. when adding a person). Clicking anywhere inside a checkbox's `<td>` toggles it via event delegation on `#costTable`.
- **Sync Status:** "Synced to URL" is set inside `persistStateToUrl` (after the debounced write), not after recalculation. Initial load syncs synchronously. `copyLink` flushes any pending save first, resets its `"Copied!"` timer cleanly on repeat clicks, and falls back to `execCommand("copy")` if the Clipboard API is unavailable.
- **Bitmask Limit:** `bitmaskToBooleans` uses arithmetic division rather than 32-bit bitwise operators, matching `booleansToBitmask` safely up to 53 people.
- **Cache Busting:** The app uses manual versioning in the script tag (`script.js?v=X`) to ensure users receive logic updates immediately.
- **Legacy Support:** The loader in `script.js` still supports the old `?state={...}` JSON format for backward compatibility with older shared links. Restoring from the URL validates the parsed object before mutating the DOM and is wrapped in `try/catch/finally` so a malformed link falls back to the blank default table instead of breaking the page.
