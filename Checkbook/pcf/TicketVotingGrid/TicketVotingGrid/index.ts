import * as React from "react";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import {
  TicketVotingGridApp,
  TicketVotingGridProps,
} from "./components/TicketVotingGridApp";

export class TicketVotingGrid
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
    const props: TicketVotingGridProps = {
      dataset: context.parameters.tickets,
      webAPI: context.webAPI,
      navigation: context.navigation,
      userSettings: context.userSettings,
      isDisabled: context.mode.isControlDisabled,
      width: context.mode.allocatedWidth,
    };
    return React.createElement(TicketVotingGridApp, props);
  }

  public getOutputs(): IOutputs {
    return {};
  }

  public destroy(): void {
    // no-op
  }
}
