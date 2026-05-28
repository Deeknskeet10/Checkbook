import * as React from "react";
import {
  FluentProvider,
  webLightTheme,
  Button,
  Spinner,
} from "@fluentui/react-components";
import { SaveRegular, ErrorCircleRegular } from "@fluentui/react-icons";

// Fiscal year month order (October -> September)
const FISCAL_MONTHS = [
  { key: "book_october", label: "Oct" },
  { key: "book_november", label: "Nov" },
  { key: "book_december", label: "Dec" },
  { key: "book_january", label: "Jan" },
  { key: "book_february", label: "Feb" },
  { key: "book_march", label: "Mar" },
  { key: "book_april", label: "Apr" },
  { key: "book_may", label: "May" },
  { key: "book_june", label: "Jun" },
  { key: "book_july", label: "Jul" },
  { key: "book_august", label: "Aug" },
  { key: "book_september", label: "Sep" },
] as const;

type MonthKey = (typeof FISCAL_MONTHS)[number]["key"];

interface SpendPlanRecord {
  book_spendplanid: string;
  book_october: number | null;
  book_november: number | null;
  book_december: number | null;
  book_january: number | null;
  book_february: number | null;
  book_march: number | null;
  book_april: number | null;
  book_may: number | null;
  book_june: number | null;
  book_july: number | null;
  book_august: number | null;
  book_september: number | null;
  book_total: number | null;
  book_availableamount: number | null;
  book_spendplantype: string | null;
}

interface MonthlyValues {
  book_october: number;
  book_november: number;
  book_december: number;
  book_january: number;
  book_february: number;
  book_march: number;
  book_april: number;
  book_may: number;
  book_june: number;
  book_july: number;
  book_august: number;
  book_september: number;
}

interface SpendPlanGridProps {
  webAPI: ComponentFramework.WebApi;
  parentRecordId: string;
  parentEntityType: string;
  isReadOnly: boolean;
  onSaveComplete?: () => void;
}

// Map parent entity type to the lookup field name on Spend Plan
const PARENT_LOOKUP_MAP: Record<string, string> = {
  book_prioritization: "_book_prioritization_value",
  book_requirementfunding: "_book_requirementfunding_value",
  book_unfundedrequests: "_book_unfundedrequest_value",
};

