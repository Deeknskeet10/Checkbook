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

/***/ "./PrioritizationsForRequirement/PrioritizationsForRequirementApp.tsx"
/*!****************************************************************************!*\
  !*** ./PrioritizationsForRequirement/PrioritizationsForRequirementApp.tsx ***!
  \****************************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

eval("{__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   PrioritizationsForRequirementApp: () => (/* binding */ PrioritizationsForRequirementApp)\n/* harmony export */ });\n/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! react */ \"react\");\n/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(react__WEBPACK_IMPORTED_MODULE_0__);\n/* harmony import */ var _fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! @fluentui/react-components */ \"@fluentui/react-components\");\n/* harmony import */ var _fluentui_react_components__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__);\n\n\nvar fmtMoney = n => n == null ? \"—\" : n.toLocaleString(\"en-US\", {\n  style: \"currency\",\n  currency: \"USD\",\n  maximumFractionDigits: 0\n});\nvar fmtDate = d => d ? d.toLocaleDateString(\"en-US\", {\n  year: \"numeric\",\n  month: \"short\",\n  day: \"numeric\"\n}) : \"\";\nvar toDate = v => {\n  if (!v) return null;\n  if (v instanceof Date) return v;\n  var d = new Date(v);\n  return isNaN(d.getTime()) ? null : d;\n};\nfunction statusColor(label) {\n  var t = (label || \"\").toLowerCase();\n  if (t.includes(\"approved\") || t.includes(\"funded\")) return \"success\";\n  if (t.includes(\"submit\")) return \"brand\";\n  if (t.includes(\"reject\") || t.includes(\"kick\")) return \"danger\";\n  if (t.includes(\"draft\") || t.includes(\"planning\")) return \"informative\";\n  if (t.includes(\"review\")) return \"warning\";\n  return \"informative\";\n}\nvar PrioritizationsForRequirementApp = props => {\n  var dataset = props.dataset,\n    navigation = props.navigation;\n  var rows = react__WEBPACK_IMPORTED_MODULE_0__.useMemo(() => {\n    return dataset.sortedRecordIds.map(id => dataset.records[id]).map(r => {\n      var _a, _b, _c, _d, _e;\n      return {\n        id: r.getRecordId(),\n        name: r.getValue(\"name\") || \"(unnamed)\",\n        statePriority: (_a = r.getValue(\"statePriority\")) !== null && _a !== void 0 ? _a : null,\n        approvalStatus: (_b = r.getFormattedValue(\"approvalStatus\")) !== null && _b !== void 0 ? _b : null,\n        fundedAmount: (_c = r.getValue(\"fundedAmount\")) !== null && _c !== void 0 ? _c : null,\n        unfundedAmount: (_d = r.getValue(\"unfundedAmount\")) !== null && _d !== void 0 ? _d : null,\n        requirementType: (_e = r.getFormattedValue(\"requirementType\")) !== null && _e !== void 0 ? _e : null,\n        createdOn: toDate(r.getValue(\"createdOn\"))\n      };\n    }).sort((a, b) => {\n      var _a, _b, _c, _d;\n      var pa = a.statePriority == null ? Number.MAX_SAFE_INTEGER : a.statePriority;\n      var pb = b.statePriority == null ? Number.MAX_SAFE_INTEGER : b.statePriority;\n      if (pa !== pb) return pa - pb;\n      var da = (_b = (_a = a.createdOn) === null || _a === void 0 ? void 0 : _a.getTime()) !== null && _b !== void 0 ? _b : 0;\n      var db = (_d = (_c = b.createdOn) === null || _c === void 0 ? void 0 : _c.getTime()) !== null && _d !== void 0 ? _d : 0;\n      return db - da;\n    });\n  }, [dataset.sortedRecordIds.join(\"|\")]);\n  var open = id => {\n    navigation.openForm({\n      entityName: \"book_prioritization\",\n      entityId: id\n    });\n  };\n  var totalFunded = rows.reduce((s, r) => {\n    var _a;\n    return s + ((_a = r.fundedAmount) !== null && _a !== void 0 ? _a : 0);\n  }, 0);\n  var totalUnfunded = rows.reduce((s, r) => {\n    var _a;\n    return s + ((_a = r.unfundedAmount) !== null && _a !== void 0 ? _a : 0);\n  }, 0);\n  return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.FluentProvider, {\n    theme: _fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.webLightTheme\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    className: \"arsc-prios-for-req\",\n    style: {\n      padding: 12,\n      fontFamily: \"Segoe UI, sans-serif\",\n      fontSize: 13,\n      background: \"#FFFFFF\"\n    }\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    style: {\n      display: \"flex\",\n      alignItems: \"center\",\n      gap: 12,\n      marginBottom: 12,\n      flexWrap: \"wrap\"\n    }\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"span\", {\n    style: {\n      fontSize: 15,\n      fontWeight: 600\n    }\n  }, \"Prioritizations\"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.Badge, {\n    appearance: \"outline\",\n    color: \"informative\",\n    size: \"medium\"\n  }, rows.length, \" \", rows.length === 1 ? \"prioritization\" : \"prioritizations\"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.Badge, {\n    appearance: \"tint\",\n    color: \"success\"\n  }, \"Funded: \", fmtMoney(totalFunded)), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.Badge, {\n    appearance: \"tint\",\n    color: \"warning\"\n  }, \"Unfunded: \", fmtMoney(totalUnfunded))), rows.length === 0 ? (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    style: {\n      color: \"#605E5C\",\n      padding: \"16px 0\",\n      borderTop: \"1px solid #EDEBE9\"\n    }\n  }, \"No prioritizations under this requirement yet.\")) : (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    style: {\n      display: \"flex\",\n      flexDirection: \"column\",\n      gap: 6\n    }\n  }, rows.map(row => {\n    var _a, _b;\n    return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n      key: row.id,\n      onClick: () => open(row.id),\n      style: {\n        display: \"flex\",\n        alignItems: \"center\",\n        gap: 12,\n        padding: \"10px 12px\",\n        border: \"1px solid #EDEBE9\",\n        borderRadius: 4,\n        background: \"#FFFFFF\",\n        cursor: \"pointer\"\n      },\n      onMouseEnter: e => e.currentTarget.style.background = \"#F3F2F1\",\n      onMouseLeave: e => e.currentTarget.style.background = \"#FFFFFF\"\n    }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n      style: {\n        minWidth: 36,\n        height: 36,\n        borderRadius: 18,\n        background: row.statePriority == null ? \"#A19F9D\" : row.statePriority <= 1 ? \"#107C10\" : row.statePriority <= 3 ? \"#0078D4\" : \"#605E5C\",\n        color: \"#FFFFFF\",\n        display: \"flex\",\n        alignItems: \"center\",\n        justifyContent: \"center\",\n        fontWeight: 700,\n        fontSize: 13,\n        fontVariantNumeric: \"tabular-nums\"\n      },\n      title: \"State priority: \".concat((_a = row.statePriority) !== null && _a !== void 0 ? _a : \"—\")\n    }, (_b = row.statePriority) !== null && _b !== void 0 ? _b : \"—\"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n      style: {\n        flex: 1,\n        minWidth: 0\n      }\n    }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n      style: {\n        display: \"flex\",\n        alignItems: \"baseline\",\n        gap: 8,\n        flexWrap: \"wrap\",\n        marginBottom: 2\n      }\n    }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"strong\", {\n      style: {\n        overflow: \"hidden\",\n        textOverflow: \"ellipsis\",\n        whiteSpace: \"nowrap\",\n        maxWidth: 480\n      }\n    }, row.name), row.approvalStatus && (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.Badge, {\n      appearance: \"tint\",\n      color: statusColor(row.approvalStatus)\n    }, row.approvalStatus)), row.requirementType && (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.Badge, {\n      appearance: \"outline\",\n      color: \"informative\"\n    }, row.requirementType))), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n      style: {\n        color: \"#605E5C\",\n        fontSize: 12,\n        display: \"flex\",\n        gap: 12,\n        flexWrap: \"wrap\"\n      }\n    }, row.createdOn && /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"span\", null, \"Created \", fmtDate(row.createdOn)))), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n      style: {\n        textAlign: \"right\",\n        minWidth: 140\n      }\n    }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n      style: {\n        fontWeight: 700,\n        fontSize: 14,\n        fontVariantNumeric: \"tabular-nums\",\n        color: \"#107C10\"\n      }\n    }, fmtMoney(row.fundedAmount)), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n      style: {\n        color: \"#605E5C\",\n        fontSize: 11,\n        fontVariantNumeric: \"tabular-nums\"\n      }\n    }, \"uf \", fmtMoney(row.unfundedAmount))));\n  })))));\n};\n\n//# sourceURL=webpack://pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad/./PrioritizationsForRequirement/PrioritizationsForRequirementApp.tsx?\n}");

