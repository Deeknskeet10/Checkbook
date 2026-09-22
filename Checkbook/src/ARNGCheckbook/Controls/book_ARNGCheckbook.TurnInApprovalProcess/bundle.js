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

/***/ "./TurnInApprovalProcess/components/TurnInApprovalProcessApp.tsx"
/*!***********************************************************************!*\
  !*** ./TurnInApprovalProcess/components/TurnInApprovalProcessApp.tsx ***!
  \***********************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

eval("{__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   TurnInApprovalProcessApp: () => (/* binding */ TurnInApprovalProcessApp)\n/* harmony export */ });\n/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! react */ \"react\");\n/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(react__WEBPACK_IMPORTED_MODULE_0__);\n/* harmony import */ var _fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! @fluentui/react-components */ \"@fluentui/react-components\");\n/* harmony import */ var _fluentui_react_components__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__);\nfunction _slicedToArray(r, e) { return _arrayWithHoles(r) || _iterableToArrayLimit(r, e) || _unsupportedIterableToArray(r, e) || _nonIterableRest(); }\nfunction _nonIterableRest() { throw new TypeError(\"Invalid attempt to destructure non-iterable instance.\\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.\"); }\nfunction _unsupportedIterableToArray(r, a) { if (r) { if (\"string\" == typeof r) return _arrayLikeToArray(r, a); var t = {}.toString.call(r).slice(8, -1); return \"Object\" === t && r.constructor && (t = r.constructor.name), \"Map\" === t || \"Set\" === t ? Array.from(r) : \"Arguments\" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0; } }\nfunction _arrayLikeToArray(r, a) { (null == a || a > r.length) && (a = r.length); for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e]; return n; }\nfunction _iterableToArrayLimit(r, l) { var t = null == r ? null : \"undefined\" != typeof Symbol && r[Symbol.iterator] || r[\"@@iterator\"]; if (null != t) { var e, n, i, u, a = [], f = !0, o = !1; try { if (i = (t = t.call(r)).next, 0 === l) { if (Object(t) !== t) return; f = !1; } else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0); } catch (r) { o = !0, n = r; } finally { try { if (!f && null != t.return && (u = t.return(), Object(u) !== u)) return; } finally { if (o) throw n; } } return a; } }\nfunction _arrayWithHoles(r) { if (Array.isArray(r)) return r; }\nvar __awaiter = undefined && undefined.__awaiter || function (thisArg, _arguments, P, generator) {\n  function adopt(value) {\n    return value instanceof P ? value : new P(function (resolve) {\n      resolve(value);\n    });\n  }\n  return new (P || (P = Promise))(function (resolve, reject) {\n    function fulfilled(value) {\n      try {\n        step(generator.next(value));\n      } catch (e) {\n        reject(e);\n      }\n    }\n    function rejected(value) {\n      try {\n        step(generator[\"throw\"](value));\n      } catch (e) {\n        reject(e);\n      }\n    }\n    function step(result) {\n      result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);\n    }\n    step((generator = generator.apply(thisArg, _arguments || [])).next());\n  });\n};\n\n\n// Inline SVG icons — @fluentui/react-icons v2 pulls in @griffel which needs\n// react/jsx-runtime (React 17+), and this project is pinned to React 16.14 to\n// match the platform-library version in the manifest.\nvar IconCheck = () => (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"svg\", {\n  width: 20,\n  height: 20,\n  viewBox: \"0 0 20 20\",\n  \"aria-hidden\": \"true\"\n}, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"circle\", {\n  cx: 10,\n  cy: 10,\n  r: 9,\n  fill: \"currentColor\"\n}), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"path\", {\n  d: \"M6 10.5l2.5 2.5L14 7\",\n  fill: \"none\",\n  stroke: \"#fff\",\n  strokeWidth: 1.8,\n  strokeLinecap: \"round\",\n  strokeLinejoin: \"round\"\n})));\nvar IconCurrent = () => (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"svg\", {\n  width: 20,\n  height: 20,\n  viewBox: \"0 0 20 20\",\n  \"aria-hidden\": \"true\"\n}, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"circle\", {\n  cx: 10,\n  cy: 10,\n  r: 9,\n  fill: \"none\",\n  stroke: \"currentColor\",\n  strokeWidth: 2\n}), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"circle\", {\n  cx: 10,\n  cy: 10,\n  r: 4,\n  fill: \"currentColor\"\n})));\nvar IconFuture = () => (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"svg\", {\n  width: 20,\n  height: 20,\n  viewBox: \"0 0 20 20\",\n  \"aria-hidden\": \"true\"\n}, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"circle\", {\n  cx: 10,\n  cy: 10,\n  r: 9,\n  fill: \"none\",\n  stroke: \"currentColor\",\n  strokeWidth: 2\n})));\nvar TURNIN_ENTITY = \"book_turnin\";\nvar STATE_APPROVED = \"book_stateapproved\";\nvar BE_APPROVED = \"book_beapproved\";\nvar REQUIRES_BE = \"book_requiresbeapproval\";\n// Role gate — mirrors TurnInValidator.EnforceApprovalRoles. This is UX\n// only; the plugin remains the authoritative check.\nvar STATE_ROLES = [\"Book - State Approver\", \"Book - State Administrator\", \"Book - Checkbook Administrator\"];\nvar BE_ROLES = [\"Book - Budget Executor\", \"Book - Checkbook Administrator\"];\nvar useStyles = (0,_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.makeStyles)({\n  provider: {\n    width: \"100%\",\n    boxSizing: \"border-box\"\n  },\n  root: Object.assign(Object.assign(Object.assign({\n    width: \"100%\",\n    boxSizing: \"border-box\"\n  }, _fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.shorthands.padding(\"12px\", \"16px\")), {\n    backgroundColor: _fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.tokens.colorNeutralBackground2\n  }), _fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.shorthands.borderRadius(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.tokens.borderRadiusMedium)),\n  chevronRow: Object.assign({\n    display: \"flex\",\n    alignItems: \"stretch\",\n    minHeight: \"40px\"\n  }, _fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.shorthands.gap(\"2px\")),\n  chevron: Object.assign(Object.assign(Object.assign({\n    display: \"flex\",\n    alignItems: \"center\"\n  }, _fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.shorthands.gap(\"8px\")), _fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.shorthands.padding(\"6px\", \"24px\", \"6px\", \"20px\")), {\n    fontWeight: _fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.tokens.fontWeightSemibold,\n    color: _fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.tokens.colorNeutralForeground1,\n    backgroundColor: _fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.tokens.colorNeutralBackground3,\n    clipPath: \"polygon(0 0, calc(100% - 14px) 0, 100% 50%, calc(100% - 14px) 100%, 0 100%, 14px 50%)\",\n    flexGrow: 1,\n    minWidth: \"160px\"\n  }),\n  chevronFirst: {\n    clipPath: \"polygon(0 0, calc(100% - 14px) 0, 100% 50%, calc(100% - 14px) 100%, 0 100%)\"\n  },\n  chevronPast: {\n    backgroundColor: _fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.tokens.colorPaletteGreenBackground2,\n    color: _fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.tokens.colorPaletteGreenForeground2\n  },\n  chevronCurrent: {\n    backgroundColor: _fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.tokens.colorBrandBackground2,\n    color: _fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.tokens.colorBrandForeground1,\n    outlineStyle: \"solid\",\n    outlineWidth: \"2px\",\n    outlineColor: _fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.tokens.colorBrandStroke1\n  },\n  chevronFuture: {\n    color: _fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.tokens.colorNeutralForeground3\n  },\n  actionsRow: Object.assign(Object.assign({\n    display: \"flex\"\n  }, _fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.shorthands.gap(\"8px\")), {\n    marginTop: \"12px\",\n    alignItems: \"center\",\n    flexWrap: \"wrap\"\n  }),\n  helper: {\n    color: _fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.tokens.colorNeutralForeground3,\n    marginLeft: \"auto\"\n  }\n});\nfunction stageOf(rec) {\n  if (!rec.stateApproved) return \"state\";\n  if (rec.requiresBEApproval && !rec.beApproved) return \"be\";\n  return \"done\";\n}\nvar TurnInApprovalProcessApp = _ref => {\n  var webAPI = _ref.webAPI,\n    userSettings = _ref.userSettings,\n    entityId = _ref.entityId,\n    entityName = _ref.entityName,\n    isDisabled = _ref.isDisabled;\n  var styles = useStyles();\n  var _React$useState = react__WEBPACK_IMPORTED_MODULE_0__.useState(null),\n    _React$useState2 = _slicedToArray(_React$useState, 2),\n    record = _React$useState2[0],\n    setRecord = _React$useState2[1];\n  var _React$useState3 = react__WEBPACK_IMPORTED_MODULE_0__.useState(new Set()),\n    _React$useState4 = _slicedToArray(_React$useState3, 2),\n    userRoles = _React$useState4[0],\n    setUserRoles = _React$useState4[1];\n  var _React$useState5 = react__WEBPACK_IMPORTED_MODULE_0__.useState(true),\n    _React$useState6 = _slicedToArray(_React$useState5, 2),\n    loading = _React$useState6[0],\n    setLoading = _React$useState6[1];\n  var _React$useState7 = react__WEBPACK_IMPORTED_MODULE_0__.useState(false),\n    _React$useState8 = _slicedToArray(_React$useState7, 2),\n    busy = _React$useState8[0],\n    setBusy = _React$useState8[1];\n  var _React$useState9 = react__WEBPACK_IMPORTED_MODULE_0__.useState(null),\n    _React$useState0 = _slicedToArray(_React$useState9, 2),\n    error = _React$useState0[0],\n    setError = _React$useState0[1];\n  var cleanId = react__WEBPACK_IMPORTED_MODULE_0__.useMemo(() => (entityId || \"\").replace(/[{}]/g, \"\"), [entityId]);\n  var reload = react__WEBPACK_IMPORTED_MODULE_0__.useCallback(() => __awaiter(void 0, void 0, void 0, function* () {\n    var _a;\n    if (!cleanId) {\n      setLoading(false);\n      return;\n    }\n    try {\n      var rec = yield webAPI.retrieveRecord(entityName || TURNIN_ENTITY, cleanId, \"?$select=\".concat(STATE_APPROVED, \",\").concat(BE_APPROVED, \",\").concat(REQUIRES_BE));\n      setRecord({\n        stateApproved: !!rec[STATE_APPROVED],\n        beApproved: !!rec[BE_APPROVED],\n        requiresBEApproval: !!rec[REQUIRES_BE]\n      });\n    } catch (e) {\n      setError((_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : \"Failed to load Turn-In record.\");\n    } finally {\n      setLoading(false);\n    }\n  }), [cleanId, entityName, webAPI]);\n  var loadRoles = react__WEBPACK_IMPORTED_MODULE_0__.useCallback(() => __awaiter(void 0, void 0, void 0, function* () {\n    var userId = (userSettings.userId || \"\").replace(/[{}]/g, \"\");\n    if (!userId) return;\n    try {\n      // Mirror UserRoleHelper on the plugin side: fetch direct role assignments\n      // AND roles inherited via team membership. The systemuserroles_association\n      // navigation returns only direct assignments; team-derived roles come in\n      // through teamroles_association → teammembership_association.\n      var filter = \"systemuserroles_association/any(o:o/systemuserid eq \".concat(userId, \")\") + \" or teamroles_association/any(t:t/teammembership_association/any(m:m/systemuserid eq \".concat(userId, \"))\");\n      var resp = yield webAPI.retrieveMultipleRecords(\"role\", \"?$select=name&$filter=\".concat(filter));\n      var names = new Set();\n      for (var r of resp.entities) {\n        if (r.name) names.add(r.name);\n      }\n      setUserRoles(names);\n    } catch (_a) {\n      // Best-effort — if role fetch fails, buttons render disabled and the\n      // plugin still enforces authoritatively. Don't surface a scary error.\n      setUserRoles(new Set());\n    }\n  }), [userSettings.userId, webAPI]);\n  react__WEBPACK_IMPORTED_MODULE_0__.useEffect(() => {\n    void reload();\n    void loadRoles();\n  }, [reload, loadRoles]);\n  var canApproveState = react__WEBPACK_IMPORTED_MODULE_0__.useMemo(() => STATE_ROLES.some(r => userRoles.has(r)), [userRoles]);\n  var canApproveBE = react__WEBPACK_IMPORTED_MODULE_0__.useMemo(() => BE_ROLES.some(r => userRoles.has(r)), [userRoles]);\n  var setFlag = (field, value) => __awaiter(void 0, void 0, void 0, function* () {\n    var _a;\n    if (!cleanId) return;\n    setBusy(true);\n    setError(null);\n    try {\n      yield webAPI.updateRecord(entityName || TURNIN_ENTITY, cleanId, {\n        [field]: value\n      });\n      yield reload();\n    } catch (e) {\n      // The plugin's InvalidPluginExecutionException message shows up as\n      // e.message here — surface it so the user knows what went wrong.\n      setError((_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : \"Update failed.\");\n    } finally {\n      setBusy(false);\n    }\n  });\n  if (loading) {\n    return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.FluentProvider, {\n      theme: _fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.webLightTheme,\n      className: styles.provider\n    }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n      className: styles.root\n    }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.Spinner, {\n      size: \"tiny\",\n      label: \"Loading Turn-In status...\"\n    })));\n  }\n  if (!record) {\n    return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.FluentProvider, {\n      theme: _fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.webLightTheme,\n      className: styles.provider\n    }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n      className: styles.root\n    }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.Text, null, \"Save the Turn-In first to see the approval process.\")));\n  }\n  var current = stageOf(record);\n  var showBE = record.requiresBEApproval;\n  // Stage list — index used to decide past/current/future styling.\n  var stages = [{\n    key: \"state\",\n    label: \"State Approval\"\n  }, ...(showBE ? [{\n    key: \"be\",\n    label: \"BE Approval\"\n  }] : []), {\n    key: \"done\",\n    label: \"Approved\"\n  }];\n  var currentIdx = stages.findIndex(s => s.key === current);\n  var iconFor = idx => {\n    if (idx < currentIdx) return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(IconCheck, null);\n    if (idx === currentIdx) return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(IconCurrent, null);\n    return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(IconFuture, null);\n  };\n  return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.FluentProvider, {\n    theme: _fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.webLightTheme,\n    className: styles.provider\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    className: styles.root\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    className: styles.chevronRow\n  }, stages.map((s, i) => (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    key: s.key,\n    className: [styles.chevron, i === 0 ? styles.chevronFirst : \"\", i < currentIdx ? styles.chevronPast : \"\", i === currentIdx ? styles.chevronCurrent : \"\", i > currentIdx ? styles.chevronFuture : \"\"].filter(Boolean).join(\" \")\n  }, iconFor(i), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.Text, null, s.label))))), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    className: styles.actionsRow\n  }, current === \"state\" && (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(react__WEBPACK_IMPORTED_MODULE_0__.Fragment, null, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.Button, {\n    appearance: \"primary\",\n    disabled: busy || isDisabled || !canApproveState,\n    onClick: () => void setFlag(STATE_APPROVED, true)\n  }, \"Approve \\u2014 State\"), !canApproveState && (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.Text, {\n    className: styles.helper\n  }, \"Only State Approvers, State Administrators, or Checkbook Administrators can approve.\")))), current === \"be\" && (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(react__WEBPACK_IMPORTED_MODULE_0__.Fragment, null, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.Button, {\n    appearance: \"primary\",\n    disabled: busy || isDisabled || !canApproveBE,\n    onClick: () => void setFlag(BE_APPROVED, true)\n  }, \"Approve \\u2014 Budget Execution\"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.Button, {\n    appearance: \"secondary\",\n    disabled: busy || isDisabled || !canApproveState,\n    onClick: () => void setFlag(STATE_APPROVED, false)\n  }, \"Deny (return to State)\"), !canApproveBE && (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.Text, {\n    className: styles.helper\n  }, \"Only Budget Executors or Checkbook Administrators can approve BE.\")))), current === \"done\" && (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.Text, null, \"This Turn-In is fully approved.\"))), error && (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(\"div\", {\n    style: {\n      marginTop: 8\n    }\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.MessageBar, {\n    intent: \"error\"\n  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.MessageBarBody, null, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_fluentui_react_components__WEBPACK_IMPORTED_MODULE_1__.MessageBarTitle, null, \"Update blocked\"), error))))));\n};\n\n//# sourceURL=webpack://pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad/./TurnInApprovalProcess/components/TurnInApprovalProcessApp.tsx?\n}");

