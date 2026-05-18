import * as React from "react";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import {
  ValidateAndFundGridApp,
  ValidateAndFundGridProps,
} from "./components/ValidateAndFundGridApp";

export class ValidateAndFundGrid
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
    const ctxInfo = (context.mode as unknown as {
      contextInfo?: { entityId?: string; entityRecordName?: string };
    }).contextInfo;

    const props: ValidateAndFundGridProps = {
      dataset: context.parameters.prioritizations,
      webAPI: context.webAPI,
      isDisabled: context.mode.isControlDisabled,
      requirementFundingId: ctxInfo?.entityId,
      requirementFundingName: ctxInfo?.entityRecordName,
    };
    return React.createElement(ValidateAndFundGridApp, props);
  }

  public getOutputs(): IOutputs {
    return {};
  }

  public destroy(): void {
    // no-op
  }
}
