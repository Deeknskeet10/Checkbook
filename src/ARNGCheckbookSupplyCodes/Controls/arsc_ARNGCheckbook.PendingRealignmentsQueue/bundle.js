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

/***/ "./PendingRealignmentsQueue/PendingRealignmentsQueueApp.tsx"
/*!******************************************************************!*\
  !*** ./PendingRealignmentsQueue/PendingRealignmentsQueueApp.tsx ***!
  \******************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

eval("{__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   PendingRealignmentsQueueApp: () => (/* binding */ PendingRealignmentsQueueApp)\n/* harmony export */ });\n/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! react */ \"react\");\n/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(react__WEBPACK_IMPORTED_MODULE_0__);\n/* harmony import */ var _fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! @fluentui/react-components */ \"@fluentui/react-components\");\n/* harmony import */ var _fluentui_react_components__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__);\n\n\nvar fmtMoney = n => n.toLocaleString(\"en-US\", {\n  style: \"currency\",\n  currency: \"USD\",\n  maximumFractionDigits: 0\n});\nfunction getLookupName(r, col) {\n  var _a, _b;\n  var raw = r.getValue(col);\n  if (!raw) return \"\";\n  var v = Array.isArray(raw) ? raw[0] : raw;\n  return (_b = (_a = v === null || v === void 0 ? void 0 : v.name) !== null && _a !== void 0 ? _a : r.getFormattedValue(col)) !== null && _b !== void 0 ? _b : \"\";\n}\nfunction concurColor(label) {\n  var t = (label || \"\").toLowerCase();\n  if (t.includes(\"concur\") && !t.includes(\"non\")) return \"success\";\n  if (t.includes(\"non\") || t.includes(\"reject\") || t.includes(\"deny\")) return \"danger\";\n  if (t.includes(\"pend\") || t.includes(\"review\")) return \"warning\";\n  return \"informative\";\n}\nvar PendingRealignmentsQueueApp = props => {\n  var dataset = props.dataset,\n    navigation = props.navigation;\n  var rows = dataset.sortedRecordIds.map(id => dataset.records[id]).map(r => {\n    var _a, _b, _c, _d, _e;\n    return {\n      id: r.getRecordId(),\n      name: r.getValue(\"name\") || \"(unnamed)\",\n      amount: (_a = r.getValue(\"amount\")) !== null && _a !== void 0 ? _a : 0,\n      status: (_b = r.getFormattedValue(\"status\")) !== null && _b !== void 0 ? _b : \"\",\n      debitFrom: getLookupName(r, \"debitedPrioritization\"),\n      creditTo: getLookupName(r, \"creditedPrioritization\"),\n      payerConcur: (_c = r.getFormattedValue(\"payerConcurrence\")) !== null && _c !== void 0 ? _c : \"\",\n      payeeConcur: (_d = r.getFormattedValue(\"payeeConcurrence\")) !== null && _d !== void 0 ? _d : \"\",\n      stateApproved: (_e = r.getValue(\"stateApproved\")) !== null && _e !== void 0 ? _e : null\n    };\n  }).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));\n  var total = rows.reduce((s, r) => s + Math.abs(r.amount), 0);\n  var bothConcur = rows.filter(r => /concur/i.test(r.payerConcur) && /concur/i.test(r.payeeConcur) && !/non/i.test(r.payerConcur) && !/non/i.test(r.payeeConcur));\n  var blockedRows = rows.filter(r => /non/i.test(r.payerConcur) || /non/i.test(r.payeeConcur));\n  var onOpen = id => {\n    navigation.openForm({\n      entityName: \"book_realignments\",\n      entityId: id\n    }).catch(() => {});\n  };\n  return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.FluentProvider, {\n    theme: _fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.webLightTheme\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    className: \"arsc-pending-realignments\",\n    style: {\n      padding: 12,\n      fontFamily: \"Segoe UI, sans-serif\",\n      fontSize: 13,\n      background: \"#FFFFFF\"\n    }\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    style: {\n      display: \"flex\",\n      alignItems: \"center\",\n      gap: 12,\n      marginBottom: 12,\n      flexWrap: \"wrap\"\n    }\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"span\", {\n    style: {\n      fontSize: 15,\n      fontWeight: 600\n    }\n  }, \"Pending Realignments\"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.Badge, {\n    appearance: \"outline\",\n    color: \"informative\",\n    size: \"medium\"\n  }, rows.length, \" \", rows.length === 1 ? \"realignment\" : \"realignments\"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.Badge, {\n    appearance: \"tint\",\n    color: \"brand\",\n    size: \"medium\"\n  }, \"Queued: \", fmtMoney(total)), bothConcur.length > 0 && (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.Badge, {\n    appearance: \"tint\",\n    color: \"success\",\n    size: \"medium\"\n  }, \"Both concur: \", bothConcur.length)), blockedRows.length > 0 && (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.Badge, {\n    appearance: \"tint\",\n    color: \"danger\",\n    size: \"medium\"\n  }, \"Non-concur: \", blockedRows.length))), rows.length === 0 ? (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    style: {\n      color: \"#605E5C\",\n      padding: \"16px 0\",\n      borderTop: \"1px solid #EDEBE9\"\n    }\n  }, \"No pending realignments \\u2014 the queue is clear.\")) : (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    style: {\n      display: \"flex\",\n      flexDirection: \"column\",\n      gap: 6\n    }\n  }, rows.map(r => (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    key: r.id,\n    onClick: () => onOpen(r.id),\n    style: {\n      display: \"flex\",\n      alignItems: \"center\",\n      gap: 12,\n      padding: \"10px 12px\",\n      border: \"1px solid #EDEBE9\",\n      borderRadius: 4,\n      background: \"#FFFFFF\",\n      cursor: \"pointer\"\n    },\n    onMouseEnter: e => e.currentTarget.style.background = \"#F3F2F1\",\n    onMouseLeave: e => e.currentTarget.style.background = \"#FFFFFF\"\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    style: {\n      flex: 1,\n      minWidth: 0,\n      textAlign: \"right\"\n    }\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    style: {\n      fontSize: 11,\n      color: \"#A4262C\",\n      textTransform: \"uppercase\",\n      letterSpacing: 0.4\n    }\n  }, \"Debit\"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    style: {\n      fontWeight: 600,\n      overflow: \"hidden\",\n      textOverflow: \"ellipsis\",\n      whiteSpace: \"nowrap\"\n    }\n  }, r.debitFrom || \"—\"), r.payerConcur && (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.Badge, {\n    appearance: \"tint\",\n    color: concurColor(r.payerConcur),\n    size: \"small\"\n  }, \"Payer: \", r.payerConcur))), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    style: {\n      minWidth: 140,\n      textAlign: \"center\"\n    }\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    style: {\n      fontSize: 18,\n      color: \"#605E5C\",\n      lineHeight: 1\n    }\n  }, \"\\u2192\"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    style: {\n      fontWeight: 700,\n      fontSize: 15,\n      fontVariantNumeric: \"tabular-nums\",\n      color: \"#323130\"\n    }\n  }, fmtMoney(Math.abs(r.amount))), r.status && (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    style: {\n      fontSize: 11,\n      color: \"#605E5C\"\n    }\n  }, r.status))), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    style: {\n      flex: 1,\n      minWidth: 0\n    }\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    style: {\n      fontSize: 11,\n      color: \"#107C10\",\n      textTransform: \"uppercase\",\n      letterSpacing: 0.4\n    }\n  }, \"Credit\"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    style: {\n      fontWeight: 600,\n      overflow: \"hidden\",\n      textOverflow: \"ellipsis\",\n      whiteSpace: \"nowrap\"\n    }\n  }, r.creditTo || \"—\"), r.payeeConcur && (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.Badge, {\n    appearance: \"tint\",\n    color: concurColor(r.payeeConcur),\n    size: \"small\"\n  }, \"Payee: \", r.payeeConcur))), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    style: {\n      minWidth: 110,\n      textAlign: \"right\"\n    }\n  }, r.stateApproved === true && (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.Badge, {\n    appearance: \"tint\",\n    color: \"success\"\n  }, \"State approved\")), r.stateApproved === false && (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.Badge, {\n    appearance: \"tint\",\n    color: \"warning\"\n  }, \"Awaiting state\"))))))))));\n};\n\n//# sourceURL=webpack://pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad/./PendingRealignmentsQueue/PendingRealignmentsQueueApp.tsx?\n}");

