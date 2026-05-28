import * as React from "react";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { PrioritizationsForRequirementApp, PrioritizationsForRequirementProps } from "./PrioritizationsForRequirementApp";

export class PrioritizationsForRequirement implements ComponentFramework.ReactControl<IInputs, IOutputs> {
  private context!: ComponentFramework.Context<IInputs>;

  public init(context: ComponentFramework.Context<IInputs>): void {
    this.context = context;
    context.mode.trackContainerResize(true);
  }

  public updateView(context: ComponentFramework.Context<IInputs>): React.ReactElement {
    this.context = context;
    const ctxAny: any = context.mode as any;
    const props: PrioritizationsForRequirementProps = {
      dataset: context.parameters.prioritizations,
      webAPI: context.webAPI,
      navigation: (context as any).navigation,
      parentRequirementId: ctxAny.contextInfo?.entityId,
    };
    return React.createElement(PrioritizationsForRequirementApp, props);
  }

  public getOutputs(): IOutputs {
    return {};
  }

  public destroy(): void {}
}
