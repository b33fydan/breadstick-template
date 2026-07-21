import {
  createVisualParamsPacket,
  normalizeVisualParams,
} from './contracts.js';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function packetLike(value) {
  if (!isRecord(value)) return null;

  if ('type' in value || 'version' in value || 'channels' in value) return value;
  if (isRecord(value.visualParams)) return wrapParams(value.visualParams);
  if (isRecord(value.packet)) return wrapParams(value.packet);
  if (isRecord(value.params)) return wrapParams(value.params);
  return null;
}

function wrapParams(params) {
  if (!isRecord(params)) return null;
  if ('type' in params || 'version' in params || 'channels' in params) return params;
  return {
    type: 'visual-params',
    version: 1,
    sourceKind: 'field-controls',
    priority: 100,
    channels: params,
  };
}

function packetFromSourceNode(sourceId, nodes) {
  const sourceNode = Array.isArray(nodes) ? nodes.find((node) => node?.id === sourceId) : null;
  if (!sourceNode || sourceNode.type !== 'visual-controls' || !isRecord(sourceNode.data)) return null;

  if (isRecord(sourceNode.data.packet)) return wrapParams(sourceNode.data.packet);
  if (isRecord(sourceNode.data.params)) return wrapParams(sourceNode.data.params);
  return null;
}

function describePacket(packet) {
  if (!isRecord(packet)) return 'no packet';
  return `${String(packet.type ?? 'untyped')}@${String(packet.version ?? '?')}`;
}

function validatePacket(packet, sourceId) {
  if (!isRecord(packet)) {
    return { ok: false, error: null };
  }
  if (packet.type !== 'visual-params') {
    return {
      ok: false,
      error: `Field Controls connection "${sourceId}" must provide visual-params@1; received ${describePacket(packet)}.`,
    };
  }
  if (packet.version !== 1) {
    return {
      ok: false,
      error: `Visual params version mismatch from "${sourceId}": expected visual-params@1; received ${describePacket(packet)}.`,
    };
  }
  if (!isRecord(packet.channels)) {
    return {
      ok: false,
      error: `Invalid visual-params@1 packet from "${sourceId}": channels must be an object.`,
    };
  }
  return { ok: true, error: null };
}

/**
 * Resolves graph control data at render time. This is deliberately a pure
 * function: callers pass the current edges/nodeOutputs on every React render,
 * and no graph state or React hook is retained here.
 */
export function resolveVisualInputs({
  targetId,
  edges,
  nodeOutputs,
  localParams,
  nodes,
} = {}) {
  const local = normalizeVisualParams(localParams);
  const inbound = Array.isArray(edges)
    ? edges.find((edge) => edge?.target === targetId && edge?.targetHandle === 'params-in')
    : null;

  if (!inbound) {
    return {
      params: local,
      packet: null,
      connected: false,
      sourceId: null,
      error: null,
    };
  }

  const sourceId = inbound.source;
  const currentOutput = isRecord(nodeOutputs) ? nodeOutputs[sourceId] : null;
  let candidate = packetLike(currentOutput);
  if (!candidate) candidate = packetFromSourceNode(sourceId, nodes);

  const validation = validatePacket(candidate, sourceId);
  if (!validation.ok) {
    return {
      params: local,
      packet: null,
      connected: true,
      sourceId,
      error: validation.error,
    };
  }

  const params = normalizeVisualParams(candidate.channels, local);
  const packet = createVisualParamsPacket(params, {
    sourceKind: candidate.sourceKind,
    priority: candidate.priority,
  });

  return {
    params,
    packet,
    connected: true,
    sourceId,
    error: null,
  };
}
