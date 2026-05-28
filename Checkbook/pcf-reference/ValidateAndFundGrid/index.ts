import * as React from "react";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { ValidateAndFundGridApp, ValidateAndFundGridProps } from "./ValidateAndFundGridApp";

export class ValidateAndFundGrid implements ComponentFramework.ReactControl<IInputs, IOutputs> {
  private context!: ComponentFramework.Context<IInputs>;

  public init(context: ComponentFramework.Context<IInputs>): void {
    this.context = context;
    context.mode.trackContainerResize(true);
  }

  public updateView(context: ComponentFramework.Context<IInputs>): React.ReactElement {
    this.context = context;
    const ctxAny: any = context.mode as any;
    const props: ValidateAndFundGridProps = {
      dataset: context.parameters.prioritizations,
      webAPI: context.webAPI,
      navigation: (context as any).navigation,
      parentRequirementFundingId: ctxAny.contextInfo?.entityId,
      parentRequirementFundingName: ctxAny.contextInfo?.entityRecordName,
    };
    return React.createElement(ValidateAndFundGridApp, props);
  }

  public getOutputs(): IOutputs {
    return {};
  }

  public destroy(): void {}
}
