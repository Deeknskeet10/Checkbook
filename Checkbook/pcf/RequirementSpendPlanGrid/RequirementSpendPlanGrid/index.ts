import * as React from "react";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import {
  RequirementSpendPlanGridApp,
  RequirementSpendPlanGridProps,
} from "./components/RequirementSpendPlanGridApp";

export class RequirementSpendPlanGrid
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
  }

  public updateView(
    context: ComponentFramework.Context<IInputs>
  ): React.ReactElement {
    // contextInfo is undocumented but stable — the id of the form's record
    // (same pattern as PrioritizationSpendPlanGrid / ItemizedDetailsGrid).
    const contextInfo = (context.mode as unknown as {
      contextInfo?: { entityId?: string };
    }).contextInfo;
    const props: RequirementSpendPlanGridProps = {
      dataset: context.parameters.requirementFunding,
      webAPI: context.webAPI,
      isDisabled: context.mode.isControlDisabled,
      width: context.mode.allocatedWidth,
      requirementId: contextInfo?.entityId ?? null,
    };
    return React.createElement(RequirementSpendPlanGridApp, props);
  }

  public getOutputs(): IOutputs {
    return {};
  }

  public destroy(): void {
    // no-op
  }
}
