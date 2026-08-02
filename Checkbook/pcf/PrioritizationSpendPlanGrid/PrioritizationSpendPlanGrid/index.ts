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
  }

  public updateView(
    context: ComponentFramework.Context<IInputs>
  ): React.ReactElement {
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
