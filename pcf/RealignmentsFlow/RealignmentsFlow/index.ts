import * as React from "react";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { RealignmentsFlowApp, RealignmentsFlowProps } from "./RealignmentsFlowApp";

export class RealignmentsFlow implements ComponentFramework.ReactControl<IInputs, IOutputs> {
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
    const ctxAny: any = context.mode as any;
    const props: RealignmentsFlowProps = {
      webAPI: context.webAPI,
      navigation: (context as any).navigation,
      recordId: ctxAny.contextInfo?.entityId,
      amountInput: (context.parameters.amount?.raw as number | null) ?? null,
    };
    return React.createElement(RealignmentsFlowApp, props);
  }

  public getOutputs(): IOutputs {
    return {};
  }

  public destroy(): void {}
}
