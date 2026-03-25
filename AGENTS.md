# Agent Context: Cost Splitter

This is a single-page, **no-backend** web application used to split costs proportionally among groups. It is designed to be entirely stateless, relying on the URL for data persistence.

## 🏗 Architecture & Design
- **Frontend only:** No database, no accounts, no API calls.
- **URL-based Persistence:** All state is stored in the URL using a Base64-encoded JSON string (`?s=...`).
- **Event-Driven:** The app abandoned a timer-based update model in favor of a reactive approach using `oninput`, `onblur`, and `onchange` listeners.
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
   - Result: Someone buying a $5 appetizer pays proportionally less tax/tip than someone buying a $50 steak.

## 🛠 Key Files
- `index.html`: Contains the table structure and the "Shareable Link" UI.
- `script.js`: The "Brain." Contains math logic, DOM manipulation, and Base64 sync logic.
- `style.css`: Handles UI polish and the `:empty` placeholder logic for `contenteditable` cells.

## ⚠️ Implementation Caveats
- **ContentEditable:** Browsers often insert `<br>` or `&nbsp;` when deleting text. `script.js` includes a `blur` cleanup utility to force these cells to be truly empty so CSS placeholders return.
- **Cache Busting:** The app uses manual versioning in the script tag (`script.js?v=X`) to ensure users receive logic updates immediately.
- **Legacy Support:** The loader in `script.js` still supports the old `?state={...}` JSON format for backward compatibility with older shared links.
