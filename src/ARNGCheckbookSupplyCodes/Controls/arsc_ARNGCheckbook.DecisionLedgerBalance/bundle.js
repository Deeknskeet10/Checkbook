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

/***/ "./DecisionLedgerBalance/DecisionLedgerBalanceApp.tsx"
/*!************************************************************!*\
  !*** ./DecisionLedgerBalance/DecisionLedgerBalanceApp.tsx ***!
  \************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

eval("{__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   DecisionLedgerBalanceApp: () => (/* binding */ DecisionLedgerBalanceApp)\n/* harmony export */ });\n/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! react */ \"react\");\n/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(react__WEBPACK_IMPORTED_MODULE_0__);\n/* harmony import */ var _fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! @fluentui/react-components */ \"@fluentui/react-components\");\n/* harmony import */ var _fluentui_react_components__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__);\nfunction _slicedToArray(r, e) { return _arrayWithHoles(r) || _iterableToArrayLimit(r, e) || _unsupportedIterableToArray(r, e) || _nonIterableRest(); }\nfunction _nonIterableRest() { throw new TypeError(\"Invalid attempt to destructure non-iterable instance.\\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.\"); }\nfunction _unsupportedIterableToArray(r, a) { if (r) { if (\"string\" == typeof r) return _arrayLikeToArray(r, a); var t = {}.toString.call(r).slice(8, -1); return \"Object\" === t && r.constructor && (t = r.constructor.name), \"Map\" === t || \"Set\" === t ? Array.from(r) : \"Arguments\" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0; } }\nfunction _arrayLikeToArray(r, a) { (null == a || a > r.length) && (a = r.length); for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e]; return n; }\nfunction _iterableToArrayLimit(r, l) { var t = null == r ? null : \"undefined\" != typeof Symbol && r[Symbol.iterator] || r[\"@@iterator\"]; if (null != t) { var e, n, i, u, a = [], f = !0, o = !1; try { if (i = (t = t.call(r)).next, 0 === l) { if (Object(t) !== t) return; f = !1; } else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0); } catch (r) { o = !0, n = r; } finally { try { if (!f && null != t.return && (u = t.return(), Object(u) !== u)) return; } finally { if (o) throw n; } } return a; } }\nfunction _arrayWithHoles(r) { if (Array.isArray(r)) return r; }\n\n\nvar fmtMoney = n => n.toLocaleString(\"en-US\", {\n  style: \"currency\",\n  currency: \"USD\",\n  maximumFractionDigits: 0\n});\nvar fmtDate = d => d ? d.toLocaleDateString(\"en-US\", {\n  year: \"2-digit\",\n  month: \"short\",\n  day: \"numeric\"\n}) : \"\";\nvar toDate = v => {\n  if (!v) return null;\n  if (v instanceof Date) return v;\n  var d = new Date(v);\n  return isNaN(d.getTime()) ? null : d;\n};\nfunction getLookupName(v) {\n  var _a;\n  if (!v) return \"\";\n  if (Array.isArray(v)) return ((_a = v[0]) === null || _a === void 0 ? void 0 : _a.name) || \"\";\n  return v.name || \"\";\n}\nfunction colorForLabel(label) {\n  var colors = [\"#4F6BED\", \"#73AA24\", \"#9373C0\", \"#E0A45C\", \"#117865\", \"#0078D4\", \"#CC4A31\"];\n  var h = 0;\n  for (var i = 0; i < label.length; i++) h = h * 31 + label.charCodeAt(i) >>> 0;\n  return colors[h % colors.length];\n}\nfunction Sparkline(_ref) {\n  var values = _ref.values,\n    _ref$w = _ref.w,\n    w = _ref$w === void 0 ? 200 : _ref$w,\n    _ref$h = _ref.h,\n    h = _ref$h === void 0 ? 36 : _ref$h;\n  if (values.length === 0) return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"svg\", {\n    width: w,\n    height: h,\n    \"aria-hidden\": \"true\"\n  });\n  var min = Math.min(0, ...values);\n  var max = Math.max(0, ...values);\n  var range = max - min || 1;\n  var stepX = w / Math.max(1, values.length - 1);\n  var pts = values.map((v, i) => {\n    var x = i * stepX;\n    var y = h - (v - min) / range * h;\n    return \"\".concat(x.toFixed(1), \",\").concat(y.toFixed(1));\n  });\n  var zeroY = h - (0 - min) / range * h;\n  return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"svg\", {\n    width: w,\n    height: h,\n    \"aria-label\": \"balance over time\"\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"line\", {\n    x1: 0,\n    y1: zeroY,\n    x2: w,\n    y2: zeroY,\n    stroke: \"#EDEBE9\",\n    strokeWidth: 1\n  }), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"polyline\", {\n    points: pts.join(\" \"),\n    fill: \"none\",\n    stroke: \"#4F6BED\",\n    strokeWidth: 1.5\n  }));\n}\nvar DecisionLedgerBalanceApp = props => {\n  var dataset = props.dataset,\n    webAPI = props.webAPI,\n    navigation = props.navigation,\n    parentEntityName = props.parentEntityName,\n    parentEntityId = props.parentEntityId,\n    parentRecordName = props.parentRecordName;\n  // Opening balance + target final balance come from the parent FundingTrack.\n  var _React$useState = react__WEBPACK_IMPORTED_MODULE_0__.useState(0),\n    _React$useState2 = _slicedToArray(_React$useState, 2),\n    openingBalance = _React$useState2[0],\n    setOpeningBalance = _React$useState2[1];\n  var _React$useState3 = react__WEBPACK_IMPORTED_MODULE_0__.useState(null),\n    _React$useState4 = _slicedToArray(_React$useState3, 2),\n    targetBalance = _React$useState4[0],\n    setTargetBalance = _React$useState4[1];\n  react__WEBPACK_IMPORTED_MODULE_0__.useEffect(() => {\n    if (!webAPI || !parentEntityId || parentEntityName !== \"book_fundingtrack\") {\n      setOpeningBalance(0);\n      setTargetBalance(null);\n      return;\n    }\n    var id = parentEntityId.replace(/[{}]/g, \"\");\n    webAPI.retrieveRecord(\"book_fundingtrack\", id, \"?$select=book_beginningbalancereadonly,book_newresourceamount,book_resourceamount,book_newdecisiontotal\").then(rec => {\n      var _a, _b, _c;\n      var begin = Number((_a = rec.book_beginningbalancereadonly) !== null && _a !== void 0 ? _a : 0) || 0;\n      var target = Number((_c = (_b = rec.book_newresourceamount) !== null && _b !== void 0 ? _b : rec.book_resourceamount) !== null && _c !== void 0 ? _c : NaN);\n      setOpeningBalance(begin);\n      setTargetBalance(isNaN(target) ? null : target);\n    }).catch(() => {\n      setOpeningBalance(0);\n      setTargetBalance(null);\n    });\n  }, [webAPI, parentEntityName, parentEntityId]);\n  // Sort by createdOn ascending; running total accumulates left-to-right\n  var records = dataset.sortedRecordIds.map(id => dataset.records[id]).map(r => ({\n    r,\n    date: toDate(r.getValue(\"createdOn\"))\n  })).sort((a, b) => {\n    var ta = a.date ? a.date.getTime() : 0;\n    var tb = b.date ? b.date.getTime() : 0;\n    return ta - tb;\n  });\n  var running = openingBalance;\n  var rows = records.map(_ref2 => {\n    var r = _ref2.r,\n      date = _ref2.date;\n    var _a;\n    var amount = (_a = r.getValue(\"amount\")) !== null && _a !== void 0 ? _a : 0;\n    running += amount;\n    return {\n      id: r.getRecordId(),\n      date,\n      name: r.getValue(\"name\") || \"(unnamed)\",\n      eventName: getLookupName(r.getValue(\"event\")),\n      amount,\n      balance: running\n    };\n  });\n  var balances = [openingBalance, ...rows.map(r => r.balance)];\n  var finalBalance = rows.length > 0 ? rows[rows.length - 1].balance : openingBalance;\n  var totalIncrease = rows.filter(r => r.amount > 0).reduce((s, r) => s + r.amount, 0);\n  var totalDecrease = rows.filter(r => r.amount < 0).reduce((s, r) => s + Math.abs(r.amount), 0);\n  // Newest first for the statement table\n  var visible = [...rows].reverse();\n  var onOpen = id => {\n    navigation.openForm({\n      entityName: \"book_decision\",\n      entityId: id,\n      openInNewWindow: false\n    }).catch(() => {});\n  };\n  var targetMismatch = targetBalance != null && Math.abs(finalBalance - targetBalance) > 0.005;\n  return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.FluentProvider, {\n    theme: _fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.webLightTheme\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    className: \"arsc-decision-ledger\",\n    style: {\n      padding: 12,\n      fontFamily: \"Segoe UI, sans-serif\",\n      fontSize: 13,\n      background: \"#FFFFFF\"\n    }\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    style: {\n      display: \"flex\",\n      alignItems: \"center\",\n      gap: 12,\n      marginBottom: 8,\n      flexWrap: \"wrap\"\n    }\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"span\", {\n    style: {\n      fontSize: 15,\n      fontWeight: 600\n    }\n  }, \"Decision Ledger\", parentRecordName ? \" \\xB7 \".concat(parentRecordName) : \"\"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.Badge, {\n    appearance: \"outline\",\n    color: \"informative\",\n    size: \"medium\"\n  }, rows.length, \" \", rows.length === 1 ? \"decision\" : \"decisions\"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.Badge, {\n    appearance: \"tint\",\n    color: \"informative\",\n    size: \"medium\"\n  }, \"Opening: \", fmtMoney(openingBalance)), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"span\", {\n    style: {\n      color: \"#107C10\",\n      fontVariantNumeric: \"tabular-nums\",\n      fontSize: 12\n    }\n  }, \"+ \", fmtMoney(totalIncrease)), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"span\", {\n    style: {\n      color: \"#A4262C\",\n      fontVariantNumeric: \"tabular-nums\",\n      fontSize: 12\n    }\n  }, \"\\u2212 \", fmtMoney(totalDecrease)), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    style: {\n      flex: 1\n    }\n  }), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"span\", {\n    style: {\n      color: \"#605E5C\",\n      fontSize: 12\n    }\n  }, \"Resource Amount\"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"span\", {\n    style: {\n      fontSize: 16,\n      fontWeight: 700,\n      fontVariantNumeric: \"tabular-nums\",\n      color: finalBalance >= 0 ? \"#107C10\" : \"#A4262C\"\n    }\n  }, fmtMoney(finalBalance)), targetBalance != null && (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.Badge, {\n    appearance: \"tint\",\n    color: targetMismatch ? \"warning\" : \"success\",\n    title: \"Funding Track says: \".concat(fmtMoney(targetBalance))\n  }, targetMismatch ? \"\\u2260 track (\".concat(fmtMoney(targetBalance), \")\") : \"matches track ✓\"))), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(Sparkline, {\n    values: balances,\n    w: 1000,\n    h: 40\n  }), rows.length === 0 ? (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    style: {\n      color: \"#605E5C\",\n      padding: \"16px 0\",\n      borderTop: \"1px solid #EDEBE9\"\n    }\n  }, \"No decisions yet \\u2014 the resource amount equals the opening balance.\")) : (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    style: {\n      overflowX: \"auto\",\n      border: \"1px solid #EDEBE9\",\n      borderRadius: 4,\n      marginTop: 8\n    }\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"table\", {\n    style: {\n      width: \"100%\",\n      borderCollapse: \"collapse\",\n      fontSize: 13\n    }\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"thead\", null, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"tr\", {\n    style: {\n      background: \"#F3F2F1\",\n      color: \"#323130\"\n    }\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"th\", {\n    style: thStyle\n  }, \"Date\"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"th\", {\n    style: thStyle\n  }, \"Description\"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"th\", {\n    style: thStyle\n  }, \"Decision Event\"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"th\", {\n    style: thStyleNum\n  }, \"+ Increase\"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"th\", {\n    style: thStyleNum\n  }, \"\\u2212 Decrease\"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"th\", {\n    style: thStyleNum\n  }, \"Balance\"))), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"tbody\", null, visible.map(row => (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"tr\", {\n    key: row.id,\n    onClick: () => onOpen(row.id),\n    style: {\n      borderTop: \"1px solid #EDEBE9\",\n      cursor: \"pointer\"\n    },\n    onMouseEnter: e => e.currentTarget.style.background = \"#F3F2F1\",\n    onMouseLeave: e => e.currentTarget.style.background = \"#FFFFFF\"\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"td\", {\n    style: tdStyle\n  }, fmtDate(row.date)), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"td\", {\n    style: tdStyle\n  }, row.name), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"td\", {\n    style: tdStyle\n  }, row.eventName && (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"span\", {\n    style: {\n      display: \"inline-block\",\n      padding: \"2px 8px\",\n      borderRadius: 10,\n      fontSize: 11,\n      color: \"#FFFFFF\",\n      background: colorForLabel(row.eventName)\n    }\n  }, row.eventName))), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"td\", {\n    style: Object.assign(Object.assign({}, tdStyleNum), {\n      color: row.amount > 0 ? \"#107C10\" : \"#A19F9D\"\n    })\n  }, row.amount > 0 ? fmtMoney(row.amount) : \"\"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"td\", {\n    style: Object.assign(Object.assign({}, tdStyleNum), {\n      color: row.amount < 0 ? \"#A4262C\" : \"#A19F9D\"\n    })\n  }, row.amount < 0 ? fmtMoney(Math.abs(row.amount)) : \"\"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"td\", {\n    style: Object.assign(Object.assign({}, tdStyleNum), {\n      fontWeight: 600,\n      color: row.balance >= 0 ? \"#323130\" : \"#A4262C\"\n    })\n  }, fmtMoney(row.balance)))))), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"tfoot\", null, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"tr\", {\n    style: {\n      background: \"#FAF9F8\",\n      fontWeight: 700,\n      borderTop: \"2px solid #EDEBE9\"\n    }\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"td\", {\n    style: tdStyle,\n    colSpan: 3\n  }, \"Opening + Decisions = Resource Amount\"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"td\", {\n    style: tdStyleNum\n  }, fmtMoney(totalIncrease)), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"td\", {\n    style: tdStyleNum\n  }, fmtMoney(totalDecrease)), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"td\", {\n    style: Object.assign(Object.assign({}, tdStyleNum), {\n      color: finalBalance >= 0 ? \"#107C10\" : \"#A4262C\"\n    })\n  }, fmtMoney(finalBalance)))))))));\n};\nvar thStyle = {\n  textAlign: \"left\",\n  padding: \"8px 12px\",\n  fontWeight: 600,\n  fontSize: 12,\n  borderBottom: \"1px solid #EDEBE9\"\n};\nvar thStyleNum = Object.assign(Object.assign({}, thStyle), {\n  textAlign: \"right\"\n});\nvar tdStyle = {\n  padding: \"8px 12px\",\n  verticalAlign: \"middle\"\n};\nvar tdStyleNum = Object.assign(Object.assign({}, tdStyle), {\n  textAlign: \"right\",\n  fontVariantNumeric: \"tabular-nums\"\n});\n\n//# sourceURL=webpack://pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad/./DecisionLedgerBalance/DecisionLedgerBalanceApp.tsx?\n}");

