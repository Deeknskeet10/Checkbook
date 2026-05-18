import * as React from "react";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { SuppliesGridApp, SuppliesGridProps } from "./SuppliesGridApp";

export class SuppliesGrid implements ComponentFramework.ReactControl<IInputs, IOutputs> {
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
    const props: SuppliesGridProps = {
      dataset: context.parameters.supplies,
      webAPI: context.webAPI,
      navigation: (context as any).navigation,
      utils: (context as any).utils,
      parentPrioritizationId: ctxAny.contextInfo?.entityId,
      parentPrioritizationName: ctxAny.contextInfo?.entityRecordName,
      requirementLookupField:
        context.parameters.requirementIdField?.raw || "book_requirement",
    };
    return React.createElement(SuppliesGridApp, props);
  }

  public getOutputs(): IOutputs {
    return {};
  }

  public destroy(): void {}
}
