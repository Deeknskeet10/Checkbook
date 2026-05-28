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

/***/ "./RequirementDetailsRank/RequirementDetailsRankApp.tsx"
/*!**************************************************************!*\
  !*** ./RequirementDetailsRank/RequirementDetailsRankApp.tsx ***!
  \**************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

eval("{__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   RequirementDetailsRankApp: () => (/* binding */ RequirementDetailsRankApp)\n/* harmony export */ });\n/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! react */ \"react\");\n/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(react__WEBPACK_IMPORTED_MODULE_0__);\n/* harmony import */ var _fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! @fluentui/react-components */ \"@fluentui/react-components\");\n/* harmony import */ var _fluentui_react_components__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__);\nfunction _slicedToArray(r, e) { return _arrayWithHoles(r) || _iterableToArrayLimit(r, e) || _unsupportedIterableToArray(r, e) || _nonIterableRest(); }\nfunction _nonIterableRest() { throw new TypeError(\"Invalid attempt to destructure non-iterable instance.\\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.\"); }\nfunction _unsupportedIterableToArray(r, a) { if (r) { if (\"string\" == typeof r) return _arrayLikeToArray(r, a); var t = {}.toString.call(r).slice(8, -1); return \"Object\" === t && r.constructor && (t = r.constructor.name), \"Map\" === t || \"Set\" === t ? Array.from(r) : \"Arguments\" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0; } }\nfunction _arrayLikeToArray(r, a) { (null == a || a > r.length) && (a = r.length); for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e]; return n; }\nfunction _iterableToArrayLimit(r, l) { var t = null == r ? null : \"undefined\" != typeof Symbol && r[Symbol.iterator] || r[\"@@iterator\"]; if (null != t) { var e, n, i, u, a = [], f = !0, o = !1; try { if (i = (t = t.call(r)).next, 0 === l) { if (Object(t) !== t) return; f = !1; } else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0); } catch (r) { o = !0, n = r; } finally { try { if (!f && null != t.return && (u = t.return(), Object(u) !== u)) return; } finally { if (o) throw n; } } return a; } }\nfunction _arrayWithHoles(r) { if (Array.isArray(r)) return r; }\nvar __awaiter = undefined && undefined.__awaiter || function (thisArg, _arguments, P, generator) {\n  function adopt(value) {\n    return value instanceof P ? value : new P(function (resolve) {\n      resolve(value);\n    });\n  }\n  return new (P || (P = Promise))(function (resolve, reject) {\n    function fulfilled(value) {\n      try {\n        step(generator.next(value));\n      } catch (e) {\n        reject(e);\n      }\n    }\n    function rejected(value) {\n      try {\n        step(generator[\"throw\"](value));\n      } catch (e) {\n        reject(e);\n      }\n    }\n    function step(result) {\n      result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);\n    }\n    step((generator = generator.apply(thisArg, _arguments || [])).next());\n  });\n};\n\n\nvar ENTITY = \"book_requirementdetails\";\nvar FIELD_ORDER = \"book_priorityorder\";\nvar ITEM_ENTITY = \"book_items\";\nvar FV = \"@OData.Community.Display.V1.FormattedValue\";\nvar stripBraces = id => id.replace(/[{}]/g, \"\").toLowerCase();\nvar RequirementDetailsRankApp = props => {\n  var dataset = props.dataset,\n    webAPI = props.webAPI,\n    navigation = props.navigation,\n    parentRequirementId = props.parentRequirementId;\n  var initial = react__WEBPACK_IMPORTED_MODULE_0__.useMemo(() => {\n    return dataset.sortedRecordIds.map(id => dataset.records[id]).map(r => {\n      var _a, _b, _c, _d, _e, _f, _g;\n      var itemRef = r.getValue(\"item\");\n      var tdcRef = r.getValue(\"tdc\");\n      return {\n        id: r.getRecordId(),\n        name: (_a = r.getValue(\"name\")) !== null && _a !== void 0 ? _a : \"(unnamed)\",\n        priorityOrder: (_b = r.getValue(\"priorityOrder\")) !== null && _b !== void 0 ? _b : null,\n        itemId: itemRef ? stripBraces((_c = itemRef.id.guid) !== null && _c !== void 0 ? _c : itemRef.id) : null,\n        itemLabel: (_e = (_d = itemRef === null || itemRef === void 0 ? void 0 : itemRef.name) !== null && _d !== void 0 ? _d : r.getFormattedValue(\"item\")) !== null && _e !== void 0 ? _e : null,\n        tdcLabel: (_g = (_f = tdcRef === null || tdcRef === void 0 ? void 0 : tdcRef.name) !== null && _f !== void 0 ? _f : r.getFormattedValue(\"tdc\")) !== null && _g !== void 0 ? _g : null\n      };\n    }).sort((a, b) => {\n      var _a, _b;\n      var pa = (_a = a.priorityOrder) !== null && _a !== void 0 ? _a : Number.MAX_SAFE_INTEGER;\n      var pb = (_b = b.priorityOrder) !== null && _b !== void 0 ? _b : Number.MAX_SAFE_INTEGER;\n      return pa - pb;\n    });\n  }, [dataset.sortedRecordIds.join(\"|\")]);\n  var _React$useState = react__WEBPACK_IMPORTED_MODULE_0__.useState(initial),\n    _React$useState2 = _slicedToArray(_React$useState, 2),\n    rows = _React$useState2[0],\n    setRows = _React$useState2[1];\n  var _React$useState3 = react__WEBPACK_IMPORTED_MODULE_0__.useState(null),\n    _React$useState4 = _slicedToArray(_React$useState3, 2),\n    dragId = _React$useState4[0],\n    setDragId = _React$useState4[1];\n  var _React$useState5 = react__WEBPACK_IMPORTED_MODULE_0__.useState(null),\n    _React$useState6 = _slicedToArray(_React$useState5, 2),\n    hoverId = _React$useState6[0],\n    setHoverId = _React$useState6[1];\n  var _React$useState7 = react__WEBPACK_IMPORTED_MODULE_0__.useState(new Set()),\n    _React$useState8 = _slicedToArray(_React$useState7, 2),\n    savingIds = _React$useState8[0],\n    setSavingIds = _React$useState8[1];\n  var _React$useState9 = react__WEBPACK_IMPORTED_MODULE_0__.useState(null),\n    _React$useState0 = _slicedToArray(_React$useState9, 2),\n    err = _React$useState0[0],\n    setErr = _React$useState0[1];\n  var _React$useState1 = react__WEBPACK_IMPORTED_MODULE_0__.useState(null),\n    _React$useState10 = _slicedToArray(_React$useState1, 2),\n    parentPriority = _React$useState10[0],\n    setParentPriority = _React$useState10[1];\n  var _React$useState11 = react__WEBPACK_IMPORTED_MODULE_0__.useState(new Map()),\n    _React$useState12 = _slicedToArray(_React$useState11, 2),\n    itemMeta = _React$useState12[0],\n    setItemMeta = _React$useState12[1];\n  react__WEBPACK_IMPORTED_MODULE_0__.useEffect(() => {\n    setRows(initial);\n  }, [initial]);\n  react__WEBPACK_IMPORTED_MODULE_0__.useEffect(() => {\n    if (!parentRequirementId) return;\n    var cancelled = false;\n    webAPI.retrieveRecord(\"book_requirements\", parentRequirementId, \"?$select=book_priority\").then(rec => {\n      var _a;\n      if (!cancelled) setParentPriority((_a = rec === null || rec === void 0 ? void 0 : rec.book_priority) !== null && _a !== void 0 ? _a : null);\n      return null;\n    }).catch(() => {\n      /* parent priority is decorative — fall back to bare order */\n    });\n    return () => {\n      cancelled = true;\n    };\n  }, [parentRequirementId, webAPI]);\n  // Fetch Category + Quantity Type from each row's linked Item.\n  // These columns moved off book_requirementdetails — the canonical source is book_item.\n  react__WEBPACK_IMPORTED_MODULE_0__.useEffect(() => {\n    var ids = Array.from(new Set(initial.map(r => r.itemId).filter(x => !!x)));\n    if (ids.length === 0) {\n      setItemMeta(new Map());\n      return;\n    }\n    var cancelled = false;\n    var filter = ids.map(id => \"book_itemid eq \".concat(id)).join(\" or \");\n    var options = \"?$select=book_itemid,book_category,_book_quantitytype_value\" + \"&$filter=(\".concat(filter, \")\");\n    webAPI.retrieveMultipleRecords(ITEM_ENTITY, options).then(res => {\n      var _a, _b;\n      if (cancelled) return null;\n      var next = new Map();\n      for (var e of res.entities) {\n        var id = stripBraces(e.book_itemid);\n        next.set(id, {\n          category: (_a = e[\"book_category\".concat(FV)]) !== null && _a !== void 0 ? _a : null,\n          quantityType: (_b = e[\"_book_quantitytype_value\".concat(FV)]) !== null && _b !== void 0 ? _b : null\n        });\n      }\n      setItemMeta(next);\n      return null;\n    }).catch(() => {\n      // Inherited badges are decorative — leave them blank on failure.\n    });\n    return () => {\n      cancelled = true;\n    };\n  }, [initial, webAPI]);\n  var displayPriority = idx => {\n    var order = idx + 1;\n    return parentPriority != null ? \"\".concat(parentPriority, \".\").concat(order) : \"\".concat(order);\n  };\n  var _onDragStart = (e, id) => {\n    setDragId(id);\n    e.dataTransfer.effectAllowed = \"move\";\n    e.dataTransfer.setData(\"text/plain\", id);\n  };\n  var _onDragOver = (e, overId) => {\n    e.preventDefault();\n    e.dataTransfer.dropEffect = \"move\";\n    if (overId !== hoverId) setHoverId(overId);\n  };\n  var onDragEnd = () => {\n    setDragId(null);\n    setHoverId(null);\n  };\n  var _onDrop = (e, overId) => __awaiter(void 0, void 0, void 0, function* () {\n    var _a;\n    e.preventDefault();\n    setHoverId(null);\n    if (!dragId || dragId === overId) {\n      setDragId(null);\n      return;\n    }\n    var fromIdx = rows.findIndex(r => r.id === dragId);\n    var toIdx = rows.findIndex(r => r.id === overId);\n    if (fromIdx < 0 || toIdx < 0) {\n      setDragId(null);\n      return;\n    }\n    var next = [...rows];\n    var _next$splice = next.splice(fromIdx, 1),\n      _next$splice2 = _slicedToArray(_next$splice, 1),\n      moved = _next$splice2[0];\n    next.splice(toIdx, 0, moved);\n    var changes = next.map((r, i) => ({\n      id: r.id,\n      order: i + 1\n    })).filter((c, i) => next[i].priorityOrder !== c.order);\n    setRows(next.map((r, i) => Object.assign(Object.assign({}, r), {\n      priorityOrder: i + 1\n    })));\n    setDragId(null);\n    var saving = new Set(changes.map(c => c.id));\n    setSavingIds(saving);\n    try {\n      yield Promise.all(changes.map(c => webAPI.updateRecord(ENTITY, c.id, {\n        [FIELD_ORDER]: c.order\n      })));\n    } catch (ex) {\n      setErr((_a = ex === null || ex === void 0 ? void 0 : ex.message) !== null && _a !== void 0 ? _a : \"Reorder save failed\");\n    } finally {\n      setSavingIds(new Set());\n      dataset.refresh();\n    }\n  });\n  var openDetail = id => {\n    void navigation.openForm({\n      entityName: ENTITY,\n      entityId: id\n    });\n  };\n  return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.FluentProvider, {\n    theme: _fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.webLightTheme\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    className: \"arsc-reqdetails-rank\",\n    style: {\n      padding: 12,\n      fontFamily: \"Segoe UI, sans-serif\",\n      fontSize: 13,\n      background: \"#FFFFFF\"\n    }\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    style: {\n      display: \"flex\",\n      alignItems: \"center\",\n      gap: 12,\n      marginBottom: 12,\n      flexWrap: \"wrap\"\n    }\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"span\", {\n    style: {\n      fontSize: 15,\n      fontWeight: 600\n    }\n  }, \"Requirement Details\"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.Badge, {\n    appearance: \"outline\",\n    color: \"informative\",\n    size: \"medium\"\n  }, rows.length, \" \", rows.length === 1 ? \"detail\" : \"details\"), parentPriority != null && (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.Badge, {\n    appearance: \"tint\",\n    color: \"brand\"\n  }, \"Parent priority: \", parentPriority)), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"span\", {\n    style: {\n      color: \"#605E5C\",\n      fontSize: 12\n    }\n  }, \"\\u00B7 Drag a card to reorder\")), err && (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.MessageBar, {\n    intent: \"error\",\n    style: {\n      marginBottom: 12\n    }\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.MessageBarBody, null, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"strong\", null, \"Save failed: \"), err, \" \", /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.Button, {\n    size: \"small\",\n    appearance: \"transparent\",\n    onClick: () => setErr(null)\n  }, \"Dismiss\")))), rows.length === 0 ? (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    style: {\n      color: \"#605E5C\",\n      padding: \"16px 0\",\n      borderTop: \"1px solid #EDEBE9\"\n    }\n  }, \"No requirement details yet.\")) : (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    style: {\n      display: \"flex\",\n      flexDirection: \"column\",\n      gap: 6\n    }\n  }, rows.map((row, idx) => {\n    var dragging = dragId === row.id;\n    var hovering = hoverId === row.id && dragId !== row.id;\n    var inherited = row.itemId ? itemMeta.get(row.itemId) : undefined;\n    return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n      key: row.id,\n      draggable: true,\n      onDragStart: e => _onDragStart(e, row.id),\n      onDragOver: e => _onDragOver(e, row.id),\n      onDragEnd: onDragEnd,\n      onDrop: e => {\n        void _onDrop(e, row.id);\n      },\n      style: {\n        display: \"flex\",\n        alignItems: \"center\",\n        gap: 12,\n        padding: \"8px 12px\",\n        border: hovering ? \"2px dashed #4F6BED\" : \"1px solid #EDEBE9\",\n        borderRadius: 4,\n        background: dragging ? \"#F3F2F1\" : \"#FFFFFF\",\n        opacity: dragging ? 0.5 : 1,\n        cursor: \"grab\"\n      }\n    }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n      style: {\n        minWidth: 56,\n        height: 32,\n        padding: \"0 8px\",\n        borderRadius: 16,\n        background: idx === 0 ? \"#107C10\" : idx <= 2 ? \"#0078D4\" : \"#605E5C\",\n        color: \"#FFFFFF\",\n        display: \"flex\",\n        alignItems: \"center\",\n        justifyContent: \"center\",\n        fontWeight: 700,\n        fontSize: 13,\n        fontVariantNumeric: \"tabular-nums\"\n      },\n      title: \"Priority \".concat(displayPriority(idx))\n    }, displayPriority(idx)), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n      style: {\n        flex: 1,\n        minWidth: 0\n      }\n    }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n      style: {\n        display: \"flex\",\n        alignItems: \"baseline\",\n        gap: 8,\n        flexWrap: \"wrap\",\n        marginBottom: 2\n      }\n    }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"strong\", {\n      onClick: () => openDetail(row.id),\n      style: {\n        overflow: \"hidden\",\n        textOverflow: \"ellipsis\",\n        whiteSpace: \"nowrap\",\n        maxWidth: 480,\n        cursor: \"pointer\",\n        color: \"#0078D4\"\n      }\n    }, row.name), row.itemLabel && (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.Badge, {\n      appearance: \"outline\",\n      color: \"informative\"\n    }, \"Item: \", row.itemLabel)), row.tdcLabel && (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.Badge, {\n      appearance: \"outline\",\n      color: \"informative\"\n    }, \"TDC: \", row.tdcLabel)), (inherited === null || inherited === void 0 ? void 0 : inherited.category) && (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.Badge, {\n      appearance: \"tint\",\n      color: \"informative\"\n    }, inherited.category)), (inherited === null || inherited === void 0 ? void 0 : inherited.quantityType) && (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.Badge, {\n      appearance: \"tint\",\n      color: \"informative\"\n    }, inherited.quantityType)))), savingIds.has(row.id) && /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.Spinner, {\n      size: \"extra-tiny\"\n    }), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"span\", {\n      \"aria-hidden\": \"true\",\n      style: {\n        width: 20,\n        textAlign: \"center\",\n        color: \"#A19F9D\",\n        cursor: \"grab\",\n        userSelect: \"none\"\n      },\n      title: \"Drag handle\"\n    }, \"\\u22EE\\u22EE\"));\n  })))));\n};\n\n//# sourceURL=webpack://pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad/./RequirementDetailsRank/RequirementDetailsRankApp.tsx?\n}");

