import * as React from "react";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import {
  RealignmentApprovalProcessApp,
  RealignmentApprovalProcessProps,
} from "./components/RealignmentApprovalProcessApp";

export class RealignmentApprovalProcess
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
    const ctxInfo = (context.mode as any).contextInfo ?? {};
    const props: RealignmentApprovalProcessProps = {
      webAPI: context.webAPI,
      userSettings: context.userSettings,
      entityId: ctxInfo.entityId ?? "",
      entityName: ctxInfo.entityTypeName ?? "book_realignments",
      isDisabled: context.mode.isControlDisabled,
      width: context.mode.allocatedWidth,
    };
    return React.createElement(RealignmentApprovalProcessApp, props);
  }

  public getOutputs(): IOutputs {
    return {};
  }

  public destroy(): void {
    // no-op
  }
}
