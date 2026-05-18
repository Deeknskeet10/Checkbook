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

/***/ "./LedgerBalance/LedgerBalanceApp.tsx"
/*!********************************************!*\
  !*** ./LedgerBalance/LedgerBalanceApp.tsx ***!
  \********************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

eval("{__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   LedgerBalanceApp: () => (/* binding */ LedgerBalanceApp)\n/* harmony export */ });\n/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! react */ \"react\");\n/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(react__WEBPACK_IMPORTED_MODULE_0__);\n/* harmony import */ var _fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! @fluentui/react-components */ \"@fluentui/react-components\");\n/* harmony import */ var _fluentui_react_components__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__);\nfunction _slicedToArray(r, e) { return _arrayWithHoles(r) || _iterableToArrayLimit(r, e) || _unsupportedIterableToArray(r, e) || _nonIterableRest(); }\nfunction _nonIterableRest() { throw new TypeError(\"Invalid attempt to destructure non-iterable instance.\\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.\"); }\nfunction _unsupportedIterableToArray(r, a) { if (r) { if (\"string\" == typeof r) return _arrayLikeToArray(r, a); var t = {}.toString.call(r).slice(8, -1); return \"Object\" === t && r.constructor && (t = r.constructor.name), \"Map\" === t || \"Set\" === t ? Array.from(r) : \"Arguments\" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0; } }\nfunction _arrayLikeToArray(r, a) { (null == a || a > r.length) && (a = r.length); for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e]; return n; }\nfunction _iterableToArrayLimit(r, l) { var t = null == r ? null : \"undefined\" != typeof Symbol && r[Symbol.iterator] || r[\"@@iterator\"]; if (null != t) { var e, n, i, u, a = [], f = !0, o = !1; try { if (i = (t = t.call(r)).next, 0 === l) { if (Object(t) !== t) return; f = !1; } else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0); } catch (r) { o = !0, n = r; } finally { try { if (!f && null != t.return && (u = t.return(), Object(u) !== u)) return; } finally { if (o) throw n; } } return a; } }\nfunction _arrayWithHoles(r) { if (Array.isArray(r)) return r; }\n\n\nvar fmtMoney = n => n.toLocaleString(\"en-US\", {\n  style: \"currency\",\n  currency: \"USD\",\n  maximumFractionDigits: 0\n});\nvar fmtDate = d => {\n  if (!d) return \"\";\n  return d.toLocaleDateString(\"en-US\", {\n    year: \"2-digit\",\n    month: \"short\",\n    day: \"numeric\"\n  });\n};\nfunction getDirection(r) {\n  var _a;\n  // book_ledgerdirection picklist; the formatted value typically reads \"Credit\" / \"Debit\".\n  var formatted = (r.getFormattedValue(\"direction\") || \"\").toLowerCase();\n  if (formatted.startsWith(\"c\")) return \"credit\";\n  if (formatted.startsWith(\"d\")) return \"debit\";\n  // Fall back: positive amount → credit, negative → debit\n  var v = (_a = r.getValue(\"amount\")) !== null && _a !== void 0 ? _a : 0;\n  return v >= 0 ? \"credit\" : \"debit\";\n}\nfunction colorForType(label) {\n  // categorical Fluent palette by transaction type\n  var colors = [\"#4F6BED\", \"#73AA24\", \"#CC4A31\", \"#9373C0\", \"#E0A45C\", \"#117865\", \"#0078D4\", \"#A4262C\"];\n  var h = 0;\n  for (var i = 0; i < label.length; i++) h = h * 31 + label.charCodeAt(i) >>> 0;\n  return colors[h % colors.length];\n}\nfunction Sparkline(_ref) {\n  var values = _ref.values,\n    _ref$w = _ref.w,\n    w = _ref$w === void 0 ? 200 : _ref$w,\n    _ref$h = _ref.h,\n    h = _ref$h === void 0 ? 36 : _ref$h;\n  if (values.length === 0) return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"svg\", {\n    width: w,\n    height: h,\n    \"aria-hidden\": \"true\"\n  });\n  var min = Math.min(0, ...values);\n  var max = Math.max(0, ...values);\n  var range = max - min || 1;\n  var stepX = w / Math.max(1, values.length - 1);\n  var pts = values.map((v, i) => {\n    var x = i * stepX;\n    var y = h - (v - min) / range * h;\n    return \"\".concat(x.toFixed(1), \",\").concat(y.toFixed(1));\n  });\n  // Zero baseline\n  var zeroY = h - (0 - min) / range * h;\n  return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"svg\", {\n    width: w,\n    height: h,\n    \"aria-label\": \"balance over time\"\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"line\", {\n    x1: 0,\n    y1: zeroY,\n    x2: w,\n    y2: zeroY,\n    stroke: \"#EDEBE9\",\n    strokeWidth: 1\n  }), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"polyline\", {\n    points: pts.join(\" \"),\n    fill: \"none\",\n    stroke: \"#4F6BED\",\n    strokeWidth: 1.5\n  }));\n}\nvar LedgerBalanceApp = props => {\n  var dataset = props.dataset,\n    navigation = props.navigation,\n    webAPI = props.webAPI,\n    parentEntityName = props.parentEntityName,\n    parentEntityId = props.parentEntityId,\n    parentEntityName_record = props.parentEntityName_record;\n  // Opening balance comes from the parent LOA (book_fundingline.book_newtdp).\n  // For any other host, opening balance is 0.\n  var _React$useState = react__WEBPACK_IMPORTED_MODULE_0__.useState(0),\n    _React$useState2 = _slicedToArray(_React$useState, 2),\n    openingBalance = _React$useState2[0],\n    setOpeningBalance = _React$useState2[1];\n  var _React$useState3 = react__WEBPACK_IMPORTED_MODULE_0__.useState(null),\n    _React$useState4 = _slicedToArray(_React$useState3, 2),\n    openingBalanceLabel = _React$useState4[0],\n    setOpeningBalanceLabel = _React$useState4[1];\n  react__WEBPACK_IMPORTED_MODULE_0__.useEffect(() => {\n    if (!webAPI || !parentEntityId || parentEntityName !== \"book_fundingline\") {\n      setOpeningBalance(0);\n      setOpeningBalanceLabel(null);\n      return;\n    }\n    var id = parentEntityId.replace(/[{}]/g, \"\");\n    webAPI.retrieveRecord(\"book_fundingline\", id, \"?$select=book_newtdp,book_tdp,book_name\").then(rec => {\n      var _a, _b;\n      var tdp = Number((_b = (_a = rec.book_newtdp) !== null && _a !== void 0 ? _a : rec.book_tdp) !== null && _b !== void 0 ? _b : 0) || 0;\n      setOpeningBalance(tdp);\n      setOpeningBalanceLabel(\"Opening TDP\".concat(rec.book_name ? \" (\".concat(rec.book_name, \")\") : \"\"));\n    }).catch(() => {\n      setOpeningBalance(0);\n      setOpeningBalanceLabel(null);\n    });\n  }, [webAPI, parentEntityName, parentEntityId]);\n  // Sort by createdOn ascending so running balance accumulates left-to-right.\n  // The dataset returns date columns as ISO strings; coerce to Date.\n  var toDate = v => {\n    if (!v) return null;\n    if (v instanceof Date) return v;\n    var d = new Date(v);\n    return isNaN(d.getTime()) ? null : d;\n  };\n  var records = dataset.sortedRecordIds.map(id => dataset.records[id]).map(r => ({\n    r,\n    date: toDate(r.getValue(\"createdOn\"))\n  })).sort((a, b) => {\n    var ta = a.date ? a.date.getTime() : 0;\n    var tb = b.date ? b.date.getTime() : 0;\n    return ta - tb;\n  });\n  var running = openingBalance;\n  var rows = records.map(_ref2 => {\n    var r = _ref2.r,\n      date = _ref2.date;\n    var _a, _b, _c, _d;\n    var amount = (_a = r.getValue(\"amount\")) !== null && _a !== void 0 ? _a : 0;\n    var direction = getDirection(r);\n    var signed = direction === \"debit\" ? -Math.abs(amount) : Math.abs(amount);\n    running += signed;\n    return {\n      id: r.getRecordId(),\n      ref: r,\n      date,\n      name: r.getValue(\"name\") || \"(unnamed)\",\n      typeLabel: r.getFormattedValue(\"ledgerType\") || \"\",\n      loa: ((_c = (_b = r.getValue(\"lineOfAccounting\")) === null || _b === void 0 ? void 0 : _b[0]) === null || _c === void 0 ? void 0 : _c.name) || ((_d = r.getValue(\"lineOfAccounting\")) === null || _d === void 0 ? void 0 : _d.name) || \"\",\n      fy: r.getFormattedValue(\"fiscalYear\") || \"\",\n      direction,\n      signed,\n      balance: running\n    };\n  });\n  var balances = rows.map(r => r.balance);\n  var finalBalance = rows.length > 0 ? rows[rows.length - 1].balance : 0;\n  var totalDebit = rows.filter(r => r.signed < 0).reduce((s, r) => s + Math.abs(r.signed), 0);\n  var totalCredit = rows.filter(r => r.signed > 0).reduce((s, r) => s + r.signed, 0);\n  // Reverse the visual order so most recent appears at top (statement style)\n  var visible = [...rows].reverse();\n  var onOpen = id => {\n    navigation.openForm({\n      entityName: \"book_ledger\",\n      entityId: id,\n      openInNewWindow: false\n    }).catch(() => {});\n  };\n  return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.FluentProvider, {\n    theme: _fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.webLightTheme\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    className: \"arsc-ledger-balance\",\n    style: {\n      padding: 12,\n      fontFamily: \"Segoe UI, sans-serif\",\n      fontSize: 13,\n      background: \"#FFFFFF\"\n    }\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    style: {\n      display: \"flex\",\n      alignItems: \"center\",\n      gap: 12,\n      marginBottom: 8,\n      flexWrap: \"wrap\"\n    }\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"span\", {\n    style: {\n      fontSize: 15,\n      fontWeight: 600\n    }\n  }, \"Ledger\", parentEntityName_record ? \" \\xB7 \".concat(parentEntityName_record) : \"\"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.Badge, {\n    appearance: \"outline\",\n    color: \"informative\",\n    size: \"medium\"\n  }, rows.length, \" \", rows.length === 1 ? \"entry\" : \"entries\"), openingBalanceLabel && (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.Badge, {\n    appearance: \"tint\",\n    color: \"informative\",\n    size: \"medium\"\n  }, openingBalanceLabel, \": \", fmtMoney(openingBalance))), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"span\", {\n    style: {\n      color: \"#107C10\",\n      fontVariantNumeric: \"tabular-nums\",\n      fontSize: 12\n    }\n  }, \"+ \", fmtMoney(totalCredit)), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"span\", {\n    style: {\n      color: \"#A4262C\",\n      fontVariantNumeric: \"tabular-nums\",\n      fontSize: 12\n    }\n  }, \"\\u2212 \", fmtMoney(totalDebit)), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    style: {\n      flex: 1\n    }\n  }), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"span\", {\n    style: {\n      color: \"#605E5C\",\n      fontSize: 12\n    }\n  }, \"Balance\"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"span\", {\n    style: {\n      fontSize: 16,\n      fontWeight: 700,\n      fontVariantNumeric: \"tabular-nums\",\n      color: finalBalance >= 0 ? \"#107C10\" : \"#A4262C\"\n    }\n  }, fmtMoney(finalBalance))), rows.length > 1 && (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    style: {\n      marginBottom: 12\n    }\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(Sparkline, {\n    values: balances,\n    w: 1000,\n    h: 40\n  }))), rows.length === 0 ? (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    style: {\n      color: \"#605E5C\",\n      padding: \"16px 0\",\n      borderTop: \"1px solid #EDEBE9\"\n    }\n  }, \"No ledger entries in scope.\")) : (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"table\", {\n    style: {\n      width: \"100%\",\n      borderCollapse: \"collapse\",\n      fontVariantNumeric: \"tabular-nums\"\n    }\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"thead\", null, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"tr\", {\n    style: {\n      background: \"#F3F2F1\",\n      textAlign: \"left\"\n    }\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"th\", {\n    style: {\n      padding: \"6px 8px\",\n      width: 90\n    }\n  }, \"Date\"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"th\", {\n    style: {\n      padding: \"6px 8px\",\n      width: 110\n    }\n  }, \"Type\"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"th\", {\n    style: {\n      padding: \"6px 8px\"\n    }\n  }, \"Description / LOA\"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"th\", {\n    style: {\n      padding: \"6px 8px\",\n      width: 50\n    }\n  }, \"FY\"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"th\", {\n    style: {\n      padding: \"6px 8px\",\n      textAlign: \"right\",\n      width: 110\n    }\n  }, \"Debit\"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"th\", {\n    style: {\n      padding: \"6px 8px\",\n      textAlign: \"right\",\n      width: 110\n    }\n  }, \"Credit\"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"th\", {\n    style: {\n      padding: \"6px 8px\",\n      textAlign: \"right\",\n      width: 130\n    }\n  }, \"Balance\"))), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"tbody\", null, visible.map(row => {\n    var debit = row.signed < 0 ? Math.abs(row.signed) : null;\n    var credit = row.signed > 0 ? row.signed : null;\n    var c = colorForType(row.typeLabel);\n    return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"tr\", {\n      key: row.id,\n      style: {\n        borderBottom: \"1px solid #EDEBE9\",\n        cursor: \"pointer\"\n      },\n      onClick: () => onOpen(row.id)\n    }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"td\", {\n      style: {\n        padding: \"6px 8px\",\n        color: \"#605E5C\",\n        fontSize: 12\n      }\n    }, fmtDate(row.date)), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"td\", {\n      style: {\n        padding: \"6px 8px\"\n      }\n    }, row.typeLabel ? (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.Badge, {\n      appearance: \"tint\",\n      color: \"informative\",\n      style: {\n        background: \"\".concat(c, \"22\"),\n        color: c\n      }\n    }, row.typeLabel)) : (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"span\", {\n      style: {\n        color: \"#A19F9D\"\n      }\n    }, \"\\u2014\"))), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"td\", {\n      style: {\n        padding: \"6px 8px\"\n      }\n    }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n      style: {\n        overflow: \"hidden\",\n        textOverflow: \"ellipsis\",\n        whiteSpace: \"nowrap\"\n      }\n    }, row.name), row.loa && (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n      style: {\n        color: \"#605E5C\",\n        fontSize: 11\n      }\n    }, row.loa))), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"td\", {\n      style: {\n        padding: \"6px 8px\",\n        color: \"#605E5C\"\n      }\n    }, row.fy), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"td\", {\n      style: {\n        padding: \"6px 8px\",\n        textAlign: \"right\",\n        color: \"#A4262C\"\n      }\n    }, debit != null ? fmtMoney(debit) : \"\"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"td\", {\n      style: {\n        padding: \"6px 8px\",\n        textAlign: \"right\",\n        color: \"#107C10\"\n      }\n    }, credit != null ? fmtMoney(credit) : \"\"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"td\", {\n      style: {\n        padding: \"6px 8px\",\n        textAlign: \"right\",\n        fontWeight: 600,\n        color: row.balance >= 0 ? \"#323130\" : \"#A4262C\"\n      }\n    }, fmtMoney(row.balance)));\n  }))))));\n};\n\n//# sourceURL=webpack://pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad/./LedgerBalance/LedgerBalanceApp.tsx?\n}");

