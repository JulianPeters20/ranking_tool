// Gemeinsamer Render-Status fuer Ranking-Video und freien Schnitt. Beide
// nutzen ffmpeg und denselben Ausgabeordner, daher darf immer nur einer
// laufen -- und das Frontend fragt denselben Status ab.
//
//   kind: 'ranking' | 'cut' | null   -- was gerade laeuft/zuletzt lief
let state = { status: 'idle', kind: null, outputFile: null, error: null, projectId: null };

function getRenderStatus() {
  return state;
}

function setRenderStatus(next) {
  state = { ...state, ...next };
  return state;
}

function isRendering() {
  return state.status === 'running';
}

module.exports = { getRenderStatus, setRenderStatus, isRendering };
