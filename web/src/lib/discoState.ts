// What the disco lights are doing right now, shared with the graph (which colours the
// singer's line to match). Written every frame by components/Disco.tsx.
export const discoLive = {
  on: false,
  /** the lights' colour (follows the melody) */
  hue: 280,
  /** 0..1: how much this is one of the song's big lines (all sounds in, singer at full voice) */
  main: 0,
}
