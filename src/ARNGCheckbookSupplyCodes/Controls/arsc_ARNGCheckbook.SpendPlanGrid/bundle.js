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

/***/ "./SpendPlanGrid/SpendPlanGridApp.tsx"
/*!********************************************!*\
  !*** ./SpendPlanGrid/SpendPlanGridApp.tsx ***!
  \********************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

eval("{__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   SpendPlanGridApp: () => (/* binding */ SpendPlanGridApp)\n/* harmony export */ });\n/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! react */ \"react\");\n/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(react__WEBPACK_IMPORTED_MODULE_0__);\n/* harmony import */ var _fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! @fluentui/react-components */ \"@fluentui/react-components\");\n/* harmony import */ var _fluentui_react_components__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__);\n\n\n// Fiscal-year order (Oct-Sep)\nvar MONTHS = [{\n  col: \"october\",\n  short: \"Oct\"\n}, {\n  col: \"november\",\n  short: \"Nov\"\n}, {\n  col: \"december\",\n  short: \"Dec\"\n}, {\n  col: \"january\",\n  short: \"Jan\"\n}, {\n  col: \"february\",\n  short: \"Feb\"\n}, {\n  col: \"march\",\n  short: \"Mar\"\n}, {\n  col: \"april\",\n  short: \"Apr\"\n}, {\n  col: \"may\",\n  short: \"May\"\n}, {\n  col: \"june\",\n  short: \"Jun\"\n}, {\n  col: \"july\",\n  short: \"Jul\"\n}, {\n  col: \"august\",\n  short: \"Aug\"\n}, {\n  col: \"september\",\n  short: \"Sep\"\n}];\nvar fmtMoney = n => {\n  if (Math.abs(n) >= 1000000) return \"$\".concat((n / 1000000).toFixed(1), \"M\");\n  if (Math.abs(n) >= 10000) return \"$\".concat((n / 1000).toFixed(0), \"K\");\n  if (Math.abs(n) >= 1000) return \"$\".concat((n / 1000).toFixed(1), \"K\");\n  return n.toLocaleString(\"en-US\", {\n    style: \"currency\",\n    currency: \"USD\",\n    maximumFractionDigits: 0\n  });\n};\nfunction getLookupName(r, col) {\n  var _a, _b;\n  var raw = r.getValue(col);\n  if (!raw) return null;\n  var v = Array.isArray(raw) ? raw[0] : raw;\n  return (_b = (_a = v === null || v === void 0 ? void 0 : v.name) !== null && _a !== void 0 ? _a : r.getFormattedValue(col)) !== null && _b !== void 0 ? _b : null;\n}\nfunction readMonths(r) {\n  return MONTHS.map(m => {\n    var _a;\n    return (_a = r.getValue(m.col)) !== null && _a !== void 0 ? _a : 0;\n  });\n}\nfunction Sparkline(_ref) {\n  var values = _ref.values,\n    max = _ref.max,\n    color = _ref.color;\n  var w = 110,\n    h = 24,\n    pad = 2;\n  if (max <= 0) {\n    return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"svg\", {\n      width: w,\n      height: h,\n      \"aria-hidden\": \"true\"\n    });\n  }\n  var stepX = (w - pad * 2) / (values.length - 1);\n  var pts = values.map((v, i) => {\n    var x = pad + i * stepX;\n    var y = h - pad - v / max * (h - pad * 2);\n    return \"\".concat(x, \",\").concat(y);\n  });\n  return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"svg\", {\n    width: w,\n    height: h,\n    \"aria-label\": \"monthly profile\"\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"polyline\", {\n    points: pts.join(\" \"),\n    fill: \"none\",\n    stroke: color,\n    strokeWidth: 1.5\n  }));\n}\nfunction cellBgFor(v, rowMax) {\n  if (v <= 0 || rowMax <= 0) return \"transparent\";\n  var intensity = Math.min(1, v / rowMax);\n  // Tint of Fluent blue (#4F6BED). Background opacity 0.08 → 0.45.\n  var opacity = 0.08 + intensity * 0.37;\n  return \"rgba(79, 107, 237, \".concat(opacity.toFixed(3), \")\");\n}\nvar SpendPlanGridApp = props => {\n  var dataset = props.dataset,\n    navigation = props.navigation;\n  var records = dataset.sortedRecordIds.map(id => dataset.records[id]);\n  var rows = records.map(r => {\n    var _a;\n    var months = readMonths(r);\n    var sum = months.reduce((s, x) => s + x, 0);\n    var declaredTotal = (_a = r.getValue(\"total\")) !== null && _a !== void 0 ? _a : null;\n    var totalMatches = declaredTotal == null ? true : Math.abs(declaredTotal - sum) < 0.5;\n    return {\n      id: r.getRecordId(),\n      name: r.getValue(\"name\") || \"(unnamed)\",\n      loa: getLookupName(r, \"lineOfAccounting\"),\n      requirement: getLookupName(r, \"requirement\"),\n      months,\n      monthsMax: Math.max(0, ...months),\n      sum,\n      declaredTotal,\n      totalMatches,\n      ref: r\n    };\n  });\n  // Column totals (across all rows for each month)\n  var colTotals = MONTHS.map((_, idx) => rows.reduce((s, row) => s + row.months[idx], 0));\n  var grandTotal = colTotals.reduce((s, x) => s + x, 0);\n  // Color scale: use the max cell value across the grid for cell intensity\n  var gridMax = Math.max(0, ...rows.flatMap(r => r.months));\n  var onOpen = id => {\n    navigation.openForm({\n      entityName: \"book_spendplan\",\n      entityId: id,\n      openInNewWindow: false\n    }).then(() => dataset.refresh()).catch(() => {});\n  };\n  return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.FluentProvider, {\n    theme: _fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.webLightTheme\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    className: \"arsc-spendplan-grid\",\n    style: {\n      padding: 12,\n      fontFamily: \"Segoe UI, sans-serif\",\n      fontSize: 13,\n      background: \"#FFFFFF\"\n    }\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    style: {\n      display: \"flex\",\n      alignItems: \"center\",\n      gap: 12,\n      marginBottom: 12\n    }\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"span\", {\n    style: {\n      fontSize: 15,\n      fontWeight: 600\n    }\n  }, \"Spend Plan\"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.Badge, {\n    appearance: \"outline\",\n    color: \"informative\",\n    size: \"medium\"\n  }, rows.length, \" \", rows.length === 1 ? \"plan\" : \"plans\", \" \\u00B7 \", fmtMoney(grandTotal))), rows.length === 0 ? (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    style: {\n      color: \"#605E5C\",\n      padding: \"16px 0\",\n      borderTop: \"1px solid #EDEBE9\"\n    }\n  }, \"No spend plans in scope.\")) : (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    style: {\n      overflowX: \"auto\"\n    }\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"table\", {\n    style: {\n      width: \"100%\",\n      borderCollapse: \"collapse\",\n      fontVariantNumeric: \"tabular-nums\"\n    }\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"thead\", null, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"tr\", {\n    style: {\n      background: \"#F3F2F1\",\n      textAlign: \"left\"\n    }\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"th\", {\n    style: {\n      padding: \"6px 8px\",\n      position: \"sticky\",\n      left: 0,\n      background: \"#F3F2F1\",\n      zIndex: 1,\n      minWidth: 180\n    }\n  }, \"Plan\"), MONTHS.map(m => (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"th\", {\n    key: m.col,\n    style: {\n      padding: \"6px 6px\",\n      textAlign: \"right\",\n      minWidth: 64\n    }\n  }, m.short))), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"th\", {\n    style: {\n      padding: \"6px 8px\",\n      textAlign: \"right\"\n    }\n  }, \"Total\"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"th\", {\n    style: {\n      padding: \"6px 8px\",\n      textAlign: \"center\"\n    }\n  }, \"Profile\"))), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"tbody\", null, rows.map(row => {\n    var _a;\n    return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"tr\", {\n      key: row.id,\n      style: {\n        borderBottom: \"1px solid #EDEBE9\"\n      }\n    }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"td\", {\n      style: {\n        padding: \"6px 8px\",\n        position: \"sticky\",\n        left: 0,\n        background: \"#FFFFFF\",\n        zIndex: 1,\n        maxWidth: 220,\n        overflow: \"hidden\",\n        textOverflow: \"ellipsis\",\n        whiteSpace: \"nowrap\"\n      },\n      title: [row.name, row.requirement, row.loa].filter(Boolean).join(\" · \")\n    }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.Button, {\n      size: \"small\",\n      appearance: \"subtle\",\n      onClick: () => onOpen(row.id),\n      style: {\n        padding: 0,\n        height: \"auto\",\n        minWidth: 0,\n        justifyContent: \"flex-start\"\n      }\n    }, row.name), row.requirement && (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n      style: {\n        color: \"#605E5C\",\n        fontSize: 11\n      }\n    }, row.requirement))), row.months.map((v, i) => (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"td\", {\n      key: i,\n      style: {\n        padding: \"6px 6px\",\n        textAlign: \"right\",\n        background: cellBgFor(v, gridMax),\n        color: v > 0 ? \"#323130\" : \"#A19F9D\"\n      }\n    }, v > 0 ? fmtMoney(v) : \"—\"))), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"td\", {\n      style: {\n        padding: \"6px 8px\",\n        textAlign: \"right\",\n        fontWeight: 600,\n        color: row.totalMatches ? \"#323130\" : \"#A4262C\"\n      },\n      title: row.totalMatches ? undefined : \"Sum of months (\".concat(fmtMoney(row.sum), \") doesn't match declared total (\").concat(fmtMoney((_a = row.declaredTotal) !== null && _a !== void 0 ? _a : 0), \")\")\n    }, fmtMoney(row.sum), !row.totalMatches && /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"span\", {\n      style: {\n        marginLeft: 4\n      }\n    }, \"!\")), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"td\", {\n      style: {\n        padding: \"6px 8px\"\n      }\n    }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(Sparkline, {\n      values: row.months,\n      max: row.monthsMax,\n      color: \"#4F6BED\"\n    })));\n  }), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"tr\", {\n    style: {\n      background: \"#FAF9F8\",\n      fontWeight: 600\n    }\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"td\", {\n    style: {\n      padding: \"8px\",\n      position: \"sticky\",\n      left: 0,\n      background: \"#FAF9F8\",\n      zIndex: 1\n    }\n  }, \"Total\"), colTotals.map((t, i) => (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"td\", {\n    key: i,\n    style: {\n      padding: \"8px 6px\",\n      textAlign: \"right\"\n    }\n  }, t > 0 ? fmtMoney(t) : \"—\"))), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"td\", {\n    style: {\n      padding: \"8px\",\n      textAlign: \"right\"\n    }\n  }, fmtMoney(grandTotal)), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"td\", {\n    style: {\n      padding: \"8px\"\n    }\n  }))))))));\n};\n\n//# sourceURL=webpack://pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad/./SpendPlanGrid/SpendPlanGridApp.tsx?\n}");

