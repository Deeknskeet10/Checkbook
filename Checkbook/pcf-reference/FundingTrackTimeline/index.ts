import * as React from "react";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { FundingTrackTimelineApp } from "./FundingTrackTimelineApp";

export class FundingTrackTimeline
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
    return React.createElement(FundingTrackTimelineApp, {
      dataset: context.parameters.events,
      navigation: (context as any).navigation,
    });
  }

  public getOutputs(): IOutputs {
    return {};
  }

  public destroy(): void {}
}
