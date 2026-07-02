import * as React from "react";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import {
  TurnInApprovalProcessApp,
  TurnInApprovalProcessProps,
} from "./components/TurnInApprovalProcessApp";

export class TurnInApprovalProcess
  implements ComponentFramework.ReactControl<IInputs, IOutputs>
{
  private notifyOutputChanged: () => void;

  constructor() {
    // Empty
  }

  public init(
    context: ComponentFramework.Context<IInputs>,
    notifyOutputChanged: () => void
  ): void {
    this.notifyOutputChanged = notifyOutputChanged;
    context.mode.trackContainerResize(true);
  }

  public updateView(
    context: ComponentFramework.Context<IInputs>
  ): React.ReactElement {
    // Pull the current record's id and logical name from contextInfo. This is
    // populated on Model-driven app forms and is the standard way for a
    // field-bound PCF to know which record it's rendering against.
    const ctxInfo = (context.mode as any).contextInfo ?? {};
    const props: TurnInApprovalProcessProps = {
      webAPI: context.webAPI,
      userSettings: context.userSettings,
      entityId: ctxInfo.entityId ?? "",
      entityName: ctxInfo.entityTypeName ?? "book_turnin",
      isDisabled: context.mode.isControlDisabled,
      width: context.mode.allocatedWidth,
    };
    return React.createElement(TurnInApprovalProcessApp, props);
  }

  public getOutputs(): IOutputs {
    return {};
  }

  public destroy(): void {
    // no-op
  }
}
