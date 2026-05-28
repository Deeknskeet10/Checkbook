/*
 * ATTENTION: The "eval" devtool has been used (maybe by default in mode: "development").
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file in the browser devtools.
 * If you are trying to read the output file, select a different devtool (https://webpack.js.org/configuration/devtool/)
 * or disable the default devtool with "devtool: false".
 * If you are looking for production-ready output files, see mode: "production" (https://webpack.js.org/configuration/mode/).
 */
var pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad;
/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({

/***/ "./LedgersDonut/LedgersDonutApp.tsx"
/*!******************************************!*\
  !*** ./LedgersDonut/LedgersDonutApp.tsx ***!
  \******************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

eval("{__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   LedgersDonutApp: () => (/* binding */ LedgersDonutApp)\n/* harmony export */ });\n/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! react */ \"react\");\n/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(react__WEBPACK_IMPORTED_MODULE_0__);\n/* harmony import */ var _fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! @fluentui/react-components */ \"@fluentui/react-components\");\n/* harmony import */ var _fluentui_react_components__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__);\nfunction _slicedToArray(r, e) { return _arrayWithHoles(r) || _iterableToArrayLimit(r, e) || _unsupportedIterableToArray(r, e) || _nonIterableRest(); }\nfunction _nonIterableRest() { throw new TypeError(\"Invalid attempt to destructure non-iterable instance.\\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.\"); }\nfunction _unsupportedIterableToArray(r, a) { if (r) { if (\"string\" == typeof r) return _arrayLikeToArray(r, a); var t = {}.toString.call(r).slice(8, -1); return \"Object\" === t && r.constructor && (t = r.constructor.name), \"Map\" === t || \"Set\" === t ? Array.from(r) : \"Arguments\" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0; } }\nfunction _arrayLikeToArray(r, a) { (null == a || a > r.length) && (a = r.length); for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e]; return n; }\nfunction _iterableToArrayLimit(r, l) { var t = null == r ? null : \"undefined\" != typeof Symbol && r[Symbol.iterator] || r[\"@@iterator\"]; if (null != t) { var e, n, i, u, a = [], f = !0, o = !1; try { if (i = (t = t.call(r)).next, 0 === l) { if (Object(t) !== t) return; f = !1; } else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0); } catch (r) { o = !0, n = r; } finally { try { if (!f && null != t.return && (u = t.return(), Object(u) !== u)) return; } finally { if (o) throw n; } } return a; } }\nfunction _arrayWithHoles(r) { if (Array.isArray(r)) return r; }\n\n\nvar PALETTE = [\"#0078D4\", \"#107C10\", \"#A4262C\", \"#C19C00\", \"#5C2D91\", \"#038387\", \"#CC4A31\", \"#73AA24\", \"#4F6BED\", \"#9373C0\", \"#E0A45C\", \"#6264A7\", \"#117865\", \"#8764B8\", \"#498205\"];\nvar fmtMoney = n => n.toLocaleString(\"en-US\", {\n  style: \"currency\",\n  currency: \"USD\",\n  maximumFractionDigits: 0\n});\nfunction getLookupName(r, col) {\n  var _a, _b;\n  var raw = r.getValue(col);\n  if (!raw) return null;\n  var v = Array.isArray(raw) ? raw[0] : raw;\n  return (_b = (_a = v === null || v === void 0 ? void 0 : v.name) !== null && _a !== void 0 ? _a : r.getFormattedValue(col)) !== null && _b !== void 0 ? _b : null;\n}\nfunction groupValue(r, groupBy) {\n  switch (groupBy) {\n    case \"ledgerType\":\n      return r.getFormattedValue(\"ledgerType\") || \"(no type)\";\n    case \"direction\":\n      return r.getFormattedValue(\"direction\") || \"(no direction)\";\n    case \"lineOfAccounting\":\n      return getLookupName(r, \"lineOfAccounting\") || \"(no LOA)\";\n    case \"fiscalYear\":\n      return r.getFormattedValue(\"fiscalYear\") || \"(no FY)\";\n    case \"realignment\":\n      return getLookupName(r, \"realignment\") || \"(not a realignment)\";\n    case \"turnIn\":\n      return getLookupName(r, \"turnIn\") || \"(not a turn-in)\";\n  }\n}\nvar GROUP_LABELS = {\n  ledgerType: \"Type\",\n  direction: \"Direction\",\n  lineOfAccounting: \"Line of Accounting\",\n  fiscalYear: \"Fiscal Year\",\n  realignment: \"Realignment\",\n  turnIn: \"Turn-in\"\n};\nfunction donutPath(cx, cy, rOuter, rInner, startAngle, endAngle) {\n  var sweep = endAngle - startAngle;\n  if (sweep >= 360) {\n    return [\"M \".concat(cx + rOuter, \" \").concat(cy), \"A \".concat(rOuter, \" \").concat(rOuter, \" 0 1 1 \").concat(cx - rOuter, \" \").concat(cy), \"A \".concat(rOuter, \" \").concat(rOuter, \" 0 1 1 \").concat(cx + rOuter, \" \").concat(cy), \"M \".concat(cx + rInner, \" \").concat(cy), \"A \".concat(rInner, \" \").concat(rInner, \" 0 1 0 \").concat(cx - rInner, \" \").concat(cy), \"A \".concat(rInner, \" \").concat(rInner, \" 0 1 0 \").concat(cx + rInner, \" \").concat(cy), \"Z\"].join(\" \");\n  }\n  var toRad = a => (a - 90) * (Math.PI / 180);\n  var x1o = cx + rOuter * Math.cos(toRad(startAngle));\n  var y1o = cy + rOuter * Math.sin(toRad(startAngle));\n  var x2o = cx + rOuter * Math.cos(toRad(endAngle));\n  var y2o = cy + rOuter * Math.sin(toRad(endAngle));\n  var x1i = cx + rInner * Math.cos(toRad(endAngle));\n  var y1i = cy + rInner * Math.sin(toRad(endAngle));\n  var x2i = cx + rInner * Math.cos(toRad(startAngle));\n  var y2i = cy + rInner * Math.sin(toRad(startAngle));\n  var largeArc = sweep > 180 ? 1 : 0;\n  return [\"M \".concat(x1o, \" \").concat(y1o), \"A \".concat(rOuter, \" \").concat(rOuter, \" 0 \").concat(largeArc, \" 1 \").concat(x2o, \" \").concat(y2o), \"L \".concat(x1i, \" \").concat(y1i), \"A \".concat(rInner, \" \").concat(rInner, \" 0 \").concat(largeArc, \" 0 \").concat(x2i, \" \").concat(y2i), \"Z\"].join(\" \");\n}\nvar LedgersDonutApp = props => {\n  var dataset = props.dataset,\n    defaultGroupBy = props.defaultGroupBy;\n  var _React$useState = react__WEBPACK_IMPORTED_MODULE_0__.useState(defaultGroupBy),\n    _React$useState2 = _slicedToArray(_React$useState, 2),\n    groupBy = _React$useState2[0],\n    setGroupBy = _React$useState2[1];\n  var _React$useState3 = react__WEBPACK_IMPORTED_MODULE_0__.useState(null),\n    _React$useState4 = _slicedToArray(_React$useState3, 2),\n    hoverKey = _React$useState4[0],\n    setHoverKey = _React$useState4[1];\n  var records = dataset.sortedRecordIds.map(id => dataset.records[id]);\n  // Compute signed amount per row using book_ledgerdirection (Credit=positive, Debit=negative).\n  // This way the donut still aggregates magnitudes by default (we use absolute values for slice\n  // sizing) but reports a \"net\" total in the center label.\n  var slices = react__WEBPACK_IMPORTED_MODULE_0__.useMemo(() => {\n    var _a;\n    var map = new Map();\n    for (var r of records) {\n      var key = groupValue(r, groupBy);\n      var amt = Math.abs((_a = r.getValue(\"amount\")) !== null && _a !== void 0 ? _a : 0);\n      var cur = map.get(key) || {\n        amount: 0,\n        count: 0\n      };\n      cur.amount += amt;\n      cur.count += 1;\n      map.set(key, cur);\n    }\n    var arr = Array.from(map.entries()).map(_ref => {\n      var _ref2 = _slicedToArray(_ref, 2),\n        label = _ref2[0],\n        v = _ref2[1];\n      return {\n        key: label,\n        label,\n        amount: v.amount,\n        count: v.count\n      };\n    }).sort((a, b) => b.amount - a.amount);\n    return arr.map((s, i) => Object.assign(Object.assign({}, s), {\n      color: PALETTE[i % PALETTE.length]\n    }));\n  }, [records.length, groupBy, dataset.sortedRecordIds.join(\"|\")]);\n  var total = slices.reduce((s, x) => s + x.amount, 0);\n  // Net = credits − debits (uses the direction picklist's formatted value)\n  var net = react__WEBPACK_IMPORTED_MODULE_0__.useMemo(() => {\n    var _a;\n    var n = 0;\n    for (var r of records) {\n      var v = (_a = r.getValue(\"amount\")) !== null && _a !== void 0 ? _a : 0;\n      var dir = (r.getFormattedValue(\"direction\") || \"\").toLowerCase();\n      var signed = dir.startsWith(\"d\") ? -Math.abs(v) : Math.abs(v);\n      n += signed;\n    }\n    return n;\n  }, [records.length, dataset.sortedRecordIds.join(\"|\")]);\n  var runningAngle = 0;\n  var paths = slices.map(s => {\n    var sweep = total > 0 ? s.amount / total * 360 : 0;\n    var start = runningAngle;\n    var end = runningAngle + sweep;\n    runningAngle = end;\n    return {\n      slice: s,\n      d: donutPath(110, 110, 100, 60, start, end)\n    };\n  });\n  return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.FluentProvider, {\n    theme: _fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.webLightTheme\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    className: \"arsc-ledgers-donut\",\n    style: {\n      padding: 12,\n      fontFamily: \"Segoe UI, sans-serif\",\n      fontSize: 13,\n      background: \"#FFFFFF\"\n    }\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    style: {\n      display: \"flex\",\n      alignItems: \"center\",\n      gap: 12,\n      marginBottom: 12,\n      flexWrap: \"wrap\"\n    }\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"span\", {\n    style: {\n      fontSize: 15,\n      fontWeight: 600\n    }\n  }, \"Ledgers\"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.Badge, {\n    appearance: \"outline\",\n    color: \"informative\",\n    size: \"medium\"\n  }, records.length, \" entries \\u00B7 gross \", fmtMoney(total)), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.Badge, {\n    appearance: \"tint\",\n    color: net >= 0 ? \"success\" : \"danger\",\n    size: \"medium\"\n  }, \"Net: \", fmtMoney(net)), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    style: {\n      flex: 1\n    }\n  }), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"span\", {\n    style: {\n      color: \"#605E5C\"\n    }\n  }, \"Group by\"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.Dropdown, {\n    size: \"small\",\n    value: GROUP_LABELS[groupBy],\n    selectedOptions: [groupBy],\n    onOptionSelect: (_, d) => setGroupBy(d.optionValue || \"ledgerType\"),\n    style: {\n      minWidth: 180\n    }\n  }, Object.keys(GROUP_LABELS).map(k => (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.Option, {\n    key: k,\n    value: k\n  }, GROUP_LABELS[k]))))), records.length === 0 ? (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    style: {\n      color: \"#605E5C\",\n      padding: \"16px 0\",\n      borderTop: \"1px solid #EDEBE9\"\n    }\n  }, \"No ledger entries in scope.\")) : (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    style: {\n      display: \"flex\",\n      gap: 24,\n      alignItems: \"flex-start\"\n    }\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"svg\", {\n    width: 220,\n    height: 220,\n    viewBox: \"0 0 220 220\",\n    \"aria-label\": \"Ledger donut\"\n  }, paths.map(p => (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"path\", {\n    key: p.slice.key,\n    d: p.d,\n    fill: p.slice.color,\n    fillOpacity: hoverKey == null || hoverKey === p.slice.key ? 1 : 0.35,\n    stroke: \"#fff\",\n    strokeWidth: 1,\n    onMouseEnter: () => setHoverKey(p.slice.key),\n    onMouseLeave: () => setHoverKey(null)\n  }))), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"text\", {\n    x: 110,\n    y: 102,\n    textAnchor: \"middle\",\n    fontSize: 11,\n    fill: \"#605E5C\"\n  }, \"Gross\"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"text\", {\n    x: 110,\n    y: 120,\n    textAnchor: \"middle\",\n    fontSize: 15,\n    fontWeight: 600,\n    fill: \"#323130\"\n  }, fmtMoney(total)), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"text\", {\n    x: 110,\n    y: 138,\n    textAnchor: \"middle\",\n    fontSize: 11,\n    fill: net >= 0 ? \"#107C10\" : \"#A4262C\"\n  }, \"net \", fmtMoney(net))), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    style: {\n      flex: 1,\n      minWidth: 0\n    }\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"table\", {\n    style: {\n      width: \"100%\",\n      borderCollapse: \"collapse\"\n    }\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"thead\", null, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"tr\", {\n    style: {\n      background: \"#F3F2F1\",\n      textAlign: \"left\"\n    }\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"th\", {\n    style: {\n      padding: \"6px 8px\",\n      width: 16\n    },\n    \"aria-label\": \"color\"\n  }), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"th\", {\n    style: {\n      padding: \"6px 8px\"\n    }\n  }, GROUP_LABELS[groupBy]), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"th\", {\n    style: {\n      padding: \"6px 8px\",\n      textAlign: \"right\"\n    }\n  }, \"Entries\"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"th\", {\n    style: {\n      padding: \"6px 8px\",\n      textAlign: \"right\"\n    }\n  }, \"Amount\"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"th\", {\n    style: {\n      padding: \"6px 8px\",\n      textAlign: \"right\"\n    }\n  }, \"%\"))), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"tbody\", null, slices.map(s => {\n    var pct = total > 0 ? s.amount / total * 100 : 0;\n    var dim = hoverKey != null && hoverKey !== s.key;\n    return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"tr\", {\n      key: s.key,\n      style: {\n        borderBottom: \"1px solid #EDEBE9\",\n        opacity: dim ? 0.4 : 1,\n        cursor: \"default\"\n      },\n      onMouseEnter: () => setHoverKey(s.key),\n      onMouseLeave: () => setHoverKey(null)\n    }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"td\", {\n      style: {\n        padding: \"6px 8px\"\n      }\n    }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"span\", {\n      style: {\n        display: \"inline-block\",\n        width: 10,\n        height: 10,\n        borderRadius: 2,\n        background: s.color\n      }\n    })), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"td\", {\n      style: {\n        padding: \"6px 8px\",\n        overflow: \"hidden\",\n        textOverflow: \"ellipsis\"\n      }\n    }, s.label), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"td\", {\n      style: {\n        padding: \"6px 8px\",\n        textAlign: \"right\",\n        fontVariantNumeric: \"tabular-nums\"\n      }\n    }, s.count), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"td\", {\n      style: {\n        padding: \"6px 8px\",\n        textAlign: \"right\",\n        fontVariantNumeric: \"tabular-nums\"\n      }\n    }, fmtMoney(s.amount)), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"td\", {\n      style: {\n        padding: \"6px 8px\",\n        textAlign: \"right\",\n        fontVariantNumeric: \"tabular-nums\",\n        color: \"#605E5C\"\n      }\n    }, pct.toFixed(1), \"%\"));\n  }))))))));\n};\n\n//# sourceURL=webpack://pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad/./LedgersDonut/LedgersDonutApp.tsx?\n}");

