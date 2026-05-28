import * as React from "react";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { PendingRealignmentsQueueApp, PendingRealignmentsQueueProps } from "./PendingRealignmentsQueueApp";

export class PendingRealignmentsQueue implements ComponentFramework.ReactControl<IInputs, IOutputs> {
  private context!: ComponentFramework.Context<IInputs>;

  public init(context: ComponentFramework.Context<IInputs>): void {
    this.context = context;
    context.mode.trackContainerResize(true);
  }

  public updateView(context: ComponentFramework.Context<IInputs>): React.ReactElement {
    this.context = context;
    const props: PendingRealignmentsQueueProps = {
      dataset: context.parameters.realignments,
      navigation: (context as any).navigation,
    };
    return React.createElement(PendingRealignmentsQueueApp, props);
  }

  public getOutputs(): IOutputs {
    return {};
  }

  public destroy(): void {}
}
