import * as React from "react";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { UnfundedRequestsRankApp } from "./UnfundedRequestsRankApp";

export class UnfundedRequestsRank
  implements ComponentFramework.ReactControl<IInputs, IOutputs>
{
  private context!: ComponentFramework.Context<IInputs>;
  private notifyOutputChanged!: () => void;

  public init(
    context: ComponentFramework.Context<IInputs>,
    notifyOutputChanged: () => void
  ): void {
    this.context = context;
    this.notifyOutputChanged = notifyOutputChanged;
  }

  public updateView(context: ComponentFramework.Context<IInputs>): React.ReactElement {
    this.context = context;
    return React.createElement(UnfundedRequestsRankApp, {
      dataset: context.parameters.ufrs,
      webAPI: context.webAPI,
      navigation: (context as any).navigation,
    });
  }

  public getOutputs(): IOutputs {
    return {};
  }

  public destroy(): void {}
}
