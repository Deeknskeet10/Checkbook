import * as React from "react";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { LINRequestsGridApp, LINRequestsGridProps } from "./LINRequestsGridApp";

export class LINRequestsGrid implements ComponentFramework.ReactControl<IInputs, IOutputs> {
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
    const ctxAny: any = context.mode as any;
    const props: LINRequestsGridProps = {
      dataset: context.parameters.linrequests,
      webAPI: context.webAPI,
      navigation: (context as any).navigation,
      parentPrioritizationId: ctxAny.contextInfo?.entityId,
      parentPrioritizationName: ctxAny.contextInfo?.entityRecordName,
    };
    return React.createElement(LINRequestsGridApp, props);
  }

  public getOutputs(): IOutputs {
    return {};
  }

  public destroy(): void {}
}
