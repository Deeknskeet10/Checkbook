import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { SpendPlanGrid } from "./SpendPlanGrid";
import * as React from "react";

export class SpendPlanCalendar
  implements ComponentFramework.ReactControl<IInputs, IOutputs>
{
  private _notifyOutputChanged: () => void;
  private _context: ComponentFramework.Context<IInputs>;

  constructor() {
    // Empty constructor
  }

  public init(
    context: ComponentFramework.Context<IInputs>,
    notifyOutputChanged: () => void,
    _state: ComponentFramework.Dictionary
  ): void {
    this._context = context;
    this._notifyOutputChanged = notifyOutputChanged;

    // Ensure we can access the WebAPI
    context.mode.trackContainerResize(true);
  }

  public updateView(
    context: ComponentFramework.Context<IInputs>
  ): React.ReactElement {
    this._context = context;

    // Get the parent record ID from the bound property
    // The bound property should be mapped to the primary key field
    const parentRecordId = context.parameters.parentRecordId?.raw || "";

    // Get the parent entity type from the input property
    const parentEntityType = context.parameters.parentEntityType?.raw || "";

    // Get read-only flag
    const isReadOnly =
      context.parameters.isReadOnly?.raw === true ||
      context.mode.isControlDisabled;

    // Get the WebAPI from context
    const webAPI = context.webAPI;

    return React.createElement(SpendPlanGrid, {
      webAPI: webAPI,
      parentRecordId: parentRecordId,
      parentEntityType: parentEntityType,
      isReadOnly: isReadOnly,
      onSaveComplete: () => {
        this._notifyOutputChanged();
      },
    });
  }

  public getOutputs(): IOutputs {
    return {};
  }

  public destroy(): void {
    // Cleanup if necessary
  }
}
