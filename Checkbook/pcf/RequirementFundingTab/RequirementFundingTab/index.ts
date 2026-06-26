import * as React from "react";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { RequirementFundingTabApp } from "./components/RequirementFundingTabApp";

export class RequirementFundingTab
  implements ComponentFramework.ReactControl<IInputs, IOutputs>
{
  private context!: ComponentFramework.Context<IInputs>;

  public init(context: ComponentFramework.Context<IInputs>): void {
    this.context = context;
    context.mode.trackContainerResize(true);
  }

  public updateView(context: ComponentFramework.Context<IInputs>): React.ReactElement {
    this.context = context;
    const ctxAny = context.mode as unknown as {
      contextInfo?: { entityId?: string; entityTypeName?: string };
    };
    return React.createElement(RequirementFundingTabApp, {
      webAPI: context.webAPI,
      navigation: (context as unknown as { navigation: ComponentFramework.Navigation }).navigation,
      parentRequirementId: ctxAny.contextInfo?.entityId ?? null,
      isDisabled: context.mode.isControlDisabled,
    });
  }

  public getOutputs(): IOutputs {
    return {};
  }

  public destroy(): void {
    // React unmount handled by the framework.
  }
}