/***/ },

/***/ "./PrioritizationsForRequirement/index.ts"
/*!************************************************!*\
  !*** ./PrioritizationsForRequirement/index.ts ***!
  \************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

eval("{__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   PrioritizationsForRequirement: () => (/* binding */ PrioritizationsForRequirement)\n/* harmony export */ });\n/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! react */ \"react\");\n/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(react__WEBPACK_IMPORTED_MODULE_0__);\n/* harmony import */ var _PrioritizationsForRequirementApp__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./PrioritizationsForRequirementApp */ \"./PrioritizationsForRequirement/PrioritizationsForRequirementApp.tsx\");\n\n\nclass PrioritizationsForRequirement {\n  init(context) {\n    this.context = context;\n    context.mode.trackContainerResize(true);\n  }\n  updateView(context) {\n    var _a;\n    this.context = context;\n    var ctxAny = context.mode;\n    var props = {\n      dataset: context.parameters.prioritizations,\n      webAPI: context.webAPI,\n      navigation: context.navigation,\n      parentRequirementId: (_a = ctxAny.contextInfo) === null || _a === void 0 ? void 0 : _a.entityId\n    };\n    return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_PrioritizationsForRequirementApp__WEBPACK_IMPORTED_MODULE_1__.PrioritizationsForRequirementApp, props);\n  }\n  getOutputs() {\n    return {};\n  }\n  destroy() {}\n}\n\n//# sourceURL=webpack://pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad/./PrioritizationsForRequirement/index.ts?\n}");

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
/******/ 	var __webpack_exports__ = __webpack_require__("./PrioritizationsForRequirement/index.ts");
/******/ 	pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad = __webpack_exports__;
/******/ 	
/******/ })()
;
if (window.ComponentFramework && window.ComponentFramework.registerControl) {
	ComponentFramework.registerControl('ARNGCheckbook.PrioritizationsForRequirement', pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad.PrioritizationsForRequirement);
} else {
	var ARNGCheckbook = ARNGCheckbook || {};
	ARNGCheckbook.PrioritizationsForRequirement = pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad.PrioritizationsForRequirement;
	pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad = undefined;
}