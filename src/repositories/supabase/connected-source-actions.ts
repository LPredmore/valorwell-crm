import { connectedSourceAction } from '@/domain/pipelines/connected-source-actions';
import type { CrmPipeline } from '@/domain/pipelines/models';
import type { ConnectedPipelineCard } from './connected-pipeline-cards';
import { transitionApplicantPipelineCard } from './applicant-connected-transition';
import { transitionBtyPipelineCard } from './bty-connected-transition';

const transitions = {
  relationship_opportunities: transitionBtyPipelineCard,
  provider_applicants: transitionApplicantPipelineCard,
};

/** No generic table mutation or fallback for unsupported/clinical sources. */
export async function transitionConnectedSourceCard(pipeline: CrmPipeline, card: ConnectedPipelineCard, destination: string, reason: string) {
  const action = connectedSourceAction(pipeline.source_key, card.sourceStatus ?? '');
  if (pipeline.source_mode !== 'connected' || !action || card.sourceVersion === undefined
    || card.sourceKind === 'therapist_prospect' || !action.destinations.includes(destination)) {
    throw new Error('This source change must use its authorized source workspace.');
  }
  await transitions[action.source](pipeline, card, destination, reason);
}
