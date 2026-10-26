import * as React from "react";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { SwapBuilderApp, SwapBuilderProps } from "./SwapBuilderShell";

export class SwapBuilder implements ComponentFramework.ReactControl<IInputs, IOutputs> {
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
    const props: SwapBuilderProps = {
      webAPI: context.webAPI,
      recordId: ctxAny.contextInfo?.entityId,
      userId: context.userSettings.userId,
    };
    return React.createElement(SwapBuilderApp, props);
  }

  public getOutputs(): IOutputs {
    return {};
  }

  public destroy(): void {
    /* no cleanup required */
  }
}
