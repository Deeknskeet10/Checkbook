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

/***/ "./UnfundedRequestsRank/UnfundedRequestsRankApp.tsx"
/*!**********************************************************!*\
  !*** ./UnfundedRequestsRank/UnfundedRequestsRankApp.tsx ***!
  \**********************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

eval("{__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   UnfundedRequestsRankApp: () => (/* binding */ UnfundedRequestsRankApp)\n/* harmony export */ });\n/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! react */ \"react\");\n/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(react__WEBPACK_IMPORTED_MODULE_0__);\n/* harmony import */ var _fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! @fluentui/react-components */ \"@fluentui/react-components\");\n/* harmony import */ var _fluentui_react_components__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__);\nfunction _slicedToArray(r, e) { return _arrayWithHoles(r) || _iterableToArrayLimit(r, e) || _unsupportedIterableToArray(r, e) || _nonIterableRest(); }\nfunction _nonIterableRest() { throw new TypeError(\"Invalid attempt to destructure non-iterable instance.\\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.\"); }\nfunction _unsupportedIterableToArray(r, a) { if (r) { if (\"string\" == typeof r) return _arrayLikeToArray(r, a); var t = {}.toString.call(r).slice(8, -1); return \"Object\" === t && r.constructor && (t = r.constructor.name), \"Map\" === t || \"Set\" === t ? Array.from(r) : \"Arguments\" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0; } }\nfunction _arrayLikeToArray(r, a) { (null == a || a > r.length) && (a = r.length); for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e]; return n; }\nfunction _iterableToArrayLimit(r, l) { var t = null == r ? null : \"undefined\" != typeof Symbol && r[Symbol.iterator] || r[\"@@iterator\"]; if (null != t) { var e, n, i, u, a = [], f = !0, o = !1; try { if (i = (t = t.call(r)).next, 0 === l) { if (Object(t) !== t) return; f = !1; } else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0); } catch (r) { o = !0, n = r; } finally { try { if (!f && null != t.return && (u = t.return(), Object(u) !== u)) return; } finally { if (o) throw n; } } return a; } }\nfunction _arrayWithHoles(r) { if (Array.isArray(r)) return r; }\nvar __awaiter = undefined && undefined.__awaiter || function (thisArg, _arguments, P, generator) {\n  function adopt(value) {\n    return value instanceof P ? value : new P(function (resolve) {\n      resolve(value);\n    });\n  }\n  return new (P || (P = Promise))(function (resolve, reject) {\n    function fulfilled(value) {\n      try {\n        step(generator.next(value));\n      } catch (e) {\n        reject(e);\n      }\n    }\n    function rejected(value) {\n      try {\n        step(generator[\"throw\"](value));\n      } catch (e) {\n        reject(e);\n      }\n    }\n    function step(result) {\n      result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);\n    }\n    step((generator = generator.apply(thisArg, _arguments || [])).next());\n  });\n};\n\n\nvar fmtMoney = n => n == null ? \"—\" : n.toLocaleString(\"en-US\", {\n  style: \"currency\",\n  currency: \"USD\",\n  maximumFractionDigits: 0\n});\nvar fmtDate = d => d ? d.toLocaleDateString(\"en-US\", {\n  year: \"numeric\",\n  month: \"short\",\n  day: \"numeric\"\n}) : \"\";\nvar daysUntil = d => d ? Math.ceil((d.getTime() - Date.now()) / (24 * 60 * 60 * 1000)) : null;\nfunction riskColor(label) {\n  var t = (label || \"\").toLowerCase();\n  if (t.includes(\"high\") || t.includes(\"critical\") || t.includes(\"severe\")) return \"danger\";\n  if (t.includes(\"med\") || t.includes(\"moder\")) return \"warning\";\n  if (t.includes(\"low\")) return \"success\";\n  return \"informative\";\n}\nvar UnfundedRequestsRankApp = props => {\n  var dataset = props.dataset,\n    webAPI = props.webAPI;\n  var toDate = v => {\n    if (!v) return null;\n    if (v instanceof Date) return v;\n    var d = new Date(v);\n    return isNaN(d.getTime()) ? null : d;\n  };\n  var initial = react__WEBPACK_IMPORTED_MODULE_0__.useMemo(() => {\n    return dataset.sortedRecordIds.map(id => dataset.records[id]).map(r => {\n      var _a, _b, _c, _d;\n      return {\n        id: r.getRecordId(),\n        name: r.getValue(\"name\") || \"(unnamed)\",\n        amount: (_a = r.getValue(\"amount\")) !== null && _a !== void 0 ? _a : null,\n        justification: (_b = r.getValue(\"justification\")) !== null && _b !== void 0 ? _b : null,\n        dropDeadDate: toDate(r.getValue(\"dropDeadDate\")),\n        riskLabel: (_c = r.getFormattedValue(\"riskLabel\")) !== null && _c !== void 0 ? _c : null,\n        priority: (_d = r.getValue(\"priority\")) !== null && _d !== void 0 ? _d : null\n      };\n    }).sort((a, b) => {\n      // Lower priority number = higher importance, but treat null as worst\n      var pa = a.priority == null ? Number.MAX_SAFE_INTEGER : a.priority;\n      var pb = b.priority == null ? Number.MAX_SAFE_INTEGER : b.priority;\n      return pa - pb;\n    });\n  }, [dataset.sortedRecordIds.join(\"|\")]);\n  var _React$useState = react__WEBPACK_IMPORTED_MODULE_0__.useState(initial),\n    _React$useState2 = _slicedToArray(_React$useState, 2),\n    rows = _React$useState2[0],\n    setRows = _React$useState2[1];\n  var _React$useState3 = react__WEBPACK_IMPORTED_MODULE_0__.useState(null),\n    _React$useState4 = _slicedToArray(_React$useState3, 2),\n    dragId = _React$useState4[0],\n    setDragId = _React$useState4[1];\n  var _React$useState5 = react__WEBPACK_IMPORTED_MODULE_0__.useState(null),\n    _React$useState6 = _slicedToArray(_React$useState5, 2),\n    hoverId = _React$useState6[0],\n    setHoverId = _React$useState6[1];\n  var _React$useState7 = react__WEBPACK_IMPORTED_MODULE_0__.useState(new Set()),\n    _React$useState8 = _slicedToArray(_React$useState7, 2),\n    savingIds = _React$useState8[0],\n    setSavingIds = _React$useState8[1];\n  var _React$useState9 = react__WEBPACK_IMPORTED_MODULE_0__.useState(null),\n    _React$useState0 = _slicedToArray(_React$useState9, 2),\n    err = _React$useState0[0],\n    setErr = _React$useState0[1];\n  // Keep rows in sync when the dataset changes externally\n  react__WEBPACK_IMPORTED_MODULE_0__.useEffect(() => {\n    setRows(initial);\n  }, [initial]);\n  var totalUnfunded = rows.reduce((s, r) => {\n    var _a;\n    return s + ((_a = r.amount) !== null && _a !== void 0 ? _a : 0);\n  }, 0);\n  var _onDragStart = (e, id) => {\n    setDragId(id);\n    e.dataTransfer.effectAllowed = \"move\";\n    e.dataTransfer.setData(\"text/plain\", id);\n  };\n  var _onDragOver = (e, overId) => {\n    e.preventDefault();\n    e.dataTransfer.dropEffect = \"move\";\n    if (overId !== hoverId) setHoverId(overId);\n  };\n  var onDragEnd = () => {\n    setDragId(null);\n    setHoverId(null);\n  };\n  var _onDrop = (e, overId) => __awaiter(void 0, void 0, void 0, function* () {\n    e.preventDefault();\n    setHoverId(null);\n    if (!dragId || dragId === overId) {\n      setDragId(null);\n      return;\n    }\n    var fromIdx = rows.findIndex(r => r.id === dragId);\n    var toIdx = rows.findIndex(r => r.id === overId);\n    if (fromIdx < 0 || toIdx < 0) {\n      setDragId(null);\n      return;\n    }\n    var next = [...rows];\n    var _next$splice = next.splice(fromIdx, 1),\n      _next$splice2 = _slicedToArray(_next$splice, 1),\n      moved = _next$splice2[0];\n    next.splice(toIdx, 0, moved);\n    // Renumber: 1-based priority across all rows\n    var priorityChanges = next.map((r, i) => ({\n      id: r.id,\n      priority: i + 1\n    })).filter((c, i) => next[i].priority !== c.priority);\n    // Optimistic update\n    setRows(next.map((r, i) => Object.assign(Object.assign({}, r), {\n      priority: i + 1\n    })));\n    setDragId(null);\n    // Push changes in parallel; track which rows are saving\n    var saving = new Set(priorityChanges.map(c => c.id));\n    setSavingIds(saving);\n    try {\n      yield Promise.all(priorityChanges.map(c => webAPI.updateRecord(\"book_unfundedrequests\", c.id, {\n        book_priority: c.priority\n      })));\n    } catch (e) {\n      setErr((e === null || e === void 0 ? void 0 : e.message) || \"Reorder save failed\");\n    } finally {\n      setSavingIds(new Set());\n      // Refresh dataset so other clients pick up changes\n      dataset.refresh();\n    }\n  });\n  return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.FluentProvider, {\n    theme: _fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.webLightTheme\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    className: \"arsc-ufr-rank\",\n    style: {\n      padding: 12,\n      fontFamily: \"Segoe UI, sans-serif\",\n      fontSize: 13,\n      background: \"#FFFFFF\"\n    }\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    style: {\n      display: \"flex\",\n      alignItems: \"center\",\n      gap: 12,\n      marginBottom: 12\n    }\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"span\", {\n    style: {\n      fontSize: 15,\n      fontWeight: 600\n    }\n  }, \"Unfunded Requests\"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.Badge, {\n    appearance: \"outline\",\n    color: \"informative\",\n    size: \"medium\"\n  }, rows.length, \" \", rows.length === 1 ? \"request\" : \"requests\", \" \\u00B7 \", fmtMoney(totalUnfunded)), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"span\", {\n    style: {\n      color: \"#605E5C\",\n      fontSize: 12\n    }\n  }, \"\\u00B7 Drag a card to reorder\")), err && (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.MessageBar, {\n    intent: \"error\",\n    style: {\n      marginBottom: 12\n    }\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.MessageBarBody, null, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"strong\", null, \"Save failed: \"), err, \" \", /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.Button, {\n    size: \"small\",\n    appearance: \"transparent\",\n    onClick: () => setErr(null)\n  }, \"Dismiss\")))), rows.length === 0 ? (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    style: {\n      color: \"#605E5C\",\n      padding: \"16px 0\",\n      borderTop: \"1px solid #EDEBE9\"\n    }\n  }, \"No unfunded requests in scope.\")) : (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    style: {\n      display: \"flex\",\n      flexDirection: \"column\",\n      gap: 6\n    }\n  }, rows.map((row, idx) => {\n    var dragging = dragId === row.id;\n    var hovering = hoverId === row.id && dragId !== row.id;\n    var dDays = daysUntil(row.dropDeadDate);\n    var justPreview = (row.justification || \"\").replace(/\\s+/g, \" \").slice(0, 140);\n    return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n      key: row.id,\n      draggable: true,\n      onDragStart: e => _onDragStart(e, row.id),\n      onDragOver: e => _onDragOver(e, row.id),\n      onDragEnd: onDragEnd,\n      onDrop: e => _onDrop(e, row.id),\n      style: {\n        display: \"flex\",\n        alignItems: \"center\",\n        gap: 12,\n        padding: \"8px 12px\",\n        border: hovering ? \"2px dashed #4F6BED\" : \"1px solid #EDEBE9\",\n        borderRadius: 4,\n        background: dragging ? \"#F3F2F1\" : \"#FFFFFF\",\n        opacity: dragging ? 0.5 : 1,\n        cursor: \"grab\"\n      }\n    }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n      style: {\n        minWidth: 32,\n        height: 32,\n        borderRadius: 16,\n        background: idx === 0 ? \"#107C10\" : idx <= 2 ? \"#0078D4\" : \"#605E5C\",\n        color: \"#FFFFFF\",\n        display: \"flex\",\n        alignItems: \"center\",\n        justifyContent: \"center\",\n        fontWeight: 700,\n        fontSize: 13,\n        fontVariantNumeric: \"tabular-nums\"\n      },\n      title: \"Rank \".concat(idx + 1)\n    }, idx + 1), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n      style: {\n        flex: 1,\n        minWidth: 0\n      }\n    }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n      style: {\n        display: \"flex\",\n        alignItems: \"baseline\",\n        gap: 8,\n        marginBottom: 2\n      }\n    }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"strong\", {\n      style: {\n        overflow: \"hidden\",\n        textOverflow: \"ellipsis\",\n        whiteSpace: \"nowrap\",\n        maxWidth: 480\n      }\n    }, row.name), row.riskLabel && (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.Badge, {\n      appearance: \"tint\",\n      color: riskColor(row.riskLabel)\n    }, row.riskLabel)), dDays != null && (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.Badge, {\n      appearance: \"outline\",\n      color: dDays < 0 ? \"danger\" : dDays < 30 ? \"warning\" : \"informative\",\n      title: \"Drop-dead: \".concat(fmtDate(row.dropDeadDate))\n    }, dDays < 0 ? \"\".concat(Math.abs(dDays), \"d overdue\") : \"\".concat(dDays, \"d to drop-dead\")))), justPreview && (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n      style: {\n        color: \"#605E5C\",\n        fontSize: 12\n      }\n    }, justPreview, (row.justification || \"\").length > 140 && \"…\"))), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n      style: {\n        fontWeight: 700,\n        fontSize: 14,\n        fontVariantNumeric: \"tabular-nums\",\n        color: \"#323130\",\n        minWidth: 96,\n        textAlign: \"right\"\n      }\n    }, fmtMoney(row.amount)), savingIds.has(row.id) && /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.Spinner, {\n      size: \"extra-tiny\"\n    }), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"span\", {\n      \"aria-hidden\": \"true\",\n      style: {\n        width: 20,\n        textAlign: \"center\",\n        color: \"#A19F9D\",\n        cursor: \"grab\",\n        userSelect: \"none\"\n      },\n      title: \"Drag handle\"\n    }, \"\\u22EE\\u22EE\"));\n  })))));\n};\n\n//# sourceURL=webpack://pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad/./UnfundedRequestsRank/UnfundedRequestsRankApp.tsx?\n}");

