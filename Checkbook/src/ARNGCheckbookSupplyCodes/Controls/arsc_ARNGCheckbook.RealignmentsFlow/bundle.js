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

/***/ "./RealignmentsFlow/RealignmentsFlowApp.tsx"
/*!**************************************************!*\
  !*** ./RealignmentsFlow/RealignmentsFlowApp.tsx ***!
  \**************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

eval("{__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   RealignmentsFlowApp: () => (/* binding */ RealignmentsFlowApp)\n/* harmony export */ });\n/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! react */ \"react\");\n/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(react__WEBPACK_IMPORTED_MODULE_0__);\n/* harmony import */ var _fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! @fluentui/react-components */ \"@fluentui/react-components\");\n/* harmony import */ var _fluentui_react_components__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__);\nfunction _slicedToArray(r, e) { return _arrayWithHoles(r) || _iterableToArrayLimit(r, e) || _unsupportedIterableToArray(r, e) || _nonIterableRest(); }\nfunction _nonIterableRest() { throw new TypeError(\"Invalid attempt to destructure non-iterable instance.\\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.\"); }\nfunction _unsupportedIterableToArray(r, a) { if (r) { if (\"string\" == typeof r) return _arrayLikeToArray(r, a); var t = {}.toString.call(r).slice(8, -1); return \"Object\" === t && r.constructor && (t = r.constructor.name), \"Map\" === t || \"Set\" === t ? Array.from(r) : \"Arguments\" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0; } }\nfunction _arrayLikeToArray(r, a) { (null == a || a > r.length) && (a = r.length); for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e]; return n; }\nfunction _iterableToArrayLimit(r, l) { var t = null == r ? null : \"undefined\" != typeof Symbol && r[Symbol.iterator] || r[\"@@iterator\"]; if (null != t) { var e, n, i, u, a = [], f = !0, o = !1; try { if (i = (t = t.call(r)).next, 0 === l) { if (Object(t) !== t) return; f = !1; } else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0); } catch (r) { o = !0, n = r; } finally { try { if (!f && null != t.return && (u = t.return(), Object(u) !== u)) return; } finally { if (o) throw n; } } return a; } }\nfunction _arrayWithHoles(r) { if (Array.isArray(r)) return r; }\nvar __awaiter = undefined && undefined.__awaiter || function (thisArg, _arguments, P, generator) {\n  function adopt(value) {\n    return value instanceof P ? value : new P(function (resolve) {\n      resolve(value);\n    });\n  }\n  return new (P || (P = Promise))(function (resolve, reject) {\n    function fulfilled(value) {\n      try {\n        step(generator.next(value));\n      } catch (e) {\n        reject(e);\n      }\n    }\n    function rejected(value) {\n      try {\n        step(generator[\"throw\"](value));\n      } catch (e) {\n        reject(e);\n      }\n    }\n    function step(result) {\n      result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);\n    }\n    step((generator = generator.apply(thisArg, _arguments || [])).next());\n  });\n};\n\n\nvar fmtMoney = n => n == null ? \"—\" : n.toLocaleString(\"en-US\", {\n  style: \"currency\",\n  currency: \"USD\",\n  maximumFractionDigits: 0\n});\nfunction readLookup(rec, lookupAttr) {\n  var id = rec[\"_\".concat(lookupAttr, \"_value\")];\n  var name = rec[\"_\".concat(lookupAttr, \"_value@OData.Community.Display.V1.FormattedValue\")];\n  return id ? {\n    id,\n    name: name || \"(unnamed)\"\n  } : null;\n}\nfunction buildDetail(rec) {\n  var _a, _b, _c, _d, _e, _f, _g, _h;\n  return {\n    id: rec.book_realignmentsid,\n    amount: (_b = (_a = rec.book_newamount) !== null && _a !== void 0 ? _a : rec.book_amount) !== null && _b !== void 0 ? _b : null,\n    fund: readLookup(rec, \"book_fund\"),\n    status: (_c = rec[\"book_realignmentstatus@OData.Community.Display.V1.FormattedValue\"]) !== null && _c !== void 0 ? _c : null,\n    type: (_d = rec.book_realignmenttype) !== null && _d !== void 0 ? _d : null,\n    fiscalYear: (_e = rec[\"book_fiscalyear@OData.Community.Display.V1.FormattedValue\"]) !== null && _e !== void 0 ? _e : null,\n    payerConcurrence: (_f = rec[\"book_payerconcurrence@OData.Community.Display.V1.FormattedValue\"]) !== null && _f !== void 0 ? _f : null,\n    payeeConcurrence: (_g = rec[\"book_payeeconcurrence@OData.Community.Display.V1.FormattedValue\"]) !== null && _g !== void 0 ? _g : null,\n    sameFundAndSag: !!rec.book_samefundandsag,\n    remarks: (_h = rec.book_remarks) !== null && _h !== void 0 ? _h : null,\n    debit: {\n      prioritization: readLookup(rec, \"book_debitedprioritization\"),\n      mdep: readLookup(rec, \"book_debitedmdep\"),\n      fundingLine: readLookup(rec, \"book_newdebitedloa\"),\n      requirementFunding: readLookup(rec, \"book_newdebitedrequirement\")\n    },\n    credit: {\n      prioritization: readLookup(rec, \"book_creditedprioritization\"),\n      mdep: readLookup(rec, \"book_creditedmdep\"),\n      fundingLine: readLookup(rec, \"book_newcreditedloa\"),\n      requirementFunding: readLookup(rec, \"book_newcreditedrequirement\")\n    }\n  };\n}\nvar SELECT = [\"book_realignmentsid\", \"book_amount\", \"book_newamount\", \"book_realignmenttype\", \"book_remarks\", \"book_samefundandsag\", \"_book_fund_value\", \"_book_debitedprioritization_value\", \"_book_creditedprioritization_value\", \"_book_debitedmdep_value\", \"_book_creditedmdep_value\", \"_book_newdebitedloa_value\", \"_book_newcreditedloa_value\", \"_book_newdebitedrequirement_value\", \"_book_newcreditedrequirement_value\", \"book_realignmentstatus\", \"book_fiscalyear\", \"book_payerconcurrence\", \"book_payeeconcurrence\"].join(\",\");\nfunction FlowCard(_ref) {\n  var title = _ref.title,\n    side = _ref.side,\n    amount = _ref.amount,\n    color = _ref.color;\n  var _a, _b, _c, _d;\n  var Row = _ref2 => {\n    var label = _ref2.label,\n      value = _ref2.value;\n    return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n      style: {\n        display: \"flex\",\n        gap: 8,\n        marginBottom: 4,\n        fontSize: 12\n      }\n    }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"span\", {\n      style: {\n        color: \"#605E5C\",\n        minWidth: 96\n      }\n    }, label), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"span\", {\n      style: {\n        color: value ? \"#323130\" : \"#A19F9D\",\n        flex: 1,\n        overflow: \"hidden\",\n        textOverflow: \"ellipsis\",\n        whiteSpace: \"nowrap\"\n      }\n    }, value || \"—\"));\n  };\n  return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    style: {\n      flex: 1,\n      minWidth: 220,\n      border: \"1px solid \".concat(color, \"33\"),\n      borderTop: \"3px solid \".concat(color),\n      borderRadius: 4,\n      padding: \"10px 12px\",\n      background: \"#FAF9F8\"\n    }\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    style: {\n      display: \"flex\",\n      alignItems: \"baseline\",\n      gap: 8,\n      marginBottom: 8\n    }\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"span\", {\n    style: {\n      fontSize: 11,\n      fontWeight: 700,\n      letterSpacing: 0.5,\n      color\n    }\n  }, title), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    style: {\n      flex: 1\n    }\n  }), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"span\", {\n    style: {\n      fontSize: 16,\n      fontWeight: 600,\n      color: \"#323130\",\n      fontVariantNumeric: \"tabular-nums\"\n    }\n  }, fmtMoney(amount))), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(Row, {\n    label: \"Prioritization\",\n    value: (_a = side.prioritization) === null || _a === void 0 ? void 0 : _a.name\n  }), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(Row, {\n    label: \"MDEP\",\n    value: (_b = side.mdep) === null || _b === void 0 ? void 0 : _b.name\n  }), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(Row, {\n    label: \"Requirement Funding\",\n    value: (_c = side.requirementFunding) === null || _c === void 0 ? void 0 : _c.name\n  }), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(Row, {\n    label: \"LOA\",\n    value: (_d = side.fundingLine) === null || _d === void 0 ? void 0 : _d.name\n  }));\n}\nfunction Arrow() {\n  return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"svg\", {\n    width: 56,\n    height: 56,\n    viewBox: \"0 0 56 56\",\n    \"aria-hidden\": \"true\"\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"line\", {\n    x1: 4,\n    y1: 28,\n    x2: 44,\n    y2: 28,\n    stroke: \"#605E5C\",\n    strokeWidth: 2\n  }), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"polyline\", {\n    points: \"38,18 48,28 38,38\",\n    fill: \"none\",\n    stroke: \"#605E5C\",\n    strokeWidth: 2,\n    strokeLinejoin: \"round\",\n    strokeLinecap: \"round\"\n  }));\n}\nvar RealignmentsFlowApp = props => {\n  var _a, _b;\n  var webAPI = props.webAPI,\n    navigation = props.navigation,\n    recordId = props.recordId,\n    amountInput = props.amountInput;\n  var _React$useState = react__WEBPACK_IMPORTED_MODULE_0__.useState(null),\n    _React$useState2 = _slicedToArray(_React$useState, 2),\n    detail = _React$useState2[0],\n    setDetail = _React$useState2[1];\n  var _React$useState3 = react__WEBPACK_IMPORTED_MODULE_0__.useState(true),\n    _React$useState4 = _slicedToArray(_React$useState3, 2),\n    loading = _React$useState4[0],\n    setLoading = _React$useState4[1];\n  var _React$useState5 = react__WEBPACK_IMPORTED_MODULE_0__.useState(null),\n    _React$useState6 = _slicedToArray(_React$useState5, 2),\n    err = _React$useState6[0],\n    setErr = _React$useState6[1];\n  react__WEBPACK_IMPORTED_MODULE_0__.useEffect(() => {\n    if (!recordId) {\n      setLoading(false);\n      return;\n    }\n    (() => __awaiter(void 0, void 0, void 0, function* () {\n      try {\n        var rec = yield webAPI.retrieveRecord(\"book_realignments\", recordId, \"?$select=\".concat(SELECT));\n        setDetail(buildDetail(rec));\n      } catch (e) {\n        setErr((e === null || e === void 0 ? void 0 : e.message) || \"Failed to load realignment\");\n      } finally {\n        setLoading(false);\n      }\n    }))();\n  }, [recordId, webAPI]);\n  if (loading) {\n    return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.FluentProvider, {\n      theme: _fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.webLightTheme\n    }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n      style: {\n        padding: 12\n      }\n    }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.Spinner, {\n      size: \"tiny\",\n      label: \"Loading realignment...\"\n    })));\n  }\n  if (err) {\n    return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.FluentProvider, {\n      theme: _fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.webLightTheme\n    }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n      style: {\n        padding: 12\n      }\n    }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.MessageBar, {\n      intent: \"error\"\n    }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.MessageBarBody, null, err))));\n  }\n  if (!detail) {\n    return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.FluentProvider, {\n      theme: _fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.webLightTheme\n    }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n      style: {\n        padding: 12,\n        color: \"#605E5C\"\n      }\n    }, \"Save the realignment first to see the flow.\"));\n  }\n  // Use the live amount from the bound field if it's been edited\n  var liveAmount = amountInput != null && amountInput !== detail.amount ? amountInput : detail.amount;\n  // Validation\n  var issues = [];\n  if (liveAmount == null || liveAmount <= 0) issues.push(\"Amount must be greater than zero\");\n  if (!detail.debit.prioritization) issues.push(\"Debit Prioritization is required\");\n  if (!detail.credit.prioritization) issues.push(\"Credit Prioritization is required\");\n  if (detail.debit.prioritization && detail.credit.prioritization && detail.debit.prioritization.id === detail.credit.prioritization.id && ((_a = detail.debit.mdep) === null || _a === void 0 ? void 0 : _a.id) === ((_b = detail.credit.mdep) === null || _b === void 0 ? void 0 : _b.id)) {\n    issues.push(\"Debit and Credit refer to the same Prioritization + MDEP — pick different sides\");\n  }\n  if (detail.payerConcurrence && detail.payerConcurrence.toLowerCase() !== \"concur\") {\n    issues.push(\"Payer concurrence: \".concat(detail.payerConcurrence));\n  }\n  if (detail.payeeConcurrence && detail.payeeConcurrence.toLowerCase() !== \"concur\") {\n    issues.push(\"Payee concurrence: \".concat(detail.payeeConcurrence));\n  }\n  var openSide = (lookup, entityName) => {\n    if (!lookup) return;\n    navigation.openForm({\n      entityName,\n      entityId: lookup.id,\n      openInNewWindow: true\n    }).catch(() => {});\n  };\n  return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.FluentProvider, {\n    theme: _fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.webLightTheme\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    className: \"arsc-realignments-flow\",\n    style: {\n      padding: 12,\n      fontFamily: \"Segoe UI, sans-serif\",\n      fontSize: 13,\n      background: \"#FFFFFF\"\n    }\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    style: {\n      display: \"flex\",\n      alignItems: \"center\",\n      gap: 12,\n      marginBottom: 12,\n      flexWrap: \"wrap\"\n    }\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"span\", {\n    style: {\n      fontSize: 15,\n      fontWeight: 600\n    }\n  }, \"Realignment Flow\"), detail.status && (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.Badge, {\n    appearance: \"filled\",\n    color: issues.length > 0 ? \"warning\" : \"informative\"\n  }, detail.status)), detail.fiscalYear && (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.Badge, {\n    appearance: \"outline\",\n    color: \"informative\"\n  }, \"FY \", detail.fiscalYear)), detail.type && /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"span\", {\n    style: {\n      color: \"#605E5C\",\n      fontSize: 12\n    }\n  }, \"\\u00B7 \", detail.type), detail.fund && /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"span\", {\n    style: {\n      color: \"#605E5C\",\n      fontSize: 12\n    }\n  }, \"\\u00B7 \", detail.fund.name), detail.sameFundAndSag && (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.Badge, {\n    appearance: \"tint\",\n    color: \"success\"\n  }, \"Same Fund + SAG\"))), issues.length > 0 && (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.MessageBar, {\n    intent: \"warning\",\n    style: {\n      marginBottom: 12\n    }\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.MessageBarBody, null, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"strong\", null, \"Validation: \"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"ul\", {\n    style: {\n      margin: \"4px 0 0 16px\",\n      padding: 0\n    }\n  }, issues.map((i, k) => (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"li\", {\n    key: k\n  }, i))))))), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    style: {\n      display: \"flex\",\n      alignItems: \"center\",\n      gap: 8\n    }\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(FlowCard, {\n    title: \"DEBIT (FROM)\",\n    side: detail.debit,\n    amount: liveAmount,\n    color: \"#A4262C\"\n  }), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    style: {\n      display: \"flex\",\n      flexDirection: \"column\",\n      alignItems: \"center\",\n      gap: 2\n    }\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(Arrow, null), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"span\", {\n    style: {\n      fontSize: 11,\n      color: \"#605E5C\",\n      fontVariantNumeric: \"tabular-nums\"\n    }\n  }, fmtMoney(liveAmount))), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(FlowCard, {\n    title: \"CREDIT (TO)\",\n    side: detail.credit,\n    amount: liveAmount,\n    color: \"#107C10\"\n  })), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    style: {\n      display: \"flex\",\n      gap: 8,\n      marginTop: 12,\n      flexWrap: \"wrap\"\n    }\n  }, detail.debit.prioritization && (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.Button, {\n    size: \"small\",\n    appearance: \"subtle\",\n    onClick: () => openSide(detail.debit.prioritization, \"book_prioritization\")\n  }, \"Open debit prioritization \\u2192\")), detail.credit.prioritization && (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.Button, {\n    size: \"small\",\n    appearance: \"subtle\",\n    onClick: () => openSide(detail.credit.prioritization, \"book_prioritization\")\n  }, \"Open credit prioritization \\u2192\"))), detail.remarks && (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    style: {\n      marginTop: 12,\n      padding: 8,\n      background: \"#F3F2F1\",\n      borderRadius: 4,\n      fontSize: 12,\n      color: \"#605E5C\"\n    }\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"strong\", null, \"Remarks: \"), detail.remarks))));\n};\n\n//# sourceURL=webpack://pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad/./RealignmentsFlow/RealignmentsFlowApp.tsx?\n}");

