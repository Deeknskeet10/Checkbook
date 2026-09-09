import * as React from "react";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import {
  PrioritizationSpendPlanGridApp,
  PrioritizationSpendPlanGridProps,
} from "./components/PrioritizationSpendPlanGridApp";

export class PrioritizationSpendPlanGrid
  implements ComponentFramework.ReactControl<IInputs, IOutputs>
{
  private notifyOutputChanged: () => void;

  constructor() {
    // Empty
  }

  public init(
    context: ComponentFramework.Context<IInputs>,
    notifyOutputChanged: () => void
  ): void {
    this.notifyOutputChanged = notifyOutputChanged;
    context.mode.trackContainerResize(true);

    // Dataverse subgrids default to a small page size (typically the form's
    // "Rows" setting, often ~5). Without this, the PCF only ever sees the first
    // page of records — the rest are invisible no matter how the UI scrolls, so
    // a Prioritization with 7 RF allocations can render as few as 4-5 rows.
    // Pull a large page so every Prioritization Funding row renders in full.
    const paging = context.parameters.prioritizationFunding?.paging as
      | (ComponentFramework.PropertyTypes.DataSet["paging"] & {
          setPageSize?: (size: number) => void;
        })
      | undefined;
    if (paging && typeof paging.setPageSize === "function") {
      paging.setPageSize(5000);
    }
  }

  public updateView(
    context: ComponentFramework.Context<IInputs>
  ): React.ReactElement {
    // If the dataset still reports more pages after setPageSize(5000), pull them.
    // Each loadNextPage triggers another updateView; converges at hasNextPage = false.
    const paging = context.parameters.prioritizationFunding?.paging;
    if (paging && paging.hasNextPage && typeof paging.loadNextPage === "function") {
      paging.loadNextPage();
    }

    // contextInfo is undocumented but stable — the id of the form's record
    // (same pattern as ItemizedDetailsGrid / LINRequestsGrid).
    const contextInfo = (context.mode as unknown as {
      contextInfo?: { entityId?: string };
    }).contextInfo;
    const props: PrioritizationSpendPlanGridProps = {
      dataset: context.parameters.prioritizationFunding,
      webAPI: context.webAPI,
      isDisabled: context.mode.isControlDisabled,
      width: context.mode.allocatedWidth,
      prioritizationId: contextInfo?.entityId ?? null,
    };
    return React.createElement(PrioritizationSpendPlanGridApp, props);
  }

  public getOutputs(): IOutputs {
    return {};
  }

  public destroy(): void {
    // no-op
  }
}
