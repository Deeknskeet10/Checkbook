import * as React from "react";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import {
  PrioritizationFundingGridApp,
  PrioritizationFundingGridProps,
} from "./components/PrioritizationFundingGridApp";

export class PrioritizationFundingGrid
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
    const props: PrioritizationFundingGridProps = {
      dataset: context.parameters.prioritizations,
      webAPI: context.webAPI,
      navigation: context.navigation,
      userSettings: context.userSettings,
      isDisabled: context.mode.isControlDisabled,
      width: context.mode.allocatedWidth,
    };
    return React.createElement(PrioritizationFundingGridApp, props);
  }

  public getOutputs(): IOutputs {
    return {};
  }

  public destroy(): void {
    // no-op
  }
}