/***/ },

/***/ "./LedgersDonut/index.ts"
/*!*******************************!*\
  !*** ./LedgersDonut/index.ts ***!
  \*******************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

eval("{__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   LedgersDonut: () => (/* binding */ LedgersDonut)\n/* harmony export */ });\n/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! react */ \"react\");\n/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(react__WEBPACK_IMPORTED_MODULE_0__);\n/* harmony import */ var _LedgersDonutApp__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./LedgersDonutApp */ \"./LedgersDonut/LedgersDonutApp.tsx\");\n\n\nclass LedgersDonut {\n  init(context) {\n    this.context = context;\n    context.mode.trackContainerResize(true);\n  }\n  updateView(context) {\n    var _a;\n    this.context = context;\n    var props = {\n      dataset: context.parameters.ledgers,\n      defaultGroupBy: ((_a = context.parameters.defaultGroupBy) === null || _a === void 0 ? void 0 : _a.raw) || \"ledgerType\"\n    };\n    return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_LedgersDonutApp__WEBPACK_IMPORTED_MODULE_1__.LedgersDonutApp, props);\n  }\n  getOutputs() {\n    return {};\n  }\n  destroy() {}\n}\n\n//# sourceURL=webpack://pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad/./LedgersDonut/index.ts?\n}");