/***/ },

/***/ "./RealignmentsFlow/index.ts"
/*!***********************************!*\
  !*** ./RealignmentsFlow/index.ts ***!
  \***********************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

eval("{__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   RealignmentsFlow: () => (/* binding */ RealignmentsFlow)\n/* harmony export */ });\n/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! react */ \"react\");\n/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(react__WEBPACK_IMPORTED_MODULE_0__);\n/* harmony import */ var _RealignmentsFlowApp__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./RealignmentsFlowApp */ \"./RealignmentsFlow/RealignmentsFlowApp.tsx\");\n\n\nclass RealignmentsFlow {\n  init(context, notifyOutputChanged) {\n    this.context = context;\n    this.notifyOutputChanged = notifyOutputChanged;\n  }\n  updateView(context) {\n    var _a, _b, _c;\n    this.context = context;\n    var ctxAny = context.mode;\n    var props = {\n      webAPI: context.webAPI,\n      navigation: context.navigation,\n      recordId: (_a = ctxAny.contextInfo) === null || _a === void 0 ? void 0 : _a.entityId,\n      amountInput: (_c = (_b = context.parameters.amount) === null || _b === void 0 ? void 0 : _b.raw) !== null && _c !== void 0 ? _c : null\n    };\n    return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_RealignmentsFlowApp__WEBPACK_IMPORTED_MODULE_1__.RealignmentsFlowApp, props);\n  }\n  getOutputs() {\n    return {};\n  }\n  destroy() {}\n}\n\n//# sourceURL=webpack://pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad/./RealignmentsFlow/index.ts?\n}");

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
/******/ 	var __webpack_exports__ = __webpack_require__("./RealignmentsFlow/index.ts");
/******/ 	pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad = __webpack_exports__;
/******/ 	
/******/ })()
;
if (window.ComponentFramework && window.ComponentFramework.registerControl) {
	ComponentFramework.registerControl('ARNGCheckbook.RealignmentsFlow', pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad.RealignmentsFlow);
} else {
	var ARNGCheckbook = ARNGCheckbook || {};
	ARNGCheckbook.RealignmentsFlow = pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad.RealignmentsFlow;
	pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad = undefined;
}