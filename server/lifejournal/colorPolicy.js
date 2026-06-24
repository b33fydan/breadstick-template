// Whether the default LUT applies to a clip. The container `colorTransfer`
// mislabels D-Log M as bt709, so we NEVER read it for the positive case — default LOG,
// with HLG and the opt-out lists as the only negatives. See spec §5.2.
const HLG = 'arib-std-b67';

export function isLog(clip, { logDefault = true, nonLogLanes = [], nonLogRels = [] } = {}) {
  if (!logDefault) return false;
  if (clip.colorTransfer === HLG) return false;
  if (nonLogLanes.includes(clip.lane)) return false;
  if (nonLogRels.includes(clip.rel)) return false;
  return true;
}