/***/ },

/***/ "./TurnInApprovalProcess/index.ts"
/*!****************************************!*\
  !*** ./TurnInApprovalProcess/index.ts ***!
  \****************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

eval("{__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   TurnInApprovalProcess: () => (/* binding */ TurnInApprovalProcess)\n/* harmony export */ });\n/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! react */ \"react\");\n/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(react__WEBPACK_IMPORTED_MODULE_0__);\n/* harmony import */ var _components_TurnInApprovalProcessApp__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./components/TurnInApprovalProcessApp */ \"./TurnInApprovalProcess/components/TurnInApprovalProcessApp.tsx\");\n\n\nclass TurnInApprovalProcess {\n  constructor() {\n    // Empty\n  }\n  init(context, notifyOutputChanged) {\n    this.notifyOutputChanged = notifyOutputChanged;\n    context.mode.trackContainerResize(true);\n  }\n  updateView(context) {\n    var _a, _b, _c;\n    // Pull the current record's id and logical name from contextInfo. This is\n    // populated on Model-driven app forms and is the standard way for a\n    // field-bound PCF to know which record it's rendering against.\n    var ctxInfo = (_a = context.mode.contextInfo) !== null && _a !== void 0 ? _a : {};\n    var props = {\n      webAPI: context.webAPI,\n      userSettings: context.userSettings,\n      entityId: (_b = ctxInfo.entityId) !== null && _b !== void 0 ? _b : \"\",\n      entityName: (_c = ctxInfo.entityTypeName) !== null && _c !== void 0 ? _c : \"book_turnin\",\n      isDisabled: context.mode.isControlDisabled,\n      width: context.mode.allocatedWidth\n    };\n    return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_components_TurnInApprovalProcessApp__WEBPACK_IMPORTED_MODULE_1__.TurnInApprovalProcessApp, props);\n  }\n  getOutputs() {\n    return {};\n  }\n  destroy() {\n    // no-op\n  }\n}\n\n//# sourceURL=webpack://pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad/./TurnInApprovalProcess/index.ts?\n}");

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
/******/ 	const __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		const cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		const module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		if (!(moduleId in __webpack_modules__)) {
/******/ 			delete __webpack_module_cache__[moduleId];
/******/ 			const e = new Error("Cannot find module '" + moduleId + "'");
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
/******/ 			const getter = module && module.__esModule ?
/******/ 				() => (module['default']) :
/******/ 				() => (module);
/******/ 			__webpack_require__.d(getter, { a: getter });
/******/ 			return getter;
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/define property getters */
/******/ 	(() => {
/******/ 		// define getter/value functions for harmony exports
/******/ 		__webpack_require__.d = (exports, definition) => {
/******/ 			if(Array.isArray(definition)) {
/******/ 				var i = 0;
/******/ 				while(i < definition.length) {
/******/ 					var key = definition[i++];
/******/ 					var binding = definition[i++];
/******/ 					if(!__webpack_require__.o(exports, key)) {
/******/ 						if(binding === 0) {
/******/ 							Object.defineProperty(exports, key, { enumerable: true, value: definition[i++] });
/******/ 						} else {
/******/ 							Object.defineProperty(exports, key, { enumerable: true, get: binding });
/******/ 						}
/******/ 					} else if(binding === 0) { i++; }
/******/ 				}
/******/ 			} else {
/******/ 				for(var key in definition) {
/******/ 					if(__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) {
/******/ 						Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
/******/ 					}
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
/******/ 			if(Symbol.toStringTag) {
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
/******/ 	let __webpack_exports__ = __webpack_require__("./TurnInApprovalProcess/index.ts");
/******/ 	pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad = __webpack_exports__;
/******/ 	
/******/ })()
;
if (window.ComponentFramework && window.ComponentFramework.registerControl) {
	ComponentFramework.registerControl('ARNGCheckbook.TurnInApprovalProcess', pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad.TurnInApprovalProcess);
} else {
	var ARNGCheckbook = ARNGCheckbook || {};
	ARNGCheckbook.TurnInApprovalProcess = pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad.TurnInApprovalProcess;
	pcf_tools_652ac3f36e1e4bca82eb3c1dc44e6fad = undefined;
}