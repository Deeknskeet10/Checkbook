import * as React from "react";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import {
  ItemizedDetailsGridApp,
  ItemizedDetailsGridProps,
} from "./components/ItemizedDetailsGridApp";

export class ItemizedDetailsGrid
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
    const props: ItemizedDetailsGridProps = {
      dataset: context.parameters.itemizedDetails,
      webAPI: context.webAPI,
      navigation: context.navigation,
      isDisabled: context.mode.isControlDisabled,
      width: context.mode.allocatedWidth,
    };
    return React.createElement(ItemizedDetailsGridApp, props);
  }

  public getOutputs(): IOutputs {
    return {};
  }

  public destroy(): void {
    // no-op
  }
}
