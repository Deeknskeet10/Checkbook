import * as React from "react";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { DecisionLedgerBalanceApp, DecisionLedgerBalanceProps } from "./DecisionLedgerBalanceApp";

export class DecisionLedgerBalance implements ComponentFramework.ReactControl<IInputs, IOutputs> {
  private context!: ComponentFramework.Context<IInputs>;

  public init(context: ComponentFramework.Context<IInputs>): void {
    this.context = context;
    context.mode.trackContainerResize(true);
  }

  public updateView(context: ComponentFramework.Context<IInputs>): React.ReactElement {
    this.context = context;
    const ctxAny: any = context.mode as any;
    const props: DecisionLedgerBalanceProps = {
      dataset: context.parameters.decisions,
      webAPI: context.webAPI,
      navigation: (context as any).navigation,
      parentEntityName: ctxAny.contextInfo?.entityTypeName,
      parentEntityId: ctxAny.contextInfo?.entityId,
      parentRecordName: ctxAny.contextInfo?.entityRecordName,
    };
    return React.createElement(DecisionLedgerBalanceApp, props);
  }

  public getOutputs(): IOutputs {
    return {};
  }

  public destroy(): void {}
}
