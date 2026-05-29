import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { CalendarApp, ICalendarProps } from "./CalendarApp";
import * as React from "react";

export class Calendar implements ComponentFramework.ReactControl<IInputs, IOutputs> {
    private notifyOutputChanged: () => void;

    constructor() {
        // Empty
    }

    public init(
        context: ComponentFramework.Context<IInputs>,
        notifyOutputChanged: () => void,
        state: ComponentFramework.Dictionary
    ): void {
        this.notifyOutputChanged = notifyOutputChanged;
        context.mode.trackContainerResize(true);
        // Load events in a single large page so the whole window is available.
        const paging = context.parameters.events.paging as unknown as { setPageSize?: (n: number) => void };
        paging.setPageSize?.(500);
    }

    public updateView(context: ComponentFramework.Context<IInputs>): React.ReactElement {
        const view = context.parameters.defaultView.raw;
        const props: ICalendarProps = {
            dataset: context.parameters.events,
            webAPI: context.webAPI,
            defaultView: view === "twoWeek" ? "twoWeek" : "thirtyDay",
            width: context.mode.allocatedWidth,
            height: context.mode.allocatedHeight,
            refresh: () => context.parameters.events.refresh(),
        };
        return React.createElement(CalendarApp, props);
    }

    public getOutputs(): IOutputs {
        return {};
    }

    public destroy(): void {
        // Add code to cleanup control if necessary
    }
}