/***/ },

/***/ "./DecisionLedgerBalance/index.ts"
/*!****************************************!*\
  !*** ./DecisionLedgerBalance/index.ts ***!
  \****************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

eval("{__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   DecisionLedgerBalance: () => (/* binding */ DecisionLedgerBalance)\n/* harmony export */ });\n/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! react */ \"react\");\n/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(react__WEBPACK_IMPORTED_MODULE_0__);\n/* harmony import */ var _DecisionLedgerBalanceApp__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./DecisionLedgerBalanceApp */ \"./DecisionLedgerBalance/DecisionLedgerBalanceApp.tsx\");\n\n\nclass DecisionLedgerBalance {\n  init(context) {\n    this.context = context;\n    context.mode.trackContainerResize(true);\n  }\n  updateView(context) {\n    var _a, _b, _c;\n    this.context = context;\n    var ctxAny = context.mode;\n    var props = {\n      dataset: context.parameters.decisions,\n      webAPI: context.webAPI,\n      navigation: context.navigation,\n      parentEntityName: (_a = ctxAny.contextInfo) === null || _a === void 0 ? void 0 : _a.entityTypeName,\n      parentEntityId: (_b = ctxAny.contextInfo) === null || _b === void 0 ? void 0 : _b.entityId,\n      parentRecordName: (_c = ctxAny.contextInfo) === null || _c === void 0 ? void 0 : _c.entityRecordName\n    };\n    return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_DecisionLedgerBalanceApp__WEBPACK_IMPORTED_MODULE_1__.DecisionLedgerBalanceApp, props);\n  }\n  getOutputs() {\n    return {};\n  }\n  destroy() {}\n}\n\n//# sourceURL=webpack://pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad/./DecisionLedgerBalance/index.ts?\n}");

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
/******/ 	var __webpack_exports__ = __webpack_require__("./DecisionLedgerBalance/index.ts");
/******/ 	pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad = __webpack_exports__;
/******/ 	
/******/ })()
;
if (window.ComponentFramework && window.ComponentFramework.registerControl) {
	ComponentFramework.registerControl('ARNGCheckbook.DecisionLedgerBalance', pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad.DecisionLedgerBalance);
} else {
	var ARNGCheckbook = ARNGCheckbook || {};
	ARNGCheckbook.DecisionLedgerBalance = pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad.DecisionLedgerBalance;
	pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad = undefined;
}