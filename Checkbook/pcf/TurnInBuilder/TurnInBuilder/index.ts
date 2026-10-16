import * as React from "react";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { TurnInBuilderApp, TurnInBuilderProps } from "./TurnInBuilderShell";

export class TurnInBuilder implements ComponentFramework.ReactControl<IInputs, IOutputs> {
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
    const props: TurnInBuilderProps = {
      webAPI: context.webAPI,
      recordId: ctxAny.contextInfo?.entityId,
      userId: context.userSettings.userId,
    };
    return React.createElement(TurnInBuilderApp, props);
  }

  public getOutputs(): IOutputs {
    return {};
  }

  public destroy(): void {
    /* no cleanup required */
  }
}