/***/ },

/***/ "./LedgerBalance/index.ts"
/*!********************************!*\
  !*** ./LedgerBalance/index.ts ***!
  \********************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

eval("{__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   LedgerBalance: () => (/* binding */ LedgerBalance)\n/* harmony export */ });\n/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! react */ \"react\");\n/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(react__WEBPACK_IMPORTED_MODULE_0__);\n/* harmony import */ var _LedgerBalanceApp__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./LedgerBalanceApp */ \"./LedgerBalance/LedgerBalanceApp.tsx\");\n\n\nclass LedgerBalance {\n  init(context, notifyOutputChanged) {\n    this.context = context;\n    this.notifyOutputChanged = notifyOutputChanged;\n  }\n  updateView(context) {\n    var _a, _b, _c;\n    this.context = context;\n    var ctxAny = context.mode;\n    return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_LedgerBalanceApp__WEBPACK_IMPORTED_MODULE_1__.LedgerBalanceApp, {\n      dataset: context.parameters.ledger,\n      navigation: context.navigation,\n      webAPI: context.webAPI,\n      parentEntityName: (_a = ctxAny.contextInfo) === null || _a === void 0 ? void 0 : _a.entityTypeName,\n      parentEntityId: (_b = ctxAny.contextInfo) === null || _b === void 0 ? void 0 : _b.entityId,\n      parentEntityName_record: (_c = ctxAny.contextInfo) === null || _c === void 0 ? void 0 : _c.entityRecordName\n    });\n  }\n  getOutputs() {\n    return {};\n  }\n  destroy() {}\n}\n\n//# sourceURL=webpack://pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad/./LedgerBalance/index.ts?\n}");

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
/******/ 	var __webpack_exports__ = __webpack_require__("./LedgerBalance/index.ts");
/******/ 	pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad = __webpack_exports__;
/******/ 	
/******/ })()
;
if (window.ComponentFramework && window.ComponentFramework.registerControl) {
	ComponentFramework.registerControl('ARNGCheckbook.LedgerBalance', pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad.LedgerBalance);
} else {
	var ARNGCheckbook = ARNGCheckbook || {};
	ARNGCheckbook.LedgerBalance = pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad.LedgerBalance;
	pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad = undefined;
}