import * as React from "react";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import {
  StateSpendPlanGridApp,
  StateSpendPlanGridProps,
} from "./components/StateSpendPlanGridApp";

export class StateSpendPlanGrid
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
    const props: StateSpendPlanGridProps = {
      webAPI: context.webAPI,
      isDisabled: context.mode.isControlDisabled,
      width: context.mode.allocatedWidth,
      stateId: context.parameters.stateId.raw ?? null,
      fiscalYear: context.parameters.fiscalYear.raw ?? null,
    };
    return React.createElement(StateSpendPlanGridApp, props);
  }

  public getOutputs(): IOutputs {
    return {};
  }

  public destroy(): void {
    // no-op
  }
}
