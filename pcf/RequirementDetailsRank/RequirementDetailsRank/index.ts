import * as React from "react";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { RequirementDetailsRankApp } from "./RequirementDetailsRankApp";

const PAGE_SIZE = 500;

export class RequirementDetailsRank
  implements ComponentFramework.ReactControl<IInputs, IOutputs>
{
  private context!: ComponentFramework.Context<IInputs>;
  private pageSizeSet = false;

  public init(context: ComponentFramework.Context<IInputs>): void {
    this.context = context;
    context.mode.trackContainerResize(true);
  }

  public updateView(context: ComponentFramework.Context<IInputs>): React.ReactElement {
    this.context = context;
    const dataset = context.parameters.details;

    if (!dataset.loading) {
      if (!this.pageSizeSet) {
        this.pageSizeSet = true;
        dataset.paging.setPageSize(PAGE_SIZE);
        dataset.refresh();
      } else if (dataset.paging.hasNextPage) {
        dataset.paging.loadNextPage();
      }
    }

    const ctxAny: any = context.mode as any;
    return React.createElement(RequirementDetailsRankApp, {
      dataset,
      webAPI: context.webAPI,
      navigation: (context as any).navigation,
      parentRequirementId: ctxAny.contextInfo?.entityId,
    });
  }

  public getOutputs(): IOutputs {
    return {};
  }

  public destroy(): void {
    // No teardown required — React unmount is handled by the framework.
  }
}