/***/ },

/***/ "./PendingRealignmentsQueue/index.ts"
/*!*******************************************!*\
  !*** ./PendingRealignmentsQueue/index.ts ***!
  \*******************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

eval("{__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   PendingRealignmentsQueue: () => (/* binding */ PendingRealignmentsQueue)\n/* harmony export */ });\n/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! react */ \"react\");\n/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(react__WEBPACK_IMPORTED_MODULE_0__);\n/* harmony import */ var _PendingRealignmentsQueueApp__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./PendingRealignmentsQueueApp */ \"./PendingRealignmentsQueue/PendingRealignmentsQueueApp.tsx\");\n\n\nclass PendingRealignmentsQueue {\n  init(context) {\n    this.context = context;\n    context.mode.trackContainerResize(true);\n  }\n  updateView(context) {\n    this.context = context;\n    var props = {\n      dataset: context.parameters.realignments,\n      navigation: context.navigation\n    };\n    return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_PendingRealignmentsQueueApp__WEBPACK_IMPORTED_MODULE_1__.PendingRealignmentsQueueApp, props);\n  }\n  getOutputs() {\n    return {};\n  }\n  destroy() {}\n}\n\n//# sourceURL=webpack://pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad/./PendingRealignmentsQueue/index.ts?\n}");

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
/******/ 	var __webpack_exports__ = __webpack_require__("./PendingRealignmentsQueue/index.ts");
/******/ 	pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad = __webpack_exports__;
/******/ 	
/******/ })()
;
if (window.ComponentFramework && window.ComponentFramework.registerControl) {
	ComponentFramework.registerControl('ARNGCheckbook.PendingRealignmentsQueue', pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad.PendingRealignmentsQueue);
} else {
	var ARNGCheckbook = ARNGCheckbook || {};
	ARNGCheckbook.PendingRealignmentsQueue = pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad.PendingRealignmentsQueue;
	pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad = undefined;
}