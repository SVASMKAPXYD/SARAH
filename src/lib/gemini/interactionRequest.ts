type InteractionInput = Array<
  | { type: 'image'; data: string; mime_type: 'image/jpeg' | 'image/png'; resolution?: 'low' | 'medium' | 'high' }
  | { type: 'text'; text: string }
>;

export function buildFreshDecisionInteraction(args: {
  model: string;
  system: string;
  input: InteractionInput;
  schema: Record<string, unknown>;
}) {
  return {
    model: args.model,
    system_instruction: args.system,
    input: args.input,
    response_format: { type: 'text' as const, mime_type: 'application/json', schema: args.schema },
    generation_config: { thinking_level: 'low' as const, thinking_summaries: 'auto' as const },
    store: false as const,
  };
}
