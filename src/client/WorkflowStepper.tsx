import React from "react";
import { workspaceSteps, type WorkspaceStep, type WorkflowStatus } from "./workflow";

const statusLabel: Record<WorkflowStatus, string> = {
  "not-started": "Belum dimulai",
  active: "Sedang dikerjakan",
  complete: "Selesai",
  attention: "Perlu perhatian",
};

export function WorkflowStepper({ activeStep, statuses, onSelect }: { activeStep: WorkspaceStep; statuses: Record<WorkspaceStep, WorkflowStatus>; onSelect: (step: WorkspaceStep) => void }) {
  return <nav className="workflow-stepper" aria-label="Langkah pembuatan video">
    <ol>
      {workspaceSteps.map((step, index) => {
        const status = statuses[step.id];
        return <li key={step.id}>
          <button type="button" className={`workflow-step ${status} ${activeStep === step.id ? "selected" : ""}`} data-step-id={step.id} aria-current={activeStep === step.id ? "step" : undefined} aria-label={`${index + 1}. ${step.title}: ${statusLabel[status]}`} onClick={() => onSelect(step.id)}>
            <span className="workflow-step-index" aria-hidden="true">{status === "complete" ? "✓" : index + 1}</span>
            <span className="workflow-step-copy"><strong>{step.title}</strong><small>{step.description}</small><em>{statusLabel[status]}</em></span>
          </button>
        </li>;
      })}
    </ol>
  </nav>;
}
