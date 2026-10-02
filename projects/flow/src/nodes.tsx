// The four node kinds. One component; the kind only changes the class (shape and colour live in
// flow.css). Every kind can be connected: a target dot on top, a source dot below.
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { FlowNode } from './doc';

function FlowNodeView({ data, type, selected }: NodeProps<FlowNode>) {
  return (
    <div className={`fnode fnode--${type}${selected ? ' is-selected' : ''}`}>
      <Handle type="target" position={Position.Top} className="fhandle" />
      <span className="fnode-label">{data.label || ' '}</span>
      <Handle type="source" position={Position.Bottom} className="fhandle" />
    </div>
  );
}

export const nodeTypes = { process: FlowNodeView, decision: FlowNodeView, io: FlowNodeView, note: FlowNodeView };
