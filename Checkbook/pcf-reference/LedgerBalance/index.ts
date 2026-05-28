import * as React from "react";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { LedgerBalanceApp } from "./LedgerBalanceApp";

export class LedgerBalance implements ComponentFramework.ReactControl<IInputs, IOutputs> {
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
    return React.createElement(LedgerBalanceApp, {
      dataset: context.parameters.ledger,
      navigation: (context as any).navigation,
      webAPI: context.webAPI,
      parentEntityName: ctxAny.contextInfo?.entityTypeName,
      parentEntityId: ctxAny.contextInfo?.entityId,
      parentEntityName_record: ctxAny.contextInfo?.entityRecordName,
    });
  }

  public getOutputs(): IOutputs {
    return {};
  }

  public destroy(): void {}
}