/***/ },

/***/ "@fluentui/react-components"
/*!************************************!*\
  !*** external "FluentUIReactv940" ***!
  \************************************/
(module) {

module.exports = FluentUIReactv940;

/***/ },

/***/ "react"
/*!***************************!*\
  !*** external "Reactv16" ***!
  \***************************/
(module) {

module.exports = Reactv16;

/***/ }

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		if (!(moduleId in __webpack_modules__)) {
/******/ 			delete __webpack_module_cache__[moduleId];
/******/ 			var e = new Error("Cannot find module '" + moduleId + "'");
/******/ 			e.code = 'MODULE_NOT_FOUND';
/******/ 			throw e;
/******/ 		}
/******/ 		__webpack_modules__[moduleId](module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/compat get default export */
/******/ 	(() => {
/******/ 		// getDefaultExport function for compatibility with non-harmony modules
/******/ 		__webpack_require__.n = (module) => {
/******/ 			var getter = module && module.__esModule ?
/******/ 				() => (module['default']) :
/******/ 				() => (module);
/******/ 			__webpack_require__.d(getter, { a: getter });
/******/ 			return getter;
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/define property getters */
/******/ 	(() => {
/******/ 		// define getter functions for harmony exports
/******/ 		__webpack_require__.d = (exports, definition) => {
/******/ 			for(var key in definition) {
/******/ 				if(__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) {
/******/ 					Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
/******/ 				}
/******/ 			}
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/hasOwnProperty shorthand */
/******/ 	(() => {
/******/ 		__webpack_require__.o = (obj, prop) => (Object.prototype.hasOwnProperty.call(obj, prop))
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/make namespace object */
/******/ 	(() => {
/******/ 		// define __esModule on exports
/******/ 		__webpack_require__.r = (exports) => {
/******/ 			if(typeof Symbol !== 'undefined' && Symbol.toStringTag) {
/******/ 				Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/******/ 			}
/******/ 			Object.defineProperty(exports, '__esModule', { value: true });
/******/ 		};
/******/ 	})();
/******/ 	
/************************************************************************/
/******/ 	
/******/ 	// startup
/******/ 	// Load entry module and return exports
/******/ 	// This entry module can't be inlined because the eval devtool is used.
/******/ 	var __webpack_exports__ = __webpack_require__("./LedgersDonut/index.ts");
/******/ 	pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad = __webpack_exports__;
/******/ 	
/******/ })()
;
if (window.ComponentFramework && window.ComponentFramework.registerControl) {
	ComponentFramework.registerControl('ARNGCheckbook.LedgersDonut', pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad.LedgersDonut);
} else {
	var ARNGCheckbook = ARNGCheckbook || {};
	ARNGCheckbook.LedgersDonut = pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad.LedgersDonut;
	pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad = undefined;
}