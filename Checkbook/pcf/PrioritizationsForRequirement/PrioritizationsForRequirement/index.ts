import * as React from "react";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { PrioritizationsForRequirementApp, PrioritizationsForRequirementProps } from "./PrioritizationsForRequirementApp";

// Dataverse subgrids default to whatever "Rows" the form designer set (often
// 10–12). Override before the first fetch so the PCF sees the full set;
// 5000 is the documented platform max. If a Requirement somehow has more than
// 5000 Prioritizations, the updateView loop drains remaining pages.
const PAGE_SIZE = 5000;

export class PrioritizationsForRequirement implements ComponentFramework.ReactControl<IInputs, IOutputs> {
  public init(context: ComponentFramework.Context<IInputs>): void {
    context.mode.trackContainerResize(true);

    const paging = context.parameters.prioritizations?.paging as
      | (ComponentFramework.PropertyTypes.DataSet["paging"] & {
          setPageSize?: (size: number) => void;
        })
      | undefined;
    if (paging && typeof paging.setPageSize === "function") {
      paging.setPageSize(PAGE_SIZE);
    }
  }

  public updateView(context: ComponentFramework.Context<IInputs>): React.ReactElement {
    const dataset = context.parameters.prioritizations;

    // If anything pushed us past the first page (extra-large parent, or the
    // initial setPageSize was capped lower than expected), drain remaining
    // pages. Each loadNextPage triggers another updateView; the loop converges
    // when hasNextPage = false.
    if (!dataset.loading && dataset.paging.hasNextPage && typeof dataset.paging.loadNextPage === "function") {
      dataset.paging.loadNextPage();
    }

    const ctxAny: any = context.mode as any;
    const props: PrioritizationsForRequirementProps = {
      dataset,
      webAPI: context.webAPI,
      navigation: (context as any).navigation,
      parentRequirementId: ctxAny.contextInfo?.entityId,
    };
    return React.createElement(PrioritizationsForRequirementApp, props);
  }

  public getOutputs(): IOutputs {
    return {};
  }

  public destroy(): void {
    // no-op
  }
}
