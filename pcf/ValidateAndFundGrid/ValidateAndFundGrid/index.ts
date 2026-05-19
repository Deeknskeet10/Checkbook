import * as React from "react";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import {
  ValidateAndFundGridApp,
  ValidateAndFundGridProps,
} from "./components/ValidateAndFundGridApp";

export class ValidateAndFundGrid
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
    // "Rows" setting, often 5). Without this, the PCF only ever sees the first
    // page of records — the rest are invisible no matter how the UI scrolls.
    // Pull a large page so an RF with many child Prioritizations renders in full.
    const paging = context.parameters.prioritizations?.paging as
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
    // If the dataset still reports more pages after setPageSize(5000) (eg. an
    // RF with literally thousands of children), pull them. Each loadNextPage
    // triggers another updateView; this converges when hasNextPage = false.
    const paging = context.parameters.prioritizations?.paging;
    if (paging && paging.hasNextPage && typeof paging.loadNextPage === "function") {
      paging.loadNextPage();
    }

    const ctxInfo = (context.mode as unknown as {
      contextInfo?: { entityId?: string; entityRecordName?: string };
    }).contextInfo;

    const props: ValidateAndFundGridProps = {
      dataset: context.parameters.prioritizations,
      webAPI: context.webAPI,
      isDisabled: context.mode.isControlDisabled,
      requirementFundingId: ctxInfo?.entityId,
      requirementFundingName: ctxInfo?.entityRecordName,
    };
    return React.createElement(ValidateAndFundGridApp, props);
  }

  public getOutputs(): IOutputs {
    return {};
  }

  public destroy(): void {
    // no-op
  }
}
