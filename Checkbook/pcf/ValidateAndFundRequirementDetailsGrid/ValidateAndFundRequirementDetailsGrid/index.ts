import * as React from "react";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import {
  ValidateAndFundRequirementDetailsGridApp,
  ValidateAndFundRequirementDetailsGridProps,
} from "./components/ValidateAndFundRequirementDetailsGridApp";

export class ValidateAndFundRequirementDetailsGrid
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
    // "Rows" setting, often 5). Pull a large page so an RF with many child
    // Requirement Detail Funding rows renders in full.
    const paging = context.parameters.requirementDetailFundings?.paging as
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
    const paging = context.parameters.requirementDetailFundings?.paging;
    if (paging && paging.hasNextPage && typeof paging.loadNextPage === "function") {
      paging.loadNextPage();
    }

    const ctxInfo = (context.mode as unknown as {
      contextInfo?: { entityId?: string; entityRecordName?: string };
    }).contextInfo;

    const props: ValidateAndFundRequirementDetailsGridProps = {
      dataset: context.parameters.requirementDetailFundings,
      webAPI: context.webAPI,
      navigation: (context as unknown as { navigation: ComponentFramework.Navigation }).navigation,
      isDisabled: context.mode.isControlDisabled,
      requirementFundingId: ctxInfo?.entityId,
      requirementFundingName: ctxInfo?.entityRecordName,
    };
    return React.createElement(ValidateAndFundRequirementDetailsGridApp, props);
  }

  public getOutputs(): IOutputs {
    return {};
  }

  public destroy(): void {
    // no-op
  }
}
