import * as React from "react";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { SpendPlanGridApp } from "./SpendPlanGridApp";

export class SpendPlanGrid implements ComponentFramework.ReactControl<IInputs, IOutputs> {
  private context!: ComponentFramework.Context<IInputs>;
  private notifyOutputChanged!: () => void;

  public init(
    context: ComponentFramework.Context<IInputs>,
    notifyOutputChanged: () => void
  ): void {
    this.context = context;
    this.notifyOutputChanged = notifyOutputChanged;
    context.mode.trackContainerResize(true);
  }

  public updateView(context: ComponentFramework.Context<IInputs>): React.ReactElement {
    this.context = context;
    return React.createElement(SpendPlanGridApp, {
      dataset: context.parameters.spendplans,
      navigation: (context as any).navigation,
    });
  }

  public getOutputs(): IOutputs {
    return {};
  }

  public destroy(): void {}
}
