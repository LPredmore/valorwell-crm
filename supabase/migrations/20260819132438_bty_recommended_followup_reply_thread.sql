update public.relationship_campaign_steps
set subject_template='Re: {{organization_name}} was recommended for Beyond The Yellow',
    metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
      'sendAsReply',true,
      'replyToStepPosition',1,
      'threadingPolicy','rfc_message_id'
    ),
    updated_at=now()
where campaign_id='292d66f7-041b-4faf-873e-20631db4c120'::uuid
  and position=2;