export const SpendPlanGrid: React.FC<SpendPlanGridProps> = ({
  webAPI,
  parentRecordId,
  parentEntityType,
  isReadOnly,
  onSaveComplete,
}) => {
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [spendPlan, setSpendPlan] = React.useState<SpendPlanRecord | null>(null);
  const [monthlyValues, setMonthlyValues] = React.useState<MonthlyValues>({
    book_october: 0,
    book_november: 0,
    book_december: 0,
    book_january: 0,
    book_february: 0,
    book_march: 0,
    book_april: 0,
    book_may: 0,
    book_june: 0,
    book_july: 0,
    book_august: 0,
    book_september: 0,
  });
  const [isDirty, setIsDirty] = React.useState(false);

  // Calculate total from current values
  const calculatedTotal = React.useMemo(() => {
    return Object.values(monthlyValues).reduce((sum, val) => sum + (val || 0), 0);
  }, [monthlyValues]);

  // Available amount from the spend plan
  const availableAmount = spendPlan?.book_availableamount ?? 0;

  // Calculate remaining budget
  const remainingBudget = availableAmount - calculatedTotal;
  const isOverBudget = remainingBudget < 0;

  // Fetch the spend plan record
  const fetchSpendPlan = React.useCallback(async () => {
    if (!parentRecordId || !parentEntityType) {
      setLoading(false);
      return;
    }

    const lookupField = PARENT_LOOKUP_MAP[parentEntityType];
    if (!lookupField) {
      setError(`Unknown parent entity type: ${parentEntityType}`);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Query spend plans where the parent lookup matches
      const filter = `${lookupField} eq ${parentRecordId}`;
      const select = [
        "book_spendplanid",
        "book_october",
        "book_november",
        "book_december",
        "book_january",
        "book_february",
        "book_march",
        "book_april",
        "book_may",
        "book_june",
        "book_july",
        "book_august",
        "book_september",
        "book_total",
        "book_availableamount",
        "book_spendplantype",
      ].join(",");

      const result = await webAPI.retrieveMultipleRecords(
        "book_spendplan",
        `?$select=${select}&$filter=${filter}`
      );

      if (result.entities.length > 0) {
        const record = result.entities[0] as SpendPlanRecord;
        setSpendPlan(record);

        // Initialize monthly values from the record
        setMonthlyValues({
          book_october: record.book_october ?? 0,
          book_november: record.book_november ?? 0,
          book_december: record.book_december ?? 0,
          book_january: record.book_january ?? 0,
          book_february: record.book_february ?? 0,
          book_march: record.book_march ?? 0,
          book_april: record.book_april ?? 0,
          book_may: record.book_may ?? 0,
          book_june: record.book_june ?? 0,
          book_july: record.book_july ?? 0,
          book_august: record.book_august ?? 0,
          book_september: record.book_september ?? 0,
        });
      } else {
        setSpendPlan(null);
      }
    } catch (err) {
      console.error("Error fetching spend plan:", err);
      setError("Failed to load spend plan data. Please refresh and try again.");
    } finally {
      setLoading(false);
    }
  }, [parentRecordId, parentEntityType, webAPI]);

  React.useEffect(() => {
    fetchSpendPlan();
  }, [fetchSpendPlan]);

  // Handle month value change
  const handleMonthChange = (monthKey: MonthKey, value: string) => {
    // Allow empty, negative numbers, and decimals
    const numericValue = value === "" || value === "-" ? 0 : parseFloat(value);
    const finalValue = isNaN(numericValue) ? 0 : numericValue;

    setMonthlyValues((prev) => ({
      ...prev,
      [monthKey]: finalValue,
    }));
    setIsDirty(true);
  };

  // Save changes
  const handleSave = async () => {
    if (!spendPlan || isOverBudget) {
      return;
    }

    try {
      setSaving(true);
      setError(null);

      await webAPI.updateRecord("book_spendplan", spendPlan.book_spendplanid, {
        book_october: monthlyValues.book_october,
        book_november: monthlyValues.book_november,
        book_december: monthlyValues.book_december,
        book_january: monthlyValues.book_january,
        book_february: monthlyValues.book_february,
        book_march: monthlyValues.book_march,
        book_april: monthlyValues.book_april,
        book_may: monthlyValues.book_may,
        book_june: monthlyValues.book_june,
        book_july: monthlyValues.book_july,
        book_august: monthlyValues.book_august,
        book_september: monthlyValues.book_september,
      });

      setIsDirty(false);

      // Refresh to get updated calculated fields
      await fetchSpendPlan();

      onSaveComplete?.();
    } catch (err) {
      console.error("Error saving spend plan:", err);
      setError("Failed to save changes. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  // Format currency
  const formatCurrency = (value: number | null | undefined): string => {
    if (value === null || value === undefined) {
      return "--";
    }
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  // Render loading state
  if (loading) {
    return (
      <FluentProvider theme={webLightTheme}>
        <div className="spend-plan-calendar">
          <div className="spend-plan-loading">
            <Spinner size="medium" label="Loading spend plan..." />
          </div>
        </div>
      </FluentProvider>
    );
  }

  // Render error state
  if (error && !spendPlan) {
    return (
      <FluentProvider theme={webLightTheme}>
        <div className="spend-plan-calendar">
          <div className="spend-plan-error">{error}</div>
        </div>
      </FluentProvider>
    );
  }

  // Render empty state
  if (!spendPlan) {
    return (
      <FluentProvider theme={webLightTheme}>
        <div className="spend-plan-calendar">
          <div className="spend-plan-empty">
            No spend plan found for this record. Create a spend plan to begin
            allocating funds.
          </div>
        </div>
      </FluentProvider>
    );
  }

  return (
    <FluentProvider theme={webLightTheme}>
      <div className="spend-plan-calendar">
        {/* Grid */}
        <div className="spend-plan-grid">
          {/* Header row */}
          <div className="spend-plan-header row-label"></div>
          {FISCAL_MONTHS.map((month) => (
            <div key={month.key} className="spend-plan-header">
              {month.label}
            </div>
          ))}

          {/* Planned row */}
          <div className="spend-plan-cell row-label">Planned</div>
          {FISCAL_MONTHS.map((month) => (
            <div key={month.key} className="spend-plan-cell">
              {isReadOnly ? (
                <span
                  className={`spend-plan-value ${monthlyValues[month.key] < 0 ? "negative" : ""}`}
                >
                  {formatCurrency(monthlyValues[month.key])}
                </span>
              ) : (
                <div className="spend-plan-input-wrapper">
                  <input
                    type="number"
                    className={`spend-plan-input ${monthlyValues[month.key] < 0 ? "negative" : ""}`}
                    value={monthlyValues[month.key] || ""}
                    onChange={(e) => handleMonthChange(month.key, e.target.value)}
                    disabled={saving}
                    step="0.01"
                  />
                </div>
              )}
            </div>
          ))}

          {/* Actual row (placeholder for future) */}
          <div className="spend-plan-cell row-label spend-plan-row-actual">
            Actual
          </div>
          {FISCAL_MONTHS.map((month) => (
            <div key={month.key} className="spend-plan-cell spend-plan-row-actual">
              <span className="spend-plan-value placeholder">--</span>
            </div>
          ))}

          {/* Variance row (placeholder for future) */}
          <div className="spend-plan-cell row-label spend-plan-row-variance">
            Variance
          </div>
          {FISCAL_MONTHS.map((month) => (
            <div key={month.key} className="spend-plan-cell spend-plan-row-variance">
              <span className="spend-plan-value placeholder">--</span>
            </div>
          ))}
        </div>

        {/* Summary section */}
        <div className="spend-plan-summary">
          <div className="spend-plan-summary-item">
            <span className="spend-plan-summary-label">Total Planned:</span>
            <span className="spend-plan-summary-value">
              {formatCurrency(calculatedTotal)}
            </span>
          </div>
          <div className="spend-plan-summary-item">
            <span className="spend-plan-summary-label">Available:</span>
            <span className="spend-plan-summary-value">
              {formatCurrency(availableAmount)}
            </span>
          </div>
          <div className="spend-plan-summary-item">
            <span className="spend-plan-summary-label">Remaining:</span>
            <span
              className={`spend-plan-summary-value ${isOverBudget ? "over-budget" : "under-budget"}`}
            >
              {formatCurrency(remainingBudget)}
            </span>
          </div>
          {isDirty && !isReadOnly && (
            <span className="spend-plan-dirty-indicator">Unsaved changes</span>
          )}
        </div>

        {/* Warning message when over budget */}
        {isOverBudget && (
          <div className="spend-plan-warning">
            <ErrorCircleRegular className="spend-plan-warning-icon" />
            <span>
              Total planned amount exceeds available budget by{" "}
              {formatCurrency(Math.abs(remainingBudget))}. Please reduce allocations
              before saving.
            </span>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="spend-plan-warning">
            <ErrorCircleRegular className="spend-plan-warning-icon" />
            <span>{error}</span>
          </div>
        )}

        {/* Save button */}
        {!isReadOnly && isDirty && (
          <div className="spend-plan-actions">
            <Button
              appearance="primary"
              icon={<SaveRegular />}
              onClick={handleSave}
              disabled={saving || isOverBudget}
            >
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        )}
      </div>
    </FluentProvider>
  );
};
