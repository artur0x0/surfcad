/** Match feature-bar routing: highlight a part before part-stack undo. */
export async function focusPartHistoryForUndo(page, agentCall) {
  const hist = await agentCall(page, 'history', {});
  if (hist.result?.kind === 'part') return;
  const parts = await agentCall(page, 'parts', {});
  const id = parts.result?.activeId || parts.result?.parts?.[0]?.id;
  if (id) await agentCall(page, 'select_parts', { part_id: id });
}