/***/ },

/***/ "./RequirementDetailsRank/index.ts"
/*!*****************************************!*\
  !*** ./RequirementDetailsRank/index.ts ***!
  \*****************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

eval("{__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   RequirementDetailsRank: () => (/* binding */ RequirementDetailsRank)\n/* harmony export */ });\n/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! react */ \"react\");\n/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(react__WEBPACK_IMPORTED_MODULE_0__);\n/* harmony import */ var _RequirementDetailsRankApp__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./RequirementDetailsRankApp */ \"./RequirementDetailsRank/RequirementDetailsRankApp.tsx\");\n\n\nvar PAGE_SIZE = 500;\nclass RequirementDetailsRank {\n  constructor() {\n    this.pageSizeSet = false;\n  }\n  init(context) {\n    this.context = context;\n    context.mode.trackContainerResize(true);\n  }\n  updateView(context) {\n    var _a;\n    this.context = context;\n    var dataset = context.parameters.details;\n    if (!dataset.loading) {\n      if (!this.pageSizeSet) {\n        this.pageSizeSet = true;\n        dataset.paging.setPageSize(PAGE_SIZE);\n        dataset.refresh();\n      } else if (dataset.paging.hasNextPage) {\n        dataset.paging.loadNextPage();\n      }\n    }\n    var ctxAny = context.mode;\n    return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_RequirementDetailsRankApp__WEBPACK_IMPORTED_MODULE_1__.RequirementDetailsRankApp, {\n      dataset,\n      webAPI: context.webAPI,\n      navigation: context.navigation,\n      parentRequirementId: (_a = ctxAny.contextInfo) === null || _a === void 0 ? void 0 : _a.entityId\n    });\n  }\n  getOutputs() {\n    return {};\n  }\n  destroy() {\n    // No teardown required — React unmount is handled by the framework.\n  }\n}\n\n//# sourceURL=webpack://pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad/./RequirementDetailsRank/index.ts?\n}");

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
/******/ 	var __webpack_exports__ = __webpack_require__("./RequirementDetailsRank/index.ts");
/******/ 	pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad = __webpack_exports__;
/******/ 	
/******/ })()
;
if (window.ComponentFramework && window.ComponentFramework.registerControl) {
	ComponentFramework.registerControl('ARNGCheckbook.RequirementDetailsRank', pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad.RequirementDetailsRank);
} else {
	var ARNGCheckbook = ARNGCheckbook || {};
	ARNGCheckbook.RequirementDetailsRank = pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad.RequirementDetailsRank;
	pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad = undefined;
}