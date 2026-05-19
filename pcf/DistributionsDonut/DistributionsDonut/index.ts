import * as React from "react";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { DistributionsDonutApp, DistributionsDonutProps } from "./DistributionsDonutApp";

export class DistributionsDonut implements ComponentFramework.ReactControl<IInputs, IOutputs> {
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
    const props: DistributionsDonutProps = {
      dataset: context.parameters.distributions,
      defaultGroupBy: (context.parameters.defaultGroupBy?.raw as any) || "fundCenter",
    };
    return React.createElement(DistributionsDonutApp, props);
  }

  public getOutputs(): IOutputs {
    return {};
  }

  public destroy(): void {}
}