/***/ },

/***/ "./SpendPlanGrid/index.ts"
/*!********************************!*\
  !*** ./SpendPlanGrid/index.ts ***!
  \********************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

eval("{__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   SpendPlanGrid: () => (/* binding */ SpendPlanGrid)\n/* harmony export */ });\n/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! react */ \"react\");\n/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(react__WEBPACK_IMPORTED_MODULE_0__);\n/* harmony import */ var _SpendPlanGridApp__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./SpendPlanGridApp */ \"./SpendPlanGrid/SpendPlanGridApp.tsx\");\n\n\nclass SpendPlanGrid {\n  init(context, notifyOutputChanged) {\n    this.context = context;\n    this.notifyOutputChanged = notifyOutputChanged;\n    context.mode.trackContainerResize(true);\n  }\n  updateView(context) {\n    this.context = context;\n    return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_SpendPlanGridApp__WEBPACK_IMPORTED_MODULE_1__.SpendPlanGridApp, {\n      dataset: context.parameters.spendplans,\n      navigation: context.navigation\n    });\n  }\n  getOutputs() {\n    return {};\n  }\n  destroy() {}\n}\n\n//# sourceURL=webpack://pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad/./SpendPlanGrid/index.ts?\n}");

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
/******/ 	var __webpack_exports__ = __webpack_require__("./SpendPlanGrid/index.ts");
/******/ 	pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad = __webpack_exports__;
/******/ 	
/******/ })()
;
if (window.ComponentFramework && window.ComponentFramework.registerControl) {
	ComponentFramework.registerControl('ARNGCheckbook.SpendPlanGrid', pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad.SpendPlanGrid);
} else {
	var ARNGCheckbook = ARNGCheckbook || {};
	ARNGCheckbook.SpendPlanGrid = pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad.SpendPlanGrid;
	pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad = undefined;
}