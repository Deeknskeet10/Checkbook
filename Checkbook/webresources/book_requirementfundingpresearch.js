var RfForm = RfForm || {};

// 1. Trigger this on Form Load
RfForm.onLoad = function(ec) {
    let formContext = ec.getFormContext();
    let loaControl = formContext.getControl("book_lineofaccounting");

    if (loaControl) {
        loaControl.addPreSearch(RfForm.filterLineOfAccounting);
    }
};

// 2. The pre-search filter function
RfForm.filterLineOfAccounting = function(ec) {
    let formContext = ec.getFormContext();
    
    let fiscalYearValue = formContext.getAttribute("book_newfiscalyear").getValue();

    if (fiscalYearValue != null) {
        let filterXml = 
            "<filter type='and'>" +
                "<condition attribute='book_fiscalyear' operator='eq' value='" + fiscalYearValue + "' />" +
            "</filter>";

        formContext.getControl("book_lineofaccounting").addCustomFilter(filterXml);
    }
};

RfForm.onFiscalYearChange = function(ec) {
    let formContext = ec.getFormContext();
    let loaAttribute = formContext.getAttribute("book_lineofaccounting");
    
    if (loaAttribute && loaAttribute.getValue() != null) {
        loaAttribute.setValue(null);
    }
};