/***/ },

/***/ "./UnfundedRequestsRank/index.ts"
/*!***************************************!*\
  !*** ./UnfundedRequestsRank/index.ts ***!
  \***************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

eval("{__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   UnfundedRequestsRank: () => (/* binding */ UnfundedRequestsRank)\n/* harmony export */ });\n/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! react */ \"react\");\n/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(react__WEBPACK_IMPORTED_MODULE_0__);\n/* harmony import */ var _UnfundedRequestsRankApp__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./UnfundedRequestsRankApp */ \"./UnfundedRequestsRank/UnfundedRequestsRankApp.tsx\");\n\n\nclass UnfundedRequestsRank {\n  init(context, notifyOutputChanged) {\n    this.context = context;\n    this.notifyOutputChanged = notifyOutputChanged;\n  }\n  updateView(context) {\n    this.context = context;\n    return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_UnfundedRequestsRankApp__WEBPACK_IMPORTED_MODULE_1__.UnfundedRequestsRankApp, {\n      dataset: context.parameters.ufrs,\n      webAPI: context.webAPI,\n      navigation: context.navigation\n    });\n  }\n  getOutputs() {\n    return {};\n  }\n  destroy() {}\n}\n\n//# sourceURL=webpack://pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad/./UnfundedRequestsRank/index.ts?\n}");

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
/******/ 	var __webpack_exports__ = __webpack_require__("./UnfundedRequestsRank/index.ts");
/******/ 	pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad = __webpack_exports__;
/******/ 	
/******/ })()
;
if (window.ComponentFramework && window.ComponentFramework.registerControl) {
	ComponentFramework.registerControl('ARNGCheckbook.UnfundedRequestsRank', pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad.UnfundedRequestsRank);
} else {
	var ARNGCheckbook = ARNGCheckbook || {};
	ARNGCheckbook.UnfundedRequestsRank = pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad.UnfundedRequestsRank;
	pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad = undefined;
}