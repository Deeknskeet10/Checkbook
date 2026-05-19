import * as React from "react";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { LedgersDonutApp, LedgersDonutProps } from "./LedgersDonutApp";

export class LedgersDonut implements ComponentFramework.ReactControl<IInputs, IOutputs> {
  private context!: ComponentFramework.Context<IInputs>;

  public init(context: ComponentFramework.Context<IInputs>): void {
    this.context = context;
    context.mode.trackContainerResize(true);
  }

  public updateView(context: ComponentFramework.Context<IInputs>): React.ReactElement {
    this.context = context;
    const props: LedgersDonutProps = {
      dataset: context.parameters.ledgers,
      defaultGroupBy: (context.parameters.defaultGroupBy?.raw as any) || "ledgerType",
    };
    return React.createElement(LedgersDonutApp, props);
  }

  public getOutputs(): IOutputs {
    return {};
  }

  public destroy(): void {}
}
